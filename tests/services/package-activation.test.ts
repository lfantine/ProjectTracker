import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ZipFile } from 'yazl'
import { openDatabase, type Database } from '../../main/db/database'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageActivation, type ActivationHooks } from '../../main/packages/activation'
import { putDocument } from '../../main/core/packageStore'
import type { Manifest } from '../../shared/manifest'
const resources: { root: string; db: Database }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.db.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-activation-'))
  const db = await openDatabase(path.join(root, 'tracker.sqlite'))
  resources.push({ root, db })
  const managed = path.join(root, 'packages')
  const hooks: ActivationHooks = { confirm: vi.fn(async () => true), prevalidate: vi.fn(async () => {}), migrate: vi.fn(async (_version, snapshot) => snapshot), suspendPackage: vi.fn(() => vi.fn()), revokePackage: vi.fn(), changed: vi.fn() }
  return { root, db, managed, hooks, installer: new LocalPackageInstaller(db, managed, async () => true), activation: new PackageActivation(db, managed, hooks, true) }
}
async function archive(root: string, changes: Partial<Manifest> = {}) {
  const manifest = { ...JSON.parse(await readFile('tests/fixtures/manifests/valid/major-only.json', 'utf8')), ...changes }
  const zip = new ZipFile()
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from('<html></html>'), 'board/index.html')
  if (manifest.migrations) zip.addBuffer(Buffer.from('<html></html>'), manifest.migrations.entry)
  zip.end()
  const source = path.join(root, `${manifest.id}-${manifest.version}.zip`)
  await writeFile(source, await done)
  return source
}
async function initial(f: Awaited<ReturnType<typeof fixture>>) {
  await f.installer.importArchive(await archive(f.root))
  await f.activation.activate('example.boards', '1.0.0')
  putDocument(f.db, { packageId: 'example.boards', scope: '', collection: 'items', id: 'one' }, { original: true }, { now: 'now' })
  putDocument(f.db, { packageId: 'example.other', scope: '', collection: 'items', id: 'one' }, { private: true }, { now: 'now' })
  await f.installer.importArchive(await archive(f.root, { version: '1.1.0', storageVersion: 2, migrations: { entry: 'migration.html', steps: [1] } }))
}
describe('guarded transactional activation', () => {
  it('keeps normal activation closed even with valid native hooks', async () => {
    const f = await fixture()
    await expect(new PackageActivation(f.db, f.managed, f.hooks).activate('example.boards', '1.0.0')).rejects.toThrow('ACTIVATION_NOT_QUALIFIED')
    expect(f.hooks.prevalidate).not.toHaveBeenCalled()
  })
  it('activates a verified ready version after prevalidation; repeat is idempotent', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    expect(await f.activation.activate('example.boards', '1.0.0')).toEqual({ status: 'active' })
    expect(f.db.get('SELECT state, active_version FROM packages')).toEqual({ state: 'active', active_version: '1.0.0' })
    expect(f.hooks.prevalidate).toHaveBeenCalledOnce()
    expect(await f.activation.activate('example.boards', '1.0.0')).toEqual({ status: 'unchanged' })
    expect(f.hooks.confirm).toHaveBeenCalledOnce()
  })
  it('commits migrated docs, versions, storage version and grants atomically, preserving other packages', async () => {
    const f = await fixture()
    await initial(f)
    vi.mocked(f.hooks.migrate).mockImplementation(async (_version, snapshot) => {
      for (const entry of snapshot.entries) if (entry.kind === 'document') entry.value = { migrated: true }
      return snapshot
    })
    const foreign = f.db.all("SELECT * FROM package_documents WHERE package_id = 'example.other'")
    await f.activation.activate('example.boards', '1.1.0')
    expect(f.db.get("SELECT storage_version, active_version FROM packages WHERE id = 'example.boards'")).toEqual({ storage_version: 2, active_version: '1.1.0' })
    expect(f.db.get("SELECT value_json, revision FROM package_documents WHERE package_id = 'example.boards'")).toEqual({ value_json: '{"migrated":true}', revision: 2 })
    expect(f.db.all("SELECT * FROM package_documents WHERE package_id = 'example.other'")).toEqual(foreign)
    expect(f.db.all("SELECT status FROM package_versions ORDER BY version")).toEqual([{ status: 'retired' }, { status: 'active' }])
    expect(f.db.get("SELECT status FROM install_journal WHERE action = 'activate' ORDER BY id DESC LIMIT 1")).toEqual({ status: 'done' })
  })
  it.each(['prevalidation', 'migration', 'database'])('retains old active data/version on %s failure', async mode => {
    const f = await fixture()
    await initial(f)
    const before = f.db.all("SELECT * FROM package_documents ORDER BY package_id")
    if (mode === 'prevalidation') vi.mocked(f.hooks.prevalidate).mockRejectedValueOnce(Error('prevalidation failure'))
    if (mode === 'migration') vi.mocked(f.hooks.migrate).mockRejectedValueOnce(Error('migration failure'))
    if (mode === 'database') f.db.db.exec("CREATE TRIGGER fail_activation BEFORE UPDATE OF active_version ON packages BEGIN SELECT RAISE(ABORT, 'database failure'); END")
    await expect(f.activation.activate('example.boards', '1.1.0')).rejects.toThrow(`${mode} failure`)
    expect(f.db.all('SELECT * FROM package_documents ORDER BY package_id')).toEqual(before)
    expect(f.db.get("SELECT active_version, storage_version FROM packages WHERE id = 'example.boards'")).toEqual({ active_version: '1.0.0', storage_version: 1 })
    expect(f.db.all('SELECT status FROM package_versions ORDER BY version')).toEqual([{ status: 'active' }, { status: 'ready' }])
  })
  it('rejects concurrent writes to source data rather than overwriting them', async () => {
    const f = await fixture()
    await initial(f)
    vi.mocked(f.hooks.migrate).mockImplementation(async (_version, snapshot) => {
      putDocument(f.db, { packageId: 'example.boards', scope: '', collection: 'items', id: 'one' }, { concurrent: true }, { now: 'later' })
      return snapshot
    })
    await expect(f.activation.activate('example.boards', '1.1.0')).rejects.toThrow('ACTIVATION_SOURCE_CHANGED')
    expect(f.db.get("SELECT value_json FROM package_documents WHERE package_id = 'example.boards'")).toEqual({ value_json: '{"concurrent":true}' })
    expect(f.db.get("SELECT active_version FROM packages WHERE id = 'example.boards'")).toEqual({ active_version: '1.0.0' })
  })
  it('migrates instance metadata and config without replacing placement/binding/layout identities', async () => {
    const f = await fixture()
    await initial(f)
    f.db.run("INSERT INTO major_instances (package_id, major_id, instance_id, name, position, created_at, updated_at) VALUES ('example.boards', 'board', 'one', 'Old', 0, 'now', 'now')")
    f.db.run("INSERT INTO active_instances VALUES ('example.boards', 'board', 'one')")
    f.db.run("INSERT INTO dashboards (id, name, position, created_at, updated_at) VALUES ('dash', 'Dashboard', 0, 'now', 'now')")
    f.db.run(`INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_json, binding_json, layouts_json)
      VALUES ('dash', 'placement', 3, 'example.boards', 'board', '{}', '{"mode":"none"}', '{"w":4}')`)
    vi.mocked(f.hooks.migrate).mockImplementation(async (_version, snapshot) => {
      for (const entry of snapshot.entries) if (entry.kind === 'instance') entry.name = 'Migrated'
      return snapshot
    })
    await f.activation.activate('example.boards', '1.1.0')
    expect(f.db.get('SELECT name, revision FROM major_instances')).toEqual({ name: 'Migrated', revision: 2 })
    expect(f.db.get('SELECT instance_id FROM active_instances')).toEqual({ instance_id: 'one' })
    expect(f.db.get('SELECT placement_id, position, binding_json, layouts_json, revision FROM dashboard_widgets')).toEqual({ placement_id: 'placement', position: 3, binding_json: '{"mode":"none"}', layouts_json: '{"w":4}', revision: 2 })
  })
  it('revokes compatible transitive consumers when switching an export provider', async () => {
    const f = await fixture()
    await initial(f)
    await f.installer.importArchive(await archive(f.root, { id: 'example.consumer', dependencies: { 'example.boards': '^1.0.0' } }))
    await f.activation.activate('example.consumer', '1.0.0')
    await f.installer.importArchive(await archive(f.root, { id: 'example.indirect', dependencies: { 'example.consumer': '^1.0.0' } }))
    await f.activation.activate('example.indirect', '1.0.0')
    vi.mocked(f.hooks.revokePackage).mockClear()
    await f.activation.activate('example.boards', '1.1.0')
    expect(f.hooks.revokePackage).toHaveBeenCalledWith('example.boards')
    expect(f.hooks.revokePackage).toHaveBeenCalledWith('example.consumer')
    expect(f.hooks.revokePackage).toHaveBeenCalledWith('example.indirect')
    expect(f.db.all("SELECT state FROM packages WHERE id != 'example.boards'")).toEqual([{state:'active'},{state:'active'}])
  })
  it('rejects forged migration instance identities and rolls back documents', async () => {
    const f = await fixture()
    await initial(f)
    vi.mocked(f.hooks.migrate).mockImplementation(async (_version, snapshot) => {
      snapshot.entries.push({ kind: 'instance', majorId: 'board', instanceId: 'forged', name: 'Forged', position: 0, active: true })
      return snapshot
    })
    await expect(f.activation.activate('example.boards', '1.1.0')).rejects.toThrow()
    expect(f.db.get("SELECT value_json FROM package_documents WHERE package_id = 'example.boards'")).toEqual({ value_json: '{"original":true}' })
    expect(f.db.all('SELECT * FROM major_instances')).toEqual([])
  })
  it('does not change a registered extension identity into an executable package', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    f.db.run("UPDATE packages SET kind = 'extension'")
    await expect(f.activation.activate('example.boards', '1.0.0')).rejects.toThrow('ACTIVATION_KIND_CHANGED')
    expect(f.hooks.prevalidate).not.toHaveBeenCalled()
  })
  it('rejects tampering with a managed resource before asking for consent', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    await writeFile(path.join(f.managed, 'versions/example.boards/1.0.0/board/index.html'), 'tampered')
    await expect(f.activation.activate('example.boards', '1.0.0')).rejects.toThrow('VERSION_CONTENT_CHANGED')
    expect(f.hooks.confirm).not.toHaveBeenCalled()
  })
  it('declining activation leaves the ready version inactive and contexts alive', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    vi.mocked(f.hooks.confirm).mockResolvedValueOnce(false)
    await expect(f.activation.activate('example.boards', '1.0.0')).rejects.toThrow('ACTIVATION_CANCELLED')
    expect(f.hooks.prevalidate).not.toHaveBeenCalled()
    expect(f.hooks.revokePackage).not.toHaveBeenCalled()
    expect(f.db.get('SELECT state FROM packages')).toEqual({ state: 'disabled' })
  })
  it('refuses code downgrade after uninstall even when the storage version has not changed', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    await f.activation.activate('example.boards', '1.0.0')
    await f.installer.importArchive(await archive(f.root, {version:'2.0.0'}))
    await f.activation.activate('example.boards', '2.0.0')
    f.db.run("UPDATE packages SET state = 'uninstalled', active_version = NULL")
    f.db.run("UPDATE package_versions SET status = 'retired'")
    await expect(f.activation.activate('example.boards', '1.0.0')).rejects.toThrow('ACTIVATION_DOWNGRADE')
    expect(await f.activation.activate('example.boards', '2.0.0')).toEqual({status:'active'})
  })
  it('marks interrupted activation journals rolled back without replaying data', async () => {
    const f = await fixture()
    await f.installer.importArchive(await archive(f.root))
    f.db.run("INSERT INTO install_journal (operation_id, package_id, version, action, step, status, created_at) VALUES ('interrupted', 'example.boards', '1.0.0', 'activate', 'validating', 'started', 'now')")
    await f.activation.recover()
    await f.activation.recover()
    expect(f.db.get("SELECT status FROM install_journal WHERE operation_id = 'interrupted'")).toEqual({ status: 'rolled-back' })
    expect(f.db.get('SELECT state, active_version FROM packages')).toEqual({ state: 'disabled', active_version: null })
  })
})
