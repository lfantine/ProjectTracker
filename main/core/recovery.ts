import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { DataPaths } from '../helpers/paths'
import { acquireDataLock } from '../db/lock'
import { LATEST_SCHEMA_VERSION, openDatabase } from '../db/database'
import { verifyManagedVersion } from '../packages/managedVersion'

interface FileRecord { path: string; size: number; sha256: string }
const LIMIT = 2 * 1024 * 1024 * 1024

// Native recovery inputs are untrusted: never follow a symlink or accept an
// absolute/parent path, including paths declared by SQLite package metadata.
export function inventoryRecoveryFiles(root: string): FileRecord[] {
  const result: FileRecord[] = []
  let total = 0
  const visit = (directory: string, prefix: string, depth: number) => {
    if (depth > 20) throw Error('RECOVERY_LIMIT')
    const info = fs.lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('RECOVERY_PATH')
    for (const name of fs.readdirSync(directory).sort()) {
      if (name.includes('\\') || name.includes(':')) throw Error('RECOVERY_PATH')
      const relative = prefix + name
      if (relative === 'backup.json') continue
      const file = path.join(directory, name), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw Error('RECOVERY_PATH')
      if (stat.isDirectory()) { visit(file, relative + '/', depth + 1); continue }
      if (!stat.isFile() || result.length >= 50000 || (total += stat.size) > LIMIT) throw Error('RECOVERY_LIMIT')
      result.push({ path: relative, size: stat.size, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') })
    }
  }
  visit(root, '', 0)
  return result
}

export async function validateRecoveryDatabase(file: string, managedRoot: string): Promise<void> {
  // Even a read-only WAL connection may create SHM/WAL sidecars. Inspect a
  // disposable copy so verification never writes into the selected backup.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-verify-'))
  fs.copyFileSync(file, path.join(temporary, 'snapshot.sqlite'))
  let db: DatabaseSync | undefined
  let reference: Awaited<ReturnType<typeof openDatabase>> | undefined
  try {
    db = new DatabaseSync(path.join(temporary, 'snapshot.sqlite'), { readOnly: true, allowExtension: false })
    reference = await openDatabase(':memory:')
    db.exec('PRAGMA trusted_schema = OFF')
    const schema = (connection: DatabaseSync) => connection.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all()
    if (JSON.stringify(schema(db)) !== JSON.stringify(schema(reference.db))) throw Error('RECOVERY_SCHEMA')
    if (Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) !== LATEST_SCHEMA_VERSION) throw Error('RECOVERY_VERSION')
    if (JSON.stringify(db.prepare('PRAGMA integrity_check').all()) !== '[{"integrity_check":"ok"}]' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('RECOVERY_INTEGRITY')
    const rows = db.prepare("SELECT * FROM package_versions WHERE status IN ('ready', 'active', 'retired')").all()
    for (const row of rows) verifyManagedVersion(managedRoot, row as unknown as Parameters<typeof verifyManagedVersion>[1])
  } finally { reference?.close(); db?.close(); fs.rmSync(temporary, { recursive: true, force: true }) }
}

export async function validateRecoveryBackup(directory: string): Promise<void> {
  const manifestFile = path.join(directory, 'backup.json')
  if (!fs.lstatSync(manifestFile).isFile() || fs.lstatSync(manifestFile).isSymbolicLink() || fs.statSync(manifestFile).size > 16 * 1024 * 1024) throw Error('RECOVERY_MANIFEST')
  const metadata = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (metadata.format !== 'projecttracker-backup' || metadata.version !== 2 || metadata.schemaVersion !== LATEST_SCHEMA_VERSION || !Array.isArray(metadata.files)) throw Error('RECOVERY_VERSION')
  const actual = inventoryRecoveryFiles(directory)
  if (JSON.stringify(actual) !== JSON.stringify(metadata.files) || !actual.some(file => file.path === 'tracker.sqlite') || actual.some(file => file.path !== 'tracker.sqlite' && !file.path.startsWith('packages/'))) throw Error('RECOVERY_CHECKSUM')
  await validateRecoveryDatabase(path.join(directory, 'tracker.sqlite'), path.join(directory, 'packages'))
}

const journalName = 'restore-pending.json'
// Called with the exclusive data lock, before opening any SQLite connection.
// Journal always rolls forward. Old DB/WAL/packages are retained for recovery;
// no merge and no third-party code is involved in these renames.
export function finishPendingRestore(paths: DataPaths, checkpoint: (phase: string) => void = () => {}): boolean {
  const journal = path.join(paths.root, journalName)
  if (!fs.existsSync(journal)) return false
  if (fs.lstatSync(journal).isSymbolicLink() || fs.statSync(journal).size > 65536) throw Error('RECOVERY_PATH')
  const { directory } = JSON.parse(fs.readFileSync(journal, 'utf8'))
  if (typeof directory !== 'string' || !/^restore-[a-f0-9-]{36}$/.test(directory)) throw Error('RECOVERY_JOURNAL')
  const staging = path.join(paths.root, directory)
  if (!fs.lstatSync(staging).isDirectory() || fs.lstatSync(staging).isSymbolicLink()) throw Error('RECOVERY_PATH')
  const old = path.join(staging, 'previous'), next = path.join(staging, 'next')
  for (const directory of [old, next]) if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw Error('RECOVERY_PATH')
  for (const name of ['tracker.sqlite-wal', 'tracker.sqlite-shm', 'tracker.sqlite', 'packages']) {
    const live = path.join(paths.root, name), saved = path.join(old, name)
    if ((name.endsWith('-wal') || name.endsWith('-shm')) || fs.existsSync(path.join(next, name))) {
      if (fs.existsSync(live)) {
        if (fs.existsSync(saved) || fs.lstatSync(live).isSymbolicLink()) throw Error('RECOVERY_STATE')
        fs.renameSync(live, saved)
      }
      checkpoint(`saved-${name}`)
      if (fs.existsSync(path.join(next, name))) fs.renameSync(path.join(next, name), live)
      checkpoint(`installed-${name}`)
    }
  }
  fs.rmSync(journal)
  return true
}

// The app must close all runtimes BEFORE calling this function. A second
// process owning the data prevents restoration. Sources are copied/validated
// beside the current state first, so cancellation/invalid input changes nothing.
export async function restoreRecoveryBackup(paths: DataPaths, source: string, checkpoint: (phase: string) => void = () => {}): Promise<void> {
  const lock = acquireDataLock(paths.lock)
  if (!lock) throw Error('RECOVERY_LOCKED')
  let staging: string | undefined, committed = false
  try {
    finishPendingRestore(paths)
    const directory = `restore-${randomUUID()}`
    staging = path.join(paths.root, directory)
    const next = path.join(staging, 'next')
    // Inventory before copying rejects links and bounds the copy. The copy is
    // validated independently, so a changed source cannot bypass checksums.
    inventoryRecoveryFiles(source)
    fs.mkdirSync(next, { recursive: true })
    fs.cpSync(source, next, { recursive: true, dereference: false })
    await validateRecoveryBackup(next)
    const db = new DatabaseSync(path.join(next, 'tracker.sqlite'))
    try {
      db.exec("BEGIN IMMEDIATE; UPDATE packages SET state = 'disabled', state_reason = 'restored-requires-consent', revision = revision + 1 WHERE state = 'active'; UPDATE package_versions SET status = 'ready' WHERE status = 'active'; DELETE FROM package_sources; COMMIT;")
    } finally { db.close() }
    fs.rmSync(path.join(next, 'backup.json'))
    fs.mkdirSync(path.join(next, 'packages'), { recursive: true })
    fs.mkdirSync(path.join(staging, 'previous'))
    const temporary = path.join(paths.root, `${journalName}.tmp`)
    const fd = fs.openSync(temporary, 'w', 0o600)
    try { fs.writeSync(fd, JSON.stringify({ directory })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temporary, path.join(paths.root, journalName)); committed = true
    checkpoint('journal-committed')
    finishPendingRestore(paths, checkpoint)
  } finally {
    if (staging && !committed) fs.rmSync(staging, { recursive: true, force: true })
    lock.release()
  }
}
