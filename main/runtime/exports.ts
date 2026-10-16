import { satisfies } from 'semver'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { validateManifest, type PackageManifest, type ManifestExport } from '../../shared/manifest'
import { hasExportPermission } from '../../shared/permissions'
import { ARCHIVE_LIMITS, RUNTIME_LIMITS } from '../../shared/limits'
import { HOST_API_VERSION } from '../../shared/version'
import type { ExportSnapshot } from '../../shared/sdk'
import type { Database } from '../db/database'
import { getActiveInstanceId, getInstance } from '../core/packageStore'
import { ContextRegistry } from './contexts'
import type { StorageChange } from './events'
import type { InstanceChange } from './instances'

const id = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(128)
export const exportSchemas = {
  'packages.readExport': z.object({ package: id, export: id, instanceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional() }).strict(),
}
export interface ExportInvalidation { package: string; export: string; instanceId: string | null; invalidate: true }

export class ExportApi {
  constructor(private readonly db: Database, private readonly contexts: ContextRegistry) {}
  private provider(packageId: string): PackageManifest {
    const row = this.db.get<{ manifest_json: string; active_version: string; storage_version: number }>(`SELECT v.manifest_json, p.active_version, p.storage_version FROM packages p JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version WHERE p.id = ? AND p.kind = 'package' AND p.state = 'active' AND v.status = 'active'`, packageId)
    if (!row) throw new AppError('UNAVAILABLE', 'Fournisseur indisponible.')
    try {
      if (Buffer.byteLength(row.manifest_json) > ARCHIVE_LIMITS.maxManifestBytes) throw new Error()
      const result = validateManifest(JSON.parse(row.manifest_json))
      if (!result.ok || result.manifest.kind !== 'package' || result.manifest.id !== packageId || result.manifest.version !== row.active_version || result.manifest.storageVersion !== row.storage_version || !satisfies(HOST_API_VERSION, result.manifest.hostApi)) throw new Error()
      return result.manifest
    } catch { throw new AppError('INCOMPATIBLE', 'Fournisseur incompatible.') }
  }
  private authorized(contextId: string, packageId: string, exportId: string): ManifestExport {
    const context = this.contexts.get(contextId)
    // No provider existence or manifest metadata before checking the grant.
    if (packageId !== context.packageId && !hasExportPermission(context.permissions, packageId, exportId)) throw new AppError('PERMISSION_DENIED', 'Export non autorisé.')
    const consumer = this.contexts.manifest(contextId)
    const provider = this.provider(packageId)
    if (packageId !== context.packageId) {
      const range = consumer.dependencies?.[packageId]
      if (!range || !satisfies(provider.version, range)) throw new AppError('DEPENDENCY', 'Dépendance fournisseur incompatible ou absente.')
    } else if (provider.version !== context.packageVersion) throw new AppError('INCOMPATIBLE', 'Version du contexte périmée.')
    const declaration = provider.exports?.find((entry) => entry.id === exportId)
    if (!declaration) throw new AppError('NOT_FOUND', 'Export introuvable.')
    return declaration
  }
  hasExports(contextId: string): boolean {
    return this.contexts.get(contextId).permissions.exports.length > 0 || !!this.contexts.manifest(contextId).exports?.length
  }
  read(contextId: string, query: { package: string; export: string; instanceId?: string }): ExportSnapshot {
    const declaration = this.authorized(contextId, query.package, query.export)
    const context = this.contexts.get(contextId)
    let instance: ExportSnapshot['instance'] = null
    if (declaration.scope === 'package') {
      if (query.instanceId !== undefined) throw new AppError('VALIDATION', 'Instance inattendue pour un export partagé.')
    } else {
      const own = query.package === context.packageId
      if (own && (context.binding.mode === 'none' || context.binding.major.contributionId !== declaration.major)) throw new AppError('PERMISSION_DENIED', 'Instance non autorisée.')
      const instanceId = query.instanceId ?? (own ? context.instance?.instanceId : getActiveInstanceId(this.db, query.package, declaration.major!))
      if (!instanceId) throw new AppError('UNAVAILABLE', 'Aucune instance exportée disponible.')
      if (own && context.kind !== 'major' && instanceId !== context.instance?.instanceId) throw new AppError('PERMISSION_DENIED', 'Instance non autorisée.')
      const row = getInstance(this.db, query.package, declaration.major!, instanceId)
      if (!row) throw new AppError('NOT_FOUND', 'Instance exportée introuvable.')
      if (this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM major_instances WHERE package_id = ? AND instance_id = ?', query.package, instanceId)?.count !== 1) throw new AppError('CONFLICT', 'Adresse d’instance ambiguë.')
      instance = { instanceId, name: row.name }
    }
    const collections = [...new Set(declaration.collections)]
    const placeholders = collections.map(() => '?').join(',')
    const params = [query.package, instance?.instanceId ?? '', ...collections]
    const filter = `package_id = ? AND instance_scope = ? AND collection IN (${placeholders})`
    // The v1 snapshot has no cursor: reject oversized snapshots, never truncate
    // or load all values before checking the allocation budget.
    const budget = this.db.get<{ count: number; bytes: number }>(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(value_json AS BLOB))), 0) AS bytes FROM package_documents WHERE ${filter}`, ...params)!
    if (budget.count > RUNTIME_LIMITS.maxPageSize || budget.bytes > RUNTIME_LIMITS.maxMessageBytes / 2) throw new AppError('UNAVAILABLE', 'Export trop volumineux pour un snapshot.')
    const rows = this.db.all<{ collection: string; doc_id: string; revision: number; value_json: string; updated_at: string }>(`SELECT collection, doc_id, revision, value_json, updated_at FROM package_documents WHERE ${filter} ORDER BY collection, doc_id`, ...params)
    return { package: query.package, export: query.export, version: declaration.version, instance, documents: rows.map((row) => ({ collection: row.collection, id: row.doc_id, revision: row.revision, updatedAt: row.updated_at, instanceId: instance?.instanceId ?? null, value: JSON.parse(row.value_json) })) }
  }
  invalidations(contextId: string, change: StorageChange | InstanceChange): ExportInvalidation[] {
    const context = this.contexts.get(contextId)
    const grants = [...context.permissions.exports]
    if (change.packageId === context.packageId) for (const declaration of this.contexts.manifest(contextId).exports ?? []) grants.push({ package: context.packageId, export: declaration.id })
    const results: ExportInvalidation[] = []
    for (const grant of grants) {
      if (grant.package !== change.packageId) continue
      try {
        const declaration = this.authorized(contextId, grant.package, grant.export)
        if ('collection' in change) {
          if (!declaration.collections.includes(change.collection) || (declaration.scope === 'package') !== (change.instanceId === null)) continue
          if (declaration.scope === 'instance') {
            const row = getInstance(this.db, grant.package, declaration.major!, change.instanceId!)
            if (!row) continue
          }
        } else if (declaration.scope !== 'instance' || declaration.major !== change.majorId) continue
        if (grant.package === context.packageId && declaration.scope === 'instance') {
          if (context.binding.mode === 'none' || context.binding.major.contributionId !== declaration.major || (context.kind !== 'major' && change.instanceId !== context.instance?.instanceId)) continue
        }
        if (change.instanceId && (this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM major_instances WHERE package_id = ? AND instance_id = ?', grant.package, change.instanceId)?.count ?? 0) > 1) continue
        if (results.some((entry) => entry.package === grant.package && entry.export === grant.export)) continue
        results.push({ package: grant.package, export: grant.export, instanceId: change.instanceId, invalidate: true })
      } catch { /* missing, disabled or incompatible providers disclose nothing */ }
    }
    return results
  }
}
