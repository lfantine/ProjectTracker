import { expect, it } from 'vitest'
import { CORE_BLOCK_TYPES, CORE_WIDGETS, coreBlockRef, coreWidgetRef } from '../shared/core'
import { coreBlockCatalogue, resolveCoreContribution } from '../shared/contributionRegistry'
import { MODULE_CATALOG, MODULE_CATEGORY_COUNTS } from '../renderer/lib/moduleCatalog'

it('describes every native block and widget with a trusted adapter and no archive entry', () => {
  for (const id of CORE_BLOCK_TYPES) expect(resolveCoreContribution(coreBlockRef(id), 'minor')).toMatchObject({ source: 'native', type: 'minor', adapter: id })
  for (const id of Object.keys(CORE_WIDGETS) as (keyof typeof CORE_WIDGETS)[]) expect(resolveCoreContribution(coreWidgetRef(id), 'widget')).toMatchObject({ source: 'native', type: 'widget', adapter: id })
  expect(resolveCoreContribution({ packageId: 'other', contributionId: 'tasks' }, 'minor')).toBeUndefined()
  expect(resolveCoreContribution(coreBlockRef('tasks'), 'major')).toBeUndefined()
})
it('keeps historical deadlines block/widget references unambiguous by host kind', () => {
  const ref = { packageId: 'core', contributionId: 'deadlines' }
  expect(resolveCoreContribution(ref, 'minor')).toMatchObject({ type: 'minor', name: 'Échéances', details: { insertion: 'direct' } })
  expect(resolveCoreContribution(ref, 'widget')).toMatchObject({ type: 'widget', name: 'Échéances', size: { w: 8, h: 6 } })
})
it('feeds the existing addable module catalogue without changing order, pickers or category counts', () => {
  expect(MODULE_CATALOG.map(entry => entry.type)).toEqual(['table', 'stack', 'deadlines', 'image', 'chart', 'note', 'error'])
  expect(MODULE_CATALOG.filter(entry => entry.kind === 'picker').map(entry => entry.type)).toEqual(['note', 'error'])
  expect(MODULE_CATEGORY_COUNTS).toEqual({ suivi: 3, contenu: 2, liens: 2 })
  for (const entry of MODULE_CATALOG) expect(entry.title).toBe(coreBlockCatalogue().find(item => item.id === entry.type)?.name)
})
it('returns detached native metadata so caller edits cannot poison the next resolution', () => {
  const ref = coreBlockRef('table')
  const first = resolveCoreContribution(ref, 'minor')!
  first.name = 'changed'; first.ref.packageId = 'other'
  if (first.type === 'minor') first.details.name = 'changed'
  expect(resolveCoreContribution(ref, 'minor')).toMatchObject({ ref, name: 'Table', details: { name: 'Table' } })
  coreBlockCatalogue()[0].name = 'changed'
  expect(coreBlockCatalogue()[0].name).toBe('Table')
})
