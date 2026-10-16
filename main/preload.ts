import { PACKAGE_SHELL_CHANNELS as packageChannels, PACKAGE_SHELL_CHANGED, type PackageShellApi, type PackageRegistryChange } from '../shared/packageShell'
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { AppSnapshot, CommandResponse, DataChange, NativeCommandName, StartupStatus } from '../shared/commands'
import type { ModuleHostRequest, ModuleHostReply, ModuleHostEvent } from '../shared/moduleHost'
import type { CompositionRequest, CompositionResult, CompositionSnapshot } from '../shared/composition'
import type { ErrorPayload } from '../shared/errors'

// Narrow bridge exposed to the shell document only. There is no generic
// channel: every entry maps to one validated native handler.

type Outcome<T> = { ok: true; value: T } | { ok: false; error: ErrorPayload }

export interface MigrationReportSummary {
  id: string
  status: 'succeeded' | 'failed'
  finishedAt: string
  counts: Record<string, number>
  blocking: { location: string; message: string }[]
  unresolved: number
  archived: { location: string; reason: string }[]
  adjustments: number
  weekSource: string
}


const packageApi: PackageShellApi = {
  snapshot: () => ipcRenderer.invoke(packageChannels.snapshot),
  refresh: () => ipcRenderer.invoke(packageChannels.refresh),
  linkFolder: () => ipcRenderer.invoke(packageChannels.linkFolder),
  unlinkFolder: () => ipcRenderer.invoke(packageChannels.unlinkFolder),
  importArchive: () => ipcRenderer.invoke(packageChannels.importArchive),
  importFolder: input => ipcRenderer.invoke(packageChannels.importFolder, input),
  importBundled: input => ipcRenderer.invoke(packageChannels.importBundled, input),
  activate: input => ipcRenderer.invoke(packageChannels.activate, input),
  stop: input => ipcRenderer.invoke(packageChannels.stop, input),
  onChanged: listener => {
    const handler = (_event: IpcRendererEvent, value: PackageRegistryChange) => listener(value)
    ipcRenderer.on(PACKAGE_SHELL_CHANGED, handler)
    return () => { ipcRenderer.removeListener(PACKAGE_SHELL_CHANGED, handler) }
  },
}
const api = {
  packages: packageApi,
  composition: {
    snapshot: (): Promise<CompositionResult<CompositionSnapshot>> => ipcRenderer.invoke('composition:snapshot'),
    command: (request: CompositionRequest): Promise<CompositionResult<{ id?: string }>> => ipcRenderer.invoke('composition:command', request),
  },
  modules: {
    open: (request: ModuleHostRequest): Promise<ModuleHostReply> => ipcRenderer.invoke('modules:open', request),
    close: (contextId: string): Promise<void> => ipcRenderer.invoke('modules:close', contextId),
    onEvent(callback: (event: ModuleHostEvent) => void) {
      const listener = (_event: IpcRendererEvent, value: ModuleHostEvent) => callback(value)
      ipcRenderer.on('modules:event', listener)
      return () => { ipcRenderer.removeListener('modules:event', listener) }
    },
  },
  core: {
    status: (): Promise<StartupStatus> => ipcRenderer.invoke('core:status'),
    snapshot: (): Promise<Outcome<AppSnapshot>> => ipcRenderer.invoke('core:snapshot'),
    command: (name: NativeCommandName, params: unknown): Promise<CommandResponse<unknown>> => ipcRenderer.invoke('core:command', name, params),
    retry: (): Promise<StartupStatus> => ipcRenderer.invoke('core:retry'),
    report: (): Promise<MigrationReportSummary | null> => ipcRenderer.invoke('core:report'),
    diagnostics: (): Promise<Outcome<Record<string, string | null>[]>> => ipcRenderer.invoke('core:diagnostics'),
    exportDiagnostics: (): Promise<Outcome<{ name: string }>> => ipcRenderer.invoke('core:exportDiagnostics'),
    safeMode: (): Promise<boolean> => ipcRenderer.invoke('core:safeMode'),
    restartSafe: (): Promise<boolean> => ipcRenderer.invoke('core:restartSafe'),
    restore: (): Promise<Outcome<{ name: string }>> => ipcRenderer.invoke('core:restore'),
    backup: (): Promise<Outcome<{ name: string }>> => ipcRenderer.invoke('core:backup'),
    exportJson: (): Promise<Outcome<{ name: string }>> => ipcRenderer.invoke('core:export'),
    onChanged(callback: (payload: { changes: DataChange[]; revision: number }) => void) {
      const subscription = (_event: IpcRendererEvent, payload: { changes: DataChange[]; revision: number }) => callback(payload)
      ipcRenderer.on('core:changed', subscription)
      return () => {
        ipcRenderer.removeListener('core:changed', subscription)
      }
    },
  },
  getDataDir: (): Promise<string> => ipcRenderer.invoke('data:getDir'),
  chooseFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:chooseFile'),
  revealInFinder: (targetPath: string): Promise<string | null> =>
    ipcRenderer.invoke('shell:revealInFinder', targetPath),
  openExternal: (url: string): Promise<string | null> =>
    ipcRenderer.invoke('shell:openExternal', url),
  ai: {
    call: (request: string, format?: string): Promise<string> =>
      ipcRenderer.invoke('ai:call', request, format),
  },
  openWith: (
    target: 'terminal' | 'zed',
    targetPath: string
  ): Promise<string | null> =>
    ipcRenderer.invoke('shell:openWith', target, targetPath),
}

contextBridge.exposeInMainWorld('api', api)

export type ApiHandler = typeof api
