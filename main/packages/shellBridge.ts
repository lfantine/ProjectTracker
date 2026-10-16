import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import validVersion from 'semver/functions/valid'
import { fail, ok, type Result } from '../../shared/errors'
import { PACKAGE_SHELL_CHANNELS as channels, PACKAGE_SHELL_CHANGED, type PackageRegistryChange } from '../../shared/packageShell'
import type { CatalogueEntry } from './catalogue'
import type { PackageManager, SourceCatalogue } from './manager'

export interface PackagePickers {
  archive(): Promise<string | null>
  folder(): Promise<string | null>
}
type Available = Extract<CatalogueEntry, { status: 'available' }>
const noArguments = (args: unknown[]) => { if (args.length) throw Error('SHELL_VALIDATION') }
function fields(args: unknown[], names: string[]): Record<string, string> {
  const value = args[0]
  if (args.length !== 1 || !value || typeof value !== 'object' || Array.isArray(value)) throw Error('SHELL_VALIDATION')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== names.length || Object.keys(record).some(key => !names.includes(key)) || names.some(name => typeof record[name] !== 'string' || !record[name] || (record[name] as string).length > 256)) throw Error('SHELL_VALIDATION')
  return record as Record<string, string>
}
function identity(id: string): void {
  if (id === 'core' || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(id)) throw Error('SHELL_VALIDATION')
}
function errorResult(error: unknown): Result<never> {
  // Closed messages/codes only: never serialize fs errors, paths or archive text.
  const message = error instanceof Error ? error.message : ''
  if (message === 'SHELL_VALIDATION') return fail('VALIDATION', 'Demande de package invalide.')
  if (message === 'SHELL_DENIED') return fail('PERMISSION_DENIED', 'Appel réservé au shell natif.')
  if (['INSTALL_SOURCE_CHANGED', 'SOURCE_LINK_CHANGED', 'SHELL_SELECTION_EXPIRED', 'INSTALL_VERSION_CONFLICT', 'INSTALL_STATE_CHANGED', 'ACTIVATION_SOURCE_CHANGED'].includes(message)) return fail('CONFLICT', 'La sélection ou les données ont changé. Actualise puis réessaie.')
  if (message === 'INSTALL_INELIGIBLE' || message === 'ACTIVATION_INELIGIBLE') return fail('DEPENDENCY', 'Les dépendances du package ne permettent pas cette opération.')
  return fail('UNAVAILABLE', 'Opération de package indisponible ou annulée.')
}

/** One trusted top-level document only. Paths originate in native pickers, folder
 * selections in opaque per-document tokens. Disposal/navigation cancels queued
 * work and consent/migrations; the normal preload does not expose these calls.
 */
export function installPackageShellBridge(ipc: IpcMain, shell: WebContents, shellUrl: string,
  manager: PackageManager, pickers: PackagePickers) {
  let disposed = false
  const controller = new AbortController()
  const registered: string[] = []
  const selections = new Map<string, { folder: string; entry: Available }>()
  // Folder path is kept native. Derive it only from explicit native selection or
  // persisted source via the manager, never from a renderer argument.
  const trusted = (event: IpcMainInvokeEvent) => !disposed && !shell.isDestroyed() &&
    event.sender === shell && event.senderFrame === shell.mainFrame && event.senderFrame?.url === shellUrl
  const assertTrusted = (event: IpcMainInvokeEvent) => { if (!trusted(event)) throw Error('SHELL_DENIED') }
  const catalogue = (value: SourceCatalogue) => {
    if (selections.size > 2000) selections.clear()
    if (value.status !== 'ok') return value
    const folder = manager.linkedFolderPath()
    return { status: 'ok', entries: value.entries.map(entry => {
      if (entry.status !== 'available' || !folder) return entry
      const token = [...selections.entries()].find(([, item]) => item.folder === folder && item.entry.fileName === entry.fileName && item.entry.sourceSha256 === entry.sourceSha256)?.[0] ?? randomUUID()
      selections.set(token, { folder, entry: structuredClone(entry) })
      return { ...entry, selection: token }
    }) }
  }
  const snapshot = () => manager.status() !== 'ready'
    ? { phase: manager.status(), packages: [], versions: [], catalogue: null, bundled: [] }
    : ({ phase: manager.status(), packages: manager.packages(),
    bundledDetails: manager.bundledDetails(), hostTheme: manager.themeFor('core'), versions: manager.versions(), details: manager.details(), catalogue: catalogue(manager.catalogueSnapshot()),
    bundled: manager.bundledOffers().map(({ key, packageId, version, contentSha256 }) => ({ key, packageId, version, contentSha256 })) })
  const handle = (channel: string, action: (event: IpcMainInvokeEvent, args: unknown[]) => unknown | Promise<unknown>) => {
    ipc.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      try {
        assertTrusted(event)
        if (channel !== channels.snapshot && manager.status() !== 'ready') throw Error('PACKAGES_NOT_READY')
        const value = await action(event, args)
        assertTrusted(event)
        return ok(value)
      } catch (error) { return errorResult(error) }
    })
    registered.push(channel)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    controller.abort()
    selections.clear()
    for (const channel of registered) ipc.removeHandler(channel)
    shell.removeListener('destroyed', dispose)
    shell.removeListener('did-start-navigation', navigate)
  }
  const navigate = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) dispose() }
  try {
    handle(channels.snapshot, (_event, args) => { noArguments(args); return snapshot() })
    handle(channels.refresh, async (_event, args) => { noArguments(args); selections.clear(); await manager.refreshCatalogue(); return snapshot() })
    handle(channels.linkFolder, async (event, args) => {
      noArguments(args)
      const folder = await pickers.folder()
      assertTrusted(event)
      if (folder) selections.clear()
      if (folder) await manager.linkFolder(folder, controller.signal)
      return snapshot()
    })
    handle(channels.unlinkFolder, async (_event, args) => { noArguments(args); selections.clear(); await manager.unlinkFolder(controller.signal); return snapshot() })
    handle(channels.importArchive, async (event, args) => {
      noArguments(args)
      const source = await pickers.archive()
      assertTrusted(event)
      return source ? manager.importArchive(source, controller.signal) : null
    })
    handle(channels.importFolder, (_event, args) => {
      const { selection } = fields(args, ['selection'])
      const selected = selections.get(selection)
      if (!selected) throw Error('SHELL_SELECTION_EXPIRED')
      return manager.importFolder(selected.folder, selected.entry, controller.signal)
    })
    handle(channels.importBundled, (_event, args) => {
      const { key } = fields(args, ['key'])
      return manager.importBundled(key, controller.signal)
    })
    handle(channels.activate, (_event, args) => {
      const { packageId, version } = fields(args, ['packageId', 'version'])
      identity(packageId)
      if (version.length > 64 || validVersion(version) !== version) throw Error('SHELL_VALIDATION')
      return manager.activate(packageId, version, controller.signal)
    })
    handle(channels.stop, (_event, args) => {
      const { packageId, action } = fields(args, ['packageId', 'action'])
      identity(packageId)
      if (action !== 'disable' && action !== 'uninstall') throw Error('SHELL_VALIDATION')
      return manager.stop(packageId, action, controller.signal)
    })
    shell.on('destroyed', dispose)
    shell.on('did-start-navigation', navigate)
  } catch (error) { dispose(); throw error }
  return {
    dispose,
    notify(change: PackageRegistryChange) {
      if (!disposed && !shell.isDestroyed() && shell.mainFrame.url === shellUrl) shell.send(PACKAGE_SHELL_CHANGED, structuredClone(change))
    },
  }
}
