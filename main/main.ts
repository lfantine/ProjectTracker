import path from 'path'
import { execSync, spawn } from 'child_process'
import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers/create-window'
import { getDataDir, loadAppData, saveAppData, getSettings, saveSettings } from './helpers/data-store'
import { callAiTool } from './aiTool'

const isProd = process.env.NODE_ENV === 'production'
const devPort = process.argv[2]

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

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

;(async () => {
  await app.whenReady()

  if (!isProd) {
    const devIconPath = path.join(import.meta.dirname, '../resources/icon.png')
    if (process.platform === 'darwin') app.dock?.setIcon(devIconPath)
  }

  const mainWindow = createWindow('main', {
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    icon: isProd ? undefined : path.join(import.meta.dirname, '../resources/icon.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
    },
  })

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    await mainWindow.loadURL(`http://localhost:${devPort}/home`)
    // mainWindow.webContents.openDevTools()
  }
})()

app.on('window-all-closed', () => {
  if (!isProd) killDevServer()
  app.quit()
})

ipcMain.handle('data:load', async () => {
  return loadAppData()
})

ipcMain.handle('data:save', async (_event, data: unknown) => {
  await saveAppData(data)
  return true
})

ipcMain.handle('data:getDir', async () => {
  return getDataDir()
})

ipcMain.handle('settings:get', async () => {
  return getSettings()
})

ipcMain.handle('settings:set', async (_event, patch: { aiCommand?: string }) => {
  return saveSettings(patch)
})

ipcMain.handle('ai:call', async (_event, request: string, format?: string) => {
  const settings = await getSettings()
  return callAiTool(settings.aiCommand, request, format)
})

ipcMain.handle('dialog:chooseFolder', async () => {
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

ipcMain.handle('dialog:chooseFile', async () => {
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

ipcMain.handle('shell:revealInFinder', async (_event, targetPath: string) => {
  const result = await shell.openPath(targetPath)
  return result === '' ? null : result
})

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
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

ipcMain.handle(
  'shell:openWith',
  async (_event, target: 'terminal' | 'zed', targetPath: string) => {
    const appName = target === 'terminal' ? 'Terminal' : 'Zed'
    return new Promise<string | null>((resolve) => {
      const child = spawn('open', ['-a', appName, targetPath])
      child.on('error', (err) => resolve(err.message))
      child.on('exit', (code) => resolve(code === 0 ? null : `Impossible d'ouvrir avec ${appName}`))
    })
  }
)

ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})
