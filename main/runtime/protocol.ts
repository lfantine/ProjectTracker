import type { Protocol } from 'electron'
import { ResourceCatalog } from './resources'

export const PLUGIN_SCHEME = 'pt-plugin'

// Called exactly once by the future runtime entry point, before app.ready.
// No CSP bypass, service workers, native capability or persistent partition.
export function declarePluginScheme(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([{ scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
}

// Register on the SAME session as the host BrowserWindow, after app.ready.
// Deliberately not imported by main.ts until the isolation suite is qualified.
export function installPluginProtocol(protocol: Pick<Protocol, 'handle' | 'unhandle'>, catalog: ResourceCatalog): () => void {
  protocol.handle(PLUGIN_SCHEME, (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
      const resource = catalog.read(request.url)
      // Copy to a regular ArrayBuffer for Electron's Response implementation.
      const body = request.method === 'HEAD' ? null : Uint8Array.from(resource.body).buffer
      return new Response(body, { status: 200, headers: resource.headers })
    } catch {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } })
    }
  })
  return () => protocol.unhandle(PLUGIN_SCHEME)
}
