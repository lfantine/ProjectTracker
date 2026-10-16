import { extensionRuntime } from '../../shared/extensions'
import { validateExtensionTarget, validateTheme } from '../extensions/engine'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import lessThan from 'semver/functions/lt'
import { randomUUID, createHash } from 'node:crypto'
import { effectiveDependencies, hasMigrationChain, validateConfig, type Manifest } from '../../shared/manifest'
import { normalizePermissions, type PermissionSet } from '../../shared/permissions'
import type { MigrationSnapshot } from '../../shared/migration'
import type { Database } from '../db/database'
import { logDiagnostic } from '../core/service'
import { isQualifiedRelease } from '../core/release'
import { EXTERNAL_RUNTIME_QUALIFIED } from '../runtime/contexts'
import { snapshotPackage } from '../runtime/migrationCopy'
import { serialPackageOperation } from './operations'
import { verifyManagedVersion, type ManagedVersion } from './managedVersion'
import { assessInstallation } from './eligibility'
import { applyPackageMigration } from './applyMigration'

export interface ActivationProposal { packageId: string; version: string; contentSha256: string; permissions: PermissionSet; previousPermissions: PermissionSet }
export interface ActivationHooks {
  confirm(proposal: ActivationProposal, signal?: AbortSignal): Promise<boolean>
  prevalidate(version: ManagedVersion, signal?: AbortSignal): Promise<void>
  migrate(version: ManagedVersion, snapshot: MigrationSnapshot, signal?: AbortSignal): Promise<MigrationSnapshot>
  suspendPackage(packageId: string): () => void
  revokePackage(packageId: string): void
  changed(change: { packageId: string; version: string; affected: string[]; revision: number }): void
}
interface VersionRow { package_id: string; version: string; files_dir: string; manifest_json: string; content_fingerprint: string; source_fingerprint: string; status: string }
interface PackageRow { id: string; kind: string; state: string; active_version: string | null; storage_version: number; granted_permissions_json: string; revision: number }
function inside(child: string, parent: string): boolean { const relative = path.relative(parent, child); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) }

/** Native-only orchestration. The normal external-runtime guard stays closed.
 * Qualification opt-in is accepted ONLY under OS temporary data in test mode.
 * Hooks must be the trusted sandbox/registry adapters, never package callbacks.
 */
export class PackageActivation {
  private readonly root: string
  constructor(private readonly db: Database, root: string, private readonly hooks: ActivationHooks, private readonly isolatedQualification = false) {
    if (!path.isAbsolute(root)) throw Error('INSTALL_ROOT_INVALID')
    this.root = path.normalize(root)
  }
  private qualified(): void {
    if (EXTERNAL_RUNTIME_QUALIFIED && isQualifiedRelease()) return
    if (this.isolatedQualification && process.env.PROJECT_TRACKER_TEST === '1' && this.db.file !== ':memory:' &&
        inside(fs.realpathSync(this.db.file), fs.realpathSync(os.tmpdir())) && this.root === path.join(path.dirname(this.db.file), 'packages')) return
    throw Error('ACTIVATION_NOT_QUALIFIED')
  }
  private sourceToken(packageId: string): string {
    const rows = [this.db.all('SELECT * FROM packages ORDER BY id'), this.db.all('SELECT * FROM package_versions ORDER BY package_id, version')]
    for (const [table, order] of [['package_documents', 'instance_scope, collection, doc_id'], ['major_instances', 'major_id, instance_id'], ['active_instances', 'major_id'], ['project_blocks', 'project_id, block_id'], ['dashboard_widgets', 'dashboard_id, placement_id']] as const) rows.push(this.db.all(`SELECT * FROM ${table} WHERE package_id = ? ORDER BY ${order}`, packageId))
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  private active(): Manifest[] {
    return this.db.all<{ manifest_json: string }>(`SELECT v.manifest_json FROM packages p JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version WHERE p.state = 'active'`).map(row => JSON.parse(row.manifest_json))
  }
  activate(packageId: string, version: string, signal?: AbortSignal): Promise<{ status: 'active' | 'unchanged' }> {
    return serialPackageOperation(this.root, async () => {
      this.qualified()
      if (signal?.aborted) throw Error('ACTIVATION_CANCELLED')
      const row = this.db.get<VersionRow>('SELECT * FROM package_versions WHERE package_id = ? AND version = ?', packageId, version)
      const previous = this.db.get<PackageRow>('SELECT * FROM packages WHERE id = ?', packageId)
      if (!row || !previous || !['ready', 'retired', 'active'].includes(row.status)) throw Error('ACTIVATION_VERSION_UNAVAILABLE')
      const artifact = verifyManagedVersion(this.root, row), manifest = artifact.manifest
      validateExtensionTarget(this.db, manifest)
      if (manifest.kind === 'extension' && manifest.extensionType === 'theme') validateTheme(artifact)
      if (previous.kind !== manifest.kind) throw Error('ACTIVATION_KIND_CHANGED')
      const assess = () => {
        validateExtensionTarget(this.db, manifest)
        for (const active of this.active()) if (active.kind === 'extension' && active.id !== manifest.id && active.target.package === manifest.id) validateExtensionTarget(this.db, active, manifest)
        if (assessInstallation(manifest, this.active()).length || manifest.storageVersion < previous.storage_version) throw Error('ACTIVATION_INELIGIBLE')
        // Uninstall clears the pointer, not the history: reinstall must not
        // accidentally offer a code downgrade with an unchanged storage format.
        const lastVersion = previous.active_version ?? this.db.get<{ version: string }>("SELECT version FROM install_journal WHERE package_id = ? AND action IN ('activate', 'uninstall') AND status = 'done' AND version IS NOT NULL ORDER BY id DESC LIMIT 1", packageId)?.version
        if (lastVersion && lessThan(manifest.version, lastVersion)) throw Error('ACTIVATION_DOWNGRADE')
      }
      assess()
      if (manifest.storageVersion > previous.storage_version && !hasMigrationChain(manifest, previous.storage_version)) throw Error('ACTIVATION_MIGRATION_MISSING')
      const permissions = normalizePermissions(manifest.permissions)
      if (previous.state === 'active' && previous.active_version === version && previous.storage_version === manifest.storageVersion && JSON.stringify(permissions) === JSON.stringify(normalizePermissions(JSON.parse(previous.granted_permissions_json)))) return { status: 'unchanged' }
      const token = this.sourceToken(packageId)
      if (!await this.hooks.confirm(structuredClone({ packageId, version, contentSha256: artifact.contentSha256, permissions, previousPermissions: normalizePermissions(JSON.parse(previous.granted_permissions_json)) }), signal) || signal?.aborted) throw Error('ACTIVATION_CANCELLED')
      await this.hooks.prevalidate(structuredClone(artifact), signal)
      if (signal?.aborted) throw Error('ACTIVATION_CANCELLED')
      if (token !== this.sourceToken(packageId)) throw Error('ACTIVATION_SOURCE_CHANGED')
      assess()
      const affected = new Set([packageId])
      const replacedThemes = manifest.kind === 'extension' && manifest.extensionType === 'theme' ? this.active().filter(item => item.id !== packageId && item.kind === 'extension' && item.extensionType === 'theme' && item.target.package === manifest.target.package).map(item => item.id) : []
      for (const id of replacedThemes) affected.add(id)
      if (manifest.kind === 'extension') affected.add(manifest.target.package)
      const active = this.active()
      const themeDependants = new Set(replacedThemes)
      let dependantsAdded = true
      while (dependantsAdded) { dependantsAdded = false; for (const item of active) if (!themeDependants.has(item.id) && Object.keys(effectiveDependencies(item)).some(id => themeDependants.has(id))) { themeDependants.add(item.id); dependantsAdded = true } }
      if (Object.keys(effectiveDependencies(manifest)).some(id => themeDependants.has(id))) throw Error('ACTIVATION_INELIGIBLE')
      let expanding = true
      while (expanding) {
        expanding = false
        for (const item of active) if (!affected.has(item.id) && Object.keys(effectiveDependencies(item)).some(id => affected.has(id))) { affected.add(item.id); expanding = true }
      }
      const releases: (() => void)[] = []
      try {
        let failed = false
        for (const id of affected) try {
          const release = this.hooks.suspendPackage(id)
          if (typeof release !== 'function') throw Error('ACTIVATION_SUSPENSION_FAILED')
          releases.push(release)
          const result: unknown = this.hooks.revokePackage(id)
          if (result && typeof (result as { then?: unknown }).then === 'function') { void Promise.resolve(result).catch(() => {}); failed = true }
        } catch { failed = true }
        if (failed) throw Error('ACTIVATION_REVOCATION_FAILED')
        if (token !== this.sourceToken(packageId)) throw Error('ACTIVATION_SOURCE_CHANGED')
        const source = manifest.storageVersion > previous.storage_version ? snapshotPackage(this.db, packageId, previous.storage_version, manifest.storageVersion) : undefined
        const sourceToken = this.sourceToken(packageId)
        const journal = Number(this.db.run(`INSERT INTO install_journal (operation_id, package_id, version, action, step, status, created_at)
          VALUES (?, ?, ?, 'activate', 'validating', 'started', ?)`, randomUUID(), packageId, version, new Date().toISOString()).lastInsertRowid)
        try {
          const migrated = source ? await this.hooks.migrate(structuredClone(artifact), structuredClone(source), signal) : undefined
          if (signal?.aborted) throw Error('ACTIVATION_CANCELLED')
          if (sourceToken !== this.sourceToken(packageId)) throw Error('ACTIVATION_SOURCE_CHANGED')
          verifyManagedVersion(this.root, row)
          const revision = this.db.transaction(() => {
            if (sourceToken !== this.sourceToken(packageId)) throw Error('ACTIVATION_SOURCE_CHANGED')
            assess()
            const now = new Date().toISOString()
            if (source && migrated) applyPackageMigration(this.db, packageId, extensionRuntime(manifest), source, migrated, now)
            else if (source) throw Error('ACTIVATION_MIGRATION_INVALID')
            // Without a storage migration the existing config must already satisfy
            // the target schema. Removed contributions keep explanatory placements.
            for (const table of ['project_blocks', 'dashboard_widgets']) for (const config of this.db.all<{ contribution_id: string; config_version: number; config_json: string }>(`SELECT contribution_id, config_version, config_json FROM ${table} WHERE package_id = ?`, packageId)) {
              const contribution = extensionRuntime(manifest).contributions.find(item => item.id === config.contribution_id)
              if (contribution && (config.config_version !== (contribution.config?.version ?? 1) || !validateConfig(contribution.config, JSON.parse(config.config_json)).ok)) throw Error('ACTIVATION_CONFIG_INVALID')
            }
            for (const id of themeDependants) if (!replacedThemes.includes(id)) this.db.run("UPDATE packages SET state='suspended', state_reason='dependency-unavailable', revision=revision+1 WHERE id=?", id)
            for (const id of replacedThemes) this.db.run("UPDATE packages SET state='disabled', state_reason='theme-replaced', revision=revision+1 WHERE id=?", id)
            this.db.run("UPDATE package_versions SET status = CASE WHEN version = ? THEN 'active' ELSE 'retired' END WHERE package_id = ?", version, packageId)
            this.db.run(`UPDATE packages SET name = ?, author = ?, state = 'active', state_reason = NULL, active_version = ?, storage_version = ?, granted_permissions_json = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`, manifest.name, manifest.author, version, manifest.storageVersion, JSON.stringify(permissions), now, packageId)
            this.db.run('DELETE FROM package_dependencies WHERE package_id = ?', packageId)
            for (const [id, range] of Object.entries(effectiveDependencies(manifest))) this.db.run('INSERT INTO package_dependencies (package_id, dependency_id, version_range) VALUES (?, ?, ?)', packageId, id, range)
            this.db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
            this.db.run("UPDATE install_journal SET status = 'done', step = 'committed' WHERE id = ?", journal)
            return this.db.get<{ revision: number }>('SELECT revision FROM data_revision WHERE id = 1')!.revision
          })
          try {
            const result: unknown = this.hooks.changed({ packageId, version, affected: [...affected], revision })
            if (result && typeof (result as { then?: unknown }).then === 'function') void Promise.resolve(result).catch(() => logDiagnostic(this.db, { level: 'warn', scope: 'packages', code: 'ACTIVATION_NOTIFICATION_FAILED', packageId, step: 'committed', message: 'Activation registry notification failed.' }))
          } catch { logDiagnostic(this.db, { level: 'warn', scope: 'packages', code: 'ACTIVATION_NOTIFICATION_FAILED', packageId, step: 'committed', message: 'Activation registry notification failed.' }) }
          return { status: 'active' }
        } catch (error) {
          this.db.run("UPDATE install_journal SET status = 'failed', step = 'rolled-back' WHERE id = ?", journal)
          throw error
        }
      } finally { for (const release of releases.reverse()) try { release() } catch { logDiagnostic(this.db, { level: 'warn', scope: 'packages', code: 'ACTIVATION_FENCE_RELEASE_FAILED', packageId, message: 'Package remains unavailable after activation.' }) } }
    })
  }
  recover(): Promise<void> {
    return serialPackageOperation(this.root, async () => {
      this.qualified()
      // Data/version/active pointer and journal completion share one commit.
      // A started record therefore never authorizes replay of a partial copy.
      this.db.run("UPDATE install_journal SET status = 'rolled-back', step = 'recovered' WHERE action = 'activate' AND status = 'started'")
    })
  }
}
