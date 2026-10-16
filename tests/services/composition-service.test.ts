import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase, type Database } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { CompositionService } from '../../main/core/compositionService'
import { seedComposition } from '../../main/core/composition'
import type { CompositionCommand } from '../../shared/composition'
import { deriveGrid } from '../../shared/grid'
const resources: { root: string; db: Database }[] = []
afterEach(async () => { for (const item of resources.splice(0)) { item.db.close(); await rm(item.root, { recursive: true, force: true }) } })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-composition-')), db = await openDatabase(path.join(root, 'state.sqlite'))
  resources.push({ root, db }); seedComposition(db, new Date().toISOString())
  const service = new CompositionService(new CoreService(db))
  const run = (command: CompositionCommand) => service.execute({ command, expectedRevision: service.snapshot().revision, operationId: randomUUID() })
  return { db, service, run }
}
it('keeps one dashboard and atomically replaces the deleted default', async () => {
  const { service, run } = await fixture()
  expect(() => run({ kind: 'dashboard.delete', id: 'dash-home' })).toThrow()
  const id = run({ kind: 'dashboard.create', name: 'Travail' }).id!
  expect(() => run({ kind: 'dashboard.delete', id: 'dash-home' })).toThrow()
  run({ kind: 'dashboard.delete', id: 'dash-home', replacementId: id })
  expect(service.snapshot().dashboards).toMatchObject([{ id, isDefault: true }])
})
it('duplicates placements independently, preserving bindings and configs', async () => {
  const { service, run } = await fixture(), original = service.snapshot().dashboards[0]
  const id = run({ kind: 'dashboard.duplicate', id: original.id, name: 'Copie' }).id!
  const copy = service.snapshot().dashboards.find(item => item.id === id)!
  expect(copy.widgets).toHaveLength(original.widgets.length)
  copy.widgets.forEach((widget, index) => { expect(widget.placementId).not.toBe(original.widgets[index].placementId); expect(widget.binding).toEqual(original.widgets[index].binding); expect(widget.config).toEqual(original.widgets[index].config) })
  run({ kind: 'widget.remove', dashboardId: id, placementId: copy.widgets[0].placementId })
  expect(service.snapshot().dashboards[0].widgets).toHaveLength(original.widgets.length)
})
it('saves one breakpoint only; rejects collisions and stale revisions without partial writes', async () => {
  const { service, run } = await fixture(), original = service.snapshot().dashboards[0]
  const items = deriveGrid(original.widgets, 'sm').map(({ id, ...rect }) => ({ id, rect }))
  run({ kind: 'layout.save', dashboardId: original.id, breakpoint: 'sm', items })
  expect(service.snapshot().dashboards[0].widgets.map(item => item.layouts.lg)).toEqual(original.widgets.map(item => item.layouts.lg))
  const before = service.snapshot()
  expect(() => run({ kind: 'layout.save', dashboardId: original.id, breakpoint: 'sm', items: items.map(item => ({ ...item, rect: { x: 0, y: 0, w: 1, h: 2 } })) })).toThrow()
  expect(service.snapshot()).toEqual(before)
  expect(() => service.execute({ command: { kind: 'dashboard.create', name: 'stale' }, expectedRevision: 0, operationId: randomUUID() })).toThrow()
})
it('replays operation IDs once and restores defaults without deleting custom composition', async () => {
  const { service, run } = await fixture()
  const request = { command: { kind: 'dashboard.create' as const, name: 'Custom' }, expectedRevision: service.snapshot().revision, operationId: randomUUID() }
  const value = service.execute(request); expect(service.execute(request)).toEqual(value)
  const custom = run({ kind: 'sidebar.add', label: 'Custom', icon: 'home', target: { kind: 'dashboard', dashboardId: value.id! } }).id
  for (const entry of service.snapshot().sidebar) run({ kind: 'sidebar.update', id: entry.id, label: entry.label, icon: entry.icon, target: entry.target, hidden: true })
  run({ kind: 'sidebar.restore' })
  expect(service.snapshot().dashboards.some(item => item.id === value.id)).toBe(true)
  expect(service.snapshot().sidebar.some(item => item.id === custom)).toBe(true)
  expect(service.snapshot().sidebar.filter(item => item.defaultKey).every(item => !item.hidden)).toBe(true)
})

it('preserves unavailable targets and every layout when a referenced dashboard disappears', async () => {
  const { service, run } = await fixture()
  const id = run({ kind: 'dashboard.create', name: 'Temporary' }).id!
  const shortcut = run({ kind: 'sidebar.add', label: 'Target', icon: 'home', target: { kind: 'dashboard', dashboardId: id } }).id!
  const before = service.snapshot().dashboards[0].widgets
  run({ kind: 'dashboard.delete', id })
  const entry = service.snapshot().sidebar.find(item => item.id === shortcut)!
  expect(entry.target).toEqual({ kind: 'dashboard', dashboardId: id })
  run({ kind: 'sidebar.update', id: entry.id, label: 'Unavailable', icon: entry.icon, target: entry.target, hidden: false })
  expect(service.snapshot().dashboards[0].widgets).toEqual(before)
  expect(() => run({ kind: 'sidebar.add', label: 'Invalid', icon: 'home', target: entry.target })).toThrow()
})
it('rejects injected authority, incomplete grid inventories, unknown contributions and invalid bindings', async () => {
  const { service, run } = await fixture()
  const before = service.snapshot()
  expect(() => service.execute({ command: { kind: 'dashboard.create', name: 'Injected', permissions: {} }, operationId: randomUUID(), expectedRevision: before.revision })).toThrow()
  expect(() => run({ kind: 'layout.save', dashboardId: 'dash-home', breakpoint: 'md', items: [] })).toThrow()
  expect(() => run({ kind: 'widget.add', dashboardId: 'dash-home', contribution: { packageId: 'missing.package', contributionId: 'widget' }, binding: { mode: 'none' }, config: {} })).toThrow()
  expect(() => run({ kind: 'widget.add', dashboardId: 'dash-home', contribution: { packageId: 'core', contributionId: 'tips' }, binding: { mode: 'active', major: { packageId: 'missing.package', contributionId: 'major' } }, config: {} })).toThrow()
  expect(service.snapshot()).toEqual(before)
})
it('persists shortcut groups, placement order and collapsed state without changing business data', async () => {
  const { service, run, db } = await fixture()
  const business = db.all('SELECT * FROM major_instances')
  const entries = service.snapshot().sidebar
  const group = run({ kind: 'sidebar.group.add', name: 'Travail' }).id!
  run({ kind: 'sidebar.place', id: entries[1].id, beforeId: null, groupId: group })
  run({ kind: 'sidebar.place', id: entries[2].id, beforeId: entries[1].id, groupId: group })
  run({ kind: 'sidebar.group.update', id: group, name: 'Mes projets', collapsed: true })
  const fresh = new CompositionService(new CoreService(db)).snapshot()
  expect(fresh.sidebarGroups).toEqual([{ id: group, name: 'Mes projets', collapsed: true }])
  expect(fresh.sidebar.filter(entry => entry.groupId === group).map(entry => entry.id)).toEqual([entries[2].id, entries[1].id])
  expect(() => run({ kind: 'sidebar.place', id: entries[0].id, beforeId: entries[1].id, groupId: null })).toThrow()
  run({ kind: 'sidebar.group.remove', id: group })
  expect(service.snapshot().sidebar).toHaveLength(entries.length)
  expect(service.snapshot().sidebar.every(entry => !entry.groupId)).toBe(true)
  expect(db.all('SELECT * FROM major_instances')).toEqual(business)
})
it('reorders groups, rejects forged destinations and cleans deleted shortcut membership', async () => {
  const { service, run } = await fixture()
  const first = run({ kind: 'sidebar.group.add', name: 'Un' }).id!, second = run({ kind: 'sidebar.group.add', name: 'Deux' }).id!
  run({ kind: 'sidebar.group.place', id: second, beforeId: first })
  expect(service.snapshot().sidebarGroups?.map(group => group.id)).toEqual([second, first])
  const entry = service.snapshot().sidebar[0]
  expect(() => run({ kind: 'sidebar.place', id: entry.id, beforeId: null, groupId: 'forged' })).toThrow()
  run({ kind: 'sidebar.place', id: entry.id, beforeId: null, groupId: first })
  run({ kind: 'sidebar.remove', id: entry.id })
  expect(service.snapshot().sidebar.some(item => item.id === entry.id)).toBe(false)
})
