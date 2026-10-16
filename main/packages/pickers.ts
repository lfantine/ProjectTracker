import { dialog, type BrowserWindow } from 'electron'
import type { PackagePickers } from './shellBridge'

/** Paths remain native and never become renderer-selectable import arguments. */
export function nativePackagePickers(window: BrowserWindow): PackagePickers {
  const choose = async (folder: boolean): Promise<string | null> => {
    if (window.isDestroyed()) return null
    const result = await dialog.showOpenDialog(window, folder
      ? { title: 'Lier un dossier de packages — amber', properties: ['openDirectory'] }
      : { title: 'Importer un package — amber', properties: ['openFile'], filters: [{ name: 'Package ZIP', extensions: ['zip'] }] })
    return !window.isDestroyed() && !result.canceled && result.filePaths.length === 1 ? result.filePaths[0] : null
  }
  return { folder: () => choose(true), archive: () => choose(false) }
}
