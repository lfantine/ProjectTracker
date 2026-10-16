import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { CORE_RESOURCES, type CoreResource } from '../../shared/permissions'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { CoreErrorView, CoreNoteView, CoreProjectView, SdkContext } from '../../shared/sdk'
import type { Database } from '../db/database'
import { CoreService } from '../core/service'

const id = z.string().min(1).max(200)
const resource = z.enum(CORE_RESOURCES)
export const coreSchemas = {
  'core.get': z.object({ resource, id }).strict(),
  'core.list': z.object({ resource, cursor: id.optional(), limit: z.number().int().min(1).max(RUNTIME_LIMITS.maxPageSize).optional() }).strict(),
  'core.update': z.object({ resource, id, patch: z.record(z.string(), z.json()), expectedRevision: z.number().int().positive() }).strict(),
}
const string = z.string().max(500)
const text = z.string().max(1_000_000)
const tags = z.array(string).max(500)
const patches = {
  projects: z.object({ name: string.optional(), status: z.enum(['actif', 'pause', 'termine', 'aborted']).optional(), type: z.enum(['dev', 'video']).optional(), category: string.optional(), tags: tags.optional(), description: text.optional() }).strict(),
  notes: z.object({ title: string.optional(), content: text.optional(), tags: tags.optional() }).strict(),
  errors: z.object({ title: string.optional(), content: text.optional(), causes: text.optional(), solution: text.optional() }).strict(),
}
export function requireCorePermission(context: SdkContext, resource: CoreResource, action: 'read' | 'write'): void {
  if (!context.permissions.core[resource]?.includes(action)) throw new AppError('PERMISSION_DENIED', 'Accès CORE non autorisé.')
}

type CoreView = CoreProjectView | CoreNoteView | CoreErrorView
// Explicit SELECT lists, never object spreading from AppData/readModel. Paths,
// tasks, layouts, metadata, settings and raw/legacy fields are not SDK views.
export class CoreApi {
  constructor(private readonly db: Database, private readonly service: CoreService) {}
  get(context: SdkContext, resource: CoreResource, id: string): CoreView | null {
    requireCorePermission(context, resource, 'read')
    if (resource === 'projects') {
      const row = this.db.get<Omit<CoreProjectView, 'tags'> & { description: string | null }>('SELECT id, name, status, type, category, description, revision FROM projects WHERE id = ?', id)
      if (!row) return null
      const view: CoreProjectView = { id: row.id, name: row.name, status: row.status, type: row.type, category: row.category, revision: row.revision, tags: this.db.all<{ tag: string }>('SELECT tag FROM project_tags WHERE project_id = ? ORDER BY position', id).map((entry) => entry.tag) }
      if (row.description !== null) view.description = row.description
      return view
    }
    if (resource === 'notes') {
      const row = this.db.get<Omit<CoreNoteView, 'tags'>>('SELECT id, title, content, revision FROM notes WHERE id = ?', id)
      return row ? { ...row, tags: this.db.all<{ tag: string }>('SELECT tag FROM note_tags WHERE note_id = ? ORDER BY position', id).map((entry) => entry.tag) } : null
    }
    const row = this.db.get<Omit<CoreErrorView, 'projectIds'>>('SELECT id, title, content, causes, solution, revision FROM errors WHERE id = ?', id)
    return row ? { ...row, projectIds: this.db.all<{ project_id: string }>('SELECT project_id FROM error_projects WHERE error_id = ? ORDER BY position', id).map((entry) => entry.project_id) } : null
  }
  list(context: SdkContext, resource: CoreResource, cursor?: string, limit = 50): { items: CoreView[]; nextCursor: string | null } {
    requireCorePermission(context, resource, 'read')
    // `resource` is validated by the closed schema before reaching this API.
    const rows = this.db.all<{ id: string }>(`SELECT id FROM ${resource} WHERE id > ? ORDER BY id LIMIT ?`, cursor ?? '', limit + 1)
    const items = rows.slice(0, limit).map((row) => this.get(context, resource, row.id)!)
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null }
  }
  update(context: SdkContext, resource: CoreResource, id: string, patch: Record<string, unknown>, expectedRevision: number): { revision: number } {
    requireCorePermission(context, resource, 'write')
    const parsed = patches[resource].safeParse(patch)
    if (!parsed.success || !Object.keys(parsed.data).length) throw new AppError('VALIDATION', 'Champs CORE non autorisés ou invalides.')
    const result = this.service.execute(`${resource}.update`, { id, patch: parsed.data, expectedRevision })
    if (!result.ok) throw new AppError(result.error.code, result.error.message, result.error.details)
    const row = this.db.get<{ revision: number }>(`SELECT revision FROM ${resource} WHERE id = ?`, id)
    if (!row) throw new AppError('NOT_FOUND', 'Entité CORE introuvable.')
    return { revision: row.revision }
  }
}
