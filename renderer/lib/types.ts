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
}

export type ModuleType = 'stack' | 'tasks' | 'deadlines' | 'note' | 'error' | 'image'

export interface ProjectModule {
  id: string
  type: ModuleType
  refId?: string
  title?: string
  imageUrl?: string
  text?: string
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
}

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  raw?: boolean
  createdAt: string
  updatedAt: string
}

export interface ErrorEntry {
  id: string
  title: string
  content: string
  causes: string
  solution: string
  createdAt: string
  projectIds: string[]
}

export interface AppData {
  categories: string[]
  platforms: Record<ProjectType, string[]>
  folders: ProjectFolder[]
  projects: Project[]
  notes: Note[]
  errors: ErrorEntry[]
}

const DEFAULT_PLATFORMS: Record<ProjectType, string[]> = {
  dev: ['PC', 'Tablette', 'Mobile', 'Docker', 'Embarqué', 'Personnel'],
  video: ['YouTube', 'Instagram', 'TikTok', 'Twitch', 'LinkedIn', 'Autre'],
}

export function emptyAppData(): AppData {
  return {
    categories: ['Hardware', 'Software', 'Mobile'],
    platforms: { dev: [...DEFAULT_PLATFORMS.dev], video: [...DEFAULT_PLATFORMS.video] },
    folders: [],
    projects: [],
    notes: [],
    errors: [],
  }
}

// Migrates on-disk data saved before ProjectType/folders/tags existed:
// `platforms` used to be a flat string[] and projects had no `type`/`tags`.
export function normalizeAppData(raw: unknown): AppData {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppData> & {
    platforms?: string[] | Record<ProjectType, string[]>
  }
  const platforms: Record<ProjectType, string[]> = Array.isArray(data.platforms)
    ? { dev: data.platforms, video: [...DEFAULT_PLATFORMS.video] }
    : {
        dev: data.platforms?.dev ?? [...DEFAULT_PLATFORMS.dev],
        video: data.platforms?.video ?? [...DEFAULT_PLATFORMS.video],
      }
  return {
    categories: data.categories ?? ['Hardware', 'Software', 'Mobile'],
    platforms,
    folders: (data.folders ?? []).map((f) => ({ ...f, displayMode: f.displayMode ?? 'category' })),
    projects: (data.projects ?? []).map((p) => ({
      ...p,
      type: p.type ?? 'dev',
      tags: p.tags ?? [],
    })),
    notes: data.notes ?? [],
    errors: data.errors ?? [],
  }
}
