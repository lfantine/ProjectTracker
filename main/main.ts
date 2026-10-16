import { initializeRelease, isQualifiedRelease } from './core/release'
import path from 'path'
import fs from 'node:fs'
import os from 'node:os'
import { execSync, spawn } from 'child_process'
import { app, ipcMain, dialog, shell, BrowserWindow, protocol, type IpcMainInvokeEvent } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import { adoptLegacyDataDir, adoptLegacyDirectory, DATA_DIR_ENV, getDataPaths, resolveUserDataOverride, type DataPaths } from './helpers/paths'
import { callAiTool } from './aiTool'
import type { CoreRuntime } from './core/startup'
import { startQualifiedCore } from './core/qualification'
import { adoptHistoricalPreferences } from './core/legacyPreferences'
import { diagnosticSummary, exportDiagnostics } from './core/diagnostics'
import { createBackup, writeExport } from './core/backup'
import { restoreRecoveryBackup, validateRecoveryBackup } from './core/recovery'
import { CompositionService } from './core/compositionService'
import { AppError } from '../shared/errors'
import type { AppSettings } from '../shared/models'
import { configureRuntimeChromium } from './runtime/chromiumPolicy'
import { shellAssetResponse } from './modules/shellProtocol'
import { prepareModuleShell, MODULE_SHELL_URL } from './modules/shell'

// Do not leave a native modal error loop during shutdown/startup failures.
// Detailed stacks are restricted to isolated test runs.
process.on('uncaughtException', error => {
  console.error('Erreur native fatale', process.env.PROJECT_TRACKER_TEST === '1' ? error.stack : 'NATIVE_FATAL')
  app.exit(78)
})

const isProd = process.env.NODE_ENV === 'production'
const devPort = process.argv[2]
const safeMode = process.argv.includes('--safe-mode') || process.env.AMBER_SAFE_MODE === '1'

// Resolve every location before anything touches the disk: an invalid test
// override must stop the app instead of falling back to personal data.
initializeRelease({ packaged: app.isPackaged, production: isProd, platform: process.platform, arch: process.arch, electron: process.versions.electron, test: process.env.PROJECT_TRACKER_TEST === '1' })
let userDataOverride: string | undefined
let paths: DataPaths
try {
  userDataOverride = resolveUserDataOverride()
  // Only the qualified release opens personal data, so only it moves the
  // pre-amber directory. On failure the legacy location keeps being used.
  if (isQualifiedRelease() && process.env[DATA_DIR_ENV] === undefined) {
    try { adoptLegacyDataDir() }
    catch (error) { console.error('Déplacement des données vers amber impossible', error instanceof Error ? error.message : error) }
  }
  paths = getDataPaths()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(78)
}

// In dev, nextron spawns `next dev` as a sibling process alongside Electron.
// Closing the window only quits Electron, leaving that server (and its port) behind.
function killDevServer() {
  if (!devPort) return
  try {
    const pids = execSync(`lsof -ti:${devPort}`).toString().trim().split('\n').filter(Boolean)
    pids.forEach((pid) => {
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {
        // already gone
      }
    })
  } catch {
    // nothing listening on that port
  }
}

// Only the qualified installed release or the isolated qualification harness.
const modulesRequested = !safeMode && isProd && (isQualifiedRelease() || (process.env.PROJECT_TRACKER_TEST === '1' && process.env.PROJECT_TRACKER_MODULES === '1'))
if (modulesRequested) {
  if (!isQualifiedRelease()) {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(paths.root))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('MODULE_SHELL_NOT_QUALIFIED')
  }
  configureRuntimeChromium(app)
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: 'pt-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
} else if (isProd) {
  serve({ directory: 'app' })
}
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
} else {
  // Electron profile (window geometry, historical localStorage) formerly named
  // after the nextron template. Moved before Chromium opens it. Built from
  // appData: app.getPath('userData') creates the directory and would block it.
  const suffix = isProd ? '' : ' (development)'
  const appData = app.getPath('appData')
  const profile = path.join(appData, `${app.getName()}${suffix}`)
  try { adoptLegacyDirectory(path.join(appData, `my-nextron-app${suffix}`), profile) }
  catch (error) { console.error('Déplacement du profil Electron impossible', error instanceof Error ? error.message : error) }
  app.setPath('userData', profile)
}

let booting = true
let mainWindow: BrowserWindow | null = null
let runtime: CoreRuntime | null = null
let stopEvents: (() => void) | null = null
let moduleShell: Awaited<ReturnType<typeof prepareModuleShell>> | undefined

async function boot() {
  stopEvents?.()
  runtime?.close()
  runtime = await startQualifiedCore(paths)
  if (modulesRequested && runtime.service) {
    try { await adoptHistoricalPreferences(runtime.service) }
    catch {
      runtime.close()
      runtime.status = { mode: 'recovery', reason: 'database-error', message: 'Les préférences historiques n’ont pas pu être reprises. Les sources sont conservées. Redémarre sans tiers pour récupérer les données.', reportId: null }
    }
  }
  stopEvents = runtime.service?.onChange((changes, revision) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('core:changed', { changes, revision })
  }) ?? null
}

// Native handlers only answer the shell's own top-level document. Package
// frames (sub-frames) and any other origin are refused.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false
  const frame = event.senderFrame
  if (!frame || frame !== mainWindow.webContents.mainFrame) return false
  try {
    const url = new URL(frame.url)
    return isProd ? url.protocol === 'app:' && (!modulesRequested || url.host === 'shell') : url.protocol === 'http:' && url.hostname === 'localhost' && url.port === devPort
  } catch {
    return false
  }
}

function handle<Args extends unknown[], R>(channel: string, fn: (...args: Args) => R | Promise<R>) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Appel refusé')
    return fn(...(args as Args))
  })
}

function unavailable() {
  return { ok: false as const, error: { code: 'UNAVAILABLE' as const, message: 'Données indisponibles (mode récupération).' } }
}

function settings(): AppSettings {
  const result = runtime?.service?.execute('settings.get', {})
  return result?.ok ? (result.value as AppSettings) : { aiCommand: 'groqtool' }
}

;(async () => {
  await app.whenReady()
  // Packaged Electron ignores Playwright's -r loader. In isolated tests only,
  // let CDP attach before creating non-default session windows. This changes
  // timing, not permissions, consent, paths or the runtime implementation.
  if (process.env.PROJECT_TRACKER_TEST === '1' && process.env.AMBER_E2E_BOOT_BARRIER === '1') {
    const deadline = Date.now() + 30000
    while (!(globalThis as { __amberQualificationReady?: boolean }).__amberQualificationReady) {
      if (Date.now() >= deadline) throw Error('QUALIFICATION_ATTACH_TIMEOUT')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  await boot()

  if (!isProd) {
    const devIconPath = path.join(import.meta.dirname, '../resources/icon.png')
    if (process.platform === 'darwin') app.dock?.setIcon(devIconPath)
  }

  const current = runtime as CoreRuntime | null
  if (modulesRequested && !current?.service) protocol.handle('app', request => shellAssetResponse(request, import.meta.dirname, false))
  if (modulesRequested && current?.service) moduleShell = await prepareModuleShell(current.service, paths, import.meta.dirname, app.isPackaged ? path.join(process.resourcesPath, 'amber-runtime') : path.join(import.meta.dirname, 'runtime'))

  mainWindow = createWindow('main', {
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    icon: isProd ? undefined : path.join(import.meta.dirname, '../resources/icon.png'),
    webPreferences: {
      preload: moduleShell ? (app.isPackaged ? path.join(process.resourcesPath, 'amber-runtime/shell-preload.cjs') : path.join(import.meta.dirname, 'runtime/shell-preload.cjs')) : path.join(import.meta.dirname, 'preload.js'),
      ...(moduleShell ? { session: moduleShell.session } : {}),
    },
  })
  const shellOrigin = isProd ? 'app://' : `http://localhost:${devPort}`
  // The shell never navigates away from its own origin nor opens windows.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(shellOrigin)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

  if (moduleShell) {
    await moduleShell.attach(mainWindow)
    await mainWindow.loadURL(MODULE_SHELL_URL)
  } else if (isProd) {
    await mainWindow.loadURL(modulesRequested ? MODULE_SHELL_URL : 'app://./home')
  } else {
    await mainWindow.loadURL(`http://localhost:${devPort}/home`)
    // mainWindow.webContents.openDevTools()
  }
  booting = false
})().catch(error => {
  console.error('Démarrage interrompu :', error instanceof Error ? error.message : 'Erreur native')
  app.exit(78)
})

app.on('window-all-closed', () => {
  // Closing the confined runtime is part of restoration. Keep native work
  // alive until the journal/data replacement is complete, then relaunch.
  if (restoring || booting) return
  if (!isProd) killDevServer()
  app.quit()
})

app.on('will-quit', () => {
  moduleShell?.close()
  stopEvents?.()
  runtime?.close()
})

if (!modulesRequested) {
  handle('modules:open', () => ({ status: 'unavailable' as const }))
  handle('modules:close', () => {})
}

// ------------------------------------------------------------------ core

handle('composition:snapshot', () => {
  if (!runtime?.service) return unavailable()
  try { return { ok: true, value: new CompositionService(runtime.service).snapshot() } }
  catch { return unavailable() }
})
handle('composition:command', (input: unknown) => {
  if (!runtime?.service) return unavailable()
  try { return { ok: true, value: new CompositionService(runtime.service).execute(input) } }
  catch (error) { return { ok: false, error: error instanceof AppError ? error.toPayload() : { code: 'VALIDATION' as const, message: 'Composition non enregistrée. Les données sont conservées.' } } }
})

handle('core:status', () => runtime?.status ?? { mode: 'recovery', reason: 'database-error', message: 'Démarrage en cours.', reportId: null })

handle('core:snapshot', () => {
  const service = runtime?.service
  return service ? { ok: true, value: service.snapshot() } : unavailable()
})

handle('core:command', (name: unknown, params: unknown) => {
  const service = runtime?.service
  // Compatibility week commands remain native-only for legacy regression/import.
  // A shell (including a batch) must use the scoped package SDK instead.
  const legacy = (value: unknown) => typeof value === 'string' && value.startsWith('week.')
  if (legacy(name) || (name === 'core.batch' && params && typeof params === 'object' && 'steps' in params && Array.isArray(params.steps) && params.steps.some((step: unknown) => !!step && typeof step === 'object' && 'name' in step && legacy(step.name)))) return unavailable()
  return service ? service.execute(name, params) : unavailable()
})

handle('core:retry', async () => {
  if (runtime?.status.mode === 'ready') return runtime.status
  // Recovery had no runtime/session to rebind. Restart through the complete
  // native bootstrap rather than exposing a half-initialized package shell.
  if (modulesRequested && !moduleShell) {
    const status = runtime!.status
    setTimeout(() => { app.relaunch(); app.quit() }, 250)
    return status
  }
  await boot()
  return runtime!.status
})

handle('core:report', () => {
  const report = runtime?.lastReport
  if (!report) return null
  // Locations and reasons only; archived values may contain personal content.
  return {
    id: report.id,
    status: report.status,
    finishedAt: report.finishedAt,
    counts: report.counts,
    blocking: report.blocking,
    unresolved: report.unresolved.length,
    archived: report.archived.map((entry) => ({ location: entry.location, reason: entry.reason })),
    adjustments: report.adjustments.length,
    weekSource: report.weekSource,
  }
})

handle('core:diagnostics', () => runtime?.service ? { ok: true, value: diagnosticSummary(runtime.service.db) } : unavailable())
handle('core:exportDiagnostics', () => {
  try { return runtime?.service ? { ok: true, value: exportDiagnostics(runtime.service.db, paths) } : unavailable() }
  catch { return { ok: false, error: { code: 'STORAGE', message: 'Export du diagnostic indisponible.' } } }
})

handle('core:backup', async () => {
  const service = runtime?.service
  if (!service) return unavailable()
  try {
    const { directory } = await createBackup(service.db, paths)
    return { ok: true, value: { name: path.basename(directory) } }
  } catch {
    return { ok: false, error: { code: 'STORAGE', message: 'La sauvegarde a échoué.' } }
  }
})

// Recovery actions accept no renderer path and execute no package code.
let restoring = false
function restartWithoutPlugins() {
  app.relaunch({ args: [...process.argv.slice(1).filter(arg => arg !== '--safe-mode'), '--safe-mode'] })
  app.quit()
}
handle('core:safeMode', () => safeMode)
handle('core:restartSafe', async () => {
  if (!mainWindow) return false
  const answer = await dialog.showMessageBox(mainWindow, { type: 'question', message: 'Redémarrer sans modules tiers ?', buttons: ['Annuler', 'Redémarrer'], defaultId: 0, cancelId: 0 })
  if (answer.response !== 1) return false
  restartWithoutPlugins()
  return true
})
handle('core:restore', async () => {
  if (!mainWindow || restoring) return unavailable()
  restoring = true
  try {
    const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choisir un dossier de sauvegarde amber', properties: ['openDirectory'] })
    if (selection.canceled || selection.filePaths.length !== 1) return { ok: false, error: { code: 'UNAVAILABLE', message: 'Restauration annulée.' } }
    const source = selection.filePaths[0]
    await validateRecoveryBackup(source)
    const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Remplacer les données par cette sauvegarde ?',
      detail: 'Aucune fusion. L’état actuel sera conservé à côté. Les packages restaurés devront être réactivés explicitement. Les fichiers externes ne sont pas restaurés. L’application redémarrera sans tiers.',
      buttons: ['Annuler', 'Restaurer et redémarrer'], defaultId: 0, cancelId: 0 })
    if (answer.response !== 1) return { ok: false, error: { code: 'UNAVAILABLE', message: 'Restauration annulée.' } }
    moduleShell?.close(); moduleShell = undefined
    stopEvents?.(); stopEvents = null
    runtime?.close(); runtime = null
    try { await restoreRecoveryBackup(paths, source) }
    finally { setTimeout(restartWithoutPlugins, 250) }
    return { ok: true, value: { name: 'Restauration préparée ; redémarrage sans tiers.' } }
  } catch {
    return { ok: false, error: { code: 'STORAGE', message: 'Sauvegarde refusée ou restauration interrompue. Les états précédents sont conservés. Voir la procédure de récupération.' } }
  } finally { restoring = false }
})

handle('core:export', () => {
  const service = runtime?.service
  if (!service) return unavailable()
  try {
    const { file } = writeExport(service.db, paths)
    return { ok: true, value: { name: path.basename(file) } }
  } catch {
    return { ok: false, error: { code: 'STORAGE', message: 'L’export a échoué.' } }
  }
})

handle('data:getDir', () => paths.root)

handle('ai:call', async (request: string, format?: string) => callAiTool(settings().aiCommand, request, format))

handle('dialog:chooseFolder', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

handle('dialog:chooseFile', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

handle('shell:revealInFinder', async (targetPath: string) => {
  if (typeof targetPath !== 'string' || !targetPath) return 'Chemin invalide'
  const result = await shell.openPath(targetPath)
  return result === '' ? null : result
})

handle('shell:openExternal', async (url: string) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Lien invalide'
    }
    await shell.openExternal(url)
    return null
  } catch {
    return 'Lien invalide'
  }
})

handle('shell:openWith', async (target: 'terminal' | 'zed', targetPath: string) => {
  if (target !== 'terminal' && target !== 'zed') return 'Application inconnue'
  if (typeof targetPath !== 'string' || !targetPath) return 'Chemin invalide'
  const appName = target === 'terminal' ? 'Terminal' : 'Zed'
  return new Promise<string | null>((resolve) => {
    const child = spawn('open', ['-a', appName, targetPath])
    child.on('error', (err) => resolve(err.message))
    child.on('exit', (code) => resolve(code === 0 ? null : `Impossible d'ouvrir avec ${appName}`))
  })
})
