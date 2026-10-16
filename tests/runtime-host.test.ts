import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountContribution, type FrameConnector } from '../sdk/src/host'
const contextId = `ctx-${'a'.repeat(48)}`
const origin = `pt-plugin://${contextId}`
const registration = { contextId, origin, url: `${origin}/__pt_host__/index.html` }
const hello = { type: 'pt-sdk/hello', sdkVersion: '1.0.0' }
const disposals: (() => void)[] = []
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); document.body.replaceChildren(); vi.restoreAllMocks() })
function setup() {
  const connector: FrameConnector = { connect: vi.fn(() => new Promise(() => {})), revoke: vi.fn() }
  const mount = mountContribution(document.body, registration, connector)
  disposals.push(mount.dispose)
  return { connector, ...mount }
}
describe('hôte de frame SDK', () => {
  it('exige une origine et une identité natives cohérentes', () => {
    expect(() => mountContribution(document.body, { ...registration, contextId: 'forged' }, {} as FrameConnector)).toThrow()
    expect(() => mountContribution(document.body, { ...registration, url: `${origin}/raw.html` }, {} as FrameConnector)).toThrow()
  })
  it('contrôle la source, l’origine exacte et la forme du hello avant le pont natif', () => {
    const { frame, connector } = setup()
    const emit = (source: Window | null, from: string, data: unknown) => window.dispatchEvent(new MessageEvent('message', { source, origin: from, data }))
    emit(window, origin, hello)
    emit(frame.contentWindow, 'https://attacker.example', hello)
    emit(frame.contentWindow, origin, { ...hello, packageId: 'forged.package' })
    expect(connector.connect).not.toHaveBeenCalled()
    emit(frame.contentWindow, origin, hello)
    emit(frame.contentWindow, origin, hello)
    expect(connector.connect).toHaveBeenCalledExactlyOnceWith(contextId, hello, expect.any(AbortSignal))
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  })
  it('révoque une seule fois au démontage et ignore les messages ultérieurs', async () => {
    const { frame, connector, dispose } = setup()
    frame.remove()
    await Promise.resolve()
    expect(connector.revoke).toHaveBeenCalledExactlyOnceWith(contextId)
    dispose()
    expect(connector.revoke).toHaveBeenCalledOnce()
  })
})
