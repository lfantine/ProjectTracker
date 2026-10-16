import { MigrationCopy } from '../runtime/migrationCopy'
import type { MigrationSnapshot } from '../../shared/migration'
import { validateConfig, type PackageManifest } from '../../shared/manifest'
import type { Database } from '../db/database'
import { putDocument } from '../core/packageStore'

/** Validate again at the native boundary, then apply only inside the caller's
 * activation transaction. No identity deletion/addition or foreign SQL address.
 */
export function applyPackageMigration(db: Database, packageId: string, manifest: PackageManifest, original: MigrationSnapshot, result: MigrationSnapshot, now: string): void {
  if (!db.inTransaction || packageId !== manifest.id || result.fromVersion !== original.fromVersion || result.toVersion !== original.toVersion || result.toVersion !== manifest.storageVersion) throw Error('MIGRATION_TRANSACTION_INVALID')
  const copy = new MigrationCopy(original, () => {})
  const actions: (() => void)[] = []
  for (const entry of original.entries) if (entry.kind === 'document') copy.dispatch('migration.delete', { entry }, actions)
  const identity = (entry: MigrationSnapshot['entries'][number]) => JSON.stringify(entry.kind === 'document' ? ['document', entry.instanceScope, entry.collection, entry.id] : entry.kind === 'instance' ? ['instance', entry.majorId, entry.instanceId] : ['config', entry.owner, entry.ownerId, entry.placementId, entry.contributionId])
  const seen = new Set<string>()
  for (const entry of result.entries) {
    if (seen.has(identity(entry))) throw Error('MIGRATION_DUPLICATE')
    seen.add(identity(entry))
    if (entry.kind === 'config') {
      const contribution = manifest.contributions.find(item => item.id === entry.contributionId)
      if (contribution && (entry.version !== (contribution.config?.version ?? 1) || !validateConfig(contribution.config, entry.value).ok)) throw Error('MIGRATION_CONFIG_INVALID')
    }
    copy.dispatch('migration.write', { entry }, actions)
  }
  if (original.entries.some(entry => entry.kind !== 'document' && !seen.has(identity(entry)))) throw Error('MIGRATION_IDENTITY_MISSING')
  copy.dispatch('migration.complete', {}, actions)
  // Keep document revisions monotonic for retained identities.
  for (const entry of original.entries) if (entry.kind === 'document' && !seen.has(identity(entry))) db.run('DELETE FROM package_documents WHERE package_id = ? AND instance_scope = ? AND collection = ? AND doc_id = ?', packageId, entry.instanceScope, entry.collection, entry.id)
  db.run('DELETE FROM active_instances WHERE package_id = ?', packageId)
  for (const entry of result.entries) {
    if (entry.kind === 'document') putDocument(db, { packageId, scope: entry.instanceScope, collection: entry.collection, id: entry.id }, entry.value, { now, enforceQuota: false })
    else if (entry.kind === 'instance') {
      db.run('UPDATE major_instances SET name = ?, position = ?, revision = revision + 1, updated_at = ? WHERE package_id = ? AND major_id = ? AND instance_id = ?', entry.name, entry.position, now, packageId, entry.majorId, entry.instanceId)
      if (entry.active) db.run('INSERT INTO active_instances (package_id, major_id, instance_id) VALUES (?, ?, ?)', packageId, entry.majorId, entry.instanceId)
    } else if (entry.owner === 'project') {
      db.run('UPDATE project_blocks SET config_version = ?, config_json = ?, revision = revision + 1 WHERE package_id = ? AND project_id = ? AND block_id = ? AND contribution_id = ?', entry.version, JSON.stringify(entry.value), packageId, entry.ownerId, entry.placementId, entry.contributionId)
      db.run('UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?', now, entry.ownerId)
    } else {
      db.run('UPDATE dashboard_widgets SET config_version = ?, config_json = ?, revision = revision + 1 WHERE package_id = ? AND dashboard_id = ? AND placement_id = ? AND contribution_id = ?', entry.version, JSON.stringify(entry.value), packageId, entry.ownerId, entry.placementId, entry.contributionId)
      db.run('UPDATE dashboards SET revision = revision + 1, updated_at = ? WHERE id = ?', now, entry.ownerId)
    }
  }
}
