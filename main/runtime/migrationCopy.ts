import { AppError } from '../../shared/errors'
import { migrationEntrySchema, migrationSchemas, type MigrationEntry, type MigrationSnapshot } from '../../shared/migration'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { Database } from '../db/database'

const identity = (entry: MigrationEntry) => JSON.stringify(entry.kind === 'document'
  ? [entry.kind, entry.instanceScope, entry.collection, entry.id]
  : entry.kind === 'instance' ? [entry.kind, entry.majorId, entry.instanceId]
    : [entry.kind, entry.owner, entry.ownerId, entry.placementId, entry.contributionId])
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
// Pure private copy: never holds a Database reference or writes active storage.
export class MigrationCopy {
  private entries = new Map<string, MigrationEntry>()
  private readonly original = new Set<string>()
  private finished = false
  private readonly snapshot: MigrationSnapshot
  constructor(snapshot: MigrationSnapshot, private readonly finish: (result: MigrationSnapshot | null) => void) {
    this.snapshot = structuredClone(snapshot)
    if (!Number.isSafeInteger(snapshot.fromVersion) || snapshot.fromVersion < 1 || !Number.isSafeInteger(snapshot.toVersion) || snapshot.toVersion <= snapshot.fromVersion) throw new AppError('INCOMPATIBLE', 'Versions de migration invalides.')
    for (const item of snapshot.entries) {
      const entry = migrationEntrySchema.parse(item), key = identity(entry)
      if (this.entries.has(key)) throw new AppError('VALIDATION', 'Copie de migration invalide.')
      this.entries.set(key, structuredClone(entry)); this.original.add(key)
    }
    this.checkQuota()
  }
  private checkQuota() {
    let total = 0
    for (const entry of this.entries.values()) {
      const size = bytes(entry)
      if (size > RUNTIME_LIMITS.maxDocumentBytes) throw new AppError('VALIDATION', 'Document de migration trop volumineux.')
      total += size
    }
    if (total > RUNTIME_LIMITS.maxStorageBytesPerPackage) throw new AppError('VALIDATION', 'Copie de migration trop volumineuse.')
  }
  dispatch(method: string, params: unknown, afterReply: (() => void)[]) {
    if (this.finished) throw new AppError('UNAVAILABLE', 'Migration terminée.')
    const schema = migrationSchemas[method as keyof typeof migrationSchemas]
    if (!schema) throw new AppError('PERMISSION_DENIED', 'API indisponible en migration.')
    const parsed = schema.safeParse(params)
    if (!parsed.success) throw new AppError('VALIDATION', 'Paramètres de migration invalides.')
    if (method === 'migration.read') {
      const { cursor, limit = 100 } = parsed.data as { cursor?: string; limit?: number }
      const values = [...this.entries.values()], offset = Number(cursor ?? 0), entries: MigrationEntry[] = []
      let size = 0
      for (const entry of values.slice(offset, offset + limit)) {
        const nextSize = bytes(entry)
        if (size + nextSize > RUNTIME_LIMITS.maxDocumentBytes && entries.length) break
        entries.push(structuredClone(entry)); size += nextSize
      }
      return { fromVersion: this.snapshot.fromVersion, toVersion: this.snapshot.toVersion, entries, nextCursor: offset + entries.length < values.length ? String(offset + entries.length) : null }
    }
    if (method === 'migration.write' || method === 'migration.delete') {
      const entry = (parsed.data as { entry: MigrationEntry }).entry, key = identity(entry)
      if (entry.kind !== 'document' && !this.original.has(key)) throw new AppError('PERMISSION_DENIED', 'Identité de migration inconnue.')
      if (entry.kind === 'document' && entry.instanceScope && ![...this.entries.values()].some((item) => item.kind === 'instance' && item.instanceId === entry.instanceScope)) throw new AppError('PERMISSION_DENIED', 'Instance de migration inconnue.')
      if (method === 'migration.delete' && entry.kind !== 'document') throw new AppError('PERMISSION_DENIED', 'Identité conservée pendant la migration.')
      const previous = this.entries.get(key)
      if (method === 'migration.delete') this.entries.delete(key)
      else this.entries.set(key, structuredClone(entry))
      try { this.checkQuota() } catch (error) { if (previous) this.entries.set(key, previous); else this.entries.delete(key); throw error }
      return { updated: true }
    }
    const active = new Set<string>()
    for (const entry of this.entries.values()) if (method === 'migration.complete' && entry.kind === 'instance' && entry.active) {
      if (active.has(entry.majorId)) throw new AppError('VALIDATION', 'Instance active ambiguë.')
      active.add(entry.majorId)
    }
    this.finished = true
    const result = method === 'migration.complete' ? { ...this.snapshot, entries: [...this.entries.values()].map((item) => structuredClone(item)) } : null
    afterReply.push(() => this.finish(result))
    return { completed: method === 'migration.complete' }
  }
}

// Synchronous, scoped snapshot; no transaction survives this function. The
// installer will suspend the package and CAS-check before its later commit.
export function snapshotPackage(db: Database, packageId: string, fromVersion: number, toVersion: number): MigrationSnapshot {
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 1 || !Number.isSafeInteger(toVersion) || toVersion <= fromVersion) throw new AppError('INCOMPATIBLE', 'Versions de migration invalides.')
  return db.transaction(() => {
    const entries: MigrationEntry[] = []
    const size = db.get<{ total: number }>('SELECT coalesce(sum(size_bytes), 0) AS total FROM package_documents WHERE package_id = ?', packageId)!.total
    if (size > RUNTIME_LIMITS.maxStorageBytesPerPackage) throw new AppError('VALIDATION', 'Copie de migration trop volumineuse.')
    for (const row of db.all<any>('SELECT instance_scope, collection, doc_id, value_json FROM package_documents WHERE package_id = ? ORDER BY instance_scope, collection, doc_id', packageId)) entries.push({ kind: 'document', instanceScope: row.instance_scope, collection: row.collection, id: row.doc_id, value: JSON.parse(row.value_json) })
    for (const row of db.all<any>('SELECT i.*, a.instance_id = i.instance_id AS active FROM major_instances i LEFT JOIN active_instances a ON a.package_id = i.package_id AND a.major_id = i.major_id WHERE i.package_id = ? ORDER BY i.major_id, i.instance_id', packageId)) entries.push({ kind: 'instance', majorId: row.major_id, instanceId: row.instance_id, name: row.name, position: row.position, active: !!row.active })
    for (const [table, owner, ownerColumn, placementColumn] of [['project_blocks', 'project', 'project_id', 'block_id'], ['dashboard_widgets', 'dashboard', 'dashboard_id', 'placement_id']] as const) {
      for (const row of db.all<any>(`SELECT ${ownerColumn} AS owner_id, ${placementColumn} AS placement_id, contribution_id, config_version, config_json FROM ${table} WHERE package_id = ? ORDER BY ${ownerColumn}, ${placementColumn}`, packageId)) entries.push({ kind: 'config', owner, ownerId: row.owner_id, placementId: row.placement_id, contributionId: row.contribution_id, version: row.config_version, value: JSON.parse(row.config_json) })
    }
    const snapshot = { fromVersion, toVersion, entries }
    new MigrationCopy(snapshot, () => {}) // Validate before exposing any bytes.
    return snapshot
  })
}
