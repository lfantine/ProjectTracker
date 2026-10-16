import { expect, it, vi } from 'vitest'
import type { ProjectTrackerSdk, SdkContext } from '../sdk/src'
import { emptyWeek, localDay, validateWeek, visibleSlots } from '../packages/builtin-week/src/model'
import { loadWeek, saveWeek } from '../packages/builtin-week/src/client'
const document = () => ({ slots: [{ id: 'slot', title: 'Travail', day: 0, start: '09:00', end: '10:00', projectId: 'project-a', color: '#abc' }], wakeTimes: Array(7).fill('07:00'), preserved: { metadata: true } })
function fixture(kind: 'major' | 'widget' = 'major') {
  const context = { packageId: 'builtin.week', kind, binding: { mode: 'fixed', major: { packageId: 'builtin.week', contributionId: 'planner' }, instanceId: 'legacy-week' }, instance: { instanceId: 'legacy-week', name: 'Ma semaine' } } as SdkContext
  const sdk = { call: vi.fn(async () => context), storage: { get: vi.fn(async () => ({ instanceId: 'legacy-week', revision: 4, value: document() })), put: vi.fn(async () => ({ revision: 5 })) } }
  return { context, sdk, client: sdk as unknown as ProjectTrackerSdk }
}
it('reads the already-imported namespace without creating/writing anything, preserving metadata', async () => {
  const f = fixture()
  expect(await loadWeek(f.client)).toMatchObject({ instanceId: 'legacy-week', revision: 4, document: document() })
  expect(f.sdk.storage.get).toHaveBeenCalledWith({ collection: 'week', id: 'schedule', scope: 'instance', instanceId: 'legacy-week' })
  expect(f.sdk.storage.put).not.toHaveBeenCalled()
})
it('does not let widgets pick another instance and refuses an instance changed during read', async () => {
  const f = fixture('widget')
  await loadWeek(f.client)
  expect(f.sdk.storage.get).toHaveBeenCalledWith({ collection: 'week', id: 'schedule', scope: 'instance', instanceId: 'legacy-week' })
  f.sdk.storage.get.mockResolvedValue({ instanceId: 'other', revision: 4, value: document() })
  await expect(loadWeek(f.client)).rejects.toThrow('a changé')
})
it('writes only with snapshot revision and explicit instance; conflict is propagated without retry/overwrite', async () => {
  const f = fixture(), snapshot = (await loadWeek(f.client))!
  const edited = { ...snapshot.document, slots: [] }
  expect(await saveWeek(f.client, snapshot, edited)).toMatchObject({ revision: 5, document: edited })
  expect(f.sdk.storage.put).toHaveBeenCalledWith({ collection: 'week', id: 'schedule', scope: 'instance', instanceId: 'legacy-week', expectedRevision: 4, value: edited })
  f.sdk.storage.put.mockRejectedValue(Error('CONFLICT'))
  await expect(saveWeek(f.client, snapshot, edited)).rejects.toThrow('CONFLICT')
  expect(f.sdk.storage.put).toHaveBeenCalledTimes(2)
})
it('refuses writes after context change or from a widget', async () => {
  const f = fixture(), snapshot = (await loadWeek(f.client))!
  f.context.instance = { instanceId: 'other', name: 'Autre' }
  await expect(saveWeek(f.client, snapshot, emptyWeek())).rejects.toThrow('a changé')
  expect(f.sdk.storage.put).not.toHaveBeenCalled()
  const widget = fixture('widget')
  await expect(saveWeek(widget.client, snapshot, emptyWeek())).rejects.toThrow('a changé')
  expect(widget.sdk.storage.put).not.toHaveBeenCalled()
})
for (const [name, value] of [
  ['invalid time', { ...document(), wakeTimes: ['bad', ...Array(6).fill('07:00')] }],
  ['overlap', { ...document(), slots: [...document().slots, { ...document().slots[0], id: 'second' }] }],
  ['duplicate id', { ...document(), slots: [...document().slots, { ...document().slots[0], day: 1 }] }],
  ['wrong type', { ...document(), slots: [{ ...document().slots[0], title: 42 }] }],
  ['invalid colour', { ...document(), slots: [{ ...document().slots[0], color: 'red' }] }],
] as const) it(`refuses ${name} without dropping or mutating stored data`, () => {
  const before = structuredClone(value)
  expect(() => validateWeek(value)).toThrow('invalides')
  expect(value).toEqual(before)
})
it('filters project identity and local day, including slots without a project, without mutating shared data', () => {
  const doc = validateWeek({ ...document(), slots: [...document().slots, { id: 'none', title: 'Libre', day: 6, start: '11:00', end: '12:00' }] })
  expect(visibleSlots(doc, { projectId: 'project-a' }).map(slot => slot.id)).toEqual(['slot'])
  expect(visibleSlots(doc, { day: 6 }).map(slot => slot.id)).toEqual(['none'])
  expect(localDay(new Date(2026, 9, 19, 0, 0))).toBe(0)
  expect(localDay(new Date(2026, 9, 18, 23, 59))).toBe(6)
  visibleSlots(doc)[0].title = 'Changed'
  expect(doc.slots[0].title).toBe('Travail')
})


it('does not create data when no instance/document is available and keeps defaults detached', async () => {
  const f = fixture()
  f.context.instance = null
  expect(await loadWeek(f.client)).toBeNull()
  expect(f.sdk.storage.get).not.toHaveBeenCalled()
  f.context.instance = { instanceId: 'legacy-week', name: 'Ma semaine' }
  f.sdk.storage.get.mockResolvedValue(null as never)
  expect(await loadWeek(f.client)).toMatchObject({ revision: null, document: emptyWeek() })
  expect(f.sdk.storage.put).not.toHaveBeenCalled()
  const first = emptyWeek(); first.wakeTimes[0] = '00:00'
  expect(emptyWeek().wakeTimes[0]).toBe('07:00')
})
