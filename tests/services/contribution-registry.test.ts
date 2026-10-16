import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type Database } from '../../main/db/database'
import { ContributionRegistry } from '../../main/packages/registry'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageActivation } from '../../main/packages/activation'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'
const resources: { root: string; db: Database }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.db.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-registry-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  resources.push({ root, db })
  return { root, db, registry: new ContributionRegistry(db), installer: new LocalPackageInstaller(db, path.join(root, 'packages'), async () => true),
    activation: new PackageActivation(db, path.join(root, 'packages'), isolatedActivationHooks(), true) }
}
const ref = { packageId: 'example.boards', contributionId: 'board' }
it('distinguishes missing, imported inactive and active contributions without mutating anything', async () => {
  const f = await fixture()
  expect(f.registry.resolve(ref, 'major')).toEqual({ status: 'unavailable', reason: 'not-installed' })
  await f.installer.importArchive(await packageArchive(f.root))
  expect(f.registry.resolve(ref, 'major')).toEqual({ status: 'unavailable', reason: 'disabled' })
  await f.activation.activate(ref.packageId, '1.0.0')
  const before = f.db.all('SELECT * FROM packages')
  expect(f.registry.resolve(ref, 'major')).toMatchObject({ status: 'available', contribution: { source: 'package', ref, type: 'major', version: '1.0.0', definition: { entry: 'board/index.html' } } })
  expect(f.registry.resolve(ref, 'widget')).toEqual({ status: 'unavailable', reason: 'wrong-type' })
  expect(f.registry.resolve({ ...ref, contributionId: 'missing' }, 'major')).toEqual({ status: 'unavailable', reason: 'unknown-contribution' })
  expect(f.db.all('SELECT * FROM packages')).toEqual(before)
})
for (const state of ['disabled', 'suspended', 'uninstalled']) it(`retains an explicit ${state} reason instead of dropping the reference`, async () => {
  const f = await fixture()
  await f.installer.importArchive(await packageArchive(f.root))
  f.db.run('UPDATE packages SET state = ?', state)
  expect(f.registry.resolve(ref, 'major')).toEqual({ status: 'unavailable', reason: state })
})
it('never resolves ready updates in place of the installed active version', async () => {
  const f = await fixture()
  await f.installer.importArchive(await packageArchive(f.root))
  await f.activation.activate(ref.packageId, '1.0.0')
  await f.installer.importArchive(await packageArchive(f.root, { version: '1.1.0', name: 'Update' }))
  const resolution = f.registry.resolve(ref, 'major')
  expect(resolution).toMatchObject({ status: 'available', contribution: { version: '1.0.0' } })
  if (resolution.status === 'available') resolution.contribution.ref.contributionId = 'tampered'
  expect(f.registry.resolve(ref, 'major')).toMatchObject({ contribution: { ref } })
})
it('rejects orphan active pointers, malformed metadata and invalid references', async () => {
  const f = await fixture()
  await f.installer.importArchive(await packageArchive(f.root))
  f.db.run("UPDATE packages SET state = 'active', active_version = '1.0.0'")
  expect(f.registry.resolve(ref, 'major')).toEqual({ status: 'unavailable', reason: 'version-unavailable' })
  f.db.run("UPDATE package_versions SET status = 'active', manifest_json = '{}' ")
  expect(f.registry.resolve(ref, 'major')).toEqual({ status: 'unavailable', reason: 'version-unavailable' })
  expect(f.registry.resolve({ ...ref, contributionId: '../escape' }, 'major')).toEqual({ status: 'unavailable', reason: 'invalid-reference' })
})
it('resolves CORE from native adapters regardless of installation rows, with no external override', async () => {
  const f = await fixture()
  f.db.run(`INSERT INTO packages(id, kind, name, author, state, origin, storage_version, granted_permissions_json, installed_at, updated_at)
    VALUES ('core', 'package', 'Spoof', 'Other', 'uninstalled', 'archive', 1, '{}', 'now', 'now')`)
  expect(f.registry.resolve({ packageId: 'core', contributionId: 'tasks' }, 'minor')).toMatchObject({ status: 'available', contribution: { source: 'native', name: 'Tâches' } })
  expect(f.registry.resolve({ packageId: 'core', contributionId: 'unknown' }, 'widget')).toEqual({ status: 'unavailable', reason: 'unknown-contribution' })
})
