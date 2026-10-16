import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyWeek } from '../packages/builtin-week/src/model'
beforeEach(() => { vi.resetModules(); document.body.innerHTML = '<main id="week-root"></main>' })
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); document.body.replaceChildren() })
it.each([['https://example.test/path', true], ['javascript:alert(1)', false], ['file:///private/data', false], ['https://name:secret@example.test', false]])('opens %s only via native-confirmed SDK navigation', async (link, allowed) => {
  const sdk = {
    call: vi.fn(async () => ({ packageId: 'builtin.week', kind: 'major', binding: { mode: 'fixed', major: { packageId: 'builtin.week', contributionId: 'planner' }, instanceId: 'one' }, instance: { instanceId: 'one', name: 'Semaine' } })),
    storage: { get: vi.fn(async () => ({ instanceId: 'one', revision: 1, value: { ...emptyWeek(), slots: [{ id: 's', title: 'Lien', day: 0, start: '09:00', end: '10:00', link }] } })) },
    navigation: { open: vi.fn(async () => ({ opened: true })) }, onContextChange: () => () => {}, events: { subscribe: vi.fn(async () => async () => {}) },
  }
  vi.stubGlobal('ProjectTracker', { ready: Promise.resolve(sdk) }); await import('../packages/builtin-week/src/view')
  await vi.waitFor(() => expect(sdk.events.subscribe).toHaveBeenCalled())
  const open = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Ouvrir le lien')
  expect(!!open).toBe(allowed)
  expect(document.querySelector('a')).toBeNull()
  if (open) { open.click(); expect(sdk.navigation.open).toHaveBeenCalledWith({ kind: 'external', url: link }) }
  else expect(sdk.navigation.open).not.toHaveBeenCalled()
})
