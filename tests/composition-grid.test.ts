import { expect, it } from 'vitest'
import { deriveGrid, moveGrid, overlaps } from '../shared/grid'
import { breakpointForWidth, type DashboardWidgetPlacement } from '../shared/models'
const widgets: DashboardWidgetPlacement[] = [0, 1, 2].map(index => ({ dashboardId: 'dash', placementId: `w${index}`, contribution: { packageId: 'core', contributionId: 'tips' }, config: { version: 1, values: {} }, binding: { mode: 'none' }, revision: 0, layouts: { lg: { x: index * 4, y: 0, w: 4, h: 3 } } }))
it('uses container breakpoint boundaries', () => { expect([799, 800, 1199, 1200].map(breakpointForWidth)).toEqual(['sm', 'md', 'md', 'lg']) })
it('derives non-overlapping narrow layouts without changing persisted wider layouts', () => {
  const original = structuredClone(widgets)
  for (const breakpoint of ['lg', 'md', 'sm'] as const) {
    const grid = deriveGrid(widgets, breakpoint)
    expect(grid.every((item, index) => grid.slice(index + 1).every(other => !overlaps(item, other)))).toBe(true)
  }
  expect(widgets).toEqual(original)
})
it('prioritizes keyboard movement, resolving collisions without mutating inputs', () => {
  const grid = deriveGrid(widgets, 'sm'), before = structuredClone(grid)
  const next = moveGrid(grid, 'w2', { y: 0 }, 1)
  expect(next.find(item => item.id === 'w2')?.y).toBe(0)
  expect(next.every((item, index) => next.slice(index + 1).every(other => !overlaps(item, other)))).toBe(true)
  expect(grid).toEqual(before)
})
