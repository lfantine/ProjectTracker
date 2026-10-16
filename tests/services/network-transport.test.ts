import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { request } from 'node:https'
import { requestPinned, type HttpsHop } from '../../main/runtime/network'
import { NETWORK_LIMITS } from '../../shared/limits'
vi.mock('node:https', () => ({ request: vi.fn() }))
const hop: HttpsHop = { url: new URL('https://api.example.com:8443/path?q=1'), address: { address: '93.184.215.14', family: 4 }, method: 'POST', headers: { authorization: 'supplied' }, body: 'hello' }
function mockResponse(status = 200, headers: Record<string, string> = {}, chunks: Buffer[] = [Buffer.from('hello')], complete = true) {
  const req = new EventEmitter() as any
  req.write = vi.fn()
  const res = new PassThrough() as any
  res.statusCode = status; res.headers = headers; res.complete = complete
  req.end = vi.fn(() => queueMicrotask(() => {
    callback(res)
    if (!res.destroyed) { for (const chunk of chunks) res.write(chunk); res.end() }
  }))
  let options: any, callback: (response: any) => void
  vi.mocked(request).mockImplementationOnce(((opts: any, cb: any) => { options = opts; callback = cb; return req }) as any)
  return { req, res, options: () => options }
}
describe('transport HTTPS épinglé (socket simulée)', () => {
  it('conserve hostname/SNI, impose TLS et une IP unique sans résolution secondaire ni agent partagé', async () => {
    const s = mockResponse()
    expect(await requestPinned(hop, new AbortController().signal)).toMatchObject({ status: 200, body: Buffer.from('hello') })
    expect(s.options()).toMatchObject({ hostname: 'api.example.com', servername: 'api.example.com', port: '8443', path: '/path?q=1', family: 4, autoSelectFamily: false, agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: 16384, headers: { host: 'api.example.com:8443', 'accept-encoding': 'identity', authorization: 'supplied' } })
    const callback = vi.fn()
    s.options().lookup('api.example.com', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.215.14', 4)
    s.options().lookup('api.example.com', { all: true }, callback)
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '93.184.215.14', family: 4 }])
    expect(s.req.write).toHaveBeenCalledWith('hello')
  })
  it('arrête un corps de redirection sans le lire et refuse compression et longueur annoncée excessive', async () => {
    const redirect = mockResponse(302, { location: '/next' })
    expect(await requestPinned(hop, new AbortController().signal)).toMatchObject({ status: 302, body: Buffer.alloc(0) })
    expect(redirect.res.destroyed).toBe(true)
    for (const headers of [{ 'content-encoding': 'gzip' }, { 'content-length': String(NETWORK_LIMITS.maxResponseBytes + 1) }, { 'content-length': 'not-a-number' }]) {
      const s = mockResponse(200, headers)
      await expect(requestPinned(hop, new AbortController().signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
      expect(s.res.destroyed).toBe(true)
    }
  })
  it('borne les flux sans Content-Length, refuse les réponses tronquées et propage les erreurs TLS', async () => {
    const oversized = mockResponse(200, {}, [Buffer.alloc(NETWORK_LIMITS.maxResponseBytes), Buffer.from('overflow')])
    await expect(requestPinned(hop, new AbortController().signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(oversized.res.destroyed).toBe(true)
    mockResponse(200, {}, [Buffer.from('incomplete')], false)
    await expect(requestPinned(hop, new AbortController().signal)).rejects.toThrow('Incomplete response')
    const s = mockResponse()
    s.req.end.mockImplementationOnce(() => queueMicrotask(() => s.req.emit('error', new Error('certificate validation failed'))))
    await expect(requestPinned(hop, new AbortController().signal)).rejects.toThrow('certificate validation failed')
  })
  it('refuse les upgrades et ne crée aucune requête si déjà annulée', async () => {
    const s = mockResponse(), socket = { destroy: vi.fn() }
    s.req.end.mockImplementationOnce(() => queueMicrotask(() => s.req.emit('upgrade', {}, socket)))
    await expect(requestPinned(hop, new AbortController().signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(socket.destroy).toHaveBeenCalled()
    const controller = new AbortController(); controller.abort()
    const calls = vi.mocked(request).mock.calls.length
    await expect(requestPinned(hop, controller.signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(vi.mocked(request).mock.calls).toHaveLength(calls)
  })
})
