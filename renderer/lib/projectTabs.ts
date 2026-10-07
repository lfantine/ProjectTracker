export interface ProjectTab {
  projectId: string
  pinned: boolean
}

export interface ProjectTabSession {
  tabs: ProjectTab[]
  activeId?: string
}

export function readProjectTabSession(raw: unknown, projectIds: string[]): ProjectTabSession {
  const session = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const seen = new Set<string>()
  const tabs: ProjectTab[] = []
  for (const value of Array.isArray(session.tabs) ? session.tabs : []) {
    if (!value || typeof value !== 'object') continue
    const tab = value as Record<string, unknown>
    if (typeof tab.projectId !== 'string' || !projectIds.includes(tab.projectId) || seen.has(tab.projectId)) continue
    seen.add(tab.projectId)
    tabs.push({ projectId: tab.projectId, pinned: tab.pinned === true })
  }
  return { tabs, activeId: typeof session.activeId === 'string' && seen.has(session.activeId) ? session.activeId : undefined }
}

export function openProjectTab(tabs: ProjectTab[], projectId: string): ProjectTab[] {
  return tabs.some((tab) => tab.projectId === projectId) ? tabs : [...tabs, { projectId, pinned: false }]
}

export function closeProjectTab(tabs: ProjectTab[], projectId: string): ProjectTab[] {
  return tabs.filter((tab) => tab.projectId !== projectId || tab.pinned)
}

export function projectTabForShortcut(tabs: ProjectTab[], key: string): string | undefined {
  return /^[1-9]$/.test(key) ? tabs[Number(key) - 1]?.projectId : undefined
}
