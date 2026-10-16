import { randomUUID } from 'crypto'
import { commandRevisionTarget } from '../../shared/commands'
import { COMMAND_SCHEMAS } from './commandSchemas'
import type { CommandParams, CommandValue, DataChange, NativeCommandName, NewProjectInput } from '../../shared/commands'
import type { ChecklistItem, Deadline, Note, Project, ProjectFolder, ProjectModule, TaskNode, TrashedNote } from '../../shared/domain'
import { defaultProjectLayout } from '../../shared/domain'
import { AppError } from '../../shared/errors'
import { defaultChecklistStatus, nextChecklistStatus } from '../../shared/checklist'
import { addTaskNode, extractTaskNode, findTaskNode, insertTaskNode, isTaskDescendant, removeTaskNode, syncTaskStatuses, TASK_STATUS_ORDER, updateTaskNode } from '../../shared/tasks'
import { defaultPreferences, defaultSettings, type AppPreferences, type AppSettings } from '../../shared/models'
import type { Database } from '../db/database'
import { blockToModule, readError, readFolder, readNote, readProject, readTaxonomy, readTrashEntry, type BlockRow } from './readModel'
import { createWeek, readWeekFacade, renameActiveWeek, selectWeek, setActiveSlots, setActiveWakeTimes } from './week'
import { nullable, splitExtra } from './json'
import {
  CHECKLIST_KEYS,
  insertBlock,
  insertChecklistItem,
  insertDeadline,
  insertError,
  insertLink,
  insertNote,
  insertProjectRow,
  insertTaskTree,
  insertTrashEntry,
  LINK_KEYS,
  nextPosition,
  replaceProjectList,
  setErrorProjects,
  setNoteTags,
} from './writers'

// Handlers of the targeted native commands. Each one runs inside a single
// transaction opened by CoreService and records which entities it touched;
// the confirmed changes are read back after the write.

export class Touched {
  projects = new Set<string>()
  notes = new Set<string>()
  errors = new Set<string>()
  folders = new Set<string>()
  trash = new Set<string>()
  taxonomy = false
  week = false
  settings = false
  preferences = false
}

export interface CommandContext {
  db: Database
  now: string
  today: string
  touched: Touched
  uid(prefix: string): string
}

export function makeUid(db: Database, prefix: string, exists: (id: string) => boolean): string {
  void db
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `${prefix}_${randomUUID().slice(0, 8)}`
    if (!exists(id)) return id
  }
  return `${prefix}_${randomUUID()}`
}

function requireProject(ctx: CommandContext, id: string): Project {
  const project = readProject(ctx.db, id)
  if (!project) throw new AppError('NOT_FOUND', 'Projet introuvable.', { projectId: id })
  return project
}

export function checkCommandRevision(db: Database, name: string, input: Record<string, unknown>) {
  if (typeof input.expectedRevision !== 'number') return
  const target = commandRevisionTarget(name, input)
  const row = target === 'snapshot' ? db.get<{ revision: number }>('SELECT revision FROM data_revision WHERE id = 1')
    : target ? db.get<{ revision: number }>(`SELECT revision FROM ${target.table} WHERE ${target.table === 'trashed_notes' ? 'note_id' : 'id'} = ?`, target.id) : null
  if (target && row?.revision !== input.expectedRevision) throw new AppError('CONFLICT', 'Ces données ont été modifiées ailleurs. Recharge la vue avant de réessayer.', { revision: row?.revision ?? null })
}

function checkRevision(kind: string, current: number | undefined, expected: number | undefined) {
  if (expected !== undefined && current !== expected) {
    throw new AppError('CONFLICT', `Ce ${kind} a été modifié ailleurs. Recharge-le avant de réessayer.`, { revision: current ?? null })
  }
}

// Equivalent of the former mutateProject(): any change inside a project bumps
// its updatedAt and revision.
function touchProject(ctx: CommandContext, projectId: string) {
  ctx.db.run('UPDATE projects SET updated_at = ?, revision = revision + 1 WHERE id = ?', ctx.now, projectId)
  ctx.touched.projects.add(projectId)
}

// Same as touchProject but without updatedAt (former setData paths that did
// not go through mutateProject).
function markProject(ctx: CommandContext, projectId: string) {
  ctx.db.run('UPDATE projects SET revision = revision + 1 WHERE id = ?', projectId)
  ctx.touched.projects.add(projectId)
}

function assertUniqueIds(items: { id: string }[], label: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new AppError('VALIDATION', `Identifiant de ${label} répété : ${item.id}`)
    seen.add(item.id)
  }
}

function collectTaskIds(tasks: TaskNode[], into: { id: string }[] = []): { id: string }[] {
  for (const task of tasks) {
    into.push({ id: task.id })
    collectTaskIds(task.children ?? [], into)
  }
  return into
}

function replaceTasks(ctx: CommandContext, projectId: string, tasks: TaskNode[]) {
  const synced = syncTaskStatuses(tasks)
  assertUniqueIds(collectTaskIds(synced), 'tâche')
  ctx.db.run('DELETE FROM tasks WHERE project_id = ?', projectId)
  insertTaskTree(ctx.db, projectId, synced)
}

function projectExists(ctx: CommandContext, projectId: string) {
  return !!ctx.db.get('SELECT 1 AS present FROM projects WHERE id = ?', projectId)
}

function replaceChecklist(ctx: CommandContext, projectId: string, items: ChecklistItem[]) {
  assertUniqueIds(items, 'élément de checklist')
  ctx.db.run('DELETE FROM checklist_items WHERE project_id = ?', projectId)
  items.forEach((item, index) => insertChecklistItem(ctx.db, projectId, item, index, item.projectRef && projectExists(ctx, item.projectRef) ? item.projectRef : null))
}

function replaceDeadlines(ctx: CommandContext, projectId: string, deadlines: Deadline[]) {
  assertUniqueIds(deadlines, 'échéance')
  ctx.db.run('DELETE FROM deadlines WHERE project_id = ?', projectId)
  deadlines.forEach((deadline, index) => insertDeadline(ctx.db, projectId, deadline, index))
}

function replaceLinks(ctx: CommandContext, projectId: string, links: Project['links']) {
  assertUniqueIds(links, 'lien')
  ctx.db.run('DELETE FROM project_links WHERE project_id = ?', projectId)
  links.forEach((link, index) => insertLink(ctx.db, projectId, link, index))
}

function replaceLayout(ctx: CommandContext, projectId: string, layout: ProjectModule[]) {
  assertUniqueIds(layout, 'bloc')
  ctx.db.run('DELETE FROM project_blocks WHERE project_id = ?', projectId)
  layout.forEach((module, index) => insertBlock(ctx.db, projectId, module, index))
}

function readLayout(ctx: CommandContext, projectId: string): ProjectModule[] {
  return ctx.db.all<BlockRow>('SELECT * FROM project_blocks WHERE project_id = ? ORDER BY position', projectId).map(blockToModule)
}

function requireNote(ctx: CommandContext, noteId: string) {
  if (!ctx.db.get('SELECT 1 AS present FROM notes WHERE id = ?', noteId)) throw new AppError('NOT_FOUND', 'Note introuvable.', { noteId })
}

function requireError(ctx: CommandContext, errorId: string) {
  if (!ctx.db.get('SELECT 1 AS present FROM errors WHERE id = ?', errorId)) throw new AppError('NOT_FOUND', 'Erreur introuvable.', { errorId })
}

function appendRelation(ctx: CommandContext, table: 'project_notes' | 'project_errors', column: 'note_id' | 'error_id', projectId: string, targetId: string): boolean {
  if (ctx.db.get(`SELECT 1 AS present FROM ${table} WHERE project_id = ? AND ${column} = ?`, projectId, targetId)) return false
  ctx.db.run(`INSERT INTO ${table} (project_id, ${column}, position) VALUES (?, ?, ?)`, projectId, targetId, nextPosition(ctx.db, table, 'WHERE project_id = ?', projectId))
  return true
}

function recordUnresolved(ctx: CommandContext, ref: { sourceKind: string; sourceId: string; scope?: string; field: string; targetKind: string; targetId: string; reason: string }) {
  ctx.db.run(
    'INSERT INTO unresolved_refs (source_kind, source_id, source_scope, field, target_kind, target_id, original_json, reason, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ref.sourceKind, ref.sourceId, ref.scope ?? '', ref.field, ref.targetKind, ref.targetId, JSON.stringify(ref.targetId), ref.reason, ctx.now
  )
}

function deadlineStatusFor(date: string, today: string): Deadline['status'] {
  return date < today ? 'depasse' : 'a_venir'
}

function readSettings(db: Database): AppSettings {
  const settings: Record<string, unknown> = { ...defaultSettings() }
  for (const row of db.all<{ key: string; value_json: string }>('SELECT key, value_json FROM settings')) settings[row.key] = JSON.parse(row.value_json)
  return settings as unknown as AppSettings
}

export function readPreferences(db: Database): AppPreferences {
  const preferences: Record<string, unknown> = { ...defaultPreferences() }
  for (const row of db.all<{ key: string; value_json: string }>('SELECT key, value_json FROM preferences')) {
    if (row.key in preferences) preferences[row.key] = JSON.parse(row.value_json)
  }
  return preferences as unknown as AppPreferences
}

function writeKeyValues(ctx: CommandContext, table: 'settings' | 'preferences', values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    ctx.db.run(
      `INSERT INTO ${table} (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, revision = revision + 1, updated_at = excluded.updated_at`,
      key, JSON.stringify(value), ctx.now
    )
  }
}

export const PREFERENCES_MARKER = 'renderer-preferences'

// Parses the values formerly kept in localStorage. Invalid values are ignored.
export function preferencesFromLegacy(values: Record<string, string | null>): Partial<AppPreferences> {
  const result: Partial<AppPreferences> = {}
  const theme = values.tracker_theme_mode
  if (theme === 'system' || theme === 'light' || theme === 'dark') result.themeMode = theme
  if (values.tracker_sidebar_collapsed === '1' || values.tracker_sidebar_collapsed === '0') result.sidebarCollapsed = values.tracker_sidebar_collapsed === '1'
  try {
    const folders = JSON.parse(values.tracker_collapsed_category_folders ?? 'null')
    if (Array.isArray(folders)) result.collapsedCategoryFolders = folders.filter((entry): entry is string => typeof entry === 'string')
    else if (folders && typeof folders === 'object') result.collapsedCategoryFolders = Object.keys(folders).filter((key) => folders[key] === true)
  } catch {
    // ignored
  }
  try {
    const tabs = JSON.parse(values.tracker_project_tabs_v1 ?? 'null')
    if (tabs && Array.isArray(tabs.tabs)) {
      result.pinnedTabs = tabs.tabs
        .filter((tab: unknown): tab is { projectId: string; pinned?: unknown } => !!tab && typeof (tab as { projectId?: unknown }).projectId === 'string')
        .map((tab: { projectId: string; pinned?: unknown }) => ({ projectId: tab.projectId, pinned: tab.pinned === true }))
      result.activeTabId = typeof tabs.activeId === 'string' ? tabs.activeId : null
    }
  } catch {
    // ignored
  }
  return result
}

type Handler<K extends NativeCommandName> = (ctx: CommandContext, params: CommandParams<K>) => CommandValue<K>
type Handlers = { [K in NativeCommandName]: Handler<K> }

function createProject(ctx: CommandContext, input: NewProjectInput): Project {
  const id = ctx.uid('p')
  for (const noteId of input.noteIds ?? []) requireNote(ctx, noteId)
  for (const errorId of input.errorIds ?? []) requireError(ctx, errorId)
  const project: Project = {
    id,
    name: input.name,
    type: input.type,
    category: input.category,
    platforms: input.platforms,
    tags: input.tags || [],
    status: 'actif',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    description: '',
    stack: [],
    path: '',
    noteIds: [...new Set(input.noteIds ?? [])],
    errorIds: [...new Set(input.errorIds ?? [])],
    checklist: input.checklist || [],
    tasks: syncTaskStatuses(input.tasks),
    deadlines: input.deadlines || [],
    links: [],
    layout: defaultProjectLayout(),
  }
  insertProjectRow(ctx.db, project, nextPosition(ctx.db, 'projects'), null)
  replaceProjectList(ctx.db, id, 'platforms', project.platforms)
  replaceProjectList(ctx.db, id, 'tags', project.tags)
  replaceProjectList(ctx.db, id, 'stack', [])
  replaceTasks(ctx, id, project.tasks)
  replaceChecklist(ctx, id, project.checklist)
  replaceDeadlines(ctx, id, project.deadlines)
  replaceLayout(ctx, id, project.layout)
  project.noteIds.forEach((noteId, index) => ctx.db.run('INSERT INTO project_notes (project_id, note_id, position) VALUES (?, ?, ?)', id, noteId, index))
  project.errorIds.forEach((errorId, index) => ctx.db.run('INSERT INTO project_errors (project_id, error_id, position) VALUES (?, ?, ?)', id, errorId, index))
  ctx.touched.projects.add(id)
  return readProject(ctx.db, id)!
}

function trashNote(ctx: CommandContext, id: string): TrashedNote | null {
  const note = readNote(ctx.db, id)
  if (!note) return null
  const linkedProjects = new Set(ctx.db.all<{ project_id: string }>('SELECT project_id FROM project_notes WHERE note_id = ?', id).map((row) => row.project_id))
  const blocks = ctx.db.all<BlockRow & { position: number }>(
    "SELECT * FROM project_blocks WHERE package_id = 'core' AND contribution_id = 'note' AND json_extract(config_json, '$.refId') = ? ORDER BY project_id, position",
    id
  )
  const links: TrashedNote['links'] = []
  const names = new Map<string, string | null>()
  for (const project of ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM projects ORDER BY position')) {
    const modules = blocks.filter((block) => block.project_id === project.id).map(blockToModule)
    if (linkedProjects.has(project.id) || modules.length) {
      links.push({ projectId: project.id, modules })
      names.set(project.id, project.name)
    }
  }
  const { revision: _revision, ...stored } = note
  void _revision
  const entry: TrashedNote = { note: stored, links, deletedAt: ctx.now }
  if (ctx.db.get('SELECT 1 AS present FROM trashed_notes WHERE note_id = ?', id)) ctx.db.run('DELETE FROM trashed_notes WHERE note_id = ?', id)
  insertTrashEntry(ctx.db, entry, nextPosition(ctx.db, 'trashed_notes'), (projectId) => names.get(projectId) ?? null)
  ctx.db.run('DELETE FROM notes WHERE id = ?', id)
  for (const block of blocks) ctx.db.run('DELETE FROM project_blocks WHERE project_id = ? AND block_id = ?', block.project_id, block.block_id)
  for (const link of links) markProject(ctx, link.projectId)
  ctx.touched.notes.add(id)
  ctx.touched.trash.add(id)
  return entry
}

function restoreNote(ctx: CommandContext, id: string): Note | null {
  const entry = readTrashEntry(ctx.db, id)
  if (!entry || ctx.db.get('SELECT 1 AS present FROM notes WHERE id = ?', id)) return null
  const raw = entry.note as Partial<Note> & { id: string }
  const note: Note = {
    ...raw,
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : ctx.now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ctx.now,
  }
  insertNote(ctx.db, note, nextPosition(ctx.db, 'notes'))
  ctx.db.run('DELETE FROM trashed_notes WHERE note_id = ?', id)
  for (const link of entry.links) {
    if (!projectExists(ctx, link.projectId)) continue
    appendRelation(ctx, 'project_notes', 'note_id', link.projectId, id)
    const layout = readLayout(ctx, link.projectId)
    let position = nextPosition(ctx.db, 'project_blocks', 'WHERE project_id = ?', link.projectId)
    for (const module of link.modules) {
      if (layout.some((existing) => existing.id === module.id || (existing.type === 'note' && existing.refId === id))) continue
      insertBlock(ctx.db, link.projectId, module, position++)
      layout.push(module)
    }
    markProject(ctx, link.projectId)
  }
  ctx.touched.notes.add(id)
  ctx.touched.trash.add(id)
  return readNote(ctx.db, id)
}

function withTasks(ctx: CommandContext, projectId: string, update: (tasks: TaskNode[]) => TaskNode[]): TaskNode[] {
  const project = requireProject(ctx, projectId)
  const next = update(project.tasks)
  replaceTasks(ctx, projectId, next)
  touchProject(ctx, projectId)
  return readProject(ctx.db, projectId)!.tasks
}

function updateChecklistRow(ctx: CommandContext, projectId: string, itemId: string, update: (item: ChecklistItem) => ChecklistItem): ChecklistItem {
  const project = requireProject(ctx, projectId)
  const index = project.checklist.findIndex((item) => item.id === itemId)
  if (index === -1) throw new AppError('NOT_FOUND', 'Élément introuvable.', { itemId })
  const next = update(project.checklist[index])
  if (next.projectRef !== undefined && !projectExists(ctx, next.projectRef)) throw new AppError('VALIDATION', 'Projet lié introuvable.')
  ctx.db.run(
    'UPDATE checklist_items SET label = ?, type = ?, status = ?, link = ?, project_ref = ?, date = ?, description = ?, extra_json = ?, revision = revision + 1 WHERE project_id = ? AND id = ?',
    next.label, next.type, next.status, nullable(next.link), nullable(next.projectRef), nullable(next.date), nullable(next.description), splitExtra(next, CHECKLIST_KEYS), projectId, itemId
  )
  touchProject(ctx, projectId)
  return readProject(ctx.db, projectId)!.checklist.find((item) => item.id === itemId)!
}

function updateBlocks(ctx: CommandContext, projectId: string, update: (layout: ProjectModule[]) => ProjectModule[]): ProjectModule[] {
  requireProject(ctx, projectId)
  replaceLayout(ctx, projectId, update(readLayout(ctx, projectId)))
  touchProject(ctx, projectId)
  return readLayout(ctx, projectId)
}

export const HANDLERS: Handlers = {
  'core.batch': (ctx, { steps }) => {
    // All pre-existing entities are checked against the same initial state.
    // Later steps may modify that state as part of this one transaction.
    for (const step of steps) {
      if (step.name === ('core.batch' as string)) throw new AppError('VALIDATION', 'Opération groupée imbriquée interdite.')
      if (!step.bindings?.some((binding) => binding.field === 'id' || binding.field === 'projectId')) checkCommandRevision(ctx.db, step.name, step.params)
    }
    const results: unknown[] = []
    for (const [index, step] of steps.entries()) {
      const params = structuredClone(step.params)
      for (const binding of step.bindings ?? []) {
        const source = results[binding.resultIndex] as { id?: unknown } | undefined
        if (binding.resultIndex >= index || !source || typeof source.id !== 'string') throw new AppError('VALIDATION', 'Référence de résultat invalide.')
        if (binding.field === 'block.refId') {
          if (!params.block || typeof params.block !== 'object') throw new AppError('VALIDATION', 'Bloc attendu.')
          ;(params.block as Record<string, unknown>).refId = source.id
        } else params[binding.field] = source.id
      }
      const parsed = COMMAND_SCHEMAS[step.name].safeParse(params)
      if (!parsed.success) throw new AppError('VALIDATION', 'Paramètres invalides dans l’opération groupée.', { index })
      const input = parsed.data as Record<string, unknown>
      delete input.expectedRevision // checked before any step ran
      results.push((HANDLERS[step.name] as (ctx: CommandContext, input: unknown) => unknown)(ctx, input))
    }
    return results
  },
  'projects.create': (ctx, { input }) => createProject(ctx, input),

  'projects.update': (ctx, { id, patch, expectedRevision }) => {
    const project = requireProject(ctx, id)
    checkRevision('projet', project.revision, expectedRevision)
    const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key)
    const columns: [string, unknown][] = []
    if (patch.name !== undefined) columns.push(['name', patch.name])
    if (patch.type !== undefined) columns.push(['type', patch.type])
    if (patch.category !== undefined) columns.push(['category', patch.category])
    if (patch.status !== undefined) columns.push(['status', patch.status])
    if (patch.description !== undefined) columns.push(['description', patch.description])
    if (patch.path !== undefined) columns.push(['path', patch.path])
    if (has('folderId')) {
      const folderId = patch.folderId ?? null
      if (folderId !== null && !ctx.db.get('SELECT 1 AS present FROM folders WHERE id = ?', folderId)) throw new AppError('NOT_FOUND', 'Dossier introuvable.')
      columns.push(['folder_id', folderId])
    }
    if (patch.stack !== undefined) {
      columns.push(['has_stack', 1])
      replaceProjectList(ctx.db, id, 'stack', patch.stack)
    }
    for (const [column, value] of columns) ctx.db.run(`UPDATE projects SET ${column} = ? WHERE id = ?`, value as string, id)
    if (patch.platforms !== undefined) replaceProjectList(ctx.db, id, 'platforms', patch.platforms)
    if (patch.tags !== undefined) replaceProjectList(ctx.db, id, 'tags', patch.tags)
    if (patch.tasks !== undefined) replaceTasks(ctx, id, patch.tasks)
    if (patch.checklist !== undefined) replaceChecklist(ctx, id, patch.checklist)
    if (patch.deadlines !== undefined) replaceDeadlines(ctx, id, patch.deadlines)
    if (patch.links !== undefined) replaceLinks(ctx, id, patch.links)
    if (patch.layout !== undefined) replaceLayout(ctx, id, patch.layout)
    touchProject(ctx, id)
    return readProject(ctx.db, id)!
  },

  'projects.delete': (ctx, { id }) => {
    if (!projectExists(ctx, id)) return { deleted: false }
    // Keep a describable trace of the relations removed with the project.
    for (const row of ctx.db.all<{ error_id: string }>('SELECT error_id FROM error_projects WHERE project_id = ?', id)) {
      recordUnresolved(ctx, { sourceKind: 'error', sourceId: row.error_id, field: 'projectIds', targetKind: 'project', targetId: id, reason: 'deleted' })
      ctx.touched.errors.add(row.error_id)
    }
    for (const row of ctx.db.all<{ project_id: string; id: string }>('SELECT project_id, id FROM checklist_items WHERE project_ref = ? AND project_id <> ?', id, id)) {
      recordUnresolved(ctx, { sourceKind: 'checklist-item', sourceId: row.id, scope: row.project_id, field: 'projectRef', targetKind: 'project', targetId: id, reason: 'deleted' })
      markProject(ctx, row.project_id)
    }
    ctx.db.run('DELETE FROM projects WHERE id = ?', id)
    ctx.touched.projects.add(id)
    return { deleted: true }
  },

  'projects.touchOpened': (ctx, { id }) => {
    requireProject(ctx, id)
    ctx.db.run('UPDATE projects SET last_opened_at = ?, revision = revision + 1 WHERE id = ?', ctx.now, id)
    ctx.touched.projects.add(id)
    return readProject(ctx.db, id)!
  },

  'projects.linkNote': (ctx, { projectId, noteId }) => {
    requireProject(ctx, projectId)
    requireNote(ctx, noteId)
    if (appendRelation(ctx, 'project_notes', 'note_id', projectId, noteId)) touchProject(ctx, projectId)
    return readProject(ctx.db, projectId)!
  },

  'projects.unlinkNote': (ctx, { projectId, noteId }) => {
    requireProject(ctx, projectId)
    ctx.db.run('DELETE FROM project_notes WHERE project_id = ? AND note_id = ?', projectId, noteId)
    touchProject(ctx, projectId)
    return readProject(ctx.db, projectId)!
  },

  'projects.linkError': (ctx, { projectId, errorId }) => {
    requireProject(ctx, projectId)
    requireError(ctx, errorId)
    if (appendRelation(ctx, 'project_errors', 'error_id', projectId, errorId)) touchProject(ctx, projectId)
    if (!ctx.db.get('SELECT 1 AS present FROM error_projects WHERE error_id = ? AND project_id = ?', errorId, projectId)) {
      ctx.db.run('INSERT INTO error_projects (error_id, project_id, position) VALUES (?, ?, ?)', errorId, projectId, nextPosition(ctx.db, 'error_projects', 'WHERE error_id = ?', errorId))
      ctx.db.run('UPDATE errors SET revision = revision + 1 WHERE id = ?', errorId)
      ctx.touched.errors.add(errorId)
    }
    return readProject(ctx.db, projectId)!
  },

  'projects.unlinkError': (ctx, { projectId, errorId }) => {
    requireProject(ctx, projectId)
    ctx.db.run('DELETE FROM project_errors WHERE project_id = ? AND error_id = ?', projectId, errorId)
    touchProject(ctx, projectId)
    return readProject(ctx.db, projectId)!
  },

  'folders.create': (ctx, { input }) => {
    const folder: ProjectFolder = {
      id: ctx.uid('f'),
      name: input.name,
      kind: input.kind,
      displayMode: input.displayMode,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.kind === 'smart' ? { tagFilter: input.tagFilter || [] } : {}),
    }
    ctx.db.run(
      'INSERT INTO folders (id, name, kind, display_mode, description, tag_filter_json, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      folder.id, folder.name, folder.kind, folder.displayMode, nullable(folder.description), folder.tagFilter === undefined ? null : JSON.stringify(folder.tagFilter), nextPosition(ctx.db, 'folders')
    )
    ctx.touched.folders.add(folder.id)
    return readFolder(ctx.db, folder.id)!
  },

  'folders.update': (ctx, { id, patch }) => {
    const folder = readFolder(ctx.db, id)
    if (!folder) throw new AppError('NOT_FOUND', 'Dossier introuvable.')
    const next = { ...folder, ...patch }
    ctx.db.run(
      'UPDATE folders SET name = ?, display_mode = ?, description = ?, tag_filter_json = ?, revision = revision + 1 WHERE id = ?',
      next.name, next.displayMode, nullable(next.description), next.tagFilter === undefined ? null : JSON.stringify(next.tagFilter), id
    )
    ctx.touched.folders.add(id)
    return readFolder(ctx.db, id)!
  },

  'folders.delete': (ctx, { id }) => {
    if (!readFolder(ctx.db, id)) return { deleted: false }
    for (const row of ctx.db.all<{ id: string }>('SELECT id FROM projects WHERE folder_id = ?', id)) {
      ctx.db.run('UPDATE projects SET folder_id = NULL, revision = revision + 1 WHERE id = ?', row.id)
      ctx.touched.projects.add(row.id)
    }
    ctx.db.run('DELETE FROM folders WHERE id = ?', id)
    ctx.touched.folders.add(id)
    return { deleted: true }
  },

  'notes.create': (ctx, { input }) => {
    const note: Note = { id: ctx.uid('n'), ...input, createdAt: ctx.now, updatedAt: ctx.now }
    insertNote(ctx.db, note, nextPosition(ctx.db, 'notes'))
    ctx.touched.notes.add(note.id)
    return readNote(ctx.db, note.id)!
  },

  'notes.update': (ctx, { id, patch, expectedRevision }) => {
    const note = readNote(ctx.db, id)
    if (!note) throw new AppError('NOT_FOUND', 'Note introuvable.')
    checkRevision('note', note.revision, expectedRevision)
    const next = { ...note, ...patch }
    ctx.db.run('UPDATE notes SET title = ?, content = ?, raw = ?, updated_at = ?, revision = revision + 1 WHERE id = ?', next.title, next.content, next.raw === undefined ? null : next.raw ? 1 : 0, ctx.now, id)
    if (patch.tags !== undefined) setNoteTags(ctx.db, id, patch.tags)
    ctx.touched.notes.add(id)
    return readNote(ctx.db, id)!
  },

  'notes.trash': (ctx, { id }) => trashNote(ctx, id),
  'notes.restore': (ctx, { id }) => restoreNote(ctx, id),

  'errors.create': (ctx, { input }) => {
    const id = ctx.uid('e')
    const projectIds = [...new Set(input.projectIds)]
    for (const projectId of projectIds) requireProject(ctx, projectId)
    insertError(ctx.db, { id, ...input, projectIds, createdAt: ctx.now }, nextPosition(ctx.db, 'errors'))
    setErrorProjects(ctx.db, id, projectIds)
    for (const projectId of projectIds) {
      appendRelation(ctx, 'project_errors', 'error_id', projectId, id)
      markProject(ctx, projectId)
    }
    ctx.touched.errors.add(id)
    return readError(ctx.db, id)!
  },

  'errors.update': (ctx, { id, patch, expectedRevision }) => {
    const error = readError(ctx.db, id)
    if (!error) throw new AppError('NOT_FOUND', 'Erreur introuvable.')
    checkRevision('erreur', error.revision, expectedRevision)
    const next = { ...error, ...patch }
    ctx.db.run('UPDATE errors SET title = ?, content = ?, causes = ?, solution = ?, revision = revision + 1 WHERE id = ?', next.title, next.content, next.causes, next.solution, id)
    ctx.touched.errors.add(id)
    return readError(ctx.db, id)!
  },

  'errors.delete': (ctx, { id }) => {
    if (!readError(ctx.db, id)) return { deleted: false }
    for (const row of ctx.db.all<{ project_id: string }>('SELECT project_id FROM project_errors WHERE error_id = ?', id)) markProject(ctx, row.project_id)
    ctx.db.run('DELETE FROM errors WHERE id = ?', id)
    ctx.touched.errors.add(id)
    return { deleted: true }
  },

  'checklist.add': (ctx, { projectId, item }) => {
    requireProject(ctx, projectId)
    if (item.projectRef !== undefined && !projectExists(ctx, item.projectRef)) throw new AppError('VALIDATION', 'Projet lié introuvable.')
    const entry: ChecklistItem = {
      id: ctx.uid('c'),
      label: item.label,
      type: item.type,
      status: defaultChecklistStatus(item.type),
      ...(item.link !== undefined ? { link: item.link } : {}),
      ...(item.projectRef !== undefined ? { projectRef: item.projectRef } : {}),
      ...(item.date !== undefined ? { date: item.date } : {}),
      ...(item.description !== undefined ? { description: item.description } : {}),
    }
    insertChecklistItem(ctx.db, projectId, entry, nextPosition(ctx.db, 'checklist_items', 'WHERE project_id = ?', projectId), entry.projectRef ?? null)
    touchProject(ctx, projectId)
    return entry
  },

  'checklist.update': (ctx, { projectId, itemId, patch }) => updateChecklistRow(ctx, projectId, itemId, (item) => ({ ...item, ...patch })),
  'checklist.cycleStatus': (ctx, { projectId, itemId }) => updateChecklistRow(ctx, projectId, itemId, (item) => ({ ...item, status: nextChecklistStatus(item) })),
  'checklist.setStatus': (ctx, { projectId, itemId, status }) => updateChecklistRow(ctx, projectId, itemId, (item) => ({ ...item, status })),

  'checklist.remove': (ctx, { projectId, itemId }) => {
    requireProject(ctx, projectId)
    const deleted = Number(ctx.db.run('DELETE FROM checklist_items WHERE project_id = ? AND id = ?', projectId, itemId).changes) > 0
    touchProject(ctx, projectId)
    return { deleted }
  },

  'tasks.add': (ctx, { projectId, name, parentId }) => {
    const project = requireProject(ctx, projectId)
    const existing = new Set(collectTaskIds(project.tasks).map((task) => task.id))
    const task: TaskNode = { id: makeUid(ctx.db, 't', (candidate) => existing.has(candidate)), name, content: '', status: 'a_faire', children: [] }
    if (parentId !== undefined && !findTaskNode(project.tasks, parentId)) throw new AppError('NOT_FOUND', 'Tâche parente introuvable.')
    const tasks = withTasks(ctx, projectId, (list) => addTaskNode(list, parentId ?? null, task))
    return findTaskNode(tasks, task.id)!
  },

  'tasks.update': (ctx, { projectId, taskId, patch }) => {
    const project = requireProject(ctx, projectId)
    if (!findTaskNode(project.tasks, taskId)) throw new AppError('NOT_FOUND', 'Tâche introuvable.')
    const tasks = withTasks(ctx, projectId, (list) => updateTaskNode(list, taskId, (task) => ({ ...task, ...patch })))
    return findTaskNode(tasks, taskId)!
  },

  'tasks.cycleStatus': (ctx, { projectId, taskId }) => {
    const project = requireProject(ctx, projectId)
    if (!findTaskNode(project.tasks, taskId)) throw new AppError('NOT_FOUND', 'Tâche introuvable.')
    const tasks = withTasks(ctx, projectId, (list) =>
      updateTaskNode(list, taskId, (task) => ({ ...task, status: TASK_STATUS_ORDER[(TASK_STATUS_ORDER.indexOf(task.status) + 1) % TASK_STATUS_ORDER.length] }))
    )
    return findTaskNode(tasks, taskId)!
  },

  'tasks.remove': (ctx, { projectId, taskId }) => {
    const project = requireProject(ctx, projectId)
    const deleted = !!findTaskNode(project.tasks, taskId)
    withTasks(ctx, projectId, (list) => removeTaskNode(list, taskId))
    return { deleted }
  },

  'tasks.move': (ctx, { projectId, draggedId, targetId, position }) => {
    if (draggedId === targetId) return { moved: false }
    const project = requireProject(ctx, projectId)
    const { node, rest } = extractTaskNode(project.tasks, draggedId)
    if (!node || node.id === targetId || isTaskDescendant(node, targetId) || !findTaskNode(rest, targetId)) return { moved: false }
    withTasks(ctx, projectId, () => insertTaskNode(rest, targetId, node, position))
    return { moved: true }
  },

  'deadlines.add': (ctx, { projectId, label, date }) => {
    requireProject(ctx, projectId)
    const deadline: Deadline = { id: ctx.uid('d'), label, date, status: deadlineStatusFor(date, ctx.today) }
    insertDeadline(ctx.db, projectId, deadline, nextPosition(ctx.db, 'deadlines', 'WHERE project_id = ?', projectId))
    touchProject(ctx, projectId)
    return deadline
  },

  'deadlines.toggleDone': (ctx, { projectId, deadlineId }) => {
    const project = requireProject(ctx, projectId)
    const deadline = project.deadlines.find((entry) => entry.id === deadlineId)
    if (!deadline) throw new AppError('NOT_FOUND', 'Échéance introuvable.')
    const status = deadline.status === 'fait' ? deadlineStatusFor(deadline.date, ctx.today) : 'fait'
    ctx.db.run('UPDATE deadlines SET status = ?, revision = revision + 1 WHERE project_id = ? AND id = ?', status, projectId, deadlineId)
    touchProject(ctx, projectId)
    return { ...deadline, status }
  },

  'deadlines.remove': (ctx, { projectId, deadlineId }) => {
    requireProject(ctx, projectId)
    const deleted = Number(ctx.db.run('DELETE FROM deadlines WHERE project_id = ? AND id = ?', projectId, deadlineId).changes) > 0
    touchProject(ctx, projectId)
    return { deleted }
  },

  'links.add': (ctx, { projectId, input }) => {
    requireProject(ctx, projectId)
    const link = { id: ctx.uid('l'), title: input.title, url: input.url }
    insertLink(ctx.db, projectId, link, nextPosition(ctx.db, 'project_links', 'WHERE project_id = ?', projectId))
    touchProject(ctx, projectId)
    return link
  },

  'links.update': (ctx, { projectId, linkId, patch }) => {
    const project = requireProject(ctx, projectId)
    const link = project.links.find((entry) => entry.id === linkId)
    if (!link) throw new AppError('NOT_FOUND', 'Lien introuvable.')
    const next = { ...link, ...patch }
    ctx.db.run('UPDATE project_links SET title = ?, url = ?, extra_json = ?, revision = revision + 1 WHERE project_id = ? AND id = ?', next.title, next.url, splitExtra(next, LINK_KEYS), projectId, linkId)
    touchProject(ctx, projectId)
    return next
  },

  'links.remove': (ctx, { projectId, linkId }) => {
    requireProject(ctx, projectId)
    const deleted = Number(ctx.db.run('DELETE FROM project_links WHERE project_id = ? AND id = ?', projectId, linkId).changes) > 0
    touchProject(ctx, projectId)
    return { deleted }
  },

  'blocks.setLayout': (ctx, { projectId, layout }) => updateBlocks(ctx, projectId, () => layout as ProjectModule[]),
  'blocks.add': (ctx, { projectId, block }) => updateBlocks(ctx, projectId, (layout) => layout.concat([block as ProjectModule])),
  'blocks.remove': (ctx, { projectId, blockId }) => updateBlocks(ctx, projectId, (layout) => layout.filter((module) => module.id !== blockId)),
  'blocks.update': (ctx, { projectId, blockId, patch }) =>
    updateBlocks(ctx, projectId, (layout) => {
      if (!layout.some((module) => module.id === blockId)) throw new AppError('NOT_FOUND', 'Bloc introuvable.')
      const { id: _id, ...rest } = patch as Partial<ProjectModule>
      void _id
      return layout.map((module) => (module.id === blockId ? ({ ...module, ...rest } as ProjectModule) : module))
    }),
  'blocks.toggleNote': (ctx, { projectId, noteId }) =>
    updateBlocks(ctx, projectId, (layout) => {
      const existing = layout.find((module) => module.type === 'note' && module.refId === noteId)
      if (existing) return layout.filter((module) => module.id !== existing.id)
      const ids = new Set(layout.map((module) => module.id))
      return layout.concat([{ id: makeUid(ctx.db, 'mod', (candidate) => ids.has(candidate)), type: 'note', refId: noteId }])
    }),

  'taxonomy.addCategory': (ctx, { name }) => {
    if (!ctx.db.get('SELECT 1 AS present FROM categories WHERE name = ?', name)) {
      ctx.db.run('INSERT INTO categories (name, position) VALUES (?, ?)', name, nextPosition(ctx.db, 'categories'))
      ctx.touched.taxonomy = true
    }
    return readTaxonomy(ctx.db).categories
  },

  'taxonomy.addPlatform': (ctx, { type, name }) => {
    if (!ctx.db.get('SELECT 1 AS present FROM platforms WHERE project_type = ? AND name = ?', type, name)) {
      ctx.db.run('INSERT INTO platforms (project_type, name, position) VALUES (?, ?, ?)', type, name, nextPosition(ctx.db, 'platforms', 'WHERE project_type = ?', type))
      ctx.touched.taxonomy = true
    }
    return readTaxonomy(ctx.db).platforms
  },

  'week.setSlots': (ctx, { slots }) => {
    setActiveSlots(ctx.db, slots as never, ctx.now)
    ctx.touched.week = true
    return readWeekFacade(ctx.db)
  },
  'week.setWakeTimes': (ctx, { wakeTimes }) => {
    setActiveWakeTimes(ctx.db, wakeTimes, ctx.now)
    ctx.touched.week = true
    return readWeekFacade(ctx.db)
  },
  'week.select': (ctx, { id }) => {
    selectWeek(ctx.db, id)
    ctx.touched.week = true
    return readWeekFacade(ctx.db)
  },
  'week.create': (ctx, { name, copy }) => {
    createWeek(ctx.db, { id: ctx.uid('week-preset'), name, copy, now: ctx.now })
    ctx.touched.week = true
    return readWeekFacade(ctx.db)
  },
  'week.rename': (ctx, { name }) => {
    renameActiveWeek(ctx.db, name, ctx.now)
    ctx.touched.week = true
    return readWeekFacade(ctx.db)
  },

  'settings.get': (ctx) => readSettings(ctx.db),
  'settings.update': (ctx, { patch }) => {
    writeKeyValues(ctx, 'settings', patch)
    ctx.touched.settings = true
    return readSettings(ctx.db)
  },
  'preferences.update': (ctx, { patch }) => {
    writeKeyValues(ctx, 'preferences', patch)
    ctx.touched.preferences = true
    return readPreferences(ctx.db)
  },
  'preferences.adoptLegacy': (ctx, { values }) => {
    if (ctx.db.get('SELECT 1 AS present FROM import_markers WHERE kind = ?', PREFERENCES_MARKER)) return { adopted: false, preferences: readPreferences(ctx.db) }
    const imported = Object.fromEntries(Object.entries(preferencesFromLegacy(values)).filter(([key]) => !ctx.db.get('SELECT 1 AS present FROM preferences WHERE key = ?', key)))
    writeKeyValues(ctx, 'preferences', imported)
    ctx.db.run('INSERT INTO import_markers (kind, completed_at) VALUES (?, ?)', PREFERENCES_MARKER, ctx.now)
    ctx.touched.preferences = true
    return { adopted: true, preferences: readPreferences(ctx.db) }
  },
}

export function collectChanges(db: Database, touched: Touched): DataChange[] {
  const changes: DataChange[] = []
  for (const id of touched.projects) changes.push({ entity: 'project', id, value: readProject(db, id) })
  for (const id of touched.notes) changes.push({ entity: 'note', id, value: readNote(db, id) })
  for (const id of touched.errors) changes.push({ entity: 'error', id, value: readError(db, id) })
  for (const id of touched.folders) changes.push({ entity: 'folder', id, value: readFolder(db, id) })
  for (const id of touched.trash) changes.push({ entity: 'trash', id, value: readTrashEntry(db, id) })
  if (touched.taxonomy) changes.push({ entity: 'taxonomy', value: readTaxonomy(db) })
  if (touched.week) changes.push({ entity: 'week', value: readWeekFacade(db) })
  if (touched.settings) changes.push({ entity: 'settings', value: readSettings(db) })
  if (touched.preferences) changes.push({ entity: 'preferences', value: readPreferences(db) })
  return changes
}

export { readSettings }
