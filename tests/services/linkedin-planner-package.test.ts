import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { buildLinkedinPlannerPackage } from '../../scripts/build-linkedin-planner-package.mjs'
import { prepareArchive } from '../../main/packages/archive'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageActivation } from '../../main/packages/activation'
import { openDatabase, type Database } from '../../main/db/database'
import { validateManifest } from '../../shared/manifest'
import { isolatedActivationHooks } from './package-fixtures'

const resources: { root: string; db?: Database }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.db?.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'amber-linkedin-planner-')); const f = { root, db: await openDatabase(path.join(root, 'state.sqlite')) }; resources.push(f); return f }

it('builds a reproducible archive: valid manifest, no extra rights, no native/renderer bridge', async () => {
  const f = await fixture()
  const first = await buildLinkedinPlannerPackage(path.join(f.root, 'first'))
  const second = await buildLinkedinPlannerPackage(path.join(f.root, 'second'))
  expect(await readFile(first)).toEqual(await readFile(second))
  expect(validateManifest(JSON.parse(await readFile('packages/linkedin-post-planner/manifest.json', 'utf8')))).toMatchObject({ ok: true })
  const prepared = await prepareArchive(first, path.join(f.root, 'stage'))
  try {
    expect(prepared.manifest).toMatchObject({ id: 'lfantine.linkedin-post-planner', storageVersion: 1, permissions: {} })
    if (prepared.manifest.kind !== 'package') throw Error('fixture')
    expect(prepared.manifest.contributions.map(item => [item.id, item.type])).toEqual([['planner', 'major']])
    expect(prepared.files.map(file => file.path).sort()).toEqual(['assets/logo.png', 'assets/planner.css', 'assets/planner.js', 'manifest.json', 'planner.html'])
    expect(prepared.logoDataUrl).toMatch(/^data:image\/png;base64,/)
    const script = await readFile(path.join(prepared.root, 'assets/planner.js'), 'utf8')
    expect(script).not.toMatch(/window\.api|ipcRenderer|node:|require\(["']electron|localStorage|indexedDB|fetch\(/)
  } finally { await prepared.dispose() }
})
it('imports and activates the real ZIP in a disposable database', async () => {
  const f = await fixture()
  const source = await buildLinkedinPlannerPackage(path.join(f.root, 'build'))
  const installer = new LocalPackageInstaller(f.db, path.join(f.root, 'packages'), async () => true)
  await installer.importArchive(source)
  await rm(source)
  await new PackageActivation(f.db, path.join(f.root, 'packages'), isolatedActivationHooks(), true).activate('lfantine.linkedin-post-planner', '1.0.1')
  expect(f.db.get('SELECT origin, state FROM packages WHERE id = ?', 'lfantine.linkedin-post-planner')).toEqual({ origin: 'archive', state: 'active' })
  expect(await readFile(path.join(f.root, 'packages/versions/lfantine.linkedin-post-planner/1.0.1/planner.html'), 'utf8')).toContain('assets/planner.js')
})
