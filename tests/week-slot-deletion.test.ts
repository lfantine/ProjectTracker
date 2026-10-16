import { afterEach, expect, it, vi } from 'vitest'
import { slotDeletion } from '../packages/builtin-week/src/slot-deletion'
import { emptyWeek } from '../packages/builtin-week/src/model'
import type { ProjectTrackerSdk } from '../sdk/src'
const target = { id: 'target', title: '<script>legacy</script>', day: 0, start: '09:00', end: '10:00' }
const other = { ...target, id: 'other', day: 1, metadata: 'preserved' }
function setup(put = vi.fn(async () => ({ revision: 8 }))) {
  const sdk = { call: vi.fn(async () => ({ kind: 'major', packageId: 'builtin.week', instance: { instanceId: 'week-one' } })), storage: { put } } as unknown as ProjectTrackerSdk
  const snapshot = { instanceId: 'week-one', name: 'Semaine', revision: 7, document: { ...emptyWeek(), slots: [target, other], metadata: 'document' } }
  const done = vi.fn(); const panel = slotDeletion(sdk, snapshot, 'target', done); document.body.append(panel)
  const confirm = () => panel.querySelector<HTMLButtonElement>('button')!.click()
  return { sdk, snapshot, done, panel, confirm }
}
afterEach(() => { document.body.replaceChildren() })
it('shows an inert confirmation and cancel does not write', () => {
  const { panel, sdk, done } = setup()
  expect(panel.textContent).toContain(target.title); expect(panel.querySelector('script')).toBeNull()
  expect(sdk.storage.put).not.toHaveBeenCalled()
  Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Annuler')!.click()
  expect(done).toHaveBeenCalledTimes(1); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('removes only the confirmed target with captured CAS and preserved metadata/wakes', async () => {
  const { sdk, snapshot, done, confirm } = setup(); confirm()
  await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
  expect(sdk.storage.put).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'week-one', expectedRevision: 7,
    value: { metadata: 'document', slots: [other], wakeTimes: Array(7).fill('07:00') } }))
  expect(snapshot.document.slots).toEqual([target, other])
})
it('retains the confirmation after conflict without leaking or retrying', async () => {
  const put = vi.fn(async () => { throw Error('private native path') })
  const { panel, done, confirm } = setup(put); confirm()
  await vi.waitFor(() => expect(panel.textContent).toContain('Suppression impossible'))
  expect(panel.textContent).not.toContain('private native path'); expect(put).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled()
  expect(panel.querySelector('button')!.disabled).toBe(false)
})
it('deduplicates pending confirmations and ignores success after unmount', async () => {
  let release!: (value: { revision: number }) => void
  const put = vi.fn(() => new Promise<{ revision: number }>(resolve => { release = resolve }))
  const { panel, done, confirm } = setup(put); confirm(); confirm()
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(Array.from(panel.querySelectorAll('button')).every(button => button.disabled)).toBe(true)
  panel.remove(); release({ revision: 8 })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
})
it('rejects a missing target before constructing a destructive command', () => {
  const { sdk, snapshot, done } = setup()
  expect(() => slotDeletion(sdk, snapshot, 'missing', done)).toThrow('Créneau indisponible')
  expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('refuses deletion after switching the consulted instance', async () => {
  const { sdk, panel, done, confirm } = setup()
  vi.mocked(sdk.call).mockResolvedValueOnce({ kind: 'major', packageId: 'builtin.week', instance: { instanceId: 'another' } } as never)
  confirm()
  await vi.waitFor(() => expect(panel.textContent).toContain('Suppression impossible'))
  expect(sdk.storage.put).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled()
})
it('Escape cancels the confirmation without deleting', () => {
  const { panel, sdk, done } = setup()
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(done).toHaveBeenCalledTimes(1); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('can remove the final slot without removing the week or resetting wake times', async () => {
  const { snapshot, sdk, done, confirm } = setup()
  snapshot.document.slots = [target]; snapshot.document.wakeTimes[0] = '06:30'
  confirm(); await vi.waitFor(() => expect(done).toHaveBeenCalled())
  expect(sdk.storage.put).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'week-one', value: expect.objectContaining({ slots: [], wakeTimes: ['06:30', ...Array(6).fill('07:00')] }) }))
})
