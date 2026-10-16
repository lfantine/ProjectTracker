import { expect, it } from 'vitest'
import { daySlotStatus, dayState } from '../packages/builtin-week/src/day-state'
const slot = { id: 'one', title: '<Travail>', day: 0, start: '09:00', end: '10:00' }
it('preserves today widget local boundaries and minute progress', () => {
  expect(dayState(slot, new Date(2026, 9, 12, 8, 59))).toMatchObject({ label: 'À venir', running: false, progress: 0 })
  expect(dayState(slot, new Date(2026, 9, 12, 9, 0))).toMatchObject({ label: 'En cours', running: true, progress: 0, remaining: 60 })
  expect(dayState(slot, new Date(2026, 9, 12, 9, 30))).toMatchObject({ label: 'En cours', progress: 50, remaining: 30 })
  expect(dayState(slot, new Date(2026, 9, 12, 10, 0))).toMatchObject({ label: 'Passé', running: false, progress: 100, remaining: 0 })
})
it('renders accessible native progress and text safely, only while running', () => {
  const state = daySlotStatus(slot, new Date(2026, 9, 12, 9, 30))
  expect(state.textContent).toBe('En cours30 min restantes')
  const progress = state.querySelector('progress')!
  expect(progress.value).toBe(50)
  expect(progress.getAttribute('aria-label')).toBe('Avancement de <Travail>')
  expect(state.querySelector('travail')).toBeNull()
  expect(daySlotStatus(slot, new Date(2026, 9, 12, 10)).querySelector('progress')).toBeNull()
})
