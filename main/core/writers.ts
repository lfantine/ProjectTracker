import type { ChecklistItem, Deadline, ErrorEntry, Note, Project, ProjectFolder, ProjectLink, ProjectModule, TaskNode, TrashedNote } from '../../shared/domain'
import type { InstanceBinding } from '../../shared/bindings'
import { isCoreBlockType } from '../../shared/core'
import { CORE_PACKAGE_ID } from '../../shared/ids'
import type { Database } from '../db/database'
import { nullable, splitExtra } from './json'

// Low-level inserts shared by the legacy importer and the commands. Callers
// are responsible for reference checks and for running inside a transaction.

export const PROJECT_KEYS = ['id', 'name', 'type', 'category', 'platforms', 'tags', 'folderId', 'status', 'createdAt', 'updatedAt', 'lastOpenedAt', 'description', 'stack', 'path', 'noteIds', 'errorIds', 'checklist', 'tasks', 'deadlines', 'links', 'layout', 'revision'] as const
export const TASK_KEYS = ['id', 'name', 'content', 'status', 'children'] as const
export const CHECKLIST_KEYS = ['id', 'label', 'type', 'status', 'link', 'projectRef', 'date', 'description'] as const
export const DEADLINE_KEYS = ['id', 'label', 'date', 'status'] as const
export const LINK_KEYS = ['id', 'title', 'url'] as const
export const NOTE_KEYS = ['id', 'title', 'content', 'tags', 'raw', 'createdAt', 'updatedAt', 'revision'] as const
export const ERROR_KEYS = ['id', 'title', 'content', 'causes', 'solution', 'createdAt', 'projectIds', 'revision'] as const
export const FOLDER_KEYS = ['id', 'name', 'kind', 'displayMode', 'description', 'tagFilter', 'revision'] as const

export function insertProjectRow(db: Database, project: Project, position: number, folderId: string | null) {
  db.run(
    `INSERT INTO projects (id, name, type, category, folder_id, status, created_at, updated_at, last_opened_at, description, path, has_stack, position, extra_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    project.id,
    project.name,
    project.type,
    project.category,
    folderId,
    project.status,
    project.createdAt,
    project.updatedAt,
    nullable(project.lastOpenedAt),
    nullable(project.description),
    nullable(project.path),
    Array.isArray(project.stack) ? 1 : 0,
    position,
    splitExtra(project, PROJECT_KEYS)
  )
}

const LIST_TABLES = {
  platforms: ['project_platforms', 'platform'],
  tags: ['project_tags', 'tag'],
  stack: ['project_stack', 'item'],
} as const

export function replaceProjectList(db: Database, projectId: string, list: keyof typeof LIST_TABLES, values: readonly string[]) {
  const [table, column] = LIST_TABLES[list]
  db.run(`DELETE FROM ${table} WHERE project_id = ?`, projectId)
  values.forEach((value, index) => db.run(`INSERT INTO ${table} (project_id, position, ${column}) VALUES (?, ?, ?)`, projectId, index, value))
}

export function insertTaskTree(db: Database, projectId: string, tasks: readonly TaskNode[], parentId: string | null = null) {
  tasks.forEach((task, index) => {
    db.run(
      'INSERT INTO tasks (project_id, id, parent_id, position, name, content, status, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      projectId, task.id, parentId, index, task.name, task.content ?? '', task.status, splitExtra(task, TASK_KEYS)
    )
    insertTaskTree(db, projectId, task.children ?? [], task.id)
  })
}

export function insertChecklistItem(db: Database, projectId: string, item: ChecklistItem, position: number, projectRef: string | null) {
  db.run(
    'INSERT INTO checklist_items (project_id, id, position, label, type, status, link, project_ref, date, description, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    projectId, item.id, position, item.label, item.type, item.status, nullable(item.link), projectRef, nullable(item.date), nullable(item.description), splitExtra(item, CHECKLIST_KEYS)
  )
}

export function insertDeadline(db: Database, projectId: string, deadline: Deadline, position: number) {
  db.run(
    'INSERT INTO deadlines (project_id, id, position, label, date, status, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    projectId, deadline.id, position, deadline.label, deadline.date, deadline.status, splitExtra(deadline, DEADLINE_KEYS)
  )
}

export function insertLink(db: Database, projectId: string, link: ProjectLink, position: number) {
  db.run(
    'INSERT INTO project_links (project_id, id, position, title, url, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
    projectId, link.id, position, link.title, link.url, splitExtra(link, LINK_KEYS)
  )
}

// A core block keeps every field except id/type in its raw configuration, so
// custom titles, table data and partially typed chart values round-trip
// untouched. Anything else is stored with its contribution reference.
export function moduleToBlock(module: ProjectModule): { packageId: string; contributionId: string; config: Record<string, unknown>; binding: InstanceBinding } {
  if (module.type === 'external') {
    return {
      packageId: module.contribution?.packageId ?? CORE_PACKAGE_ID,
      contributionId: module.contribution?.contributionId ?? 'unknown',
      config: module.config ?? {},
      binding: module.binding ?? { mode: 'none' },
    }
  }
  const { id: _id, type, contribution: _c, binding: _b, config: _cfg, ...config } = module as ProjectModule & Record<string, unknown>
  void _id
  void _c
  void _b
  void _cfg
  return { packageId: CORE_PACKAGE_ID, contributionId: String(type), config, binding: { mode: 'none' } }
}

export function insertBlock(db: Database, projectId: string, module: ProjectModule, position: number) {
  const block = moduleToBlock(module)
  db.run(
    'INSERT INTO project_blocks (project_id, block_id, position, package_id, contribution_id, config_version, config_json, binding_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    projectId, module.id, position, block.packageId, block.contributionId, 1, JSON.stringify(block.config), JSON.stringify(block.binding)
  )
}

export function isKnownCoreModule(module: { type?: unknown }): boolean {
  return isCoreBlockType(module.type)
}

export function insertNote(db: Database, note: Note, position: number) {
  db.run(
    'INSERT INTO notes (id, title, content, raw, created_at, updated_at, position, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    note.id, note.title, note.content, note.raw === undefined ? null : note.raw ? 1 : 0, note.createdAt, note.updatedAt, position, splitExtra(note, NOTE_KEYS)
  )
  setNoteTags(db, note.id, note.tags ?? [])
}

export function setNoteTags(db: Database, noteId: string, tags: readonly string[]) {
  db.run('DELETE FROM note_tags WHERE note_id = ?', noteId)
  tags.forEach((tag, index) => db.run('INSERT INTO note_tags (note_id, position, tag) VALUES (?, ?, ?)', noteId, index, tag))
}

export function insertError(db: Database, error: ErrorEntry, position: number) {
  db.run(
    'INSERT INTO errors (id, title, content, causes, solution, created_at, position, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    error.id, error.title, error.content ?? '', error.causes ?? '', error.solution ?? '', error.createdAt, position, splitExtra(error, ERROR_KEYS)
  )
}

export function setErrorProjects(db: Database, errorId: string, projectIds: readonly string[]) {
  db.run('DELETE FROM error_projects WHERE error_id = ?', errorId)
  projectIds.forEach((projectId, index) => db.run('INSERT INTO error_projects (error_id, project_id, position) VALUES (?, ?, ?)', errorId, projectId, index))
}

export function insertFolder(db: Database, folder: ProjectFolder, position: number) {
  db.run(
    'INSERT INTO folders (id, name, kind, display_mode, description, tag_filter_json, position, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    folder.id, folder.name, folder.kind, folder.displayMode, nullable(folder.description), folder.tagFilter === undefined ? null : JSON.stringify(folder.tagFilter), position, splitExtra(folder, FOLDER_KEYS)
  )
}

export function insertTrashEntry(db: Database, entry: TrashedNote, position: number, projectName: (projectId: string) => string | null) {
  db.run('INSERT INTO trashed_notes (note_id, note_json, deleted_at, position) VALUES (?, ?, ?, ?)', entry.note.id, JSON.stringify(entry.note), entry.deletedAt, position)
  entry.links.forEach((link, index) =>
    db.run(
      'INSERT INTO trashed_note_links (note_id, position, project_id, project_name, modules_json) VALUES (?, ?, ?, ?, ?)',
      entry.note.id, index, link.projectId, projectName(link.projectId), JSON.stringify(link.modules ?? [])
    )
  )
}

export function nextPosition(db: Database, table: string, where = '', ...params: (string | number)[]): number {
  return Number(db.get<{ next: number }>(`SELECT COALESCE(MAX(position) + 1, 0) AS next FROM ${table} ${where}`, ...params)?.next ?? 0)
}

export function bumpRevision(db: Database): number {
  db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
  return Number(db.get<{ revision: number }>('SELECT revision FROM data_revision WHERE id = 1')!.revision)
}
