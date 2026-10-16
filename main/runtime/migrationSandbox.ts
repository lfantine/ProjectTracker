import { randomBytes } from 'node:crypto'
import { BrowserWindow, ipcMain, session } from 'electron'
import type { Database } from '../db/database'
import { CoreService } from '../core/service'
import { AppError } from '../../shared/errors'
import { hasMigrationChain, manifestSchema, validateConfig, type PackageManifest } from '../../shared/manifest'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { MigrationSnapshot } from '../../shared/migration'
import { ContextRegistry } from './contexts'
import { ResourceCatalog, type ResourceFile } from './resources'
import { installPluginProtocol } from './protocol'
import { installRuntimeSession } from './session'
import { installRuntimeBridge } from './bridge'
import { SdkBroker } from './broker'
import { MigrationCopy } from './migrationCopy'

export interface MigrationJob {
  manifest: PackageManifest
  root: string
  files: ResourceFile[]
  snapshot: MigrationSnapshot
  // Trusted host bundles only; never compiled from package sources.
  hostBundle: string
  bootstrapBundle: string
  preloadPath: string
  signal?: AbortSignal
  timeoutMs?: number // native test seam, cannot increase the 30s ceiling
}
// Returns a validated COPY only. Activation/persistence and suspension/CAS of
// live contexts belong to the installer's transaction (lot 4), never this job.
export async function runMigrationSandbox(db: Database, input: MigrationJob): Promise<MigrationSnapshot> {
  const manifest = manifestSchema.parse(input.manifest)
  if (manifest.kind !== 'package' || !manifest.migrations || !hasMigrationChain(manifest, input.snapshot.fromVersion) || input.snapshot.toVersion !== manifest.storageVersion) throw new AppError('INCOMPATIBLE', 'Chaîne de migration incompatible.')
  if (input.signal?.aborted) throw new AppError('UNAVAILABLE', 'Migration annulée.')
  const contexts = new ContextRegistry(db), shellOrigin = 'app://migration'
  const catalog = new ResourceCatalog(contexts, shellOrigin)
  const isolated = session.fromPartition(`migration-${randomBytes(24).toString('hex')}`, { cache: false })
  const guard = installRuntimeSession(isolated, shellOrigin + '/', contexts)
  let win: BrowserWindow | undefined, stopProtocol: (() => void) | undefined, bridge: ReturnType<typeof installRuntimeBridge> | undefined
  let appHandled = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
  try {
    return await new Promise<MigrationSnapshot>((resolve, reject) => {
      timer = setTimeout(() => reject(new AppError('TIMEOUT', 'Délai de migration dépassé.')), Math.min(Math.max(1, input.timeoutMs ?? RUNTIME_LIMITS.migrationTimeoutMs), RUNTIME_LIMITS.migrationTimeoutMs))
      abort = () => reject(new AppError('UNAVAILABLE', 'Migration annulée.'))
      input.signal?.addEventListener('abort', abort, { once: true })
      const copy = new MigrationCopy(input.snapshot, (result) => {
        if (!result) { reject(new AppError('UNAVAILABLE', 'Migration échouée.')); return }
        for (const entry of result.entries) if (entry.kind === 'config') {
          const contribution = manifest.contributions.find(item => item.id === entry.contributionId)
          if (contribution && (entry.version !== (contribution.config?.version ?? 1) || !validateConfig(contribution.config, entry.value).ok)) { reject(new AppError('VALIDATION', 'Configuration migrée invalide.')); return }
        }
        resolve(result)
      })
      void (async () => {
        await guard.ready
        if (disposed) throw new AppError('UNAVAILABLE', 'Migration fermée.')
        const registration = contexts.createMigration(manifest)
        catalog.add(registration.id, input.root, input.files)
        const url = catalog.prepareBootstrap(registration.id, manifest.migrations!.entry, input.bootstrapBundle)
        const mount = `const connector=PtHost.createElectronConnector(location.origin);PtHost.mountContribution(document.body,${JSON.stringify({ contextId: registration.id, origin: registration.origin, url })},connector);`
        isolated.protocol.handle('app', (request) => {
          const path = new URL(request.url).pathname
          const body = path === '/host.js' ? input.hostBundle : path === '/' ? '<!doctype html><html><body><script src="host.js"></script></body></html>' : ''
          return new Response(body, { status: body ? 200 : 404, headers: { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; frame-src pt-plugin:; style-src 'self' 'unsafe-inline'" } })
        })
        appHandled = true
        stopProtocol = installPluginProtocol(isolated.protocol, catalog)
        win = new BrowserWindow({ show: false, webPreferences: { session: isolated, preload: input.preloadPath, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true } })
        guard.attach(win.webContents)
        win.webContents.once('render-process-gone', () => reject(new AppError('UNAVAILABLE', 'Migration interrompue.')))
        win.once('closed', () => reject(new AppError('UNAVAILABLE', 'Migration fermée.')))
        await win.loadURL(shellOrigin + '/')
        if (disposed) throw new AppError('UNAVAILABLE', 'Migration fermée.')
        bridge = installRuntimeBridge(ipcMain, win.webContents, win.webContents.getURL(), contexts, new SdkBroker(db, contexts, new CoreService(db), { migration: copy }))
        bridge.authorize(registration.id)
        // Execute trusted mounting code only, never package code in the shell.
        await win.webContents.executeJavaScript(mount + ';void 0;')
      })().catch(reject)
    })
  } finally {
    disposed = true
    if (timer) clearTimeout(timer)
    if (abort) input.signal?.removeEventListener('abort', abort)
    bridge?.dispose(); if (win && !win.isDestroyed()) win.destroy(); guard.close(); stopProtocol?.(); catalog.close(); contexts.close()
    if (appHandled) isolated.protocol.unhandle('app')
  }
}
