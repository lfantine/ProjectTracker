import { dialog, shell, type BrowserWindow } from 'electron'
import type { NavigationHooks } from './navigation'
// Native confirmation owned by the trusted window, never content supplied as
// HTML by a package. No remember/auto-approval path in v1.
export function externalNavigationHooks(window: BrowserWindow): Pick<NavigationHooks, 'confirmExternal' | 'openExternal'> {
  return {
    async confirmExternal(source, url, signal) {
      if (signal.aborted || window.isDestroyed()) return false
      const answer = await dialog.showMessageBox(window, { type: 'question', signal, title: 'Ouvrir un lien externe', message: `${source.context.packageId} demande à ouvrir un lien dans votre navigateur.`, detail: url, buttons: ['Annuler', 'Ouvrir'], defaultId: 0, cancelId: 0, noLink: true })
      return !signal.aborted && !window.isDestroyed() && answer.response === 1
    },
    openExternal: url => shell.openExternal(url, { activate: true }),
  }
}
