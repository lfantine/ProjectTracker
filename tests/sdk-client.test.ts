import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect, createClient } from '../sdk/src/client'
import { SDK_VERSION, HOST_API_VERSION } from '../shared/version'
import { SDK_WELCOME, type SdkWelcome } from '../shared/sdk'

class Port {
  addEventListener = vi.fn()
  onmessageerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  sent: unknown[] = []
  postMessage = vi.fn((value: unknown) => { this.sent.push(value) })
  start = vi.fn()
  close = vi.fn()
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
}
const welcome = { type: SDK_WELCOME, hostApi: HOST_API_VERSION, context: { hostApi: HOST_API_VERSION, sdkVersion: SDK_VERSION, packageId: 'fixture.package' } } as SdkWelcome

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('SDK client et négociation', () => {
  it('n’accepte que le parent à l’origine hôte exacte avec une version compatible', async () => {
    vi.useFakeTimers()
    const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    const connected = connect({ hostOrigin: 'app://.' })
    const port = new Port()
    const send = (origin: string, data: unknown, source: Window | null = window.parent) => window.dispatchEvent(new MessageEvent('message', { source, origin, data, ports: [port as unknown as MessagePort] }))
    send('https://attacker.example', welcome)
    send('app://.', welcome, null)
    send('app://.', { ...welcome, hostApi: '99.0.0' })
    expect(port.start).not.toHaveBeenCalled()
    send('app://.', welcome)
    const sdk = await connected
    expect(sdk.context.packageId).toBe('fixture.package')
    expect(post).toHaveBeenCalledWith({ type: 'pt-sdk/hello', sdkVersion: SDK_VERSION }, 'app://.')
    port.emit({ type: 'revoked' })
  })

  it('expire sans hôte et refuse une origine non autorisée', async () => {
    vi.useFakeTimers()
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    await expect(connect({ hostOrigin: '*' })).rejects.toMatchObject({ code: 'VALIDATION' })
    const attempt = connect({ hostOrigin: 'app://.', timeoutMs: 50 })
    const failed = expect(attempt).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(50)
    await failed
  })

  it('nettoie les messages non clonables, les délais et les appels révoqués', async () => {
    vi.useFakeTimers()
    const port = new Port()
    const sdk = createClient(port as unknown as MessagePort, welcome, 100)
    port.postMessage.mockImplementationOnce(() => { throw new Error('DataCloneError') })
    await expect(sdk.storage.get({ collection: 'c', id: 'x' })).rejects.toMatchObject({ code: 'VALIDATION' })
    const attempt = sdk.storage.get({ collection: 'c', id: 'x' })
    const failed = expect(attempt).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(100)
    await failed
    const pending = sdk.storage.get({ collection: 'c', id: 'x' })
    const revoked = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    port.emit({ type: 'revoked', reason: 'unmount' })
    await revoked
    expect(sdk.revoked).toBe(true)
    expect(port.close).toHaveBeenCalledOnce()
    await expect(sdk.storage.get({ collection: 'c', id: 'x' })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
})
