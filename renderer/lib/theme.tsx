import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ThemeMode } from './types'
import { useData } from './store'


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
  const { preferences, updatePreferences } = useData()
  const themeMode = preferences.themeMode
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const themeRequest = useRef(0)
  const [packageTheme, setPackageTheme] = useState<import('../../shared/packageShell').PackageShellSnapshot['hostTheme']>(null)
  useEffect(() => {
    let alive = true
    const refresh = () => { const request = ++themeRequest.current; void window.api?.packages?.snapshot().then(result => { if (alive && request === themeRequest.current && result.ok) setPackageTheme(result.value.hostTheme ?? null) }).catch(() => {}) }
    refresh(); const stop = window.api?.packages?.onChanged(refresh)
    return () => { alive = false; stop?.() }
  }, [])
  const isDark = themeMode === 'system' ? systemDark : themeMode === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    if (!packageTheme) return
    const style = document.documentElement.style, tokens = isDark ? packageTheme.dark : packageTheme.light
    const mapping: Record<string, string> = { background: '--tracker-bg', surface: '--tracker-surface', text: '--tracker-text', accent: '--tracker-accent', border: '--tracker-border' }
    for (const [key, value] of Object.entries(tokens)) if (mapping[key]) style.setProperty(mapping[key], value)
    if (packageTheme.background) style.setProperty('--tracker-background-image', `url("${packageTheme.background}")`)
    return () => { for (const key of Object.keys(tokens)) if (mapping[key]) style.removeProperty(mapping[key]); style.removeProperty('--tracker-background-image') }
  }, [packageTheme, isDark])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    void updatePreferences({ themeMode: mode })
  }, [updatePreferences])

  const cycleTheme = useCallback(() => {
    setThemeMode(themeMode === 'system' ? 'light' : themeMode === 'light' ? 'dark' : 'system')
  }, [themeMode, setThemeMode])

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
