import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { openDatabase } from '../../main/db/database'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageActivation } from '../../main/packages/activation'
import { auditActivePackages } from '../../main/packages/audit'
import { putDocument } from '../../main/core/packageStore'
import { makeTempDir } from './helpers'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'

describe('real SIGKILL package recovery (Electron Node / temporary data)', () => {
  it.each(['import-extracted', 'import-prepared', 'import-moved', 'import-transaction', 'import-committed', 'activation-migration', 'activation-transaction', 'activation-committed'])('%s preserves one coherent active state after restart', async mode => {
    const root = makeTempDir('amber-crash-'), managed = path.join(root, 'packages'), file = path.join(root, 'tracker.sqlite')
    let db = await openDatabase(file)
    try {
      let installer = new LocalPackageInstaller(db, managed, async () => true)
      await installer.importArchive(await packageArchive(root))
      await new PackageActivation(db, managed, isolatedActivationHooks(), true).activate('example.boards', '1.0.0')
      putDocument(db, { packageId: 'example.boards', scope: '', collection: 'items', id: 'one' }, { original: true }, { now: 'now' })
      putDocument(db, { packageId: 'example.other', scope: '', collection: 'items', id: 'one' }, { private: true }, { now: 'now' })
      const next = await packageArchive(root, { version: '1.1.0', storageVersion: 2, migrations: { entry: 'migration.html', steps: [1] } })
      if (mode.startsWith('activation-')) await installer.importArchive(next)
      db.close()
      const worker = spawnSync(process.execPath, [path.resolve('tests/fixtures/install-crash.cjs'), root, mode], {
        cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROJECT_TRACKER_TEST: '1' }, encoding: 'utf8', timeout: 10000,
      })
      expect(worker.error, worker.stderr).toBeUndefined()
      expect(worker.signal, worker.stderr).toBe('SIGKILL')
      db = await openDatabase(file)
      installer = new LocalPackageInstaller(db, managed, async () => true)
      await installer.recover()
      await new PackageActivation(db, managed, isolatedActivationHooks(), true).recover()
      expect(await auditActivePackages(db, managed, { revokePackage() {}, changed() {} })).toEqual([])
      expect(db.get('PRAGMA integrity_check')).toEqual({ integrity_check: 'ok' })
      expect(db.all('PRAGMA foreign_key_check')).toEqual([])
      const committed = mode === 'activation-committed'
      expect(db.get("SELECT active_version, storage_version, state FROM packages WHERE id = 'example.boards'")).toEqual({ active_version: committed ? '1.1.0' : '1.0.0', storage_version: committed ? 2 : 1, state: 'active' })
      expect(db.get("SELECT value_json FROM package_documents WHERE package_id = 'example.boards'")).toEqual({ value_json: JSON.stringify(committed ? { migrated: true } : { original: true }) })
      expect(db.get("SELECT value_json FROM package_documents WHERE package_id = 'example.other'")).toEqual({ value_json: '{"private":true}' })
      expect(db.all("SELECT version FROM package_versions WHERE status = 'active'")).toEqual([{ version: committed ? '1.1.0' : '1.0.0' }])
      const nextExists = mode.startsWith('activation-') || mode === 'import-committed'
      expect(await readdir(path.join(managed, 'versions/example.boards'))).toEqual(nextExists ? ['1.0.0', '1.1.0'] : ['1.0.0'])
      expect(await readdir(path.join(managed, '.staging'))).toEqual([])
      expect(db.all("SELECT * FROM install_journal WHERE status = 'started'")).toEqual([])
      const journal = db.all('SELECT * FROM install_journal ORDER BY id')
      await installer.recover()
      await new PackageActivation(db, managed, isolatedActivationHooks(), true).recover()
      expect(db.all('SELECT * FROM install_journal ORDER BY id')).toEqual(journal)
    } finally { try { db.close() } catch { /* worker failure after parent closed */ } }
  }, 15000)
})
