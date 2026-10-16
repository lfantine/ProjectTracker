import { BrowserWindow, session } from 'electron'
import type { CoreService } from './service'

const keys = ['tracker_theme_mode', 'tracker_sidebar_collapsed', 'tracker_collapsed_category_folders', 'tracker_project_tabs_v1']
const url = 'app://./__amber_preferences__'

// Read only the four historic keys in the historic default Electron profile.
// No old application script, preload, plugin or remote page is ever loaded.
// Originals remain untouched; the native adoption command is transactional and
// refuses to overwrite preferences already written to SQLite.
export async function adoptHistoricalPreferences(core: CoreService): Promise<void> {
  if (core.db.get("SELECT 1 FROM import_markers WHERE kind = 'renderer-preferences'")) return
  let window: BrowserWindow | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  session.defaultSession.protocol.handle('app', request => request.url === url
    ? new Response('<!doctype html><html><body></body></html>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'" } })
    : new Response(null, { status: 404 }))
  try {
    window = new BrowserWindow({ show: false, webPreferences: { session: session.defaultSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    const load = async () => {
      await window!.loadURL(url)
      const values = await window!.webContents.executeJavaScript(`Object.fromEntries(${JSON.stringify(keys)}.map(key => { const value = localStorage.getItem(key); if (value && value.length > 1000000) throw Error('PREFERENCES_LIMIT'); return [key, value] }))`)
      const result = core.execute('preferences.adoptLegacy', { values })
      if (!result.ok) throw Error('PREFERENCES_ADOPTION')
    }
    await Promise.race([load(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('PREFERENCES_TIMEOUT')), 5000) })])
  } finally {
    clearTimeout(timer)
    if (window && !window.isDestroyed()) window.destroy()
    session.defaultSession.protocol.unhandle('app')
  }
}
