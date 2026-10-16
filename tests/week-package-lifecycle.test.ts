import { afterEach, beforeEach, expect, it, vi } from 'vitest'
beforeEach(() => { vi.resetModules(); document.body.innerHTML = '<main id="week-root"></main>' })
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = '' })
it('does not start reads/listeners if unmounted while waiting for the SDK', async () => {
  let release!: (value: unknown) => void
  const ready = new Promise(resolve => { release = resolve })
  const call = vi.fn()
  vi.stubGlobal('ProjectTracker', { ready })
  await import('../packages/builtin-week/src/view')
  window.dispatchEvent(new Event('pagehide'))
  release({ call })
  await Promise.resolve(); await Promise.resolve()
  expect(call).not.toHaveBeenCalled()
})
it('cleans a subscription resolved after unmount without restarting a timer', async () => {
  let release!: (unsubscribe: () => Promise<void>) => void
  const unsubscribe = vi.fn(async () => {})
  const stopContext = vi.fn()
  const interval = vi.spyOn(globalThis, 'setInterval')
  const sdk = {
    call: vi.fn(async () => ({ packageId: 'builtin.week', kind: 'major', binding: { mode: 'active', major: { packageId: 'builtin.week', contributionId: 'planner' } }, instance: { instanceId: 'week-one', name: 'Semaine' } })),
    storage: { get: vi.fn(async () => null) },
    onContextChange: vi.fn(() => stopContext),
    events: { subscribe: vi.fn(() => new Promise(resolve => { release = resolve })) },
  }
  vi.stubGlobal('ProjectTracker', { ready: Promise.resolve(sdk) })
  await import('../packages/builtin-week/src/view')
  await vi.waitFor(() => expect(sdk.events.subscribe).toHaveBeenCalled())
  window.dispatchEvent(new Event('pagehide'))
  release(unsubscribe)
  await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1))
  expect(stopContext).toHaveBeenCalledTimes(1)
  expect(interval.mock.calls.filter(args => args[1] === 60_000)).toEqual([])
})
it('keeps an open wake draft on refresh but discards it when the context changes', async () => {
  let contextChanged!: () => void
  let refreshed!: () => void
  const sdk = {
    call: vi.fn(async () => ({ packageId: 'builtin.week', kind: 'major', binding: { mode: 'active', major: { packageId: 'builtin.week', contributionId: 'planner' } }, instance: { instanceId: 'week-one', name: 'Semaine' } })),
    storage: { get: vi.fn(async () => null), put: vi.fn() },
    onContextChange: vi.fn((callback: () => void) => { contextChanged = callback; return () => {} }),
    events: { subscribe: vi.fn(async (_names: unknown, callback: () => void) => { refreshed = callback; return async () => {} }) },
  }
  vi.stubGlobal('ProjectTracker', { ready: Promise.resolve(sdk) })
  await import('../packages/builtin-week/src/view')
  await vi.waitFor(() => expect(sdk.events.subscribe).toHaveBeenCalled())
  Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Modifier les réveils')!.click()
  const input = document.querySelector('input')!; input.value = '10:00'
  refreshed(); window.dispatchEvent(new Event('focus'))
  await Promise.resolve()
  expect(document.querySelector('input')).toBe(input)
  expect(input.value).toBe('10:00')
  contextChanged()
  await vi.waitFor(() => expect(document.querySelector('form')).toBeNull())
  expect(sdk.storage.put).not.toHaveBeenCalled()
})
it('recomputes the widget after a simulated sleep time jump on focus and visibility', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(new Date(2026, 9, 12, 9, 15))
    const sdk = {
      call: vi.fn(async () => ({ packageId: 'builtin.week', kind: 'widget', binding: { mode: 'active', major: { packageId: 'builtin.week', contributionId: 'planner' } }, instance: { instanceId: 'one', name: 'Semaine' } })),
      storage: { get: vi.fn(async () => ({ instanceId: 'one', revision: 1, value: { slots: [{ id: 'slot', title: 'Travail', day: 0, start: '09:00', end: '10:00' }], wakeTimes: Array(7).fill('07:00') } })), put: vi.fn() },
      onContextChange: vi.fn(() => () => {}),
      events: { subscribe: vi.fn(async () => async () => {}) },
    }
    vi.stubGlobal('ProjectTracker', { ready: Promise.resolve(sdk) })
    await import('../packages/builtin-week/src/view')
    await vi.waitFor(() => expect(document.querySelector('progress')?.value).toBe(25))
    await vi.waitFor(() => expect(sdk.events.subscribe).toHaveBeenCalled())
    await Promise.resolve(); await Promise.resolve()
    vi.setSystemTime(new Date(2026, 9, 12, 9, 55))
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(document.querySelector('progress')?.value).toBe(92))
    vi.setSystemTime(new Date(2026, 9, 12, 10, 5))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Passé'))
    expect(document.querySelector('progress')).toBeNull()
    expect(sdk.storage.put).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
