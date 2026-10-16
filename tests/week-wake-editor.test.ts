import { afterEach, expect, it, vi } from 'vitest'
import { wakeEditor } from '../packages/builtin-week/src/wake-editor'
import { emptyWeek } from '../packages/builtin-week/src/model'
import type { ProjectTrackerSdk } from '../sdk/src'
const snapshot = () => ({ instanceId: 'week-one', name: 'Semaine', revision: 4, document: { ...emptyWeek(), custom: 'preserved' } })
function setup(put = vi.fn(async () => ({ revision: 5 }))) {
  const sdk = { call: vi.fn(async () => ({ kind: 'major', packageId: 'builtin.week', instance: { instanceId: 'week-one' } })), storage: { put } } as unknown as ProjectTrackerSdk
  const original = snapshot(); const done = vi.fn()
  const form = wakeEditor(sdk, original, done); document.body.append(form)
  return { form, sdk, original, done }
}
afterEach(() => { document.body.replaceChildren() })
it('saves seven local wake times with captured revision and keeps document metadata', async () => {
  const { form, sdk, original, done } = setup()
  const inputs = form.querySelectorAll('input'); expect(inputs).toHaveLength(7)
  inputs[0].value = '08:30'
  inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
  expect(sdk.storage.put).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'week-one', expectedRevision: 4, value: expect.objectContaining({ custom: 'preserved', wakeTimes: ['08:30', ...Array(6).fill('07:00')] }) }))
  expect(original.document.wakeTimes[0]).toBe('07:00')
})
it('retains the draft after conflict without retrying or closing', async () => {
  const put = vi.fn(async () => { throw Error('private native details') })
  const { form, done } = setup(put)
  form.querySelector('input')!.value = '09:00'
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(form.textContent).toContain('Votre saisie est conservée'))
  expect(form.querySelector('input')!.value).toBe('09:00')
  expect(form.textContent).not.toContain('private native details')
  expect(put).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled()
})
it('cancel closes without writing and invalid times do not submit', () => {
  const { form, sdk, done } = setup()
  form.querySelector('input')!.value = ''
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  expect(sdk.storage.put).not.toHaveBeenCalled()
  Array.from(form.querySelectorAll('button')).find(button => button.textContent === 'Annuler')!.click()
  expect(done).toHaveBeenCalledTimes(1)
})
it('deduplicates pending submissions and does not act after unmount', async () => {
  let release!: (value: { revision: number }) => void
  const put = vi.fn(() => new Promise<{ revision: number }>(resolve => { release = resolve }))
  const { form, done } = setup(put)
  form.dispatchEvent(new Event('submit', { cancelable: true })); form.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(form.querySelector('fieldset')!.disabled).toBe(true)
  form.remove(); release({ revision: 5 })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
})
