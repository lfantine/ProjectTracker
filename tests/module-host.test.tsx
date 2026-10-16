import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ModuleHostEvent, ModuleHostReply } from '../shared/moduleHost'
import { ModuleHost } from '../renderer/components/ModuleHost'
const mocks = vi.hoisted(() => ({ push: vi.fn(), mount: vi.fn(), dispose: vi.fn(), open: vi.fn(), close: vi.fn(), listeners: new Set<(event: ModuleHostEvent) => void>() }))
vi.mock('next/router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('../sdk/src/host', () => ({ createElectronConnector: () => ({}), mountContribution: (...args: unknown[]) => { mocks.mount(...args); return { frame: document.createElement('iframe'), dispose: mocks.dispose } } }))
const request = { kind: 'major' as const, major: { packageId: 'builtin.week', contributionId: 'planner' } }
const registration = (contextId: string): ModuleHostReply => ({ status: 'available', contextId, origin: `pt-plugin://${contextId}`, url: `pt-plugin://${contextId}/__pt_host__/index.html` })
beforeEach(() => {
  vi.clearAllMocks(); mocks.listeners.clear()
  mocks.open.mockResolvedValue(registration('one'))
  Object.defineProperty(window, 'api', { configurable: true, value: { modules: { open: mocks.open, close: mocks.close, onEvent: (listener: (event: ModuleHostEvent) => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) } } } })
})
it('mounts only a native registration, compares requests by value and cleans on unmount', async () => {
  const ui = render(<ModuleHost request={request} />)
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1))
  ui.rerender(<ModuleHost request={{ ...request }} />)
  expect(mocks.open).toHaveBeenCalledTimes(1)
  ui.unmount()
  expect(mocks.close).toHaveBeenCalledWith('one')
  expect(mocks.dispose).toHaveBeenCalledOnce()
  expect(mocks.listeners.size).toBe(0)
})
it('remounts only its own revoked context and scopes navigation to its source', async () => {
  render(<ModuleHost request={request} />)
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledOnce())
  act(() => { for (const listener of mocks.listeners) listener({ kind: 'navigate', contextId: 'other', href: '/project?id=p' }) })
  expect(mocks.push).not.toHaveBeenCalled()
  act(() => { for (const listener of mocks.listeners) listener({ kind: 'navigate', contextId: 'one', href: '/project?id=p' }) })
  expect(mocks.push).toHaveBeenCalledWith('/project?id=p')
  mocks.open.mockResolvedValueOnce(registration('two'))
  act(() => { for (const listener of [...mocks.listeners]) listener({ kind: 'revoked', contextId: 'one' }) })
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2))
  expect(mocks.dispose).toHaveBeenCalledOnce()
})
it('revokes a registration arriving after the host was removed, without mounting it', async () => {
  let resolve!: (value: ModuleHostReply) => void
  mocks.open.mockImplementationOnce(() => new Promise<ModuleHostReply>(done => { resolve = done }))
  const ui = render(<ModuleHost request={request} />); ui.unmount()
  await act(async () => resolve(registration('late')))
  expect(mocks.mount).not.toHaveBeenCalled()
  expect(mocks.close).toHaveBeenCalledWith('late')
})
it('shows unavailable rather than synthesizing bindings or silently falling back', async () => {
  mocks.open.mockResolvedValueOnce({ status: 'unavailable' })
  render(<ModuleHost request={request} />)
  expect(await screen.findByRole('status')).toHaveTextContent('données sont conservés')
  expect(mocks.mount).not.toHaveBeenCalled()
})
it('retries an unavailable placement after a native registry change and releases its listener', async () => {
  const listeners = new Set<(change: { affected: string[] }) => void>()
  Object.assign(window.api, { packages: { onChanged: (listener: (change: { affected: string[] }) => void) => { listeners.add(listener); return () => listeners.delete(listener) } } })
  mocks.open.mockResolvedValueOnce({ status: 'unavailable' })
  const ui = render(<ModuleHost request={request} />)
  await screen.findByRole('status')
  mocks.open.mockResolvedValueOnce(registration('restored'))
  act(() => { for (const listener of [...listeners]) listener({ affected: [] }) })
  await waitFor(() => expect(mocks.mount).toHaveBeenCalledOnce())
  ui.unmount(); expect(listeners.size).toBe(0)
})
