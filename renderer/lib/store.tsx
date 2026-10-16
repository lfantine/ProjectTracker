import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
} from './types'
import { emptyCoreData } from './types'
import type { TaskDropPosition } from './helpers'
import { commandRevisionTarget } from '../../shared/commands'
import type { NativeBatchStep, CommandParams, CommandValue, DataChange, NativeCommandName, NewProjectInput, ProjectPatch, StartupStatus } from '../../shared/commands'
import type { ErrorPayload } from '../../shared/errors'
import { defaultPreferences, defaultSettings, type AppPreferences, type AppSettings } from '../../shared/models'
import { useToast } from '../components/Toast'

// Renderer cache of the data owned by the main process (SQLite). It is only
// updated with confirmed changes returned by targeted commands or broadcast
// after a commit. Inputs that need instant feedback keep a local draft (see
// useDraft) and commit through these actions.

export type MaybePromise<T> = Promise<T | null>

interface DataContextValue {
  data: AppData
  loading: boolean
  status: StartupStatus | null
  settings: AppSettings
  preferences: AppPreferences
  // Last failed write, until dismissed or retried.
  lastError: ErrorPayload | null
  retryStartup: () => Promise<void>

  findProject: (id: string | null | undefined) => Project | undefined
  findNote: (id: string | null | undefined) => Note | undefined
  findError: (id: string | null | undefined) => ErrorEntry | undefined

  addProject: (input: NewProjectInput) => MaybePromise<Project>
  updateProject: (id: string, patch: ProjectPatch, expectedRevision?: number) => Promise<boolean>
  removeProject: (id: string) => Promise<boolean>
  touchProjectOpened: (id: string) => Promise<boolean>

  addFolder: (input: {
    name: string
    kind: FolderKind
    displayMode: FolderDisplayMode
    description?: string
    tagFilter?: string[]
  }) => MaybePromise<ProjectFolder>
  updateFolder: (
    id: string,
    patch: Partial<Pick<ProjectFolder, 'name' | 'description' | 'displayMode' | 'tagFilter'>>
  ) => Promise<boolean>
  removeFolder: (id: string) => Promise<boolean>

  addNote: (input: { title: string; content: string; tags: string[] }) => MaybePromise<Note>
  updateNote: (
    id: string,
    patch: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'raw'>>,
    expectedRevision?: number
  ) => Promise<boolean>
  removeNote: (id: string) => Promise<boolean>
  restoreNote: (id: string) => Promise<boolean>

  addError: (input: {
    title: string
    content: string
    causes: string
    solution: string
    projectIds: string[]
  }) => MaybePromise<ErrorEntry>
  updateError: (
    id: string,
    patch: Partial<Pick<ErrorEntry, 'title' | 'content' | 'causes' | 'solution'>>,
    expectedRevision?: number
  ) => Promise<boolean>
  removeError: (id: string) => Promise<boolean>

  linkNote: (projectId: string, noteId: string) => Promise<boolean>
  unlinkNote: (projectId: string, noteId: string) => Promise<boolean>
  linkError: (projectId: string, errorId: string) => Promise<boolean>
  unlinkError: (projectId: string, errorId: string) => Promise<boolean>

  addChecklistItem: (
    projectId: string,
    item: {
      label: string
      type: ChecklistType
      link?: string
      projectRef?: string
      date?: string
      description?: string
    }
  ) => Promise<boolean>
  updateChecklistItem: (projectId: string, itemId: string, patch: Partial<ChecklistItem>) => Promise<boolean>
  cycleChecklistStatus: (projectId: string, itemId: string) => Promise<boolean>
  setChecklistStatus: (projectId: string, itemId: string, status: ChecklistStatus) => Promise<boolean>
  removeChecklistItem: (projectId: string, itemId: string) => Promise<boolean>

  addTask: (projectId: string, name: string) => Promise<boolean>
  addSubtask: (projectId: string, parentId: string, name: string) => Promise<boolean>
  updateTask: (projectId: string, taskId: string, patch: Partial<TaskNode>) => Promise<boolean>
  cycleTaskStatus: (projectId: string, taskId: string) => Promise<boolean>
  removeTask: (projectId: string, taskId: string) => Promise<boolean>
  moveTask: (projectId: string, draggedId: string, targetId: string, position: TaskDropPosition) => Promise<boolean>

  addDeadline: (projectId: string, label: string, date: string) => Promise<boolean>
  toggleDeadlineDone: (projectId: string, deadlineId: string) => Promise<boolean>
  removeDeadline: (projectId: string, deadlineId: string) => Promise<boolean>

  addLink: (projectId: string, input: { title: string; url: string }) => Promise<boolean>
  updateLink: (projectId: string, linkId: string, patch: { title?: string; url?: string }) => Promise<boolean>
  removeLink: (projectId: string, linkId: string) => Promise<boolean>

  setLayout: (projectId: string, layout: ProjectModule[]) => Promise<boolean>
  addModule: (projectId: string, module: ProjectModule) => Promise<boolean>
  removeModule: (projectId: string, moduleId: string) => Promise<boolean>
  updateModule: (projectId: string, moduleId: string, patch: Partial<ProjectModule>, expectedRevision?: number) => Promise<boolean>
  toggleNoteModule: (projectId: string, noteId: string) => Promise<boolean>

  addCategory: (name: string) => Promise<boolean>
  addPlatform: (type: ProjectType, name: string) => Promise<boolean>

  applyBatch: (steps: NativeBatchStep[], operationId: string) => Promise<unknown[] | null>

  updateSettings: (patch: Partial<AppSettings>) => Promise<boolean>
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<boolean>
}

const DataContext = createContext<DataContextValue | null>(null)

export function operationId(): string {
  return `op_${crypto.randomUUID()}`
}

function upsert<T extends { id: string }>(list: T[], id: string, value: T | null): T[] {
  const index = list.findIndex((item) => item.id === id)
  if (value === null) return index === -1 ? list : list.filter((item) => item.id !== id)
  if (index === -1) return list.concat([value])
  const next = list.slice()
  next[index] = value
  return next
}

// Applies confirmed changes to the cached snapshot. Entities keep their
// position; new ones are appended (the main process appends them too).
export function applyDataChanges(data: AppData, changes: DataChange[]): AppData {
  let next = data
  for (const change of changes) {
    switch (change.entity) {
      case 'project':
        next = { ...next, projects: upsert(next.projects, change.id, change.value) }
        break
      case 'note':
        next = { ...next, notes: upsert(next.notes, change.id, change.value) }
        break
      case 'error':
        next = { ...next, errors: upsert(next.errors, change.id, change.value) }
        break
      case 'folder':
        next = { ...next, folders: upsert(next.folders, change.id, change.value) }
        break
      case 'trash': {
        const trash = (next.trashedNotes || []).filter((entry) => entry.note.id !== change.id)
        next = { ...next, trashedNotes: change.value ? trash.concat([change.value]) : trash }
        break
      }
      case 'taxonomy':
        next = { ...next, ...change.value }
        break
      default:
        break
    }
  }
  return next
}

// Keys formerly kept in localStorage by the renderer. They are adopted once
// into SQLite and kept untouched afterwards for recovery.
export const LEGACY_PREFERENCE_KEYS = ['tracker_theme_mode', 'tracker_sidebar_collapsed', 'tracker_collapsed_category_folders', 'tracker_project_tabs_v1'] as const

function readLegacyPreferences(): Record<string, string | null> {
  const values: Record<string, string | null> = {}
  for (const key of LEGACY_PREFERENCE_KEYS) {
    try {
      values[key] = window.localStorage.getItem(key)
    } catch {
      values[key] = null
    }
  }
  return values
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(emptyCoreData)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<StartupStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings())
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences())
  const [lastError, setLastError] = useState<ErrorPayload | null>(null)
  const confirmedData = useRef(data)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const revision = useRef(0)
  const hydrating = useRef(true)
  const pendingChanges = useRef<{ changes: DataChange[]; revision: number }[]>([])
  const hydrationRequest = useRef(0)
  const { showToast } = useToast()

  const applyChanges = useCallback((changes: DataChange[], next: number) => {
    if (hydrating.current) {
      pendingChanges.current.push({ changes, revision: next })
      return
    }
    // Responses and broadcasts carry the same revision: apply each once, in order.
    if (next <= revision.current) return
    revision.current = next
    confirmedData.current = applyDataChanges(confirmedData.current, changes)
    setData(confirmedData.current)
    for (const change of changes) {
      if (change.entity === 'settings') setSettings(change.value)
      if (change.entity === 'preferences') setPreferences(change.value)
    }
  }, [])

  const run = useCallback(
    async <K extends NativeCommandName>(name: K, params: CommandParams<K>): Promise<CommandValue<K> | null> => {
      const payload = { ...params } as Record<string, unknown>
      const target = commandRevisionTarget(name, payload)
      if (payload.expectedRevision === undefined && target) {
        const lists = { projects: confirmedData.current.projects, notes: confirmedData.current.notes, errors: confirmedData.current.errors, folders: confirmedData.current.folders }
        payload.expectedRevision = target === 'snapshot' ? revision.current
          : target.table === 'trashed_notes' ? confirmedData.current.trashedNotes?.find((entry) => entry.note.id === target.id)?.note.revision
          : lists[target.table].find((entry) => entry.id === target.id)?.revision
      }
      let response
      try {
        response = await window.api.core.command(name, payload)
      } catch {
        response = { ok: false as const, error: { code: 'UNAVAILABLE' as const, message: 'Le processus principal ne répond pas.' } }
      }
      if (!response.ok) {
        setLastError(response.error)
        showToast(`Non enregistré : ${response.error.message}`, 'danger', {
          label: response.error.code === 'CONFLICT' ? 'Recharger' : 'Réessayer',
          onClick: () => response.error.code === 'CONFLICT' ? void refresh.current() : void run(name, payload as CommandParams<K>),
        })
        return null
      }
      setLastError(null)
      applyChanges(response.changes, response.revision)
      return response.value as CommandValue<K>
    },
    [applyChanges, showToast]
  )

  const hydrate = useCallback(async () => {
    const request = ++hydrationRequest.current
    hydrating.current = true
    setLoading(true)
    try {
      const current = await window.api.core.status()
      if (request !== hydrationRequest.current) return
      setStatus(current)
      if (current.mode !== 'ready') return
      let snapshot = await window.api.core.snapshot()
      if (!snapshot.ok) throw new Error(snapshot.error.message)
      if (!snapshot.value.preferencesAdopted) {
        const adopted = await window.api.core.command('preferences.adoptLegacy', { values: readLegacyPreferences() })
        if (!adopted.ok) throw new Error(adopted.error.message)
        // Read after adoption so consumers never restore default preferences
        // before the original theme, sidebar and pinned tabs have arrived.
        snapshot = await window.api.core.snapshot()
        if (!snapshot.ok) throw new Error(snapshot.error.message)
      }
      if (request !== hydrationRequest.current) return
      revision.current = snapshot.value.revision
      confirmedData.current = snapshot.value.data
      setData(snapshot.value.data)
      setSettings(snapshot.value.settings)
      setPreferences(snapshot.value.preferences)
      hydrating.current = false
      for (const event of pendingChanges.current.splice(0).sort((a, b) => a.revision - b.revision)) {
        applyChanges(event.changes, event.revision)
      }
    } catch (error) {
      if (request !== hydrationRequest.current) return
      setStatus({ mode: 'recovery', reason: 'database-error', message: error instanceof Error ? error.message : 'Le processus principal ne répond pas.', reportId: null })
    } finally {
      if (request === hydrationRequest.current) {
        hydrating.current = false
        pendingChanges.current = []
        setLoading(false)
      }
    }
  }, [applyChanges])

  useEffect(() => {
    const stop = window.api.core.onChanged(({ changes, revision: next }) => applyChanges(changes, next))
    const stopPackages = window.api.packages?.onChanged(() => { void hydrate() })
    void hydrate()
    return () => { hydrationRequest.current++; stop(); stopPackages?.() }
  }, [applyChanges, hydrate])

  const retryStartup = useCallback(async () => {
    try { await window.api.core.retry() }
    catch { /* hydrate exposes the failure through recovery status */ }
    await hydrate()
  }, [hydrate])

  refresh.current = hydrate

  const ok = (value: unknown) => value !== null

  const findProject = useCallback((id: string | null | undefined) => data.projects.find((p) => p.id === id), [data.projects])
  const findNote = useCallback((id: string | null | undefined) => data.notes.find((n) => n.id === id), [data.notes])
  const findError = useCallback((id: string | null | undefined) => data.errors.find((e) => e.id === id), [data.errors])

  const actions = useMemo(
    () => ({
      addProject: (input: NewProjectInput) => run('projects.create', { input, operationId: operationId() }),
      updateProject: async (id: string, patch: ProjectPatch, expectedRevision?: number) => {
        // `folderId: undefined` means "remove from folder".
        const sent = Object.prototype.hasOwnProperty.call(patch, 'folderId') && patch.folderId === undefined ? { ...patch, folderId: null } : patch
        return ok(await run('projects.update', { id, patch: sent as ProjectPatch, expectedRevision }))
      },
      removeProject: async (id: string) => ok(await run('projects.delete', { id })),
      touchProjectOpened: async (id: string) => ok(await run('projects.touchOpened', { id })),

      addFolder: (input: CommandParams<'folders.create'>['input']) => run('folders.create', { input, operationId: operationId() }),
      updateFolder: async (id: string, patch: CommandParams<'folders.update'>['patch']) => ok(await run('folders.update', { id, patch })),
      removeFolder: async (id: string) => ok(await run('folders.delete', { id })),

      addNote: (input: { title: string; content: string; tags: string[] }) => run('notes.create', { input, operationId: operationId() }),
      updateNote: async (id: string, patch: CommandParams<'notes.update'>['patch'], expectedRevision?: number) =>
        ok(await run('notes.update', { id, patch, ...(expectedRevision !== undefined ? { expectedRevision } : {}) })),
      removeNote: async (id: string) => ok(await run('notes.trash', { id })),
      restoreNote: async (id: string) => ok(await run('notes.restore', { id })),

      addError: (input: CommandParams<'errors.create'>['input']) => run('errors.create', { input, operationId: operationId() }),
      updateError: async (id: string, patch: CommandParams<'errors.update'>['patch'], expectedRevision?: number) =>
        ok(await run('errors.update', { id, patch, ...(expectedRevision !== undefined ? { expectedRevision } : {}) })),
      removeError: async (id: string) => ok(await run('errors.delete', { id })),

      linkNote: async (projectId: string, noteId: string) => ok(await run('projects.linkNote', { projectId, noteId })),
      unlinkNote: async (projectId: string, noteId: string) => ok(await run('projects.unlinkNote', { projectId, noteId })),
      linkError: async (projectId: string, errorId: string) => ok(await run('projects.linkError', { projectId, errorId })),
      unlinkError: async (projectId: string, errorId: string) => ok(await run('projects.unlinkError', { projectId, errorId })),

      addChecklistItem: async (projectId: string, item: CommandParams<'checklist.add'>['item']) => ok(await run('checklist.add', { projectId, item })),
      updateChecklistItem: async (projectId: string, itemId: string, patch: Partial<ChecklistItem>) => {
        const { id: _id, ...rest } = patch
        void _id
        return ok(await run('checklist.update', { projectId, itemId, patch: rest }))
      },
      cycleChecklistStatus: async (projectId: string, itemId: string) => ok(await run('checklist.cycleStatus', { projectId, itemId })),
      setChecklistStatus: async (projectId: string, itemId: string, status: ChecklistStatus) => ok(await run('checklist.setStatus', { projectId, itemId, status })),
      removeChecklistItem: async (projectId: string, itemId: string) => ok(await run('checklist.remove', { projectId, itemId })),

      addTask: async (projectId: string, name: string) => ok(await run('tasks.add', { projectId, name })),
      addSubtask: async (projectId: string, parentId: string, name: string) => ok(await run('tasks.add', { projectId, name, parentId })),
      updateTask: async (projectId: string, taskId: string, patch: Partial<TaskNode>) => {
        const allowed: Partial<Pick<TaskNode, 'name' | 'content' | 'status'>> = {}
        if (patch.name !== undefined) allowed.name = patch.name
        if (patch.content !== undefined) allowed.content = patch.content
        if (patch.status !== undefined) allowed.status = patch.status
        return ok(await run('tasks.update', { projectId, taskId, patch: allowed }))
      },
      cycleTaskStatus: async (projectId: string, taskId: string) => ok(await run('tasks.cycleStatus', { projectId, taskId })),
      removeTask: async (projectId: string, taskId: string) => ok(await run('tasks.remove', { projectId, taskId })),
      moveTask: async (projectId: string, draggedId: string, targetId: string, position: TaskDropPosition) =>
        draggedId === targetId ? false : ok(await run('tasks.move', { projectId, draggedId, targetId, position })),

      addDeadline: async (projectId: string, label: string, date: string) => ok(await run('deadlines.add', { projectId, label, date })),
      toggleDeadlineDone: async (projectId: string, deadlineId: string) => ok(await run('deadlines.toggleDone', { projectId, deadlineId })),
      removeDeadline: async (projectId: string, deadlineId: string) => ok(await run('deadlines.remove', { projectId, deadlineId })),

      addLink: async (projectId: string, input: { title: string; url: string }) => ok(await run('links.add', { projectId, input })),
      updateLink: async (projectId: string, linkId: string, patch: { title?: string; url?: string }) => ok(await run('links.update', { projectId, linkId, patch })),
      removeLink: async (projectId: string, linkId: string) => ok(await run('links.remove', { projectId, linkId })),

      setLayout: async (projectId: string, layout: ProjectModule[]) => ok(await run('blocks.setLayout', { projectId, layout })),
      addModule: async (projectId: string, module: ProjectModule) => ok(await run('blocks.add', { projectId, block: module })),
      removeModule: async (projectId: string, moduleId: string) => ok(await run('blocks.remove', { projectId, blockId: moduleId })),
      updateModule: async (projectId: string, moduleId: string, patch: Partial<ProjectModule>, expectedRevision?: number) => ok(await run('blocks.update', { projectId, blockId: moduleId, patch, expectedRevision })),
      toggleNoteModule: async (projectId: string, noteId: string) => ok(await run('blocks.toggleNote', { projectId, noteId })),

      addCategory: async (name: string) => ok(await run('taxonomy.addCategory', { name })),
      addPlatform: async (type: ProjectType, name: string) => ok(await run('taxonomy.addPlatform', { type, name })),

      applyBatch: (steps: NativeBatchStep[], operationId: string) => run('core.batch', { steps: steps.map((step) => {
        const params = { ...step.params }
        const target = commandRevisionTarget(step.name, params)
        const lists = { projects: confirmedData.current.projects, notes: confirmedData.current.notes, errors: confirmedData.current.errors, folders: confirmedData.current.folders }
        if (params.expectedRevision === undefined && target) {
          params.expectedRevision = target === 'snapshot' ? revision.current : target.table === 'trashed_notes' ? undefined : lists[target.table].find((entry) => entry.id === target.id)?.revision
        }
        return { ...step, params }
      }), operationId }),
      updateSettings: async (patch: Partial<AppSettings>) => ok(await run('settings.update', { patch })),
      updatePreferences: async (patch: Partial<AppPreferences>) => ok(await run('preferences.update', { patch })),
    }),
    [run]
  )

  const value = useMemo<DataContextValue>(
    () => ({ data, loading, status, settings, preferences, lastError, retryStartup, findProject, findNote, findError, ...actions }),
    [data, loading, status, settings, preferences, lastError, retryStartup, findProject, findNote, findError, actions]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}

export type { Deadline }
