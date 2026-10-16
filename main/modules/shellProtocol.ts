import fs from 'node:fs'
import path from 'node:path'

// Trusted static export only, also usable before CORE opens in recovery mode.
// No dev-server, index fallback, runtime bundle or arbitrary filesystem access.
export function shellAssetResponse(request: Request, appDirectory: string, allowPlugins: boolean): Response {
  try {
    const url = new URL(request.url)
    if (url.host !== 'shell' || !['GET', 'HEAD'].includes(request.method)) throw Error('REFUSED')
    const relative = decodeURIComponent(url.pathname).slice(1)
    if (!relative || relative.includes('\\') || relative.includes('%') || relative.split('/').some(part => !part || part === '.' || part === '..') || relative.startsWith('runtime/')) throw Error('REFUSED')
    const file = path.join(appDirectory, path.extname(relative) ? relative : `${relative}/index.html`)
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
    const contentType = mime[path.extname(file)]
    if (!contentType || !fs.statSync(file).isFile()) throw Error('REFUSED')
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(fs.readFileSync(file)).buffer,
      { headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src ${allowPlugins ? 'pt-plugin:' : "'none'"}; object-src 'none'; base-uri 'none'; form-action 'none'` } })
  } catch { return new Response(null, { status: 404 }) }
}
