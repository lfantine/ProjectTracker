import { useState } from 'react'
import type { SidebarEntry } from '../../shared/models'
import { ShortcutIcon } from './ShortcutIcon'
import { ShortcutEditor } from './ShortcutEditor'
import { DropTrash } from './DropTrash'
import Link from 'next/link'
import { useComposition } from '../lib/composition'
import { targetHref } from '../../shared/navigation'
import { useRouter } from 'next/router'
import { useData } from '../lib/store'
import { useTheme } from '../lib/theme'
import {
  AlertIcon,
  CalendarIcon,
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
  { href: '/week', label: 'Semaine type', icon: CalendarIcon, match: (p: string) => p === '/week' },
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

export function SideBar() {
  const router = useRouter()
  const { snapshot, mutate, pending, error } = useComposition()
  const [adding, setAdding] = useState(false)
  const [drag, setDrag] = useState<{ id: string; group: boolean } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const { themeMode, themeLabel, cycleTheme } = useTheme()
  const { preferences, updatePreferences } = useData()
  const collapsed = preferences.sidebarCollapsed
  const ThemeIcon = THEME_ICON[themeMode]

  function toggleCollapsed() {
    void updatePreferences({ sidebarCollapsed: !collapsed })
  }

  function begin(event: React.DragEvent, id: string, group: boolean) {
    event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); setDrag({ id, group })
  }
  function shortcut(entry: SidebarEntry) {
    const href = targetHref(entry.target)
    const active = router.asPath === href || entry.target.kind === 'native' && router.pathname === href
    return <Link key={entry.id} data-shortcut={entry.id} href={href} draggable={!pending} onDragStart={event => begin(event, entry.id, false)}
      onDragOver={event => { if (drag && !drag.group) { event.preventDefault(); event.stopPropagation(); setOver(entry.id) } }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); if (drag && !drag.group) void mutate({ kind: 'sidebar.place', id: drag.id, beforeId: entry.id, groupId: entry.groupId ?? null }); setDrag(null); setOver(null) }}
      onKeyDown={event => {
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); void mutate({ kind: 'sidebar.move', id: entry.id, direction: event.key === 'ArrowUp' ? -1 : 1 }) }
        if (event.altKey && event.key === 'Delete') { event.preventDefault(); void mutate({ kind: 'sidebar.remove', id: entry.id }) }
      }}
      aria-label={entry.label} title={collapsed ? entry.label : 'Glisser pour déplacer · Alt + flèches au clavier'} className={`sidebar-shortcut ${active ? 'is-active' : ''} ${over === entry.id ? 'drop-before' : ''} ${collapsed ? 'justify-center' : ''} ${drag?.id === entry.id ? 'opacity-40' : ''}`}><ShortcutIcon name={entry.icon} size={17} />{!collapsed && <span className="truncate">{entry.label}</span>}</Link>
  }

  return (
    <aside
      className={`flex-shrink-0 border-r border-border flex flex-col p-3.5 gap-1 bg-surface amber-sidebar transition-[width] duration-150 ${
        collapsed ? 'w-[64px]' : 'w-[236px]'
      }`}
    >
      <div className={`flex items-center gap-2.5 pb-5 ${collapsed ? 'justify-center' : 'px-1.5'}`}>
        <img src="/images/logo.png" width={40} height={40} alt={collapsed ? 'amber' : ''} className="amber-mark h-10 w-10 shrink-0 object-contain" draggable={false} />
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-bold text-[22px] tracking-[-0.04em] leading-tight">amber</div>
            <div className="text-[11px] text-text-muted leading-tight">projets & idées</div>
          </div>
        )}
      </div>
      <nav aria-label="Shortcuts" className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto" onDragEnd={() => { setDrag(null); setOver(null) }}>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {snapshot ? <>
          <div className={`min-h-3 ${over === 'root' ? 'sidebar-drop-over' : ''}`} onDragOver={event => { if (drag && !drag.group) { event.preventDefault(); setOver('root') } }} onDrop={event => { event.preventDefault(); if (drag && !drag.group) void mutate({ kind: 'sidebar.place', id: drag.id, beforeId: null, groupId: null }); setDrag(null); setOver(null) }}>
            {snapshot.sidebar.filter(entry => !entry.hidden && !entry.groupId).map(entry => shortcut(entry))}
          </div>
          {(snapshot.sidebarGroups ?? []).map(group => <section key={group.id} className={over === group.id ? 'sidebar-drop-over' : ''} onDragOver={event => { if (drag) { event.preventDefault(); setOver(group.id) } }} onDrop={event => {
            event.preventDefault(); event.stopPropagation()
            if (drag) void mutate(drag.group ? { kind: 'sidebar.group.place', id: drag.id, beforeId: group.id } : { kind: 'sidebar.place', id: drag.id, beforeId: null, groupId: group.id })
            setDrag(null); setOver(null)
          }}>
            <div className="sidebar-group-heading" draggable={!pending && renaming !== group.id} onDragStart={event => begin(event, group.id, true)}>
              <button className="sidebar-group-toggle" disabled={pending} aria-expanded={!group.collapsed} aria-label={`Groupe ${group.name}`} title={group.collapsed ? 'Déplier le groupe' : 'Replier le groupe'} onClick={() => void mutate({ kind: 'sidebar.group.update', id: group.id, name: group.name, collapsed: !group.collapsed })}>{group.collapsed ? '▸' : '▾'}</button>
              {!collapsed && (renaming === group.id ? <input className="sidebar-group-name" aria-label="Nom du groupe" autoFocus defaultValue={group.name} maxLength={80}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }; if (event.key === 'Escape') { event.currentTarget.dataset.cancelled = 'true'; setRenaming(null) } }}
                onBlur={event => { if (event.currentTarget.dataset.cancelled !== 'true' && event.target.value.trim() && event.target.value.trim() !== group.name) void mutate({ kind: 'sidebar.group.update', id: group.id, name: event.target.value, collapsed: group.collapsed }); setRenaming(null) }} />
                : <button className="sidebar-group-name" disabled={pending} aria-label={`Renommer ${group.name}`} title="Cliquer sur le nom pour le renommer" onClick={() => setRenaming(group.id)}>{group.name}</button>)}
            </div>
            {(!group.collapsed || collapsed) && snapshot.sidebar.filter(entry => !entry.hidden && entry.groupId === group.id).map(entry => shortcut(entry))}
            {!group.collapsed && !collapsed && !snapshot.sidebar.some(entry => entry.groupId === group.id && !entry.hidden) && <p className="text-[11px] text-text-faint px-3 py-2">Déposer un shortcut ici</p>}
          </section>)}
        </> : NAV_ITEMS.filter(item => item.href !== '/settings').map(item => <Link key={item.href} href={item.href} className="sidebar-shortcut" aria-label={item.label}><item.icon size={17} />{!collapsed && item.label}</Link>)}
        <button className="sidebar-add mt-3" aria-label="Add a shortcut" title="Ajouter un shortcut ou un groupe" onClick={() => setAdding(true)}><span aria-hidden="true">＋</span>{!collapsed && 'Add a shortcut'}</button>
        <div className="mt-auto pt-4 flex flex-col gap-1">{[{ href: '/customize', label: 'Personnalisation' }, { href: '/settings', label: 'Réglages' }].map(item => <Link key={item.href} href={item.href} aria-label={item.label} title={item.label} className={`sidebar-shortcut ${router.pathname === item.href ? 'is-active' : ''} ${collapsed ? 'justify-center' : ''}`}><SettingsIcon size={17} />{!collapsed && item.label}</Link>)}</div>
      </nav>
      {adding && <ShortcutEditor onClose={() => setAdding(false)} />}
      <DropTrash active={!!drag} onDrop={() => { if (drag) void mutate(drag.group ? { kind: 'sidebar.group.remove', id: drag.id } : { kind: 'sidebar.remove', id: drag.id }); setDrag(null); setOver(null) }} />
      <button
        type="button"
        onClick={cycleTheme}
        title={`Changer le thème : ${themeLabel}`} aria-label={`Changer le thème : ${themeLabel}`}
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
        title={collapsed ? 'Agrandir' : 'Réduire'} aria-label={collapsed ? 'Agrandir' : 'Réduire'}
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
