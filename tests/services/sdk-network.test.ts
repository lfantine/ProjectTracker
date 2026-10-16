import { describe, expect, it, vi } from 'vitest'
import { NetworkApi, isPublicAddress, type NetworkTransport, type HttpsHop, type HopResponse } from '../../main/runtime/network'
import { NETWORK_LIMITS } from '../../shared/limits'
import type { SdkContext } from '../../shared/sdk'
const context = { permissions: { network: ['https://api.example.com', 'https://other.example.com'], core: {}, exports: [] } } as SdkContext
const publicAddress = { address: '93.184.215.14', family: 4 as const }
const response = (status = 200, headers: Record<string, string> = {}, body = 'confirmed'): HopResponse => ({ status, headers, body: Buffer.from(body) })
function fixture(replies: HopResponse[] = [response()]) {
  const hops: HttpsHop[] = []
  const io: NetworkTransport = { resolve: vi.fn(async () => [publicAddress]), request: vi.fn(async (hop) => { hops.push(hop); return replies.shift()! }) }
  return { api: new NetworkApi(io), io, hops }
}
const signal = () => new AbortController().signal

describe('HTTPS natif contrôlé', () => {
  it('refuse les plages privées/spéciales, formes mappées et zones IPv6 sans bloquer les IP publiques ordinaires', () => {
    for (const address of ['0.0.0.0', '10.1.2.3', '100.100.100.100', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.0.0.9', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', 'fc00::1', 'fe80::1%lo0', 'ff02::1', '2001::1', '2001:db8::1', '2002:7f00:1::1', '3fff::1', 'not-an-ip']) expect(isPublicAddress(address), address).toBe(false)
    for (const address of ['8.8.8.8', '93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(isPublicAddress(address), address).toBe(true)
  })
  it('valide URL/origine avant DNS et ne permet ni schémas locaux, IP littérales, credentials ni fragments', async () => {
    const s = fixture()
    for (const url of ['http://api.example.com', 'file:///etc/passwd', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://localhost', 'https://api.example.com.evil.org', 'https://api.example.com:444', 'https://user:pass@api.example.com', 'https://api.example.com/#secret', 'https://api.example.com\\@evil.org', 'https://api.example.com/\npath']) await expect(s.api.fetch(context, { url }, signal())).rejects.toMatchObject({ code: expect.stringMatching(/PERMISSION_DENIED|VALIDATION/) })
    expect(s.io.resolve).not.toHaveBeenCalled()
    expect(s.io.request).not.toHaveBeenCalled()
  })
  it('exige que toutes les adresses DNS soient publiques et épingle une seule résolution par saut', async () => {
    const s = fixture()
    for (const addresses of [[], [publicAddress, { address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 6 }], [{ address: 'fe80::1', family: 6 }]]) {
      vi.mocked(s.io.resolve).mockResolvedValueOnce(addresses as any)
      await expect(s.api.fetch(context, { url: 'https://api.example.com' }, signal())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    }
    expect(s.io.request).not.toHaveBeenCalled()
    expect(await s.api.fetch(context, { url: 'https://api.example.com/path?q=1' }, signal())).toMatchObject({ status: 200, url: 'https://api.example.com/path?q=1', body: 'confirmed' })
    expect(s.hops[0].address).toEqual(publicAddress)
  })
  it('ne transmet que les en-têtes explicites autorisés et ne restitue ni cookies ni authentication serveur', async () => {
    const s = fixture([response(200, { 'content-type': 'application/json', 'set-cookie': 'private=1', 'www-authenticate': 'Basic secret', server: 'private' })])
    for (const headers of [{ Cookie: 'secret' }, { Host: '127.0.0.1' }, { 'Proxy-Authorization': 'secret' }, { Authorization: 'a', authorization: 'b' }, { Accept: 'ok\r\nInjected: true' }]) await expect(s.api.fetch(context, { url: 'https://api.example.com', headers }, signal())).rejects.toMatchObject({ code: 'VALIDATION' })
    const result = await s.api.fetch(context, { url: 'https://api.example.com', headers: { Authorization: 'Bearer supplied-by-package', Accept: 'application/json' } }, signal())
    expect(s.hops[0].headers).toEqual({ authorization: 'Bearer supplied-by-package', accept: 'application/json' })
    expect(result.headers).toEqual({ 'content-type': 'application/json' })
  })
  it('contrôle le corps UTF-8 et refuse corps GET/HEAD et dépassement du quota', async () => {
    const s = fixture()
    for (const request of [{ method: 'GET' as const, body: '' }, { method: 'HEAD' as const, body: 'x' }, { method: 'POST' as const, body: 'é'.repeat(NETWORK_LIMITS.maxRequestBodyBytes) }]) await expect(s.api.fetch(context, { url: 'https://api.example.com', ...request }, signal())).rejects.toMatchObject({ code: 'VALIDATION' })
    await s.api.fetch(context, { url: 'https://api.example.com', method: 'POST', body: 'é' }, signal())
    expect(s.hops[0]).toMatchObject({ method: 'POST', body: 'é' })
  })
  it('revalide chaque redirection avant DNS et retire les secrets en changeant d’origine', async () => {
    const s = fixture([response(302, { location: 'https://other.example.com/next' }), response()])
    await s.api.fetch(context, { url: 'https://api.example.com/start', headers: { authorization: 'secret', 'x-api-key': 'private', accept: 'text/plain' } }, signal())
    expect(s.hops[1].headers).toEqual({ accept: 'text/plain' })
    expect(s.io.resolve).toHaveBeenNthCalledWith(2, 'other.example.com', expect.anything())
    for (const location of ['http://api.example.com', 'https://forbidden.example.com', 'https://127.0.0.1', 'file:///etc/passwd']) {
      const blocked = fixture([response(302, { location })])
      await expect(blocked.api.fetch(context, { url: 'https://api.example.com' }, signal())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      expect(blocked.io.resolve).toHaveBeenCalledTimes(1)
    }
  })
  it('refuse un rebinding DNS après une redirection même de même origine', async () => {
    const s = fixture([response(302, { location: '/next' })])
    vi.mocked(s.io.resolve).mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
    await expect(s.api.fetch(context, { url: 'https://api.example.com' }, signal())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(s.io.request).toHaveBeenCalledTimes(1)
  })
  it('borne les redirections et ne rejoue pas un corps sensible vers une autre origine', async () => {
    const loop = fixture(Array.from({ length: 6 }, () => response(302, { location: '/loop' })))
    await expect(loop.api.fetch(context, { url: 'https://api.example.com' }, signal())).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(loop.io.request).toHaveBeenCalledTimes(6)
    const cross = fixture([response(307, { location: 'https://other.example.com/next' })])
    await expect(cross.api.fetch(context, { url: 'https://api.example.com', method: 'POST', body: 'private' }, signal())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const seeOther = fixture([response(303, { location: '/next' }), response()])
    await seeOther.api.fetch(context, { url: 'https://api.example.com', method: 'POST', body: 'private', headers: { 'content-type': 'text/plain' } }, signal())
    expect(seeOther.hops[1]).toMatchObject({ method: 'GET', body: undefined, headers: {} })
  })
  it('annule pendant DNS sans ouvrir de socket et ne donne aucun résultat tardif', async () => {
    const s = fixture(), controller = new AbortController()
    let finish: (addresses: any) => void = () => {}
    vi.mocked(s.io.resolve).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const request = s.api.fetch(context, { url: 'https://api.example.com' }, controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    finish([publicAddress]); await Promise.resolve(); await Promise.resolve()
    expect(s.io.request).not.toHaveBeenCalled()
  })
  it('annule pendant le transport et borne aussi un DNS qui ne répond jamais à 20 secondes', async () => {
    const s = fixture(), controller = new AbortController()
    let transportSignal: AbortSignal | undefined
    vi.mocked(s.io.request).mockImplementationOnce(async (_hop, signal) => { transportSignal = signal; return new Promise(() => {}) })
    const request = s.api.fetch(context, { url: 'https://api.example.com' }, controller.signal)
    await Promise.resolve(); controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(transportSignal?.aborted).toBe(true)
    vi.useFakeTimers()
    try {
      vi.mocked(s.io.resolve).mockImplementationOnce(() => new Promise(() => {}))
      const slow = s.api.fetch(context, { url: 'https://api.example.com' }, signal())
      const assertion = expect(slow).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(NETWORK_LIMITS.timeoutMs)
      await assertion
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('masque les erreurs DNS/TLS et refuse le binaire UTF-8 invalide et les réponses surdimensionnées', async () => {
    const s = fixture()
    vi.mocked(s.io.resolve).mockRejectedValueOnce(new Error('/private/path DNS failed'))
    await expect(s.api.fetch(context, { url: 'https://api.example.com' }, signal())).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Requête réseau indisponible.' })
    for (const body of [Buffer.from([0xff]), Buffer.alloc(NETWORK_LIMITS.maxResponseBytes + 1)]) {
      vi.mocked(s.io.request).mockResolvedValueOnce({ status: 200, headers: {}, body })
      await expect(s.api.fetch(context, { url: 'https://api.example.com' }, signal())).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    }
  })
})
