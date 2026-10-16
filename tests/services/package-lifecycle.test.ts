import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase, type Database } from '../../main/db/database'
import { PackageLifecycle, type ConfirmStop, type LifecycleHooks } from '../../main/packages/lifecycle'
import { ContextRegistry } from '../../main/runtime/contexts'
import { normalizePermissions } from '../../shared/permissions'
import type { PackageManifest } from '../../shared/manifest'
const resources: { root: string; db: Database; registry: ContextRegistry }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.registry.close(); f.db.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture(confirm: ConfirmStop = async () => true) {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-lifecycle-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  const registry = new ContextRegistry(db)
  resources.push({ root, db, registry })
  const managed = path.join(root, 'packages')
  const hooks: LifecycleHooks = { revokePackage: vi.fn(id => registry.revokePackage(id)), changed: vi.fn() }
  const lifecycle = new PackageLifecycle(db, managed, confirm, hooks)
  async function seed(id: string, dependencies: Record<string, string> = {}) {
    const manifest: PackageManifest = { ...JSON.parse(await readFile('tests/fixtures/manifests/valid/major-only.json', 'utf8')), id, dependencies }
    db.run(`INSERT INTO packages (id, kind, name, author, active_version, state, origin, storage_version, granted_permissions_json, installed_at, updated_at)
      VALUES (?, 'package', 'Example', 'Example', '1.0.0', 'active', 'bundled', 1, '{}', 'now', 'now')`, id)
    db.run(`INSERT INTO package_versions (package_id, version, content_fingerprint, source_fingerprint, manifest_json, files_dir, status, created_at)
      VALUES (?, '1.0.0', 'content', 'source', ?, ?, 'active', 'now')`, id, JSON.stringify(manifest), `versions/${id}/1.0.0`)
    await mkdir(path.join(managed, 'versions', id, '1.0.0'), { recursive: true })
    await writeFile(path.join(managed, 'versions', id, '1.0.0', 'sentinel'), 'retained')
    return manifest
  }
  return { db, managed, registry, hooks, lifecycle, seed }
}
describe('conservative package lifecycle', () => {
  it('confirms transitive dependants (including extension targets), revokes before commit, notifies after commit', async () => {
    const confirm = vi.fn(async () => true)
    const f = await fixture(confirm)
    const provider = await f.seed('example.provider')
    await f.seed('example.consumer', { 'example.provider': '*' })
    await f.seed('example.indirect', { 'example.consumer': '*' })
    await f.seed('example.other')
    const extension = { manifestVersion: 1, kind: 'extension', extensionType: 'theme', id: 'example.extension', name: 'Theme', author: 'Example', version: '1.0.0', hostApi: '*', dependencies: {}, permissions: {}, storageVersion: 1, target: { package: 'example.provider', version: '*' }, theme: 'theme.json' }
    await f.seed('example.extension')
    f.db.run('UPDATE package_versions SET manifest_json = ? WHERE package_id = ?', JSON.stringify(extension), extension.id)
    const context = f.registry.create({ manifest: provider, contributionId: 'board', grantedPermissions: normalizePermissions(provider.permissions), placementId: null, owner: { kind: 'page' }, binding: { mode: 'active', major: { packageId: provider.id, contributionId: 'board' } } })
    const cleanup = vi.fn()
    f.registry.onRevoke(context.id, cleanup)
    let stateOnNotification: unknown
    vi.mocked(f.hooks.changed).mockImplementation(() => { stateOnNotification = f.db.get('SELECT state FROM packages WHERE id = ?', provider.id) })
    const result = await f.lifecycle.stop(provider.id, 'disable')
    expect(result.affected).toEqual(['example.provider', 'example.consumer', 'example.extension', 'example.indirect'])
    expect(confirm).toHaveBeenCalledWith({ packageId: provider.id, action: 'disable', suspendedDependants: ['example.consumer', 'example.extension', 'example.indirect'] }, undefined)
    expect(stateOnNotification).toEqual({ state: 'disabled' })
    expect(() => f.registry.get(context.id)).toThrow()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(f.hooks.changed).toHaveBeenCalledOnce()
    expect(f.db.get('SELECT state FROM packages WHERE id = ?', 'example.indirect')).toEqual({ state: 'suspended' })
    expect(f.db.get('SELECT state FROM packages WHERE id = ?', 'example.other')).toEqual({ state: 'active' })
  })
  it('retains data, instances, configuration, placements, sidebar and version files on uninstall', async () => {
    const f = await fixture()
    await f.seed('example.provider')
    f.db.run("INSERT INTO package_documents (package_id, collection, doc_id, value_json, size_bytes, updated_at) VALUES ('example.provider', 'items', 'one', '{}', 2, 'now')")
    f.db.run("INSERT INTO major_instances (package_id, major_id, instance_id, name, position, created_at, updated_at) VALUES ('example.provider', 'board', 'one', 'One', 0, 'now', 'now')")
    f.db.run("INSERT INTO active_instances VALUES ('example.provider', 'board', 'one')")
    f.db.run("INSERT INTO dashboards (id, name, position, created_at, updated_at) VALUES ('dash', 'Dashboard', 0, 'now', 'now')")
    f.db.run(`INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_json, binding_json, layouts_json)
      VALUES ('dash', 'widget', 0, 'example.provider', 'widget', '{"option":true}', '{}', '{}')`)
    f.db.run("INSERT INTO sidebar_entries (id, label, icon, target_json, position) VALUES ('entry', 'Example', 'home', '{}', 0)")
    const tables = ['package_documents', 'major_instances', 'active_instances', 'dashboard_widgets', 'sidebar_entries']
    const before = tables.map(table => f.db.all(`SELECT * FROM ${table}`))
    await f.lifecycle.stop('example.provider', 'uninstall')
    expect(tables.map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before)
    expect(f.db.get('SELECT state, active_version, origin FROM packages')).toEqual({ state: 'uninstalled', active_version: null, origin: 'bundled' })
    expect(f.db.get('SELECT status FROM package_versions')).toEqual({ status: 'retired' })
    expect(await readdir(path.join(f.managed, 'versions/example.provider/1.0.0'))).toEqual(['sentinel'])
    const journal = f.db.all('SELECT * FROM install_journal')
    expect(await f.lifecycle.stop('example.provider', 'uninstall')).toEqual({ status: 'unchanged', affected: [] })
    expect(f.db.all('SELECT * FROM install_journal')).toEqual(journal)
  })
  it('does not change states or close contexts on refusal/abort', async () => {
    const f = await fixture(async () => false)
    await f.seed('example.provider')
    const before = f.db.all('SELECT * FROM packages')
    await expect(f.lifecycle.stop('example.provider', 'uninstall')).rejects.toThrow('PACKAGE_CANCELLED')
    const controller = new AbortController()
    controller.abort()
    await expect(f.lifecycle.stop('example.provider', 'disable', controller.signal)).rejects.toThrow('PACKAGE_CANCELLED')
    expect(f.db.all('SELECT * FROM packages')).toEqual(before)
    expect(f.hooks.revokePackage).not.toHaveBeenCalled()
  })
  it('requires a fresh agreement if the dependency graph changes while confirming', async () => {
    const f = await fixture(async () => true)
    await f.seed('example.provider')
    const lifecycle = new PackageLifecycle(f.db, f.managed, async () => { await f.seed('example.new', { 'example.provider': '*' }); return true }, f.hooks)
    await expect(lifecycle.stop('example.provider', 'uninstall')).rejects.toThrow('PACKAGE_STATE_CHANGED')
    expect(f.hooks.revokePackage).not.toHaveBeenCalled()
    expect(f.db.get('SELECT state FROM packages WHERE id = ?', 'example.provider')).toEqual({ state: 'active' })
  })
  it('fails closed if revocation fails, while attempting every affected package', async () => {
    const f = await fixture()
    await f.seed('example.provider')
    await f.seed('example.consumer', { 'example.provider': '*' })
    vi.mocked(f.hooks.revokePackage).mockImplementationOnce(() => { throw Error('revocation failed') })
    await expect(f.lifecycle.stop('example.provider', 'uninstall')).rejects.toThrow('PACKAGE_REVOCATION_FAILED')
    expect(f.hooks.revokePackage).toHaveBeenCalledTimes(2)
    expect(f.db.get('SELECT state FROM packages WHERE id = ?', 'example.provider')).toEqual({ state: 'active' })
    expect(f.hooks.changed).not.toHaveBeenCalled()
  })
  it('keeps the committed result when a post-commit notification throws', async () => {
    const f = await fixture()
    await f.seed('example.provider')
    vi.mocked(f.hooks.changed).mockImplementation(() => { throw Error('notification failed') })
    expect(await f.lifecycle.stop('example.provider', 'disable')).toMatchObject({ status: 'changed' })
    expect(f.db.get('SELECT code FROM diagnostics')).toEqual({ code: 'LIFECYCLE_NOTIFICATION_FAILED' })
  })
  it('rolls back all states/journal on a database failure after revocation', async () => {
    const f = await fixture()
    await f.seed('example.provider')
    await f.seed('example.consumer', { 'example.provider': '*' })
    f.db.db.exec("CREATE TRIGGER fail_stop BEFORE INSERT ON install_journal BEGIN SELECT RAISE(ABORT, 'test interruption'); END")
    await expect(f.lifecycle.stop('example.provider', 'uninstall')).rejects.toThrow('test interruption')
    expect(f.db.all('SELECT state FROM packages')).toEqual([{ state: 'active' }, { state: 'active' }])
    expect(f.db.all('SELECT * FROM install_journal')).toEqual([])
    expect(f.hooks.changed).not.toHaveBeenCalled()
    expect(f.hooks.revokePackage).toHaveBeenCalledTimes(2)
  })
  it('protects native CORE and rejects unknown packages', async () => {
    const f = await fixture()
    await expect(f.lifecycle.stop('core', 'uninstall')).rejects.toThrow('PACKAGE_CORE_PROTECTED')
    await expect(f.lifecycle.stop('example.unknown', 'disable')).rejects.toThrow('PACKAGE_NOT_FOUND')
  })
})
