import { randomBytes } from 'node:crypto'
import { BrowserWindow, ipcMain, session } from 'electron'
import { openDatabase } from '../db/database'
import { CoreService } from '../core/service'
import { createInstance } from '../core/packageStore'
import { AppError } from '../../shared/errors'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import { RUNTIME_LIMITS } from '../../shared/limits'
import { ContextRegistry } from './contexts'
import { ResourceCatalog, type ResourceFile } from './resources'
import { installPluginProtocol } from './protocol'
import { installRuntimeSession } from './session'
import { installRuntimeBridge } from './bridge'
import { SdkBroker } from './broker'

export interface PrevalidationJob {
  featureMode?: boolean
  manifest: PackageManifest
  root: string
  files: ResourceFile[]
  hostBundle: string
  bootstrapBundle: string
  preloadPath: string
  signal?: AbortSignal
  timeoutMs?: number // native qualification only, cannot increase the ceiling
}

/** Check every entry with the real SDK in disposable Chromium sessions and an
 * empty in-memory DB. Accepts NO active database; cannot read/mutate user data.
 * This is loading/negotiation evidence, not a guarantee of future correctness.
 * Extensions must await their own engines; no normal-app activation here.
 */
export async function prevalidatePackage(input: PrevalidationJob): Promise<void> {
  const manifest = manifestSchema.parse(input.manifest)
  if (manifest.kind !== 'package') throw new AppError('UNAVAILABLE', 'Prévalidation des extensions indisponible.')
  if (input.signal?.aborted) throw new AppError('UNAVAILABLE', 'Prévalidation annulée.')
  const deadline = Date.now() + Math.min(Math.max(1, input.timeoutMs ?? RUNTIME_LIMITS.migrationTimeoutMs), RUNTIME_LIMITS.migrationTimeoutMs)
  for (const contribution of manifest.contributions) {
    if (input.signal?.aborted) throw new AppError('UNAVAILABLE', 'Prévalidation annulée.')
    if (Date.now() >= deadline) throw new AppError('TIMEOUT', 'Délai de prévalidation dépassé.')
    const db = await openDatabase(':memory:')
    const contexts = new ContextRegistry(db)
    const shellOrigin = 'app://prevalidation'
    const catalog = new ResourceCatalog(contexts, shellOrigin)
    const isolated = session.fromPartition(`prevalidation-${randomBytes(24).toString('hex')}`, { cache: false })
    let guard: ReturnType<typeof installRuntimeSession> | undefined
    let win: BrowserWindow | undefined, bridge: ReturnType<typeof installRuntimeBridge> | undefined, stopProtocol: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
    let appHandled = false
    let disposed = false
    let poll: ReturnType<typeof setInterval> | undefined
    let inspecting = false
    try {
      guard = installRuntimeSession(isolated, shellOrigin + '/', contexts)
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new AppError('TIMEOUT', 'Délai de prévalidation dépassé.')), Math.max(1, deadline - Date.now()))
        abort = () => reject(new AppError('UNAVAILABLE', 'Prévalidation annulée.'))
        input.signal?.addEventListener('abort', abort, { once: true })
        void (async () => {
          await guard!.ready
          if (disposed || input.signal?.aborted) throw new AppError('UNAVAILABLE', 'Prévalidation fermée.')
          for (const major of manifest.contributions.filter(item => item.type === 'major')) createInstance(db, { packageId: manifest.id, majorId: major.id, instanceId: 'prevalidation', name: 'Prévalidation', now: '2000-01-01T00:00:00.000Z' })
          const major = contribution.type === 'major' ? contribution.id : contribution.major
          const registration = contexts.create({ manifest, contributionId: contribution.id, placementId: null,
            owner: { kind: 'page' }, binding: major ? { mode: 'active', major: { packageId: manifest.id, contributionId: major } } : { mode: 'none' },
            runtimeKind: input.featureMode ? 'feature' : undefined, grantedPermissions: normalizePermissions(manifest.permissions) })
          catalog.add(registration.id, input.root, input.files)
          const url = catalog.prepareBootstrap(registration.id, contribution.entry, input.bootstrapBundle)
          contexts.onRevoke(registration.id, () => { if (!disposed) reject(new AppError('UNAVAILABLE', 'Contexte de prévalidation révoqué.')) })
          isolated.protocol.handle('app', request => {
            const pathname = new URL(request.url).pathname
            const body = pathname === '/host.js' ? input.hostBundle : pathname === '/' ? '<!doctype html><html><body><script src="host.js"></script></body></html>' : ''
            return new Response(body, { status: body ? 200 : 404, headers: { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; frame-src pt-plugin:; style-src 'self' 'unsafe-inline'" } })
          })
          appHandled = true
          stopProtocol = installPluginProtocol(isolated.protocol, catalog)
          win = new BrowserWindow({ show: false, webPreferences: { session: isolated, preload: input.preloadPath, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true } })
          guard!.attach(win.webContents)
          win.webContents.once('render-process-gone', () => reject(new AppError('UNAVAILABLE', 'Prévalidation interrompue.')))
          win.once('closed', () => reject(new AppError('UNAVAILABLE', 'Prévalidation fermée.')))
          win.webContents.on('console-message', details => {
            if (details.level === 'error') reject(new AppError('UNAVAILABLE', 'Erreur de chargement de contribution.'))
          })
          await win.loadURL(shellOrigin + '/')
          if (disposed) throw new AppError('UNAVAILABLE', 'Prévalidation fermée.')
          bridge = installRuntimeBridge(ipcMain, win.webContents, win.webContents.getURL(), contexts, new SdkBroker(db, contexts, new CoreService(db), { prevalidation: true }))
          bridge.authorize(registration.id)
          await win.webContents.executeJavaScript(`(()=>{const connector=PtHost.createElectronConnector(location.origin);PtHost.mountContribution(document.body,${JSON.stringify({ contextId: registration.id, origin: registration.origin, url })},connector)})();void 0;`)
          if (disposed) throw new AppError('UNAVAILABLE', 'Prévalidation fermée.')
          // document.write does not emit a second Electron frame-finish event.
          // Read metadata in the child only, never evaluate imported code in the
          // shell. One outstanding inspection bounds a hung renderer; native
          // deadline destroys its window independently of this promise.
          poll = setInterval(() => {
            if (disposed || inspecting || !win || win.isDestroyed()) return
            try {
              if (!contexts.isReady(registration.id)) return
              const frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith(registration.origin + '/'))
              if (!frame) return
              inspecting = true
              void frame.executeJavaScript('[location.href, document.readyState]').then(metadata => {
                if (!disposed && Array.isArray(metadata) && metadata[0] === `${registration.origin}/${contribution.entry}` && metadata[1] === 'complete') resolve()
              }).catch(() => { if (!disposed) reject(new AppError('UNAVAILABLE', 'Inspection de contribution interrompue.')) }).finally(() => { inspecting = false })
            } catch { reject(new AppError('UNAVAILABLE', 'Négociation SDK indisponible.')) }
          }, 25)

        })().catch(reject)
      })
    } finally {
      disposed = true
      if (timer) clearTimeout(timer)
      if (poll) clearInterval(poll)
      if (abort) input.signal?.removeEventListener('abort', abort)
      bridge?.dispose(); if (win && !win.isDestroyed()) win.destroy(); guard?.close(); stopProtocol?.(); catalog.close(); contexts.close()
      try { if (appHandled) isolated.protocol.unhandle('app') } finally { db.close() }
    }
  }
}
