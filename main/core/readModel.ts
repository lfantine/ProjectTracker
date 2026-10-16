import type {
  AppData,
  ChecklistItem,
  Deadline,
  ErrorEntry,
  Note,
  Project,
  ProjectFolder,
  ProjectLink,
  ProjectModule,
  ProjectType,
  TaskNode,
  TrashedNote,
} from '../../shared/domain'
import type { WeekFacade } from '../../shared/commands'
import { isCoreBlockType } from '../../shared/core'
import { CORE_PACKAGE_ID } from '../../shared/ids'
import type { InstanceBinding } from '../../shared/bindings'
import type { Database } from '../db/database'
import { optional, parseJson, readExtra, withOptional } from './json'
import { readWeekFacade } from './week'

// Temporary read facade: rebuilds the AppData shape the existing screens use
// from the relational tables. It is a projection of SQLite, never a second
// source of truth.

interface ProjectRow {
  id: string
  name: string
  type: string
  category: string
  folder_id: string | null
  status: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
  description: string | null
  path: string | null
  has_stack: number
  revision: number
  extra_json: string | null
}

interface TaskRow {
  project_id: string
  id: string
  parent_id: string | null
  name: string
  content: string
  status: string
  extra_json: string | null
}

interface ChecklistRow {
  project_id: string
  id: string
  label: string
  type: string
  status: string
  link: string | null
  project_ref: string | null
  date: string | null
  description: string | null
  extra_json: string | null
}

interface DeadlineRow {
  project_id: string
  id: string
  label: string
  date: string
  status: string
  extra_json: string | null
}

interface LinkRow {
  project_id: string
  id: string
  title: string
  url: string
  extra_json: string | null
}

export interface BlockRow {
  project_id: string
  block_id: string
  package_id: string
  contribution_id: string
  config_json: string
  binding_json: string
}

interface NoteRow {
  id: string
  title: string
  content: string
  raw: number | null
  created_at: string
  updated_at: string
  revision: number
  extra_json: string | null
}

interface ErrorRow {
  id: string
  title: string
  content: string
  causes: string
  solution: string
  created_at: string
  revision: number
  extra_json: string | null
}

interface FolderRow {
  id: string
  name: string
  kind: string
  display_mode: string
  description: string | null
  tag_filter_json: string | null
  revision: number
  extra_json: string | null
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

function buildTaskTree(rows: TaskRow[]): TaskNode[] {
  const byParent = groupBy(rows, (row) => row.parent_id)
  const build = (parentId: string | null): TaskNode[] =>
    (byParent.get(parentId) ?? []).map((row) => ({
      ...readExtra(row.extra_json),
      id: row.id,
      name: row.name,
      content: row.content,
      status: row.status as TaskNode['status'],
      children: build(row.id),
    }))
  return build(null)
}

export function blockToModule(row: Pick<BlockRow, 'block_id' | 'package_id' | 'contribution_id' | 'config_json' | 'binding_json'>): ProjectModule {
  const config = parseJson<Record<string, unknown>>(row.config_json, {})
  if (row.package_id === CORE_PACKAGE_ID && isCoreBlockType(row.contribution_id)) {
    return { ...config, id: row.block_id, type: row.contribution_id } as ProjectModule
  }
  return {
    id: row.block_id,
    type: 'external',
    contribution: { packageId: row.package_id, contributionId: row.contribution_id },
    binding: parseJson<InstanceBinding>(row.binding_json, { mode: 'none' }),
    config,
  }
}

function checklistItem(row: ChecklistRow): ChecklistItem {
  return withOptional(
    { ...readExtra(row.extra_json), id: row.id, label: row.label, type: row.type, status: row.status } as ChecklistItem,
    { link: row.link, projectRef: row.project_ref, date: row.date, description: row.description }
  )
}

function deadline(row: DeadlineRow): Deadline {
  return { ...readExtra(row.extra_json), id: row.id, label: row.label, date: row.date, status: row.status as Deadline['status'] }
}

function link(row: LinkRow): ProjectLink {
  return { ...readExtra(row.extra_json), id: row.id, title: row.title, url: row.url }
}

interface ProjectChildren {
  platforms: Map<string, string[]>
  tags: Map<string, string[]>
  stack: Map<string, string[]>
  notes: Map<string, string[]>
  errors: Map<string, string[]>
  tasks: Map<string, TaskRow[]>
  checklist: Map<string, ChecklistRow[]>
  deadlines: Map<string, DeadlineRow[]>
  links: Map<string, LinkRow[]>
  blocks: Map<string, BlockRow[]>
}

function loadChildren(db: Database, projectId?: string): ProjectChildren {
  const where = projectId === undefined ? '' : 'WHERE project_id = ?'
  const params = projectId === undefined ? [] : [projectId]
  const values = (table: string, column: string) =>
    new Map(
      [...groupBy(db.all<{ project_id: string; value: string }>(`SELECT project_id, ${column} AS value FROM ${table} ${where} ORDER BY project_id, position`, ...params), (row) => row.project_id)].map(
        ([id, rows]) => [id, rows.map((row) => row.value)]
      )
    )
  return {
    platforms: values('project_platforms', 'platform'),
    tags: values('project_tags', 'tag'),
    stack: values('project_stack', 'item'),
    notes: values('project_notes', 'note_id'),
    errors: values('project_errors', 'error_id'),
    tasks: groupBy(db.all<TaskRow>(`SELECT * FROM tasks ${where} ORDER BY project_id, position`, ...params), (row) => row.project_id),
    checklist: groupBy(db.all<ChecklistRow>(`SELECT * FROM checklist_items ${where} ORDER BY project_id, position`, ...params), (row) => row.project_id),
    deadlines: groupBy(db.all<DeadlineRow>(`SELECT * FROM deadlines ${where} ORDER BY project_id, position`, ...params), (row) => row.project_id),
    links: groupBy(db.all<LinkRow>(`SELECT * FROM project_links ${where} ORDER BY project_id, position`, ...params), (row) => row.project_id),
    blocks: groupBy(db.all<BlockRow>(`SELECT * FROM project_blocks ${where} ORDER BY project_id, position`, ...params), (row) => row.project_id),
  }
}

function project(row: ProjectRow, children: ProjectChildren): Project {
  const id = row.id
  const result = {
    ...readExtra(row.extra_json),
    id,
    name: row.name,
    type: row.type as ProjectType,
    category: row.category,
    platforms: children.platforms.get(id) ?? [],
    tags: children.tags.get(id) ?? [],
    status: row.status as Project['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    noteIds: children.notes.get(id) ?? [],
    errorIds: children.errors.get(id) ?? [],
    checklist: (children.checklist.get(id) ?? []).map(checklistItem),
    tasks: buildTaskTree(children.tasks.get(id) ?? []),
    deadlines: (children.deadlines.get(id) ?? []).map(deadline),
    links: (children.links.get(id) ?? []).map(link),
    layout: (children.blocks.get(id) ?? []).map(blockToModule),
    revision: row.revision,
  } as Project
  withOptional(result, { folderId: row.folder_id, lastOpenedAt: row.last_opened_at, description: row.description, path: row.path })
  if (row.has_stack) result.stack = children.stack.get(id) ?? []
  return result
}

export function readProject(db: Database, id: string): Project | null {
  const row = db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
  return row ? project(row, loadChildren(db, id)) : null
}

export function readProjects(db: Database): Project[] {
  const children = loadChildren(db)
  return db.all<ProjectRow>('SELECT * FROM projects ORDER BY position').map((row) => project(row, children))
}

function noteFrom(row: NoteRow, tags: string[]): Note {
  return withOptional(
    { ...readExtra(row.extra_json), id: row.id, title: row.title, content: row.content, tags, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision } as Note,
    { raw: row.raw === null ? undefined : row.raw === 1 }
  )
}

export function readNote(db: Database, id: string): Note | null {
  const row = db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', id)
  if (!row) return null
  return noteFrom(row, db.all<{ tag: string }>('SELECT tag FROM note_tags WHERE note_id = ? ORDER BY position', id).map((tag) => tag.tag))
}

export function readNotes(db: Database): Note[] {
  const tags = groupBy(db.all<{ note_id: string; tag: string }>('SELECT note_id, tag FROM note_tags ORDER BY note_id, position'), (row) => row.note_id)
  return db.all<NoteRow>('SELECT * FROM notes ORDER BY position').map((row) => noteFrom(row, (tags.get(row.id) ?? []).map((tag) => tag.tag)))
}

function errorFrom(row: ErrorRow, projectIds: string[]): ErrorEntry {
  return {
    ...readExtra(row.extra_json),
    id: row.id,
    title: row.title,
    content: row.content,
    causes: row.causes,
    solution: row.solution,
    createdAt: row.created_at,
    projectIds,
    revision: row.revision,
  }
}

export function readError(db: Database, id: string): ErrorEntry | null {
  const row = db.get<ErrorRow>('SELECT * FROM errors WHERE id = ?', id)
  if (!row) return null
  return errorFrom(row, db.all<{ project_id: string }>('SELECT project_id FROM error_projects WHERE error_id = ? ORDER BY position', id).map((entry) => entry.project_id))
}

export function readErrors(db: Database): ErrorEntry[] {
  const links = groupBy(db.all<{ error_id: string; project_id: string }>('SELECT error_id, project_id FROM error_projects ORDER BY error_id, position'), (row) => row.error_id)
  return db.all<ErrorRow>('SELECT * FROM errors ORDER BY position').map((row) => errorFrom(row, (links.get(row.id) ?? []).map((entry) => entry.project_id)))
}

function folderFrom(row: FolderRow): ProjectFolder {
  return withOptional(
    { ...readExtra(row.extra_json), id: row.id, name: row.name, kind: row.kind, displayMode: row.display_mode, revision: row.revision } as ProjectFolder,
    { description: row.description, tagFilter: row.tag_filter_json === null ? undefined : parseJson<string[]>(row.tag_filter_json, []) }
  )
}

export function readFolder(db: Database, id: string): ProjectFolder | null {
  const row = db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', id)
  return row ? folderFrom(row) : null
}

export function readFolders(db: Database): ProjectFolder[] {
  return db.all<FolderRow>('SELECT * FROM folders ORDER BY position').map(folderFrom)
}

interface TrashRow {
  note_id: string
  note_json: string
  deleted_at: string
}

function trashFrom(db: Database, row: TrashRow): TrashedNote {
  const links = db
    .all<{ project_id: string; modules_json: string }>('SELECT project_id, modules_json FROM trashed_note_links WHERE note_id = ? ORDER BY position', row.note_id)
    .map((entry) => ({ projectId: entry.project_id, modules: parseJson<ProjectModule[]>(entry.modules_json, []) }))
  return { note: parseJson<Note>(row.note_json, { id: row.note_id } as Note), deletedAt: row.deleted_at, links }
}

export function readTrashEntry(db: Database, noteId: string): TrashedNote | null {
  const row = db.get<TrashRow>('SELECT * FROM trashed_notes WHERE note_id = ?', noteId)
  return row ? trashFrom(db, row) : null
}

export function readTrash(db: Database): TrashedNote[] {
  return db.all<TrashRow>('SELECT * FROM trashed_notes ORDER BY position').map((row) => trashFrom(db, row))
}

export function readTaxonomy(db: Database): Pick<AppData, 'categories' | 'platforms'> {
  const categories = db.all<{ name: string }>('SELECT name FROM categories ORDER BY position').map((row) => row.name)
  const platforms: Record<ProjectType, string[]> = { dev: [], video: [] }
  for (const row of db.all<{ project_type: string; name: string }>('SELECT project_type, name FROM platforms ORDER BY project_type, position')) {
    ;(platforms[row.project_type as ProjectType] ??= []).push(row.name)
  }
  return { categories, platforms }
}

export function weekFields(facade: WeekFacade): Pick<AppData, 'weekPresets' | 'activeWeekPresetId' | 'weekSlots' | 'wakeTimes'> {
  const active = facade.weekPresets.find((preset) => preset.id === facade.activeWeekPresetId) ?? facade.weekPresets[0]
  return {
    weekPresets: facade.weekPresets,
    activeWeekPresetId: active?.id,
    weekSlots: active?.slots ?? [],
    wakeTimes: active?.wakeTimes ?? [],
  }
}

export function buildAppData(db: Database): AppData {
  return {
    ...readTaxonomy(db),
    folders: readFolders(db),
    projects: readProjects(db),
    notes: readNotes(db),
    errors: readErrors(db),
    trashedNotes: readTrash(db),
  }
}

// Legacy JSON export/import regression projection only; never sent to the shell.
export function buildLegacyAppData(db: Database): AppData {
  return { ...buildAppData(db), ...weekFields(readWeekFacade(db)) }
}

export function currentRevision(db: Database): number {
  return Number(db.get<{ revision: number }>('SELECT revision FROM data_revision WHERE id = 1')?.revision ?? 0)
}

export { optional }
