import type { ContributionRef } from './bindings'
import { BUILTIN_WEEK_ID, CORE_PACKAGE_ID } from './ids'
import type { GridRect } from './models'
import type { HostIcon } from './version'

// Registry of the native core contributions. They are rendered by trusted
// adapters in the renderer, not loaded from files.

export const CORE_BLOCK_TYPES = ['stack', 'tasks', 'deadlines', 'note', 'error', 'image', 'chart', 'table'] as const
export type CoreBlockType = (typeof CORE_BLOCK_TYPES)[number]

export function isCoreBlockType(value: unknown): value is CoreBlockType {
  return typeof value === 'string' && (CORE_BLOCK_TYPES as readonly string[]).includes(value)
}

export const CORE_WIDGETS = {
  'stat-active-projects': { name: 'Projets actifs', size: { w: 3, h: 2 } },
  'stat-total-projects': { name: 'Projets au total', size: { w: 3, h: 2 } },
  'stat-open-tasks': { name: 'Tâches ouvertes', size: { w: 3, h: 2 } },
  'stat-stalest-project': { name: 'Projet sans activité', size: { w: 3, h: 2 } },
  tips: { name: 'Conseils du jour', size: { w: 12, h: 4 } },
  deadlines: { name: 'Échéances', size: { w: 8, h: 6 } },
  'recent-projects': { name: 'Projets récents', size: { w: 12, h: 6 } },
  activity: { name: 'Activité récente', size: { w: 8, h: 6 } },
} as const satisfies Record<string, { name: string; size: Pick<GridRect, 'w' | 'h'> }>
export type CoreWidgetId = keyof typeof CORE_WIDGETS

export function isCoreWidget(value: unknown): value is CoreWidgetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CORE_WIDGETS, value)
}

export function coreBlockRef(type: CoreBlockType): ContributionRef {
  return { packageId: CORE_PACKAGE_ID, contributionId: type }
}

export function coreWidgetRef(id: CoreWidgetId): ContributionRef {
  return { packageId: CORE_PACKAGE_ID, contributionId: id }
}

// Contributions of the builtin "Semaine type" package. They are declared by its
// manifest; these constants only name them for the host (default dashboard,
// sidebar, legacy importer).
export const WEEK_MAJOR: ContributionRef = { packageId: BUILTIN_WEEK_ID, contributionId: 'planner' }
export const WEEK_PROJECT_MINOR: ContributionRef = { packageId: BUILTIN_WEEK_ID, contributionId: 'project-slots' }
export const WEEK_TODAY_WIDGET: ContributionRef = { packageId: BUILTIN_WEEK_ID, contributionId: 'today' }
// Private storage of the week package: one document per instance.
export const WEEK_COLLECTION = 'week'
export const WEEK_DOCUMENT_ID = 'schedule'
export const WEEK_EXPORT_ID = 'week-slots'
export const WEEK_SUMMARY_SLOT = 'summary'

// Default sidebar of the application, in order. "Restore defaults" recreates
// the missing ones without touching custom entries or dashboards.
export interface DefaultSidebarEntry {
  key: string
  label: string
  icon: HostIcon
  target:
    | { kind: 'native'; page: 'projects' | 'marketplace' | 'notes' | 'errors' | 'search' | 'settings' }
    | { kind: 'default-dashboard' }
    | { kind: 'major'; major: ContributionRef }
}

export const DEFAULT_SIDEBAR: DefaultSidebarEntry[] = [
  { key: 'week', label: 'Semaine type', icon: 'calendar', target: { kind: 'major', major: WEEK_MAJOR } },
  { key: 'home', label: 'Accueil', icon: 'home', target: { kind: 'default-dashboard' } },
  { key: 'projects', label: 'Projets', icon: 'folder', target: { kind: 'native', page: 'projects' } },
  { key: 'marketplace', label: 'Marketplace', icon: 'store', target: { kind: 'native', page: 'marketplace' } },
  { key: 'notes', label: 'Notes', icon: 'note', target: { kind: 'native', page: 'notes' } },
  { key: 'errors', label: 'Erreurs', icon: 'alert', target: { kind: 'native', page: 'errors' } },
  { key: 'search', label: 'Recherche', icon: 'search', target: { kind: 'native', page: 'search' } },
]

// The default "Accueil" dashboard reproduces the former fixed home page.
export interface DefaultDashboardWidget {
  contribution: ContributionRef
  lg: GridRect
}

export const DEFAULT_HOME_WIDGETS: DefaultDashboardWidget[] = [
  { contribution: coreWidgetRef('stat-active-projects'), lg: { x: 0, y: 0, w: 2, h: 2 } },
  { contribution: coreWidgetRef('stat-total-projects'), lg: { x: 2, y: 0, w: 2, h: 2 } },
  { contribution: coreWidgetRef('stat-open-tasks'), lg: { x: 4, y: 0, w: 2, h: 2 } },
  { contribution: coreWidgetRef('stat-stalest-project'), lg: { x: 6, y: 0, w: 3, h: 2 } },
  { contribution: WEEK_TODAY_WIDGET, lg: { x: 9, y: 0, w: 3, h: 12 } },
  { contribution: coreWidgetRef('tips'), lg: { x: 0, y: 2, w: 9, h: 4 } },
  { contribution: coreWidgetRef('deadlines'), lg: { x: 0, y: 6, w: 9, h: 5 } },
  { contribution: coreWidgetRef('recent-projects'), lg: { x: 0, y: 11, w: 9, h: 5 } },
  { contribution: coreWidgetRef('activity'), lg: { x: 0, y: 16, w: 9, h: 5 } },
]
