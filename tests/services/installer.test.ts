import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile, symlink, rename } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ZipFile } from 'yazl'
import { openDatabase, type Database } from '../../main/db/database'
import { LocalPackageInstaller } from '../../main/packages/installer'
import type { ConfirmImport } from '../../main/packages/consent'
import type { Manifest } from '../../shared/manifest'
const resources: { root: string; db: Database }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.db.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture(confirm: ConfirmImport = async () => true) {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-installer-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  resources.push({ root, db })
  const managed = path.join(root, 'packages')
  return { root, db, managed, installer: new LocalPackageInstaller(db, managed, confirm) }
}
async function archive(root: string, changes: Partial<Manifest> = {}, html = '<html></html>') {
  const manifest = { ...JSON.parse(await readFile('tests/fixtures/manifests/valid/major-only.json', 'utf8')), ...changes }
  const zip = new ZipFile()
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', chunk => chunks.push(chunk))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from(html), 'board/index.html')
  zip.end()
  const file = path.join(root, `${manifest.version}.zip`)
  await writeFile(file, await done)
  return file
}
describe('inactive local installation', () => {
  it('persists immutable files, remains disabled, survives source removal and reimports without another approval', async () => {
    const confirm = vi.fn(async () => true)
    const f = await fixture(confirm)
    const source = await archive(f.root)
    expect(await f.installer.importArchive(source)).toMatchObject({ status: 'ready' })
    expect(f.db.get('SELECT state, active_version FROM packages')).toEqual({ state: 'disabled', active_version: null })
    expect(await f.installer.importArchive(source)).toMatchObject({ status: 'unchanged' })
    expect(confirm).toHaveBeenCalledTimes(1)
    await unlink(source)
    const target = path.join(f.managed, 'versions/example.boards/1.0.0/board/index.html')
    expect(await readFile(target, 'utf8')).toBe('<html></html>')
    await f.installer.recover()
    expect(await readFile(target, 'utf8')).toBe('<html></html>')
    expect(f.db.get('SELECT status FROM install_journal')).toEqual({ status: 'done' })
  })
  it('rejects altered contents under an existing version without another approval', async () => {
    const confirm = vi.fn(async () => true)
    const f = await fixture(confirm)
    await f.installer.importArchive(await archive(f.root))
    await expect(f.installer.importArchive(await archive(f.root, {}, 'different'))).rejects.toThrow('INSTALL_VERSION_CONFLICT')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(f.db.all('SELECT * FROM package_versions')).toHaveLength(1)
  })
  it('detects damaged managed files on idempotent reimport', async () => {
    const f = await fixture()
    const source = await archive(f.root)
    await f.installer.importArchive(source)
    await writeFile(path.join(f.managed, 'versions/example.boards/1.0.0/board/index.html'), 'changed')
    await expect(f.installer.importArchive(source)).rejects.toThrow('INSTALL_FILES_CORRUPT')
  })
  it('declining or aborting leaves no package, journal or extracted files', async () => {
    const f = await fixture(async () => false)
    const source = await archive(f.root)
    await expect(f.installer.importArchive(source)).rejects.toThrow('INSTALL_CANCELLED')
    const controller = new AbortController()
    controller.abort()
    await expect(f.installer.importArchive(source, controller.signal)).rejects.toThrow('INSTALL_CANCELLED')
    expect(f.db.all('SELECT * FROM packages')).toEqual([])
    expect(f.db.all('SELECT * FROM install_journal')).toEqual([])
    expect(await readdir(path.join(f.managed, '.staging'))).toEqual([])
  })
  it('rejects incompatible dependencies before asking for trust', async () => {
    const confirm = vi.fn(async () => true)
    const f = await fixture(confirm)
    const source = await archive(f.root, { dependencies: { 'example.absent': '^1.0.0' } })
    await expect(f.installer.importArchive(source)).rejects.toThrow('INSTALL_INELIGIBLE')
    expect(confirm).not.toHaveBeenCalled()
    expect(f.db.all('SELECT * FROM packages')).toEqual([])
  })
  it('serializes concurrent imports, including across service objects', async () => {
    const confirm = vi.fn(async () => true)
    const f = await fixture(confirm)
    const other = new LocalPackageInstaller(f.db, f.managed, confirm)
    const source = await archive(f.root)
    const results = await Promise.all([f.installer.importArchive(source), other.importArchive(source)])
    expect(results.map(result => result.status)).toEqual(['ready', 'unchanged'])
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('retains the active pointer, grants and version when preparing an update fails or succeeds', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    f.db.run("UPDATE packages SET active_version = '1.0.0', state = 'active', revision = revision + 1")
    f.db.run("UPDATE package_versions SET status = 'active'")
    const before = f.db.get('SELECT * FROM packages')
    await expect(f.installer.importArchive(await archive(f.root, { version: '2.0.0', dependencies: { absent: '*' } }))).rejects.toThrow('INSTALL_INELIGIBLE')
    await f.installer.importArchive(await archive(f.root, { version: '1.1.0', permissions: { network: ['https://example.com'] } }))
    expect(f.db.get('SELECT * FROM packages')).toEqual(before)
    expect(f.db.all('SELECT status FROM package_versions ORDER BY version')).toEqual([{ status: 'active' }, { status: 'ready' }])
  })
  it('revalidates the package revision after confirmation and rolls back moved files on a race', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    const raced = new LocalPackageInstaller(f.db, f.managed, async () => {
      f.db.run('UPDATE packages SET revision = revision + 1')
      return true
    })
    await expect(raced.importArchive(await archive(f.root, { version: '1.1.0' }))).rejects.toThrow('INSTALL_STATE_CHANGED')
    expect(await readdir(path.join(f.managed, 'versions/example.boards'))).toEqual(['1.0.0'])
    expect(f.db.all('SELECT status FROM install_journal ORDER BY id')).toEqual([{ status: 'done' }, { status: 'failed' }])
  })
  it('recovers interrupted extraction/rename, but never removes a committed version', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    for (const version of ['1.0.0', '1.1.0']) {
      await mkdir(path.join(f.managed, 'versions/example.boards', version), { recursive: true })
      f.db.run(`INSERT INTO install_journal (operation_id, package_id, version, action, step, status, created_at)
        VALUES (?, 'example.boards', ?, 'import-inactive', 'prepared', 'started', 'now')`, `interrupted-${version}`, version)
    }
    await mkdir(path.join(f.managed, '.staging', 'abandoned'))
    await f.installer.recover()
    await f.installer.recover()
    expect(await readdir(path.join(f.managed, 'versions/example.boards'))).toEqual(['1.0.0'])
    expect(await readdir(path.join(f.managed, '.staging'))).toEqual([])
    expect(f.db.all("SELECT status FROM install_journal WHERE operation_id LIKE 'interrupted-%'")).toEqual([{ status: 'rolled-back' }, { status: 'rolled-back' }])
  })
})


for (const mode of ['extra-file', 'parent-link', 'metadata'] as const) it(`rejects ${mode} on idempotent reimport without another approval or DB mutation`, async () => {
  const confirm = vi.fn(async () => true)
  const f = await fixture(confirm)
  const source = await archive(f.root)
  await f.installer.importArchive(source)
  const version = path.join(f.managed, 'versions/example.boards/1.0.0')
  if (mode === 'extra-file') await writeFile(path.join(version, 'extra.js'), 'unregistered code')
  if (mode === 'parent-link') {
    await rename(path.join(version, 'board'), path.join(f.root, 'original-board'))
    await symlink(path.join(f.root, 'original-board'), path.join(version, 'board'))
  }
  if (mode === 'metadata') f.db.run("UPDATE package_versions SET manifest_json = '{}' ")
  const before = f.db.all('SELECT * FROM package_versions')
  await expect(f.installer.importArchive(source)).rejects.toThrow('INSTALL_FILES_CORRUPT')
  expect(f.db.all('SELECT * FROM package_versions')).toEqual(before)
  expect(confirm).toHaveBeenCalledTimes(1)
})

for (const mode of ['root', 'stage', 'versions', 'package'] as const) it(`refuses a replaced ${mode} directory during recovery without touching external sentinels`, async () => {
  const f = await fixture()
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'sentinel.txt'), 'keep')
  if (mode === 'root') await symlink(outside, f.managed)
  else {
    await mkdir(f.managed)
    const target = mode === 'stage' ? path.join(f.managed, '.staging') : mode === 'versions' ? path.join(f.managed, 'versions') : path.join(f.managed, 'versions/example.boards')
    await mkdir(path.dirname(target), { recursive: true })
    await symlink(outside, target)
  }
  f.db.run(`INSERT INTO install_journal(operation_id, package_id, version, action, step, status, created_at)
    VALUES ('interrupted', 'example.boards', '1.1.0', 'import-inactive', 'prepared', 'started', 'now')`)
  await expect(f.installer.recover()).rejects.toThrow('INSTALL_DIRECTORY_INVALID')
  expect(await readFile(path.join(outside, 'sentinel.txt'), 'utf8')).toBe('keep')
  expect(await readdir(outside)).toEqual(['sentinel.txt'])
  expect(f.db.get('SELECT status FROM install_journal')).toEqual({ status: 'started' })
})
