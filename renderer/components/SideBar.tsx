import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useTheme } from '../lib/theme'
import {
  AlertIcon,
  ArrowLeftIcon,
  FolderIcon,
  HomeIcon,
  MonitorIcon,
  MoonIcon,
  NoteIcon,
  SearchIcon,
  SettingsIcon,
  StoreIcon,
  SunIcon,
} from './icons'

const NAV_ITEMS = [
  { href: '/home', label: 'Home', icon: HomeIcon, match: (p: string) => p === '/home' },
  {
    href: '/projects',
    label: 'Projets',
    icon: FolderIcon,
    match: (p: string) => p.startsWith('/project'),
  },
  {
    href: '/marketplace',
    label: 'Marketplace',
    icon: StoreIcon,
    match: (p: string) => p === '/marketplace',
  },
  { href: '/notes', label: 'Notes', icon: NoteIcon, match: (p: string) => p.startsWith('/notes') },
  { href: '/errors', label: 'Erreurs', icon: AlertIcon, match: (p: string) => p === '/errors' },
  { href: '/search', label: 'Recherche', icon: SearchIcon, match: (p: string) => p === '/search' },
  {
    href: '/settings',
    label: 'Réglages',
    icon: SettingsIcon,
    match: (p: string) => p === '/settings',
  },
]

const THEME_ICON = { system: MonitorIcon, light: SunIcon, dark: MoonIcon }
const STORAGE_KEY = 'tracker_sidebar_collapsed'

export function SideBar() {
  const router = useRouter()
  const { themeMode, themeLabel, cycleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const ThemeIcon = THEME_ICON[themeMode]

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1')
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <aside
      className={`flex-shrink-0 border-r border-border flex flex-col p-3.5 gap-1 bg-surface transition-[width] duration-150 ${
        collapsed ? 'w-[64px]' : 'w-[236px]'
      }`}
    >
      <div className={`flex items-center gap-2.5 pb-5 ${collapsed ? 'justify-center' : 'px-1.5'}`}>
        <div className="w-[30px] h-[30px] rounded-lg bg-accent text-accent-text flex items-center justify-center font-bold font-mono flex-shrink-0">
          T
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-[15px] leading-tight">Tracker</div>
            <div className="text-[11px] text-text-faint leading-tight">projets & notes</div>
          </div>
        )}
      </div>
      <nav className="flex flex-col gap-0.5 flex-1">
        {NAV_ITEMS.map((item) => {
          const active = item.match(router.pathname)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 py-2.5 rounded-lg text-[13.5px] transition-colors ${
                collapsed ? 'justify-center' : 'px-2.5'
              } ${
                active
                  ? 'bg-accent-soft text-accent-soft-text font-bold'
                  : 'text-text-muted font-medium hover:bg-surface-hover'
              }`}
            >
              <Icon size={17} />
              {!collapsed && item.label}
            </Link>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={cycleTheme}
        title={collapsed ? themeLabel : undefined}
        className={`flex items-center gap-2 py-2.5 rounded-lg border-none bg-transparent text-text-muted cursor-pointer text-[12.5px] hover:bg-surface-hover ${
          collapsed ? 'justify-center' : 'px-2.5'
        }`}
      >
        <ThemeIcon size={15} />
        {!collapsed && themeLabel}
      </button>
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Agrandir' : 'Réduire'}
        className={`flex items-center gap-2 py-2 rounded-lg border-none bg-transparent text-text-faint cursor-pointer text-[12.5px] hover:bg-surface-hover hover:text-text ${
          collapsed ? 'justify-center' : 'px-2.5'
        }`}
      >
        <ArrowLeftIcon size={14} className={collapsed ? 'rotate-180' : ''} />
        {!collapsed && 'Réduire'}
      </button>
    </aside>
  )
}
