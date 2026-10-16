import { observeContentSize } from './layout'
import { connect, type ProjectTrackerSdk } from './client'

export interface BootstrapInput { hostOrigin: string; documentHtml: string; documentUrl: string; theme?: { light: Record<string, string>; dark: Record<string, string>; texts: Record<string, string>; background?: string; mode: 'light' | 'dark' | 'system' } }

// Only the host-generated empty document loads this bundle. It contains NO
// package script tags until negotiation has completed successfully.
export async function start(input: BootstrapInput): Promise<void> {
  try {
    const sdk = await connect({ hostOrigin: input.hostOrigin })
    const ready: Promise<ProjectTrackerSdk> = Promise.resolve(sdk)
    Object.defineProperty(window, 'ProjectTracker', { value: Object.freeze({ ready }), writable: false, configurable: false })
    history.replaceState(null, '', input.documentUrl)
    document.open()
    document.write(input.documentHtml)
    document.close()
    observeContentSize(input.hostOrigin)
    if (input.theme) {
      const theme = input.theme
      const apply = () => {
        const dark = theme.mode === 'dark' || (theme.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
        for (const [key, value] of Object.entries(dark ? theme.dark : theme.light)) document.documentElement.style.setProperty(`--amber-${key}`, value)
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
        if (theme.background) document.body.style.backgroundImage = `url("${theme.background}")`
      }
      apply()
      if (theme.mode === 'system') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
      // Explicitly exposed presentation keys only; never permission/security UI.
      if (theme.texts['week.title']) document.documentElement.dataset.weekTitle = theme.texts['week.title']
    }
  } catch {
    document.body.textContent = 'Contribution indisponible : initialisation du SDK impossible.'
  }
}
