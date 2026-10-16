import { CompositionService } from '../../main/core/compositionService'
import { seedComposition } from '../../main/core/composition'
import { randomUUID } from 'node:crypto'
import type { CompositionCommand } from '../../shared/composition'
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type Database } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { createInstance, setActiveInstance } from '../../main/core/packageStore'
import { PackageManager } from '../../main/packages/manager'
import { ContextRegistry } from '../../main/runtime/contexts'
import { ResourceCatalog } from '../../main/runtime/resources'
import { ModuleLauncher } from '../../main/modules/launch'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'
const resources: { root: string; db: Database; contexts: ContextRegistry }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.contexts.close(); f.db.close(); await rm(f.root, { recursive: true, force: true }) } })
const major = { packageId: 'example.boards', contributionId: 'board' }
async function fixture(withWidget = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-launch-')), managed = path.join(root, 'packages')
  const db = await openDatabase(path.join(root, 'state.sqlite')), contexts = new ContextRegistry(db)
  resources.push({ root, db, contexts })
  const manager = new PackageManager(db, managed, { confirmImport: async () => true, confirmStop: async () => true,
    activation: isolatedActivationHooks(), revokePackage: id => contexts.revokePackage(id), changed: () => {} }, [], true)
  const catalog = new ResourceCatalog(contexts, 'app://shell')
  const launcher = new ModuleLauncher(new CoreService(db), managed, manager, contexts, catalog, '/* trusted */')
  await manager.start()
  await manager.importArchive(await packageArchive(root, withWidget ? { contributions: [
    { id: 'board', type: 'major', name: 'Board', entry: 'board/index.html', icon: 'chart', integrations: ['summary'], instanceLabel: 'Board' },
    { id: 'summary', type: 'widget', name: 'Summary', entry: 'board/index.html', major: 'board', size: { default: { w: 3, h: 4 }, min: { w: 2, h: 3 }, max: { w: 6, h: 10 } } },
  ] } : {}))
  return { root, managed, db, contexts, manager, catalog, launcher }
}
it('requires active native installation; page launches do not manufacture instances', async () => {
  const f = await fixture()
  expect(() => f.launcher.open({ kind: 'major', major })).toThrow()
  await f.manager.activate(major.packageId, '1.0.0')
  const result = f.launcher.open({ kind: 'major', major })
  expect(f.contexts.get(result.contextId)).toMatchObject({ owner: { kind: 'page' }, instance: null, binding: { mode: 'active', major } })
  expect(f.db.all('SELECT * FROM major_instances')).toEqual([])
  expect(f.catalog.read(result.url).headers['Content-Type']).toContain('text/html')
})
it('rejects authority/config/path injection, absent placements and wrong contribution type', async () => {
  const f = await fixture()
  await f.manager.activate(major.packageId, '1.0.0')
  for (const extra of [{ permissions: {} }, { binding: { mode: 'none' } }, { owner: { kind: 'page' } }, { root: '/tmp' }, { config: {} }]) {
    expect(() => f.launcher.open({ kind: 'major', major, ...extra })).toThrow()
  }
  expect(() => f.launcher.open({ kind: 'project', projectId: 'missing', placementId: 'missing' })).toThrow()
  expect(() => f.launcher.open({ kind: 'dashboard' })).toThrow()
  expect(() => f.launcher.open({ kind: 'major', major: { ...major, contributionId: 'other' } })).toThrow()
})
it('pins the requested fixed instance, revokes after rename, and reopens fresh context', async () => {
  const f = await fixture()
  await f.manager.activate(major.packageId, '1.0.0')
  for (const instanceId of ['one', 'two']) createInstance(f.db, { packageId: major.packageId, majorId: major.contributionId, instanceId, name: instanceId, now: new Date().toISOString() })
  setActiveInstance(f.db, major.packageId, major.contributionId, 'two')
  const a = f.launcher.open({ kind: 'major', major, instanceId: 'one' })
  expect(f.contexts.get(a.contextId).instance?.instanceId).toBe('one')
  f.db.run("UPDATE major_instances SET name = 'Renamed' WHERE instance_id = 'one'")
  f.contexts.reconcile()
  expect(() => f.contexts.get(a.contextId)).toThrow()
  expect(() => f.catalog.read(a.url)).toThrow()
  const b = f.launcher.open({ kind: 'major', major, instanceId: 'one' })
  expect(b.origin).not.toBe(a.origin)
  expect(f.contexts.get(b.contextId).instance?.name).toBe('Renamed')
})
it('rechecks actual managed bytes at every launch, not just startup audit', async () => {
  const f = await fixture()
  await f.manager.activate(major.packageId, '1.0.0')
  await writeFile(path.join(f.managed, 'versions/example.boards/1.0.0/board/index.html'), 'tampered')
  expect(() => f.launcher.open({ kind: 'major', major })).toThrow('VERSION_CONTENT_CHANGED')
})

it('active pages follow native selection while fixed pages never fall back after deletion', async () => {
  const f = await fixture()
  await f.manager.activate(major.packageId, '1.0.0')
  for (const instanceId of ['one', 'two']) createInstance(f.db, { packageId: major.packageId, majorId: major.contributionId, instanceId, name: instanceId, now: new Date().toISOString() })
  setActiveInstance(f.db, major.packageId, major.contributionId, 'one')
  const active = f.launcher.open({ kind: 'major', major })
  const fixed = f.launcher.open({ kind: 'major', major, instanceId: 'one' })
  setActiveInstance(f.db, major.packageId, major.contributionId, 'two')
  f.contexts.reconcile()
  expect(() => f.contexts.get(active.contextId)).toThrow()
  expect(f.contexts.get(fixed.contextId).instance?.instanceId).toBe('one')
  expect(f.contexts.get(f.launcher.open({ kind: 'major', major }).contextId).instance?.instanceId).toBe('two')
  f.db.run("DELETE FROM major_instances WHERE instance_id = 'one'")
  f.contexts.reconcile()
  expect(() => f.contexts.get(fixed.contextId)).toThrow()
  expect(() => f.launcher.open({ kind: 'major', major, instanceId: 'one' })).toThrow()
})

it('composed widgets in multiple dashboards follow active selection and retain missing fixed targets', async () => {
  const f = await fixture(true)
  await f.manager.activate(major.packageId, '1.0.0')
  seedComposition(f.db, new Date().toISOString())
  const service = new CompositionService(new CoreService(f.db))
  const run = (command: CompositionCommand) => service.execute({ command, expectedRevision: service.snapshot().revision, operationId: randomUUID() })
  for (const instanceId of ['one', 'two']) createInstance(f.db, { packageId: major.packageId, majorId: major.contributionId, instanceId, name: instanceId, now: new Date().toISOString() })
  setActiveInstance(f.db, major.packageId, major.contributionId, 'one')
  const widget = run({ kind: 'widget.add', dashboardId: 'dash-home', contribution: { packageId: major.packageId, contributionId: 'summary' }, binding: { mode: 'fixed', major, instanceId: 'one' }, config: {} }).id!
  const copy = run({ kind: 'dashboard.duplicate', id: 'dash-home', name: 'Copy' }).id!
  const copyWidget = service.snapshot().dashboards.find(item => item.id === copy)!.widgets.find(item => item.contribution.contributionId === 'summary')!
  const open = (dashboardId: string, placementId: string) => f.launcher.open({ kind: 'dashboard', dashboardId, placementId })
  const fixed = open('dash-home', widget), fixedCopy = open(copy, copyWidget.placementId)
  run({ kind: 'widget.configure', dashboardId: copy, placementId: copyWidget.placementId, binding: { mode: 'active', major }, config: {} })
  f.contexts.reconcile()
  expect(() => f.contexts.get(fixedCopy.contextId)).toThrow()
  const active = open(copy, copyWidget.placementId)
  const layouts = service.snapshot().dashboards.map(item => item.widgets.map(widget => widget.layouts))
  setActiveInstance(f.db, major.packageId, major.contributionId, 'two'); f.contexts.reconcile()
  expect(() => f.contexts.get(active.contextId)).toThrow()
  expect(f.contexts.get(fixed.contextId).instance?.instanceId).toBe('one')
  expect(f.contexts.get(open(copy, copyWidget.placementId).contextId).instance?.instanceId).toBe('two')
  f.db.run("DELETE FROM major_instances WHERE package_id = ? AND instance_id = 'one'", major.packageId); f.contexts.reconcile()
  expect(() => f.contexts.get(fixed.contextId)).toThrow()
  expect(() => open('dash-home', widget)).toThrow()
  expect(service.snapshot().dashboards.map(item => item.widgets.map(widget => widget.layouts))).toEqual(layouts)
  run({ kind: 'widget.configure', dashboardId: 'dash-home', placementId: widget, binding: { mode: 'fixed', major, instanceId: 'two' }, config: {} })
  expect(f.contexts.get(open('dash-home', widget).contextId).instance?.instanceId).toBe('two')
})
