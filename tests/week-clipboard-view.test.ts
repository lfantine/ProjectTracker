import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyWeek } from '../packages/builtin-week/src/model'
beforeEach(() => { vi.resetModules(); document.body.innerHTML = '<main id="week-root"></main>' })
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); document.body.replaceChildren() })
async function setup(kind = 'major') {
  let change!: () => void
  const slot = { id: 'source', title: 'Lecture', day: 0, start: '09:00', end: '10:00', description: 'Préservé' }
  const sdk = {
    call: vi.fn(async () => ({ packageId: 'builtin.week', kind, binding: { mode: 'active', major: { packageId: 'builtin.week', contributionId: 'planner' } }, instance: { instanceId: 'week-one', name: 'Semaine' } })),
    storage: { get: vi.fn(async () => ({ instanceId: 'week-one', revision: 1, value: { ...emptyWeek(), slots: [slot] } })), put: vi.fn() },
    onContextChange: vi.fn((callback: () => void) => { change = callback; return () => {} }),
    events: { subscribe: vi.fn(async () => async () => {}) },
  }
  vi.stubGlobal('ProjectTracker', { ready: Promise.resolve(sdk) })
  await import('../packages/builtin-week/src/view')
  await vi.waitFor(() => expect(sdk.events.subscribe).toHaveBeenCalled())
  const button = (name: string) => Array.from(document.querySelectorAll('button')).find(node => node.textContent === name)!
  return { sdk, button, change: () => change() }
}
it('copies with Command and opens a detached creation draft with Ctrl V without saving', async () => {
  const { sdk, button } = await setup()
  expect(button('Coller le créneau').disabled).toBe(true)
  const item = document.querySelector('li')!; item.focus()
  item.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true }))
  expect(button('Coller le créneau').disabled).toBe(false)
  item.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))
  const form = document.querySelector('form')!
  expect(form.getAttribute('aria-label')).toBe('Ajouter un créneau')
  expect((form.elements.namedItem('title') as HTMLInputElement).value).toBe('Lecture')
  expect((form.elements.namedItem('start') as HTMLInputElement).value).toBe('10:00')
  expect(sdk.storage.put).not.toHaveBeenCalled()
  const input = form.querySelector('input')!; const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })
  input.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  button('Annuler').click()
  await vi.waitFor(() => expect(document.querySelector('form')).toBeNull())
  await vi.waitFor(() => expect(button('Coller le créneau').disabled).toBe(false))
})
it('clears its private clipboard when the context changes', async () => {
  const { button, change } = await setup(); button('Copier le créneau').click()
  expect(button('Coller le créneau').disabled).toBe(false)
  change()
  await vi.waitFor(() => expect(button('Coller le créneau').disabled).toBe(true))
})
it('keeps copy and paste unavailable in widget views', async () => {
  const { button } = await setup('widget')
  expect(button('Copier le créneau')).toBeUndefined(); expect(button('Coller le créneau')).toBeUndefined()
})
it('Space edits and Delete only opens a confirmation, never an immediate write', async () => {
  const { sdk, button } = await setup()
  document.querySelector('li')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
  expect(document.querySelector('form')!.getAttribute('aria-label')).toBe('Modifier le créneau')
  button('Annuler').click()
  await vi.waitFor(() => expect(document.querySelector('form')).toBeNull())
  await vi.waitFor(() => expect(document.activeElement).toBe(document.getElementById('week-root')))
  document.querySelector('li')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
  expect(button('Confirmer la suppression')).toBeDefined(); expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('does not treat repeat, composition or modified edit keys as commands', async () => {
  const { sdk, button } = await setup()
  const item = document.querySelector('li')!
  for (const options of [{ key: 'c', ctrlKey: true, repeat: true }, { key: 'c', metaKey: true, isComposing: true }, { key: 'Delete', altKey: true }, { key: 'Enter', ctrlKey: true }]) {
    item.dispatchEvent(new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true }))
  }
  expect(button('Coller le créneau').disabled).toBe(true)
  expect(document.querySelector('form')).toBeNull(); expect(button('Confirmer la suppression')).toBeUndefined()
  expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('does not replace an active grid gesture with a focus-triggered refresh', async () => {
  const { sdk } = await setup()
  const canvas = document.querySelectorAll<HTMLElement>('.week-canvas')[1]
  window.dispatchEvent(new Event('focus')) // Start a read before the gesture.
  canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 672, bubbles: true }))
  window.dispatchEvent(new Event('focus')) // Must not start another render mid-drag.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(document.querySelectorAll('.week-canvas')[1]).toBe(canvas)
  canvas.dispatchEvent(new MouseEvent('pointermove', { clientY: 720, bubbles: true }))
  canvas.dispatchEvent(new MouseEvent('pointerup', { clientY: 720, bubbles: true }))
  expect(document.querySelector('form')!.getAttribute('aria-label')).toBe('Ajouter un créneau')
  expect((document.querySelector('[name=start]') as HTMLInputElement).value).toBe('14:00')
  expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('opens an actual dialog without unmounting the calendar and cancels without writes', async () => {
  const { sdk, button } = await setup()
  const calendar = document.querySelector('.week-grid')!
  button('Ajouter un créneau').click()
  const dialog = document.querySelector('dialog')!
  expect(dialog.getAttribute('aria-label')).toBe('Ajouter un créneau')
  expect(dialog.hasAttribute('open')).toBe(true)
  expect(document.querySelector('.week-grid')).toBe(calendar)
  button('Annuler').click()
  await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull())
  expect(sdk.storage.put).not.toHaveBeenCalled()
})
