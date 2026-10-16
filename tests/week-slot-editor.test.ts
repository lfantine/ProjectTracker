import { afterEach, expect, it, vi } from 'vitest'
import { slotEditor } from '../packages/builtin-week/src/slot-editor'
import { emptyWeek } from '../packages/builtin-week/src/model'
import type { ProjectTrackerSdk } from '../sdk/src'
import type { WeekSlot } from '../shared/week'
const base = { id: 'slot-one', title: 'Travail', day: 0, start: '09:00', end: '10:00', color: '#AbC', people: ['A\nB', ''], custom: { legacy: true } }
function setup(existing: WeekSlot | null = base, put = vi.fn(async () => ({ revision: 3 }))) {
  const sdk = { call: vi.fn(async () => ({ kind: 'major', packageId: 'builtin.week', instance: { instanceId: 'week-one' } })), storage: { put }, core: { list: vi.fn(async () => ({ items: [{ id: 'project-one', name: 'Projet' }], nextCursor: null })) } } as unknown as ProjectTrackerSdk
  const document = { ...emptyWeek(), slots: [{ ...base }], metadata: 'retained' }
  const done = vi.fn(); const form = slotEditor(sdk, { instanceId: 'week-one', name: 'Semaine', revision: 2, document }, existing ?? undefined, done)
  window.document.body.append(form)
  const set = (name: string, value: string) => { (form.elements.namedItem(name) as HTMLInputElement).value = value }
  const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }))
  return { form, sdk, done, document, set, submit }
}
afterEach(() => { document.body.replaceChildren() })
it('edits a slot preserving identity, unknown metadata, untouched people and colour', async () => {
  const { sdk, done, set, submit, document } = setup()
  await vi.waitFor(() => expect(window.document.querySelector('option[value=project-one]')).not.toBeNull())
  set('title', 'Nouvel objectif'); set('description', '<script>text</script>'); set('projectId', 'project-one')
  Array.from(window.document.querySelectorAll('button')).find(button => button.textContent === 'Enregistrer')!.click()
  await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
  expect(sdk.storage.put).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'week-one', expectedRevision: 2, value: expect.objectContaining({ metadata: 'retained', slots: [expect.objectContaining({ ...base, title: 'Nouvel objectif', description: '<script>text</script>', projectId: 'project-one' })] }) }))
  expect(document.slots[0].title).toBe('Travail')
})
it('adds a new slot without replacing existing slots or wake times', async () => {
  const { sdk, done, set, submit } = setup(null)
  set('title', 'Après-midi'); set('day', '1'); submit()
  await vi.waitFor(() => expect(done).toHaveBeenCalled())
  const value = vi.mocked(sdk.storage.put).mock.calls[0][0].value as { slots: WeekSlot[]; wakeTimes: string[] }
  expect(value.slots).toHaveLength(2); expect(value.slots[0]).toEqual(base)
  expect(value.slots[1]).toMatchObject({ title: 'Après-midi', day: 1 }); expect(value.slots[1].id).not.toBe(base.id)
  expect(value.wakeTimes).toEqual(Array(7).fill('07:00'))
})
it.each([
  ['end', '08:00', 'La fin doit être après'],
  ['color', 'red', 'couleur hexadécimale'],
])('validates %s without any write', async (name, value, error) => {
  const { form, sdk, set, submit } = setup(); set(name, value); submit()
  expect(form.textContent).toContain(error); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('rejects overlap with another slot', () => {
  const { form, sdk, submit, document } = setup()
  document.slots.push({ id: 'other', title: 'Autre', day: 0, start: '09:30', end: '10:30' })
  submit(); expect(form.textContent).toContain('chevauche'); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('clears optional fields explicitly and edits people one per line', async () => {
  const { sdk, done, set, submit } = setup()
  set('color', ''); set('people', 'Alice\nBob'); submit()
  await vi.waitFor(() => expect(done).toHaveBeenCalled())
  const value = vi.mocked(sdk.storage.put).mock.calls[0][0].value as { slots: WeekSlot[] }
  expect(value.slots[0].color).toBeUndefined(); expect(value.slots[0].people).toEqual(['Alice', 'Bob'])
})
it('keeps draft on conflict without leaking details or retrying', async () => {
  const put = vi.fn(async () => { throw Error('private path') })
  const { form, done, set, submit } = setup(base, put); set('title', 'Brouillon'); submit()
  await vi.waitFor(() => expect(form.textContent).toContain('Votre saisie est conservée'))
  expect((form.elements.namedItem('title') as HTMLInputElement).value).toBe('Brouillon')
  expect(form.textContent).not.toContain('private path'); expect(put).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled()
})
it('cancel does not save', () => {
  const { form, done, sdk } = setup(); Array.from(form.querySelectorAll('button')).find(button => button.textContent === 'Annuler')!.click()
  expect(done).toHaveBeenCalledTimes(1); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('deduplicates pending saves and ignores success after unmount', async () => {
  let release!: (value: { revision: number }) => void
  const put = vi.fn(() => new Promise<{ revision: number }>(resolve => { release = resolve }))
  const { form, done, submit } = setup(base, put)
  submit(); submit()
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(form.querySelector('fieldset')!.disabled).toBe(true)
  form.remove(); release({ revision: 3 })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
})
it('pastes a template as a new identity without losing metadata or overwriting the original', async () => {
  const { sdk, done } = setup(); document.body.replaceChildren()
  const template = { ...base, start: '10:00', end: '11:00' }
  const form = slotEditor(sdk, { instanceId: 'week-one', name: 'Semaine', revision: 2, document: { ...emptyWeek(), slots: [base] } }, undefined, done, template)
  document.body.append(form)
  Array.from(form.querySelectorAll('button')).find(button => button.textContent === 'Enregistrer')!.click()
  await vi.waitFor(() => expect(done).toHaveBeenCalled())
  const value = vi.mocked(sdk.storage.put).mock.calls[0][0].value as { slots: (WeekSlot & { custom?: unknown })[] }
  expect(value.slots).toHaveLength(2); expect(value.slots[0]).toEqual(base)
  expect(value.slots[1]).toMatchObject({ ...template, id: expect.any(String) })
  expect(value.slots[1].id).not.toBe(base.id)
})
it('still checks overlap against the copied original rather than excluding its id', () => {
  const { sdk, done } = setup(); document.body.replaceChildren()
  const form = slotEditor(sdk, { instanceId: 'week-one', name: 'Semaine', revision: 2, document: { ...emptyWeek(), slots: [base] } }, undefined, done, base)
  document.body.append(form)
  Array.from(form.querySelectorAll('button')).find(button => button.textContent === 'Enregistrer')!.click()
  expect(form.textContent).toContain('chevauche'); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('preserves untouched legacy line endings even when browser controls normalize their display', async () => {
  const legacy = { ...base, title: 'Objectif\nancien', description: 'Ligne 1\r\nLigne 2', location: 'Adresse\nancienne', people: ['A\r\nB'] }
  const { sdk, done, form, submit } = setup(legacy)
  expect(form.querySelector('textarea[name=description]')).not.toBeNull()
  submit(); await vi.waitFor(() => expect(done).toHaveBeenCalled())
  expect(sdk.storage.put).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ slots: [legacy] }) }))
})
