import type { ContributionRef, InstanceBinding } from './bindings'
import type { SidebarTarget } from './navigation'
import type { PermissionSet } from './permissions'
import type { HostIcon } from './version'

// Persisted composition models. A placement (block in a project, widget on a
// dashboard) has its own identity; it is never reused as an instance identity
// and never stores business data of the instance it shows.

export interface PlacementConfig {
  version: number
  values: Record<string, unknown>
}

export interface ProjectBlockPlacement {
  projectId: string
  // Unique within its project only (legacy ids such as "mod_tasks" repeat
  // across projects).
  placementId: string
  contribution: ContributionRef
  position: number
  config: PlacementConfig
  binding: InstanceBinding
  revision: number
}

export const GRID_BREAKPOINTS = {
  lg: { minWidth: 1200, cols: 12 },
  md: { minWidth: 800, cols: 6 },
  sm: { minWidth: 0, cols: 1 },
} as const
export type GridBreakpoint = keyof typeof GRID_BREAKPOINTS
export const BREAKPOINT_ORDER: GridBreakpoint[] = ['lg', 'md', 'sm']

export interface GridRect {
  x: number
  y: number
  w: number
  h: number
}

export function breakpointForWidth(width: number): GridBreakpoint {
  return BREAKPOINT_ORDER.find((name) => width >= GRID_BREAKPOINTS[name].minWidth) ?? 'sm'
}

export interface DashboardWidgetPlacement {
  dashboardId: string
  placementId: string
  contribution: ContributionRef
  config: PlacementConfig
  binding: InstanceBinding
  // One layout per breakpoint; a missing one is derived without overwriting
  // the layout of a wider screen.
  layouts: Partial<Record<GridBreakpoint, GridRect>>
  revision: number
}

export interface Dashboard {
  id: string
  name: string
  position: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
  revision: number
  widgets: DashboardWidgetPlacement[]
}

export interface SidebarGroup { id: string; name: string; collapsed: boolean }

export interface SidebarEntry {
  groupId?: string | null
  id: string
  label: string
  icon: HostIcon
  target: SidebarTarget
  hidden: boolean
  position: number
  // Key of the default entry this one comes from, if any (used by "restore").
  defaultKey: string | null
  revision: number
}

export interface MajorInstance {
  packageId: string
  majorId: string
  instanceId: string
  name: string
  position: number
  createdAt: string
  updatedAt: string
  revision: number
}

export type PackageOrigin = 'bundled' | 'archive' | 'folder'
export type PackageState =
  // Installed, its contributions may run.
  | 'active'
  // Disabled by the user.
  | 'disabled'
  // Waiting for a dependency, a target or a permission agreement.
  | 'suspended'
  // Code removed, data kept.
  | 'uninstalled'

export interface InstalledPackage {
  id: string
  kind: 'package' | 'extension'
  name: string
  author: string
  activeVersion: string
  state: PackageState
  // Reason shown when the package is suspended.
  stateReason: string | null
  origin: PackageOrigin
  contentFingerprint: string
  sourceFingerprint: string
  storageVersion: number
  grantedPermissions: PermissionSet
  installedAt: string
  updatedAt: string
  revision: number
}

export interface AppPreferences {
  themeMode: 'system' | 'light' | 'dark'
  sidebarCollapsed: boolean
  collapsedCategoryFolders: string[]
  pinnedTabs: { projectId: string; pinned: boolean }[]
  activeTabId: string | null
}

export function defaultPreferences(): AppPreferences {
  return { themeMode: 'system', sidebarCollapsed: false, collapsedCategoryFolders: [], pinnedTabs: [], activeTabId: null }
}

export interface AppSettings {
  // Path or name of the executable invoked for AI features.
  aiCommand: string
}

export function defaultSettings(): AppSettings {
  return { aiCommand: 'groqtool' }
}
