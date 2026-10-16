import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { buildWeekPackage } from '../../scripts/build-week-package.mjs'
import { prepareArchive } from '../../main/packages/archive'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageSourceImports } from '../../main/packages/sourceImports'
import { PackageSources } from '../../main/packages/sources'
import { PackageActivation } from '../../main/packages/activation'
import { openDatabase, type Database } from '../../main/db/database'
import { ensureWeekInstance, readWeekFacade, writeWeekDocument } from '../../main/core/week'
import { isolatedActivationHooks } from './package-fixtures'
const resources: { root: string; db?: Database }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.db?.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'amber-built-week-')); const f = { root, db: await openDatabase(path.join(root, 'state.sqlite')) }; resources.push(f); return f }
it('builds a reproducible archive with valid three-way contributions and no native/renderer bridge', async () => {
  const f = await fixture()
  const first = await buildWeekPackage(path.join(f.root, 'first'))
  const second = await buildWeekPackage(path.join(f.root, 'second'))
  expect(await readFile(first)).toEqual(await readFile(second))
  const prepared = await prepareArchive(first, path.join(f.root, 'stage'))
  try {
    expect(prepared.manifest).toMatchObject({ id: 'builtin.week', storageVersion: 1, permissions: { core: { projects: ['read'] } } })
    if (prepared.manifest.kind !== 'package') throw Error('fixture')
    expect(prepared.manifest.contributions.map(item => item.type)).toEqual(['major', 'minor', 'widget'])
    expect(prepared.files).toHaveLength(7)
    expect(prepared.logoDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(await readFile(path.join(prepared.root, 'assets/logo.png'))).toEqual(await readFile('docs/logo/week-module-logo.png'))
    const script = await readFile(path.join(prepared.root, 'assets/week.js'), 'utf8')
    expect(script).not.toMatch(/window\.api|useData|ipcRenderer|node:|require\(["']electron/)
  } finally { await prepared.dispose() }
})
for (const origin of ['archive', 'bundled'] as const) it(`imports the real ZIP from ${origin}, retaining legacy instance/document identities after activation and source deletion`, async () => {
  const f = await fixture()
  const instanceId = ensureWeekInstance(f.db, 'now')
  writeWeekDocument(f.db, instanceId, { slots: [{ id: 'preserved-slot', title: 'Travail', day: 0, start: '09:00', end: '10:00' }], wakeTimes: Array(7).fill('07:00') }, 'now')
  const before = readWeekFacade(f.db)
  const source = await buildWeekPackage(path.join(f.root, 'build'))
  const installer = new LocalPackageInstaller(f.db, path.join(f.root, 'packages'), async () => true)
  if (origin === 'bundled') {
    const prepared = await prepareArchive(source, path.join(f.root, 'catalogue'))
    try { await new PackageSourceImports(f.db, installer, new PackageSources(f.db), [{ key: 'week', path: source, packageId: 'builtin.week', version: '1.1.2', contentSha256: prepared.contentSha256 }]).importBundled('week') } finally { await prepared.dispose() }
  } else await installer.importArchive(source)
  await rm(source)
  await new PackageActivation(f.db, path.join(f.root, 'packages'), isolatedActivationHooks(), true).activate('builtin.week', '1.1.2')
  expect(readWeekFacade(f.db)).toEqual(before)
  expect(f.db.all('SELECT instance_id FROM major_instances')).toEqual([{ instance_id: instanceId }])
  expect(f.db.get('SELECT origin, state FROM packages')).toEqual({ origin, state: 'active' })
  expect(await readFile(path.join(f.root, 'packages/versions/builtin.week/1.1.2/today.html'), 'utf8')).toContain('assets/week.js')
})
