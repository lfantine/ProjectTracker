import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useData } from '../lib/store'
import { closeProjectTab, openProjectTab, projectTabForShortcut, readProjectTabSession, type ProjectTabSession } from '../lib/projectTabs'
import { XIcon } from './icons'


export function ProjectTabs() {
  const router = useRouter()
  const { data, loading, preferences, updatePreferences } = useData()
  const [session, setSession] = useState<ProjectTabSession>({ tabs: [] })
  const [ready, setReady] = useState(false)
  const restored = useRef(false)
  const restoringTarget = useRef<string | null>(null)
  const activeId = router.pathname === '/project' && typeof router.query.id === 'string' ? router.query.id : undefined

  useEffect(() => {
    if (loading || !router.isReady || restored.current) return
    restored.current = true
    const saved = readProjectTabSession({ tabs: preferences.pinnedTabs, activeId: preferences.activeTabId }, data.projects.map((project) => project.id))
    saved.tabs = saved.tabs.filter((tab) => tab.pinned)
    if (!saved.tabs.some((tab) => tab.projectId === saved.activeId)) saved.activeId = undefined
    if (activeId && data.projects.some((project) => project.id === activeId)) {
      saved.tabs = openProjectTab(saved.tabs, activeId)
      saved.activeId = activeId
    } else if (router.pathname === '/home' && saved.activeId) {
      restoringTarget.current = saved.activeId
      void router.replace(`/project?id=${encodeURIComponent(saved.activeId)}`)
    }
    setSession(saved)
    setReady(true)
  }, [loading, router.isReady, activeId, data.projects, router, preferences])

  useEffect(() => {
    if (!ready || loading) return
    setSession((previous) => {
      const cleaned = readProjectTabSession({ tabs: preferences.pinnedTabs, activeId: previous.activeId }, data.projects.map((project) => project.id))
      if (activeId && data.projects.some((project) => project.id === activeId)) {
        cleaned.tabs = openProjectTab(cleaned.tabs, activeId)
        cleaned.activeId = activeId
      } else {
        cleaned.tabs = cleaned.tabs.filter((tab) => tab.pinned)
        cleaned.activeId = undefined
      }
      return JSON.stringify(cleaned) === JSON.stringify(previous) ? previous : cleaned
    })
  }, [ready, loading, activeId, data.projects, preferences.pinnedTabs])

  // Persist the active pinned tab only on navigation; failed writes must not
  // trigger an effect loop or clear the restored target before routing finishes.
  const lastRoute = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || loading) return
    if (restoringTarget.current) {
      if (activeId !== restoringTarget.current) return
      restoringTarget.current = null
    }
    const route = `${router.pathname}:${activeId ?? ''}`
    if (lastRoute.current === route) return
    lastRoute.current = route
    const pinned = session.tabs.some((tab) => tab.projectId === activeId && tab.pinned)
    const next = pinned ? activeId! : null
    if (preferences.activeTabId !== next) void updatePreferences({ activeTabId: next })
  }, [ready, loading, router.pathname, activeId, session.tabs, preferences.activeTabId, updatePreferences])

  async function togglePin(projectId: string) {
    const pins = session.tabs.map((entry) => entry.projectId === projectId ? { ...entry, pinned: !entry.pinned } : entry).filter((entry) => entry.pinned)
    await updatePreferences({ pinnedTabs: pins, activeTabId: pins.some((entry) => entry.projectId === activeId) ? activeId! : null })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return
      if (document.querySelector('[aria-modal="true"]:not([data-allow-project-switch="true"])')) return
      const digit = /^[1-9]$/.test(event.key) ? event.key : /^Digit[1-9]$/.test(event.code) ? event.code.slice(-1) : event.key
      const projectId = projectTabForShortcut(session.tabs, digit)
      if (projectId) {
        event.preventDefault()
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        void router.push(`/project?id=${encodeURIComponent(projectId)}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session.tabs, router])

  function closeTab(projectId: string) {
    const index = session.tabs.findIndex((tab) => tab.projectId === projectId)
    if (session.tabs[index]?.pinned) return
    const tabs = closeProjectTab(session.tabs, projectId)
    const nextId = tabs[Math.min(index, tabs.length - 1)]?.projectId
    setSession({ tabs, activeId: session.activeId === projectId ? nextId : session.activeId })
    if (activeId === projectId) void router.push(nextId ? `/project?id=${encodeURIComponent(nextId)}` : '/projects')
  }

  if (!ready || !session.tabs.length) return null
  return (
    <nav aria-label="Projets ouverts" className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 pt-2 flex-shrink-0">
      {session.tabs.map((tab, index) => {
        const project = data.projects.find((project) => project.id === tab.projectId)
        if (!project) return null
        return <div key={tab.projectId} className={`flex items-center gap-1 rounded-t-lg border border-b-0 px-2 py-2 min-w-0 flex-shrink-0 ${activeId === tab.projectId ? 'border-accent bg-accent-soft text-accent-soft-text' : 'border-border text-text-muted hover:bg-surface-hover'}`}>
          <button type="button" onClick={() => void router.push(`/project?id=${encodeURIComponent(tab.projectId)}`)} title={index < 9 ? `Ouvrir ${project.name} (⌘${index + 1} / Ctrl+${index + 1})` : `Ouvrir ${project.name}`} aria-label={index < 9 ? `Ouvrir ${project.name} (⌘${index + 1} / Ctrl+${index + 1})` : `Ouvrir ${project.name}`} aria-current={activeId === tab.projectId ? 'page' : undefined} className="flex items-center gap-2 cursor-pointer text-[13px] font-semibold">
            {index < 9 && <kbd className="text-[10px] text-text-faint">{index + 1}</kbd>}
            <span className="max-w-44 truncate" title={project.name}>{project.name}</span>
          </button>
          <button type="button" aria-label={`${tab.pinned ? 'Désépingler' : 'Épingler'} ${project.name}`} aria-pressed={tab.pinned} title={tab.pinned ? 'Désépingler : fermer cet onglet en quittant le projet' : 'Épingler : garder cet onglet ouvert'} onClick={() => void togglePin(tab.projectId)} className={`text-xs p-1 cursor-pointer ${tab.pinned ? 'text-accent-soft-text' : 'text-text-faint'}`}>{tab.pinned ? '◆' : '◇'}</button>
          {!tab.pinned && <button type="button" aria-label={`Fermer ${project.name}`} title={`Fermer l’onglet ${project.name}`} onClick={() => closeTab(tab.projectId)} className="text-text-faint hover:text-text p-1 cursor-pointer"><XIcon size={13} /></button>}
        </div>
      })}
    </nav>
  )
}
