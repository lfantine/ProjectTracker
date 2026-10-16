import { expect, it } from 'vitest'
import { plannedMinutes } from '../packages/builtin-week-report/src/model'
it('totals planned minutes per day and project without counting wake times', () => {
  const report = plannedMinutes([{ day: 0, start: '08:00', end: '09:15', projectId: 'a' }, { day: 0, start: '10:00', end: '10:30' }, { day: 6, start: '23:00', end: '24:00', projectId: 'deleted' }], [{ id: 'a', name: 'Projet A' }])
  expect(report.total).toBe(165); expect(report.days).toEqual([105,0,0,0,0,0,60])
  expect(report.projects.map(item => [item.label, item.minutes])).toEqual([['Projet A',75],['Sans projet',30],['Projet manquant (deleted)',60]])
})
it('keeps independent weeks separate and handles empty weeks/no projects', () => {
  expect(plannedMinutes([], []).total).toBe(0)
  expect(plannedMinutes([{ day: 1, start: '12:00', end: '13:00' }], []).total).toBe(60)
  expect(plannedMinutes([], []).projects).toEqual([])
})
it('rejects invalid times rather than silently publishing incorrect totals', () => {
  for (const slot of [{ day: 7, start: '08:00', end: '09:00' }, { day: 0, start: '08:00', end: '07:59' }, { day: 0, start: '24:00', end: '24:30' }]) expect(() => plannedMinutes([slot], [])).toThrow()
})
