import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { InstanceSummary, SdkContext } from '../../shared/sdk'
import type { Database } from '../db/database'
import { currentRevision } from '../core/readModel'
import { CoreService } from '../core/service'
import { createInstance, deleteInstance, getActiveInstanceId, getInstance, packageStorageBytes, renameInstance, setActiveInstance } from '../core/packageStore'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const revision = z.number().int().positive()
export const instanceSchemas = {
  'instances.list': z.object({ cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(RUNTIME_LIMITS.maxPageSize).optional() }).strict(),
  'instances.create': z.object({ name: z.string().trim().min(1).max(80), copyFrom: id.optional(), operationId: z.string().min(8).max(100) }).strict(),
  'instances.rename': z.object({ instanceId: id, name: z.string().trim().min(1).max(80), expectedRevision: revision }).strict(),
  'instances.delete': z.object({ instanceId: id, expectedRevision: revision }).strict(),
  'instances.setActive': z.object({ instanceId: id, expectedActiveInstanceId: id.nullable() }).strict(),
} as const
export interface InstanceChange { packageId: string; majorId: string; instanceId: string; action: 'created' | 'renamed' | 'deleted' | 'active'; revision: number }
export interface InstanceDeletion { packageId: string; majorId: string; instanceId: string; name: string; documentCount: number; usages: { projectPlacements: number; dashboardPlacements: number; sidebarLinks: number } }
export interface InstanceHooks {
  // Native UI must show confirmation/usages. Never accept a boolean supplied
  // by the contribution as proof of consent. No hook means deletion is closed.
  confirmDeletion?: (context: SdkContext, deletion: InstanceDeletion, signal: AbortSignal) => Promise<boolean>
}
export class InstanceApi {
  constructor(private readonly db: Database, private readonly core: CoreService, private readonly hooks: InstanceHooks = {}) {}
  private major(context: SdkContext, write = false): string | null {
    if (write && context.kind !== 'major') throw new AppError('PERMISSION_DENIED', 'Gestion réservée au module majeur.')
    return context.binding.mode === 'none' ? null : context.binding.major.contributionId
  }
  private target(context: SdkContext, instanceId: string, expectedRevision?: number) {
    const major = this.major(context, true)!
    const row = getInstance(this.db, context.packageId, major, instanceId)
    if (!row) throw new AppError('NOT_FOUND', 'Instance introuvable.')
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new AppError('CONFLICT', 'L’instance a été modifiée.', { revision: row.revision })
    if (this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM major_instances WHERE package_id = ? AND instance_id = ?', context.packageId, instanceId)?.count !== 1) throw new AppError('CONFLICT', 'Adresse d’instance ambiguë.')
    return row
  }
  private summary(context: SdkContext, instanceId: string): InstanceSummary {
    const major = this.major(context)!
    const row = getInstance(this.db, context.packageId, major, instanceId)
    if (!row) throw new AppError('CONFLICT', 'L’instance de cette opération n’existe plus.')
    return { instanceId: row.instanceId, name: row.name, position: row.position, revision: row.revision, active: getActiveInstanceId(this.db, context.packageId, major) === instanceId }
  }
  list(context: SdkContext, input: { cursor?: string; limit?: number }): { items: InstanceSummary[]; nextCursor: string | null } {
    const major = this.major(context)
    if (!major) return { items: [], nextCursor: null }
    let position = -1, lastId = ''
    if (input.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error()
        const parsed = z.tuple([z.number().int().nonnegative(), id]).parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')))
        ;[position, lastId] = parsed
      } catch { throw new AppError('VALIDATION', 'Curseur d’instances invalide.') }
    }
    const limit = input.limit ?? 50
    const rows = this.db.all<{ instance_id: string; name: string; position: number; revision: number }>('SELECT instance_id, name, position, revision FROM major_instances WHERE package_id = ? AND major_id = ? AND (position > ? OR (position = ? AND instance_id > ?)) ORDER BY position, instance_id LIMIT ?', context.packageId, major, position, position, lastId, limit + 1)
    const active = getActiveInstanceId(this.db, context.packageId, major)
    const items = rows.slice(0, limit).map((row) => ({ instanceId: row.instance_id, name: row.name, position: row.position, revision: row.revision, active: row.instance_id === active }))
    const last = items.at(-1)
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.position, last.instanceId])).toString('base64url') : null }
  }
  create(context: SdkContext, input: z.infer<typeof instanceSchemas['instances.create']>): { value: InstanceSummary; change: InstanceChange | null } {
    const major = this.major(context, true)!
    const operationId = `sdk-instance-${createHash('sha256').update(JSON.stringify([context.packageId, major, input.operationId])).digest('hex')}`
    const request = JSON.stringify({ name: input.name, copyFrom: input.copyFrom ?? null })
    const result = this.core.commitPackageWrite(() => {
      const previous = this.db.get<{ command: string; result_json: string }>('SELECT command, result_json FROM operations WHERE operation_id = ?', operationId)
      if (previous) {
        const stored = JSON.parse(previous.result_json) as { request: string; instanceId: string }
        if (previous.command !== 'sdk.instances.create' || stored.request !== request) throw new AppError('CONFLICT', 'Identifiant d’opération déjà utilisé.')
        return { changed: false, value: { summary: this.summary(context, stored.instanceId), created: false } }
      }
      const now = new Date().toISOString()
      const instanceId = `inst-${randomBytes(24).toString('hex')}`
      if (this.db.get('SELECT 1 FROM major_instances WHERE package_id = ? AND instance_id = ?', context.packageId, instanceId)) throw new AppError('CONFLICT', 'Identité d’instance déjà utilisée.')
      if (input.copyFrom) this.target(context, input.copyFrom)
      createInstance(this.db, { packageId: context.packageId, majorId: major, instanceId, name: input.name, now })
      if (input.copyFrom) {
        const sizes = this.db.get<{ total: number; largest: number }>('SELECT COALESCE(SUM(size_bytes), 0) AS total, COALESCE(MAX(size_bytes), 0) AS largest FROM package_documents WHERE package_id = ? AND instance_scope = ?', context.packageId, input.copyFrom)!
        if (sizes.largest > RUNTIME_LIMITS.maxDocumentBytes || packageStorageBytes(this.db, context.packageId) + sizes.total > RUNTIME_LIMITS.maxStorageBytesPerPackage) throw new AppError('STORAGE', 'La copie dépasserait le quota du package.')
        this.db.run('INSERT INTO package_documents (package_id, instance_scope, collection, doc_id, value_json, size_bytes, revision, updated_at) SELECT package_id, ?, collection, doc_id, value_json, size_bytes, 1, ? FROM package_documents WHERE package_id = ? AND instance_scope = ?', instanceId, now, context.packageId, input.copyFrom)
      }
      this.db.run('INSERT INTO operations (operation_id, command, result_json, created_at) VALUES (?, ?, ?, ?)', operationId, 'sdk.instances.create', JSON.stringify({ request, instanceId }), now)
      return { changed: true, value: { summary: this.summary(context, instanceId), created: true } }
    })
    return { value: result.value.summary, change: result.value.created ? { packageId: context.packageId, majorId: major, instanceId: result.value.summary.instanceId, action: 'created', revision: result.revision } : null }
  }
  rename(context: SdkContext, input: z.infer<typeof instanceSchemas['instances.rename']>): { value: InstanceSummary; change: InstanceChange | null } {
    const major = this.major(context, true)!
    const result = this.core.commitPackageWrite(() => {
      const row = this.target(context, input.instanceId, input.expectedRevision)
      const changed = row.name !== input.name
      if (changed) renameInstance(this.db, context.packageId, major, input.instanceId, input.name, new Date().toISOString())
      return { changed, value: this.summary(context, input.instanceId) }
    })
    return { value: result.value, change: result.value.revision !== input.expectedRevision ? { packageId: context.packageId, majorId: major, instanceId: input.instanceId, action: 'renamed', revision: result.revision } : null }
  }
  setActive(context: SdkContext, input: z.infer<typeof instanceSchemas['instances.setActive']>): { value: InstanceSummary; change: InstanceChange | null } {
    const major = this.major(context, true)!
    let changed = false
    const result = this.core.commitPackageWrite(() => {
      this.target(context, input.instanceId)
      const previous = getActiveInstanceId(this.db, context.packageId, major)
      if (previous !== input.expectedActiveInstanceId) throw new AppError('CONFLICT', 'L’instance active a changé.')
      changed = previous !== input.instanceId
      if (changed) setActiveInstance(this.db, context.packageId, major, input.instanceId)
      return { changed, value: this.summary(context, input.instanceId) }
    })
    return { value: result.value, change: changed ? { packageId: context.packageId, majorId: major, instanceId: input.instanceId, action: 'active', revision: result.revision } : null }
  }
  async delete(context: SdkContext, input: z.infer<typeof instanceSchemas['instances.delete']>, signal: AbortSignal, minInstances = 0): Promise<{ value: { deleted: boolean }; change: InstanceChange }> {
    const major = this.major(context, true)!
    const row = this.target(context, input.instanceId, input.expectedRevision)
    const checkMinimum = () => {
      const count = this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM major_instances WHERE package_id = ? AND major_id = ?', context.packageId, major)!.count
      if (count <= minInstances) throw new AppError('CONFLICT', 'Le nombre minimal d’instances doit être conservé.')
    }
    checkMinimum()
    if (!this.hooks.confirmDeletion) throw new AppError('UNAVAILABLE', 'Confirmation native de suppression indisponible.')
    const count = () => Number(this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM package_documents WHERE package_id = ? AND instance_scope = ?', context.packageId, input.instanceId)?.count ?? 0)
    const confirmationRevision = currentRevision(this.db)
    const active = getActiveInstanceId(this.db, context.packageId, major) === input.instanceId
    const countUsages = (table: string, column: string, prefix: string) => {
      const json = `(CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END)`
      return Number(this.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table} WHERE json_extract(${json}, '${prefix}.major.packageId') = ? AND json_extract(${json}, '${prefix}.major.contributionId') = ? AND ((json_extract(${json}, '${prefix}.mode') = 'fixed' AND json_extract(${json}, '${prefix}.instanceId') = ?) OR (json_extract(${json}, '${prefix}.mode') = 'active' AND ?))`, context.packageId, major, input.instanceId, active ? 1 : 0)?.count ?? 0)
    }
    const usages = { projectPlacements: countUsages('project_blocks', 'binding_json', '$'), dashboardPlacements: countUsages('dashboard_widgets', 'binding_json', '$'), sidebarLinks: countUsages('sidebar_entries', 'target_json', '$.binding') }
    if (!await this.hooks.confirmDeletion(structuredClone(context), { packageId: context.packageId, majorId: major, instanceId: row.instanceId, name: row.name, documentCount: count(), usages }, signal)) throw new AppError('PERMISSION_DENIED', 'Suppression non confirmée.')
    if (signal.aborted) throw new AppError('UNAVAILABLE', 'Contexte indisponible.')
    const result = this.core.commitPackageWrite(() => {
      if (currentRevision(this.db) !== confirmationRevision) throw new AppError('CONFLICT', 'Les données ont changé depuis la confirmation.')
      this.target(context, input.instanceId, input.expectedRevision)
      checkMinimum()
      deleteInstance(this.db, context.packageId, major, input.instanceId)
      return { changed: true, value: { deleted: true } }
    })
    return { value: result.value, change: { packageId: context.packageId, majorId: major, instanceId: input.instanceId, action: 'deleted', revision: result.revision } }
  }
}
