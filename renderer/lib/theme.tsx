import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ThemeMode } from './types'

const STORAGE_KEY = 'tracker_theme_mode'

interface ThemeContextValue {
  themeMode: ThemeMode
  isDark: boolean
  themeLabel: string
  setThemeMode: (mode: ThemeMode) => void
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const LABELS: Record<ThemeMode, string> = {
  system: 'Système',
  light: 'Clair',
  dark: 'Sombre',
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      setThemeModeState(stored)
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isDark = themeMode === 'system' ? systemDark : themeMode === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeModeState((prev) => {
      const next: ThemeMode =
        prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  const value = useMemo(
    () => ({
      themeMode,
      isDark,
      themeLabel: LABELS[themeMode],
      setThemeMode,
      cycleTheme,
    }),
    [themeMode, isDark, setThemeMode, cycleTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
