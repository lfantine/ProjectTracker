import { auditActivePackages } from '../../main/packages/audit'
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { ZipFile } from 'yazl'
import { openDatabase, type Database } from '../../main/db/database'
import { PackageManager } from '../../main/packages/manager'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'
import { ContextRegistry } from '../../main/runtime/contexts'
import { validateTheme } from '../../main/extensions/engine'
import { createInstance, setActiveInstance } from '../../main/core/packageStore'
import { normalizePermissions } from '../../shared/permissions'
import type { Manifest } from '../../shared/manifest'
const resources: { root: string; db: Database; contexts: ContextRegistry }[] = []
afterEach(async () => { for (const item of resources.splice(0)) { item.contexts.close(); item.db.close(); await rm(item.root, { recursive: true, force: true }) } })
const target = { package: 'example.boards', version: '^1.0.0' }
const base = { manifestVersion: 1, kind: 'extension', id: 'example.amber', name: 'Amber', author: 'Example', version: '1.0.0', hostApi: '^1.0.0', dependencies: {}, permissions: {}, storageVersion: 1, target }
const theme = { ...base, extensionType: 'theme', theme: 'theme.json' } as Manifest
const feature = { ...base, id: 'example.report', extensionType: 'features', features: [{ id: 'report', name: 'Report', slot: { id: 'summary', version: 1 }, entry: 'report.html' }] } as Manifest
async function archive(root: string, manifest: Manifest, data: unknown = { version: 1, light: { accent: '#ffaa00' }, dark: { accent: '#cc8800' } }) {
  const zip = new ZipFile(), chunks: Buffer[] = [], done = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', b => chunks.push(b)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json'); zip.addBuffer(Buffer.from(JSON.stringify(data)), 'theme.json'); zip.addBuffer(Buffer.from('<html></html>'), 'report.html'); zip.end()
  const file = path.join(root, `${manifest.id}.zip`); await writeFile(file, await done); return file
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-extensions-')), db = await openDatabase(path.join(root, 'state.sqlite')), contexts = new ContextRegistry(db)
  resources.push({ root, db, contexts })
  const manager = new PackageManager(db, path.join(root, 'packages'), { confirmImport: async () => true, confirmStop: async () => true, activation: isolatedActivationHooks(), revokePackage: id => contexts.revokePackage(id), changed: () => {} }, [], true)
  await manager.start()
  await manager.importArchive(await packageArchive(root, { slots: [{ id: 'summary', version: 1, contribution: 'board' }] }))
  await manager.activate(target.package, '1.0.0')
  return { root, db, contexts, manager }
}
it('activates theme data and replaces only the previous theme for the same target', async () => {
  const f = await fixture()
  for (const manifest of [theme, { ...theme, id: 'example.second' }]) { await f.manager.importArchive(await archive(f.root, manifest)); await f.manager.activate(manifest.id, '1.0.0') }
  expect(f.manager.packages().find(item => item.id === theme.id)?.state).toBe('disabled')
  expect(f.manager.themeFor(target.package)?.light.accent).toBe('#ffaa00')
  await f.manager.stop('example.second', 'disable')
  expect(f.manager.themeFor(target.package)).toBeNull()
})
it('rejects CSS, HTML/text injection keys, remote backgrounds and invalid theme payloads', async () => {
  const f = await fixture()
  for (const [index, data] of [ { version: 1, light: { accent: 'url(https://evil)' }, dark: {} }, { version: 1, light: {}, dark: {}, texts: { permissions: 'Trust me' } }, { version: 1, light: {}, dark: {}, background: 'https://evil/x.png' } ].entries()) {
    const manifest = { ...theme, id: `example.invalid-${index}` }
    await f.manager.importArchive(await archive(f.root, manifest, data))
    await expect(f.manager.activate(manifest.id, '1.0.0')).rejects.toThrow()
    expect(f.manager.packages().find(item => item.id === manifest.id)?.state).toBe('disabled')
  }
  expect(() => validateTheme({ manifest: theme, root: f.root, files: [], contentSha256: '', sourceSha256: '' })).toThrow()
})
it('refuses unknown/version-incompatible slots and preserves a suspended extension until explicit reactivation', async () => {
  const f = await fixture()
  const invalid = { ...feature, id: 'example.invalid', features: [{ id: 'report', name: 'Report', entry: 'report.html', slot: { id: 'summary', version: 2 } }] } as Manifest
  await f.manager.importArchive(await archive(f.root, invalid)); await expect(f.manager.activate(invalid.id, '1.0.0')).rejects.toThrow('EXTENSION_SLOT_INVALID')
  await f.manager.importArchive(await archive(f.root, feature)); await f.manager.activate(feature.id, '1.0.0')
  await f.manager.stop(target.package, 'disable')
  expect(f.manager.packages().find(item => item.id === feature.id)?.state).toBe('suspended')
  await f.manager.activate(target.package, '1.0.0')
  expect(f.manager.packages().find(item => item.id === feature.id)?.state).toBe('suspended')
  await f.manager.activate(feature.id, '1.0.0')
  expect(f.manager.packages().find(item => item.id === feature.id)?.state).toBe('active')
})
it('creates isolated feature identities tied to their parent instance and revokes them with the parent', async () => {
  const f = await fixture()
  const manifest = JSON.parse(f.db.get<{ manifest_json: string }>("SELECT manifest_json FROM package_versions WHERE package_id=?", target.package)!.manifest_json)
  createInstance(f.db, { packageId: target.package, majorId: 'board', instanceId: 'one', name: 'One', now: 'now' }); setActiveInstance(f.db, target.package, 'board', 'one')
  const parent = f.contexts.create({ manifest, contributionId: 'board', owner: { kind: 'page' }, placementId: null, binding: { mode: 'active', major: { packageId: target.package, contributionId: 'board' } }, grantedPermissions: normalizePermissions({}) })
  const one = f.contexts.createFeature(feature, 'report', parent.id, normalizePermissions({})), two = f.contexts.createFeature({ ...feature, id: 'example.other-report' }, 'report', parent.id, normalizePermissions({}))
  expect(one.origin).not.toBe(two.origin); expect(one.context.kind).toBe('feature'); expect(one.context.instance?.instanceId).toBe('one')
  f.contexts.revoke(parent.id)
  expect(() => f.contexts.get(one.id)).toThrow(); expect(() => f.contexts.get(two.id)).toThrow()
})

it('audits conflicting retained themes conservatively and never silently picks one', async () => {
  const f = await fixture()
  for (const manifest of [theme, { ...theme, id: 'example.second' }]) { await f.manager.importArchive(await archive(f.root, manifest)); await f.manager.activate(manifest.id, '1.0.0') }
  f.db.run("UPDATE packages SET state='active' WHERE id=?", theme.id)
  const result = await auditActivePackages(f.db, path.join(f.root, 'packages'), { revokePackage: id => f.contexts.revokePackage(id), changed: () => {} })
  expect(result.filter(item => item.reason === 'incompatible').map(item => item.packageId).sort()).toEqual(['example.amber', 'example.second'])
  expect(f.manager.themeFor(target.package)).toBeNull()
})
it('does not activate code when a previously supported slot disappears on a target update', async () => {
  const f = await fixture()
  await f.manager.importArchive(await archive(f.root, feature)); await f.manager.activate(feature.id, '1.0.0')
  await f.manager.importArchive(await packageArchive(f.root, { version: '1.1.0' }))
  await expect(f.manager.activate(target.package, '1.1.0')).rejects.toThrow('EXTENSION_SLOT_INVALID')
  expect(f.manager.packages().find(item => item.id === target.package)?.activeVersion).toBe('1.0.0')
})
