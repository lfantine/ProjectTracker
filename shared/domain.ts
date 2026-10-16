import type { ContributionRef, InstanceBinding } from './bindings'
import type { WeekPreset, WeekSlot } from './week'

// Domain model of the native core (projects, notes, errors and project
// blocks). Shared by the main process, the renderer and the legacy importer.

export type ProjectStatus = 'actif' | 'pause' | 'termine' | 'aborted'
export type ProjectType = 'dev' | 'video'
export type FolderKind = 'manual' | 'smart'
export type FolderDisplayMode = 'category' | 'group'
export type TaskStatus = 'a_faire' | 'en_cours' | 'fait'
export type ChecklistStatus =
  | 'a_faire'
  | 'en_cours'
  | 'fait'
  | 'bloque'
  | 'a_acheter'
  | 'commande'
  | 'achete'
  | 'a_venir'
  | 'annule'
  | 'en_attente'
  | 'pret'
export type ChecklistType = 'generique' | 'materiel' | 'projet' | 'evenement'
export type DeadlineStatus = 'a_venir' | 'fait' | 'depasse'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface TaskNode {
  id: string
  name: string
  content: string
  status: TaskStatus
  children: TaskNode[]
}

export interface ChecklistItem {
  id: string
  label: string
  type: ChecklistType
  status: ChecklistStatus
  link?: string
  projectRef?: string
  date?: string
  description?: string
}

export interface Deadline {
  id: string
  label: string
  date: string
  status: DeadlineStatus
}

export interface ProjectLink {
  id: string
  title: string
  url: string
}

export interface ProjectFolder {
  id: string
  name: string
  kind: FolderKind
  displayMode: FolderDisplayMode
  description?: string // shown on the folder's card in "group" display mode
  tagFilter?: string[] // smart folders only: match projects with ANY of these tags
  revision?: number
}

// 'external': block provided by a package (or of a type this version does not
// know). It is kept with its raw configuration and rendered by the package
// host, or as an unavailable placement.
export type ModuleType = 'stack' | 'tasks' | 'deadlines' | 'note' | 'error' | 'image' | 'chart' | 'table' | 'external'

export type ChartKind = 'bar' | 'line'

export interface ChartPoint {
  id: string
  label: string
  // Kept as typed text so partial input ("-", "1,") survives editing.
  value: string
}

export interface ChartConfig {
  kind: ChartKind
  points: ChartPoint[]
}

export interface TableColumn {
  id: string
  label: string
  type: 'text' | 'date' | 'url' | 'select'
  options?: string[]
}

export interface TableRow {
  id: string
  cells: Record<string, string>
  contact?: string
  notes?: string
  history?: { date: string; text: string }[]
}

export interface TableConfig {
  columns: TableColumn[]
  rows: TableRow[]
}

export interface ProjectModule {
  id: string
  type: ModuleType
  refId?: string
  title?: string
  imageUrl?: string
  text?: string
  customize_title?: boolean
  table?: TableConfig
  chart?: ChartConfig
  // External blocks only.
  contribution?: ContributionRef
  binding?: InstanceBinding
  config?: Record<string, unknown>
}

export function defaultProjectLayout(): ProjectModule[] {
  return [
    { id: 'mod_tasks', type: 'tasks' },
    { id: 'mod_deadlines', type: 'deadlines' },
  ]
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  category: string
  platforms: string[]
  tags: string[]
  folderId?: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
  description?: string
  stack?: string[]
  path?: string
  noteIds: string[]
  errorIds: string[]
  checklist: ChecklistItem[]
  tasks: TaskNode[]
  deadlines: Deadline[]
  links: ProjectLink[]
  layout: ProjectModule[]
  // Revision of the stored project, set by the main process.
  revision?: number
}

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  raw?: boolean
  createdAt: string
  updatedAt: string
  revision?: number
}

export interface ErrorEntry {
  id: string
  title: string
  content: string
  causes: string
  solution: string
  createdAt: string
  projectIds: string[]
  revision?: number
}

export interface TrashedNote {
  note: Note
  deletedAt: string
  links: { projectId: string; modules: ProjectModule[] }[]
}

export interface AppData {
  weekPresets?: WeekPreset[]
  activeWeekPresetId?: string
  wakeTimes?: string[]
  weekSlots?: WeekSlot[]
  categories: string[]
  platforms: Record<ProjectType, string[]>
  folders: ProjectFolder[]
  projects: Project[]
  notes: Note[]
  errors: ErrorEntry[]
  trashedNotes?: TrashedNote[]
}
