import { expect, it } from 'vitest'
import { pasteDraft } from '../packages/builtin-week/src/clipboard'
import type { WeekSlot } from '../shared/week'
const source: WeekSlot = { id: 'source', title: 'Lecture', day: 0, start: '09:00', end: '10:00', people: ['Alice'], color: '#abc', description: 'Détails', projectId: 'missing-project' }
it('finds the next quarter-hour gap and deeply detaches all metadata', () => {
  const value = pasteDraft(source, [source, { ...source, id: 'busy', start: '10:00', end: '10:45' }])!
  expect(value).toEqual({ ...source, start: '10:45', end: '11:45' })
  value.people!.push('Bob'); expect(source.people).toEqual(['Alice'])
})
it('rounds up rather than shortening the copied duration', () => {
  const value = pasteDraft({ ...source, start: '09:03', end: '10:07' }, [])!
  expect(value.start).toBe('10:15'); expect(value.end).toBe('11:19')
})
it('skips midnight crossings and wraps to Monday after Sunday', () => {
  const value = pasteDraft({ ...source, day: 6, start: '22:30', end: '23:30' }, [])!
  expect(value).toMatchObject({ day: 0, start: '00:00', end: '01:00' })
})
it('returns no draft for a full week or invalid source', () => {
  const full = Array.from({ length: 7 }, (_, day) => ({ ...source, id: String(day), day, start: '00:00', end: '23:59' }))
  expect(pasteDraft(source, full)).toBeNull()
  expect(pasteDraft({ ...source, end: '08:00' }, [])).toBeNull()
})
it('uses an explicit grid destination but refuses overlap or a midnight crossing', () => {
  expect(pasteDraft(source, [source], { day: 2, minute: 900 })).toMatchObject({ day: 2, start: '15:00', end: '16:00' })
  expect(pasteDraft(source, [source], { day: 0, minute: 540 })).toBeNull()
  expect(pasteDraft(source, [], { day: 0, minute: 1410 })).toBeNull()
})
