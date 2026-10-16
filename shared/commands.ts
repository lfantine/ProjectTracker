import type {
  AppData,
  ChecklistItem,
  ChecklistStatus,
  ChecklistType,
  Deadline,
  ErrorEntry,
  FolderDisplayMode,
  FolderKind,
  Note,
  Project,
  ProjectFolder,
  ProjectModule,
  ProjectType,
  TaskNode,
  TrashedNote,
} from './domain'
import type { ErrorPayload } from './errors'
import type { AppPreferences, AppSettings } from './models'
import type { WeekPreset, WeekSlot } from './week'

// Targeted native commands. The renderer never sends a global snapshot: each
// command names the entity it changes, runs in one main-process transaction and
// returns the confirmed changes. No command accepts SQL or a free-form table.

export type TaskDropPosition = 'before' | 'after' | 'inside'

export interface NewProjectInput {
  name: string
  type: ProjectType
  category: string
  platforms: string[]
  tags?: string[]
  noteIds?: string[]
  errorIds?: string[]
  checklist?: ChecklistItem[]
  tasks?: TaskNode[]
  deadlines?: Deadline[]
}

// Collections (tasks, checklist, deadlines, links, layout) are replaced as a
// whole for this project only, in the same transaction.
export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'type' | 'category' | 'platforms' | 'tags' | 'folderId' | 'status' | 'description' | 'stack' | 'path' | 'tasks' | 'checklist' | 'deadlines' | 'links' | 'layout'>
>

export interface NativeBatchStep {
  name: Exclude<NativeCommandName, 'core.batch'>
  params: Record<string, unknown>
  bindings?: { field: 'id' | 'projectId' | 'noteId' | 'errorId' | 'block.refId'; resultIndex: number }[]
}

interface NativeCommandDefinitions {
  'core.batch': { params: { steps: NativeBatchStep[]; operationId: string }; result: unknown[] }

  'projects.create': { params: { input: NewProjectInput; operationId: string }; result: Project }
  'projects.update': { params: { id: string; patch: ProjectPatch; expectedRevision?: number }; result: Project }
  'projects.delete': { params: { id: string }; result: { deleted: boolean } }
  'projects.touchOpened': { params: { id: string }; result: Project }
  'projects.linkNote': { params: { projectId: string; noteId: string }; result: Project }
  'projects.unlinkNote': { params: { projectId: string; noteId: string }; result: Project }
  'projects.linkError': { params: { projectId: string; errorId: string }; result: Project }
  'projects.unlinkError': { params: { projectId: string; errorId: string }; result: Project }

  'folders.create': { params: { input: { name: string; kind: FolderKind; displayMode: FolderDisplayMode; description?: string; tagFilter?: string[] }; operationId: string }; result: ProjectFolder }
  'folders.update': { params: { id: string; patch: Partial<Pick<ProjectFolder, 'name' | 'description' | 'displayMode' | 'tagFilter'>> }; result: ProjectFolder }
  'folders.delete': { params: { id: string }; result: { deleted: boolean } }

  'notes.create': { params: { input: { title: string; content: string; tags: string[] }; operationId: string }; result: Note }
  'notes.update': { params: { id: string; patch: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'raw'>>; expectedRevision?: number }; result: Note }
  'notes.trash': { params: { id: string }; result: TrashedNote | null }
  'notes.restore': { params: { id: string }; result: Note | null }

  'errors.create': { params: { input: { title: string; content: string; causes: string; solution: string; projectIds: string[] }; operationId: string }; result: ErrorEntry }
  'errors.update': { params: { id: string; patch: Partial<Pick<ErrorEntry, 'title' | 'content' | 'causes' | 'solution'>>; expectedRevision?: number }; result: ErrorEntry }
  'errors.delete': { params: { id: string }; result: { deleted: boolean } }

  'checklist.add': { params: { projectId: string; item: { label: string; type: ChecklistType; link?: string; projectRef?: string; date?: string; description?: string } }; result: ChecklistItem }
  'checklist.update': { params: { projectId: string; itemId: string; patch: Partial<Omit<ChecklistItem, 'id'>> }; result: ChecklistItem }
  'checklist.cycleStatus': { params: { projectId: string; itemId: string }; result: ChecklistItem }
  'checklist.setStatus': { params: { projectId: string; itemId: string; status: ChecklistStatus }; result: ChecklistItem }
  'checklist.remove': { params: { projectId: string; itemId: string }; result: { deleted: boolean } }

  'tasks.add': { params: { projectId: string; name: string; parentId?: string }; result: TaskNode }
  'tasks.update': { params: { projectId: string; taskId: string; patch: Partial<Pick<TaskNode, 'name' | 'content' | 'status'>> }; result: TaskNode }
  'tasks.cycleStatus': { params: { projectId: string; taskId: string }; result: TaskNode }
  'tasks.remove': { params: { projectId: string; taskId: string }; result: { deleted: boolean } }
  'tasks.move': { params: { projectId: string; draggedId: string; targetId: string; position: TaskDropPosition }; result: { moved: boolean } }

  'deadlines.add': { params: { projectId: string; label: string; date: string }; result: Deadline }
  'deadlines.toggleDone': { params: { projectId: string; deadlineId: string }; result: Deadline }
  'deadlines.remove': { params: { projectId: string; deadlineId: string }; result: { deleted: boolean } }

  'links.add': { params: { projectId: string; input: { title: string; url: string } }; result: { id: string; title: string; url: string } }
  'links.update': { params: { projectId: string; linkId: string; patch: { title?: string; url?: string } }; result: { id: string; title: string; url: string } }
  'links.remove': { params: { projectId: string; linkId: string }; result: { deleted: boolean } }

  'blocks.setLayout': { params: { projectId: string; layout: ProjectModule[] }; result: ProjectModule[] }
  'blocks.add': { params: { projectId: string; block: ProjectModule }; result: ProjectModule[] }
  'blocks.remove': { params: { projectId: string; blockId: string }; result: ProjectModule[] }
  'blocks.update': { params: { projectId: string; blockId: string; patch: Partial<ProjectModule> }; result: ProjectModule[] }
  'blocks.toggleNote': { params: { projectId: string; noteId: string }; result: ProjectModule[] }

  'taxonomy.addCategory': { params: { name: string }; result: string[] }
  'taxonomy.addPlatform': { params: { type: ProjectType; name: string }; result: Record<ProjectType, string[]> }

  // Temporary facade for the former week screen; data lives in the
  // builtin.week package storage.
  'week.setSlots': { params: { slots: WeekSlot[] }; result: WeekFacade }
  'week.setWakeTimes': { params: { wakeTimes: string[] }; result: WeekFacade }
  'week.select': { params: { id: string }; result: WeekFacade }
  'week.create': { params: { name: string; copy: boolean; operationId: string }; result: WeekFacade }
  'week.rename': { params: { name: string }; result: WeekFacade }

  'settings.get': { params: Record<string, never>; result: AppSettings }
  'settings.update': { params: { patch: Partial<AppSettings> }; result: AppSettings }
  'preferences.update': { params: { patch: Partial<AppPreferences> }; result: AppPreferences }
  // One-time adoption of the preferences formerly kept in localStorage.
  'preferences.adoptLegacy': { params: { values: Record<string, string | null> }; result: { adopted: boolean; preferences: AppPreferences } }
}

// Optimistic concurrency applies to the owning aggregate: project children
// share the project revision; preferences/settings/week use the snapshot revision.
export type NativeCommands = {
  [K in keyof NativeCommandDefinitions]: {
    params: NativeCommandDefinitions[K]['params'] & { expectedRevision?: number }
    result: NativeCommandDefinitions[K]['result']
  }
}

export function commandRevisionTarget(name: string, params: Record<string, unknown>): { table: 'projects' | 'notes' | 'errors' | 'folders' | 'trashed_notes'; id: string } | 'snapshot' | null {
  if (name === 'core.batch' || name.endsWith('.create') || name === 'projects.touchOpened' || name === 'settings.get' || name === 'preferences.adoptLegacy') return null
  if (typeof params.projectId === 'string') return { table: 'projects', id: params.projectId }
  const tables = { projects: 'projects', notes: 'notes', errors: 'errors', folders: 'folders' } as const
  const group = name.split('.')[0] as keyof typeof tables
  if (typeof params.id === 'string' && group in tables) return { table: name === 'notes.restore' ? 'trashed_notes' : tables[group], id: params.id }
  return 'snapshot'
}

export type NativeCommandName = keyof NativeCommands
export type CommandParams<K extends NativeCommandName> = NativeCommands[K]['params']
export type CommandValue<K extends NativeCommandName> = NativeCommands[K]['result']

export const NATIVE_COMMAND_NAMES = [
  'core.batch',
  'projects.create', 'projects.update', 'projects.delete', 'projects.touchOpened',
  'projects.linkNote', 'projects.unlinkNote', 'projects.linkError', 'projects.unlinkError',
  'folders.create', 'folders.update', 'folders.delete',
  'notes.create', 'notes.update', 'notes.trash', 'notes.restore',
  'errors.create', 'errors.update', 'errors.delete',
  'checklist.add', 'checklist.update', 'checklist.cycleStatus', 'checklist.setStatus', 'checklist.remove',
  'tasks.add', 'tasks.update', 'tasks.cycleStatus', 'tasks.remove', 'tasks.move',
  'deadlines.add', 'deadlines.toggleDone', 'deadlines.remove',
  'links.add', 'links.update', 'links.remove',
  'blocks.setLayout', 'blocks.add', 'blocks.remove', 'blocks.update', 'blocks.toggleNote',
  'taxonomy.addCategory', 'taxonomy.addPlatform',
  'week.setSlots', 'week.setWakeTimes', 'week.select', 'week.create', 'week.rename',
  'settings.get', 'settings.update', 'preferences.update', 'preferences.adoptLegacy',
] as const satisfies readonly NativeCommandName[]

// Compile-time check that the list above is exhaustive.
type MissingCommand = Exclude<NativeCommandName, (typeof NATIVE_COMMAND_NAMES)[number]>
const exhaustive: MissingCommand extends never ? true : false = true
void exhaustive

export function isNativeCommandName(value: unknown): value is NativeCommandName {
  return typeof value === 'string' && (NATIVE_COMMAND_NAMES as readonly string[]).includes(value)
}

export interface WeekFacade {
  weekPresets: WeekPreset[]
  activeWeekPresetId: string
}

// Confirmed changes, emitted only after commit. The renderer cache applies
// them; `value: null` means the entity no longer exists.
export type DataChange =
  | { entity: 'composition' }
  | { entity: 'project'; id: string; value: Project | null }
  | { entity: 'note'; id: string; value: Note | null }
  | { entity: 'error'; id: string; value: ErrorEntry | null }
  | { entity: 'folder'; id: string; value: ProjectFolder | null }
  | { entity: 'trash'; id: string; value: TrashedNote | null }
  | { entity: 'taxonomy'; value: Pick<AppData, 'categories' | 'platforms'> }
  | { entity: 'week'; value: WeekFacade }
  | { entity: 'settings'; value: AppSettings }
  | { entity: 'preferences'; value: AppPreferences }

export type CommandResponse<T> =
  | { ok: true; value: T; changes: DataChange[]; revision: number }
  | { ok: false; error: ErrorPayload }

// Initial hydration of the renderer cache.
export interface AppSnapshot {
  data: AppData
  settings: AppSettings
  preferences: AppPreferences
  preferencesAdopted: boolean
  revision: number
}

// Startup status. In "recovery" mode the shell and settings stay usable but no
// business data is served and no third-party code runs.
export type StartupStatus =
  | { mode: 'ready'; migratedThisLaunch: boolean; reportId: string | null }
  | { mode: 'recovery'; reason: RecoveryReason; message: string; reportId: string | null }

export type RecoveryReason = 'migration-not-qualified' | 'legacy-invalid' | 'import-failed' | 'schema-newer' | 'database-error' | 'locked'
