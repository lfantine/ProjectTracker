import { canUpdateDeliveredWeek, permitsDeliveredWeek } from './builtinUpdate'
import { isQualifiedRelease } from '../core/release'
import { shellAssetResponse } from './shellProtocol'
import { installPackageShellBridge } from '../packages/shellBridge'
import { nativePackagePickers } from '../packages/pickers'
import { nativeImportConfirmation, nativeStopConfirmation, nativeActivationConfirmation } from '../packages/consent'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { session, ipcMain, dialog, type BrowserWindow } from 'electron'
import { logDiagnostic, type CoreService } from '../core/service'
import type { DataPaths } from '../helpers/paths'
import { ContextRegistry } from '../runtime/contexts'
import { ResourceCatalog } from '../runtime/resources'
import { installRuntimeSession } from '../runtime/session'
import { installPluginProtocol } from '../runtime/protocol'
import { installRuntimeBridge } from '../runtime/bridge'
import { SdkBroker } from '../runtime/broker'
import { externalNavigationHooks } from '../runtime/externalNavigation'
import { runtimeActivationHooks } from '../runtime/activationHooks'
import { PackageManager } from '../packages/manager'
import { ModuleLauncher } from './launch'
import { moduleHref } from '../../shared/navigation'

export const MODULE_SHELL_URL = 'app://shell/home'

// Called only after native admission (qualified packaged release or isolated
// temporary-data tests). This is not a renderer-controlled opt-in.
export async function prepareModuleShell(core: CoreService, paths: DataPaths, appDirectory: string, assetsDirectory = path.join(appDirectory, 'runtime')) {
  const temporary = fs.realpathSync(os.tmpdir())
  const database = fs.realpathSync(core.db.file)
  const relative = path.relative(temporary, database)
  if ((!isQualifiedRelease() && (process.env.PROJECT_TRACKER_TEST !== '1' || process.env.PROJECT_TRACKER_MODULES !== '1' || !relative || relative.startsWith('..') || path.isAbsolute(relative))) || paths.packages !== path.join(path.dirname(core.db.file), 'packages')) throw Error('MODULE_SHELL_NOT_QUALIFIED')
  const contexts = new ContextRegistry(core.db)
  const isolated = session.fromPartition(`amber-shell-${randomUUID()}`)
  const catalog = new ResourceCatalog(contexts, 'app://shell')
  const guard = installRuntimeSession(isolated, MODULE_SHELL_URL, contexts)
  await guard.ready
  const assets = { hostBundle: fs.readFileSync(path.join(assetsDirectory, 'host.js'), 'utf8'),
    bootstrapBundle: fs.readFileSync(path.join(assetsDirectory, 'bootstrap.js'), 'utf8'), preloadPath: path.join(assetsDirectory, 'preload.cjs') }
  isolated.protocol.handle('app', request => shellAssetResponse(request, appDirectory, true))
  const stopProtocol = installPluginProtocol(isolated.protocol, catalog)
  let stop: (() => void) | undefined
  return {
    session: isolated,
    async attach(window: BrowserWindow) {
      guard.attach(window.webContents)
      const notify = (event: unknown) => { if (!window.isDestroyed()) window.webContents.send('modules:event', event) }
      const inventory = JSON.parse(fs.readFileSync(path.join(assetsDirectory, 'builtin-week.json'), 'utf8'))
      if (inventory.packageId !== 'builtin.week' || inventory.file !== `builtin.week-${inventory.version}.zip` || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(inventory.version)) throw Error('BUNDLE_INVENTORY_INVALID')
      let bootstrap = true
      let packageBridge: ReturnType<typeof installPackageShellBridge> | undefined
      const extensionBundles = ['builtin.amber-theme-1.0.0.zip', 'builtin.week-report-1.0.0.zip'].map(file => { const metadata = JSON.parse(fs.readFileSync(path.join(assetsDirectory, `${file}.json`), 'utf8')); if (metadata.file !== file) throw Error('BUNDLE_INVENTORY_INVALID'); return { ...metadata, path: path.join(assetsDirectory, file) } })
      const manager = new PackageManager(core.db, paths.packages, {
        // Only this known delivered version and its exact read-only rights get
        // bootstrap consent (first use or eligible bundled 1.0/1.1 -> 1.1.2 update).
        // Marketplace requests always use cancel-by-default native dialogs.
        confirmImport: (proposal, signal) => bootstrap ? Promise.resolve(permitsDeliveredWeek(proposal.manifest.id, proposal.manifest.version, proposal.manifest.permissions)) : nativeImportConfirmation(window)(proposal, signal), confirmStop: nativeStopConfirmation(window),
        activation: runtimeActivationHooks(core.db, contexts, assets, (proposal, signal) => bootstrap ? Promise.resolve(permitsDeliveredWeek(proposal.packageId, proposal.version, proposal.permissions)) : nativeActivationConfirmation(window)(proposal, signal), () => {}),
        revokePackage: id => contexts.revokePackage(id), changed: change => { packageBridge?.notify(change) },
      }, [{ key: inventory.key, packageId: inventory.packageId, version: inventory.version, contentSha256: inventory.contentSha256, path: path.join(assetsDirectory, inventory.file) }, ...extensionBundles], true)
      const broker = new SdkBroker(core.db, contexts, core, {
        ...externalNavigationHooks(window),
        confirmDeletion: async (_context, deletion, signal) => {
          if (signal.aborted || window.isDestroyed()) return false
          const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Supprimer cette instance ?',
            detail: JSON.stringify(deletion), buttons: ['Annuler', 'Supprimer'], defaultId: 0, cancelId: 0, signal })
          return !signal.aborted && !window.isDestroyed() && answer.response === 1
        },
        prepareNavigation: (source, target) => () => notify({ kind: 'navigate', contextId: source.contextId, href: target.kind === 'project'
          ? `/project?id=${encodeURIComponent(target.projectId)}`
          : moduleHref(target.major, target.binding.mode === 'fixed' ? target.binding.instanceId : undefined) }),
      })
      // Each committed same-document route gets a new exact-URL bridge. Old
      // capabilities are disposed, never carried across navigation implicitly.
      let bridge: ReturnType<typeof installRuntimeBridge> | undefined
      const bind = () => { bridge?.dispose(); packageBridge?.dispose(); const url = window.webContents.getURL(); bridge = installRuntimeBridge(ipcMain, window.webContents, url, contexts, broker); packageBridge = installPackageShellBridge(ipcMain, window.webContents, url, manager, nativePackagePickers(window)) }
      window.webContents.on('did-finish-load', bind)
      const inPage = (_event: unknown, _url: string, mainFrame: boolean) => { if (mainFrame) bind() }
      window.webContents.on('did-navigate-in-page', inPage)
      const launcher = new ModuleLauncher(core, paths.packages, manager, contexts, catalog, assets.bootstrapBundle)
      const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && /^app:\/\/shell\//.test(event.senderFrame.url)
      const owned = new Set<string>()
      ipcMain.handle('modules:open', (event, input: unknown) => {
        if (!trusted(event)) throw Error('REFUSED')
        try {
          if (!bridge) bind()
          const result = launcher.open(input)
          if (!bridge) { contexts.revoke(result.contextId); return { status: 'unavailable' } }
          bridge.authorize(result.contextId); owned.add(result.contextId)
          for (const feature of result.features) { bridge.authorize(feature.contextId); owned.add(feature.contextId); contexts.onRevoke(feature.contextId, () => owned.delete(feature.contextId)) }
          contexts.onRevoke(result.contextId, () => { owned.delete(result.contextId); notify({ kind: 'revoked', contextId: result.contextId }) })
          return result
        } catch { return { status: 'unavailable' } }
      })
      ipcMain.handle('modules:close', (event, id: unknown) => {
        if (!trusted(event)) throw Error('REFUSED')
        if (typeof id === 'string' && owned.has(id)) contexts.revoke(id)
      })
      // Private SDK instance commits are reconciled by the broker after its
      // acknowledgement. Public CORE changes may invalidate placements now.
      const unsubscribe = core.onChange(changes => { if (changes.length) contexts.reconcile() })
      stop = () => {
        unsubscribe(); bridge?.dispose(); packageBridge?.dispose()
        if (!window.isDestroyed()) { window.webContents.removeListener('did-finish-load', bind); window.webContents.removeListener('did-navigate-in-page', inPage) }
        ipcMain.removeHandler('modules:open'); ipcMain.removeHandler('modules:close')
      }
      await manager.start()
      // First-use delivered artifact uses the same installer and real sandbox
      // activation. A retained record (including uninstall) is never resurrected.
      const installedWeek = core.db.get<{ state: string; origin: string; active_version: string | null; storage_version: number; granted_permissions_json: string }>('SELECT * FROM packages WHERE id = ?', 'builtin.week')
      if (!installedWeek) {
        await manager.importBundled(inventory.key)
        await manager.activate('builtin.week', inventory.version)
      } else if (canUpdateDeliveredWeek(installedWeek, inventory.version)) {
        try { await manager.importBundled(inventory.key); await manager.activate('builtin.week', inventory.version) }
        catch { logDiagnostic(core.db, { level: 'warn', scope: 'bundled-update', code: 'BUNDLED_UPDATE_FAILED', message: 'Previous package retained.', packageId: 'builtin.week', version: inventory.version }) }
      }
      bootstrap = false
    },
    close() { stop?.(); contexts.close(); stopProtocol(); isolated.protocol.unhandle('app'); guard.close() },
  }
}
