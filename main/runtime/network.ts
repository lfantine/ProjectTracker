import { Resolver } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { TextDecoder } from 'node:util'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { NETWORK_LIMITS } from '../../shared/limits'
import { validateNetworkOrigin } from '../../shared/permissions'
import type { NetworkRequest, NetworkResponse, SdkContext } from '../../shared/sdk'

export const networkSchemas = {
  'network.fetch': z.object({ url: z.string().min(1).max(NETWORK_LIMITS.maxUrlLength), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(), headers: z.record(z.string().max(NETWORK_LIMITS.maxHeaderNameLength), z.string().max(NETWORK_LIMITS.maxHeaderValueLength)).optional(), body: z.string().optional() }).strict(),
}
const blocked = new BlockList()
// Deliberately conservative superset of IANA special-purpose prefixes. Public
// exceptions within these ranges are also denied, not silently allowlisted.
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) blocked.addSubnet(address, prefix, 'ipv6')
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6')
export function isPublicAddress(address: string): boolean {
  if (address.includes('%')) return false
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  // Reject mapped IPv4, NAT64, ULA, local, multicast and non-global IPv6.
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
}
export interface PinnedAddress { address: string; family: 4 | 6 }
export interface HttpsHop { url: URL; address: PinnedAddress; method: string; headers: Record<string, string>; body?: string }
export interface HopResponse { status: number; headers: Record<string, string>; body: Buffer }
// Native-only injection for deterministic qualification; never populated from
// a contribution, environment variable, SDK parameter or manifest.
export interface NetworkTransport {
  resolve(hostname: string, signal: AbortSignal): Promise<PinnedAddress[]>
  request(hop: HttpsHop, signal: AbortSignal): Promise<HopResponse>
}
async function resolvePublicHost(hostname: string, signal: AbortSignal): Promise<PinnedAddress[]> {
  const resolver = new Resolver({ timeout: NETWORK_LIMITS.dnsTimeoutMs, tries: NETWORK_LIMITS.dnsTries })
  const cancel = () => resolver.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw new Error('aborted')
    const query = async (family: 4 | 6) => {
      try { return (family === 4 ? await resolver.resolve4(hostname) : await resolver.resolve6(hostname)).map((address) => ({ address, family })) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENODATA') return []; throw error }
    }
    const results = (await Promise.all([query(4), query(6)])).flat()
    if (signal.aborted) throw new Error('aborted')
    return results
  } finally { resolver.cancel(); signal.removeEventListener('abort', cancel) }
}
export function requestPinned(hop: HttpsHop, signal: AbortSignal): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AppError('UNAVAILABLE', 'Requête annulée.')); return }
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      hostname: hop.url.hostname, port: hop.url.port || 443, servername: hop.url.hostname,
      path: hop.url.pathname + hop.url.search, method: hop.method,
      headers: { ...hop.headers, host: hop.url.host, 'accept-encoding': 'identity' },
      // One validated address, no second DNS resolution, pooling, proxy or
      // shared cookies. Keep the hostname for SNI/certificate verification.
      family: hop.address.family, autoSelectFamily: false,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [hop.address])
        else callback(null, hop.address.address, hop.address.family)
      },
      agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2', maxHeaderSize: NETWORK_LIMITS.maxHeaderBytes, signal,
    }
    const req = httpsRequest(options, (res) => {
      const status = res.statusCode ?? 0
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(res.headers)) if (typeof value === 'string') headers[key] = value
      if ([301, 302, 303, 307, 308].includes(status)) { res.destroy(); resolve({ status, headers, body: Buffer.alloc(0) }); return }
      const length = headers['content-length']
      if ((length && (!/^\d+$/.test(length) || Number(length) > NETWORK_LIMITS.maxResponseBytes)) || (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity')) {
        res.destroy(); reject(new AppError('UNAVAILABLE', 'Réponse réseau non supportée ou trop volumineuse.')); return
      }
      let size = 0
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > NETWORK_LIMITS.maxResponseBytes) { res.destroy(); reject(new AppError('UNAVAILABLE', 'Réponse réseau trop volumineuse.')); return }
        chunks.push(chunk)
      })
      res.on('end', () => { if (!res.complete) reject(new Error('Incomplete response')); else resolve({ status, headers, body: Buffer.concat(chunks) }) })
      res.on('error', reject)
      res.on('aborted', () => reject(new Error('Aborted response')))
    })
    req.on('error', reject)
    req.on('upgrade', (_response, socket) => { socket.destroy(); reject(new AppError('UNAVAILABLE', 'Changement de protocole interdit.')) })
    if (hop.body !== undefined) req.write(hop.body)
    req.end()
  })
}
const transport: NetworkTransport = { resolve: resolvePublicHost, request: requestPinned }
const requestHeaders = new Set(['accept', 'content-type', 'authorization', 'x-api-key'])
const responseHeaders = new Set(['content-type', 'cache-control', 'etag', 'last-modified', 'retry-after'])
export class NetworkApi {
  constructor(private readonly io: NetworkTransport = transport) {}
  private url(input: string, context: SdkContext): URL {
    if (/[\u0000-\u0020\u007f\\]/.test(input)) throw new AppError('VALIDATION', 'URL invalide.')
    let url: URL
    try { url = new URL(input) } catch { throw new AppError('VALIDATION', 'URL invalide.') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || validateNetworkOrigin(url.origin)) throw new AppError('PERMISSION_DENIED', 'Destination réseau interdite.')
    if (!context.permissions.network.includes(url.origin)) throw new AppError('PERMISSION_DENIED', 'Origine réseau non autorisée.')
    return url
  }
  async fetch(context: SdkContext, input: NetworkRequest, parentSignal: AbortSignal): Promise<NetworkResponse> {
    let url = this.url(input.url, context), method: string = input.method ?? 'GET', body = input.body
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.headers ?? {})) {
      const name = key.toLowerCase()
      if (!requestHeaders.has(name) || Object.hasOwn(headers, name) || /[^\u0020-\u007e]/.test(value)) throw new AppError('VALIDATION', 'En-tête réseau interdit ou invalide.')
      headers[name] = value
    }
    if (Object.keys(headers).length > requestHeaders.size || Object.values(headers).reduce((n, value) => n + Buffer.byteLength(value), 0) > NETWORK_LIMITS.maxHeaderBytes) throw new AppError('VALIDATION', 'En-têtes trop volumineux.')
    if (body !== undefined && (['GET', 'HEAD'].includes(method) || Buffer.byteLength(body) > NETWORK_LIMITS.maxRequestBodyBytes)) throw new AppError('VALIDATION', 'Corps de requête interdit ou trop volumineux.')
    const controller = new AbortController()
    const abort = () => controller.abort()
    parentSignal.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, NETWORK_LIMITS.timeoutMs)
    const signal = controller.signal
    // Race also bounds a DNS resolver/transport failing to honour cancellation.
    let rejectAbort: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new AppError(timedOut ? 'TIMEOUT' : 'UNAVAILABLE', timedOut ? 'Délai réseau dépassé.' : 'Requête annulée.')); signal.addEventListener('abort', rejectAbort, { once: true }) })
    try {
      if (parentSignal.aborted) controller.abort()
      const perform = async () => {
        for (let redirects = 0; ; redirects++) {
          if (signal.aborted) throw new AppError('UNAVAILABLE', 'Requête annulée.')
          const addresses = await this.io.resolve(url.hostname, signal)
          if (signal.aborted) throw new AppError('UNAVAILABLE', 'Requête annulée.')
          if (!addresses.length || addresses.length > NETWORK_LIMITS.maxDnsAnswers || addresses.some((entry) => isIP(entry.address) !== entry.family || !isPublicAddress(entry.address))) throw new AppError('PERMISSION_DENIED', 'Résolution réseau interdite.')
          const result = await this.io.request({ url, address: addresses[0], method, headers: { ...headers }, body }, signal)
          if (signal.aborted) throw new AppError('UNAVAILABLE', 'Requête annulée.')
          if (![301, 302, 303, 307, 308].includes(result.status)) {
            if (result.body.length > NETWORK_LIMITS.maxResponseBytes) throw new AppError('UNAVAILABLE', 'Réponse réseau trop volumineuse.')
            const safeHeaders: Record<string, string> = {}
            for (const [key, value] of Object.entries(result.headers)) if (responseHeaders.has(key)) safeHeaders[key] = value
            const text = new TextDecoder('utf-8', { fatal: true }).decode(result.body)
            return { status: result.status, url: url.href, headers: safeHeaders, body: text }
          }
          if (redirects >= NETWORK_LIMITS.maxRedirects || !result.headers.location) throw new AppError('UNAVAILABLE', 'Redirection réseau refusée.')
          const next = this.url(new URL(result.headers.location, url).href, context)
          if (result.status === 303 && method !== 'HEAD' || [301, 302].includes(result.status) && method === 'POST') { method = 'GET'; body = undefined; delete headers['content-type'] }
          if (next.origin !== url.origin) {
            if (!['GET', 'HEAD'].includes(method)) throw new AppError('PERMISSION_DENIED', 'Rejeu inter-origines interdit.')
            delete headers.authorization; delete headers['x-api-key']
          }
          url = next
        }
      }
      return await Promise.race([perform(), aborted])
    } catch (error) {
      if (timedOut) throw new AppError('TIMEOUT', 'Délai réseau dépassé.')
      if (parentSignal.aborted) throw new AppError('UNAVAILABLE', 'Requête annulée.')
      if (error instanceof AppError) throw error
      throw new AppError('UNAVAILABLE', 'Requête réseau indisponible.')
    } finally {
      clearTimeout(timer); parentSignal.removeEventListener('abort', abort)
      if (rejectAbort) signal.removeEventListener('abort', rejectAbort)
      controller.abort()
    }
  }
}
