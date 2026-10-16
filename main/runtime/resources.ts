import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { ARCHIVE_LIMITS } from '../../shared/limits'
import { isSafeRelativePath } from '../../shared/manifest'
import { ContextRegistry, pluginOrigin } from './contexts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}
export interface ResourceFile { path: string; sha256: string }
interface ResourceRoot { root: string; files: Map<string, string>; stop: () => void }

function unavailable(): never { throw new AppError('NOT_FOUND', 'Ressource indisponible.') }

// Pure resource policy, intentionally not registered with Electron yet. The
// installer must provide an inventory of verified contents, not a directory
// that this class would enumerate or trust implicitly.
export class ResourceCatalog {
  private roots = new Map<string, ResourceRoot>()
  private bootstraps = new Map<string, { html: string; script: string }>()
  private readonly shellOrigin: string
  readonly csp: string

  constructor(private readonly contexts: ContextRegistry, shellOrigin: string) {
    if (!/^(?:app:\/\/[a-zA-Z0-9.-]+|http:\/\/localhost:\d{1,5})$/.test(shellOrigin)) throw new AppError('VALIDATION', 'Origine du shell invalide.')
    this.shellOrigin = shellOrigin
    this.csp = [
      "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
      "connect-src 'none'", "worker-src 'none'", "frame-src 'none'", "child-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
      `frame-ancestors ${shellOrigin}`,
    ].join('; ')
  }

  add(contextId: string, root: string, files: ResourceFile[]): void {
    this.contexts.get(contextId)
    if (this.roots.has(contextId)) throw new AppError('CONFLICT', 'Ressources déjà associées.')
    if (files.length > ARCHIVE_LIMITS.maxFiles) throw new AppError('VALIDATION', 'Trop de ressources.')
    const allowed = new Map<string, string>()
    const canonical = new Set<string>()
    for (const file of files) {
      const key = file.path.toLocaleLowerCase('en-US').normalize('NFC')
      if (key.startsWith('__pt_host__/') || !isSafeRelativePath(file.path) || file.path.includes('%') || !/^[a-f0-9]{64}$/.test(file.sha256) || canonical.has(key)) throw new AppError('VALIDATION', 'Inventaire de ressources invalide.')
      canonical.add(key)
      allowed.set(file.path, file.sha256)
    }
    try {
      const realRoot = fs.realpathSync(root)
      if (!fs.statSync(realRoot).isDirectory()) return unavailable()
      const stop = this.contexts.onRevoke(contextId, () => { this.roots.delete(contextId); this.bootstraps.delete(contextId) })
      this.roots.set(contextId, { root: realRoot, files: allowed, stop })
    } catch { unavailable() }
  }

  prepareBootstrap(contextId: string, entry: string, trustedBundle: string, theme?: import('../extensions/engine').ResolvedTheme & { mode: 'light' | 'dark' | 'system' }): string {
    this.contexts.get(contextId)
    if (this.bootstraps.has(contextId) || path.extname(entry).toLowerCase() !== '.html' || Buffer.byteLength(trustedBundle) > 256 * 1024) throw new AppError('VALIDATION', 'Bootstrap invalide.')
    const documentHtml = Buffer.from(this.read(`${pluginOrigin(contextId)}/${entry}`).body).toString('utf8')
    const script = `${trustedBundle}\n;void PtBootstrap.start(${JSON.stringify({ hostOrigin: this.shellOrigin, documentHtml, documentUrl: `${pluginOrigin(contextId)}/${entry}`, theme })});`
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Contribution</title></head><body><script src="bootstrap.js"></script></body></html>'
    this.bootstraps.set(contextId, { html, script })
    return `${pluginOrigin(contextId)}/__pt_host__/index.html`
  }

  read(url: string): { body: Uint8Array; headers: Record<string, string> } {
    // Inspect the raw path before URL parsing can normalize dot segments.
    if (url.length > 4096) return unavailable()
    const match = /^pt-plugin:\/\/(ctx-[a-f0-9]{48})(\/[^?#]*)?(?:\?[^#]*)?$/.exec(url)
    if (!match) return unavailable()
    const [, id, encoded = '/'] = match
    let relative: string
    try { relative = decodeURIComponent(encoded.slice(1)) } catch { return unavailable() }
    if (!isSafeRelativePath(relative) || relative.includes('%')) return unavailable()
    this.contexts.get(id)
    const record = this.roots.get(id)
    const bootstrap = this.bootstraps.get(id)
    const headers = { 'Content-Security-Policy': this.csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
    if (bootstrap && relative.startsWith('__pt_host__/')) {
      const content = relative === '__pt_host__/index.html' ? bootstrap.html : relative === '__pt_host__/bootstrap.js' ? bootstrap.script : null
      if (content === null) return unavailable()
      return { body: Buffer.from(content), headers: { ...headers, 'Content-Type': relative.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' } }
    }
    // A package cannot navigate around the mandatory host bootstrap. HTML is
    // materialized only after the SDK is ready, never served as a raw document.
    if (bootstrap && path.extname(relative).toLowerCase() === '.html') return unavailable()
    const expected = record?.files.get(relative)
    const mime = MIME[path.extname(relative).toLowerCase()]
    if (!record || !expected || !mime || !url.startsWith(`${pluginOrigin(id)}/`)) return unavailable()
    try {
      // Refuse symlinks at every level, including links remaining inside the
      // package. Never serve directories or devices.
      let target = record.root
      for (const part of relative.split('/')) {
        target = path.join(target, part)
        if (fs.lstatSync(target).isSymbolicLink()) return unavailable()
      }
      const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
      let body: Buffer
      try {
        const stat = fs.fstatSync(fd)
        if (!stat.isFile() || stat.size > ARCHIVE_LIMITS.maxFileBytes) return unavailable()
        // Bounded allocation even if a file grows after the stat call.
        const buffer = Buffer.alloc(stat.size + 1)
        let length = 0
        while (length < buffer.length) {
          const read = fs.readSync(fd, buffer, length, buffer.length - length, null)
          if (!read) break
          length += read
        }
        if (length !== stat.size) return unavailable()
        body = buffer.subarray(0, length)
      } finally { fs.closeSync(fd) }
      if (body.byteLength > ARCHIVE_LIMITS.maxFileBytes || createHash('sha256').update(body).digest('hex') !== expected) return unavailable()
      return { body, headers: { 'Content-Type': mime, 'Content-Security-Policy': this.csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }
    } catch { return unavailable() }
  }

  close(): void {
    for (const record of this.roots.values()) record.stop()
    this.roots.clear()
    this.bootstraps.clear()
  }
}
