import { validateExtensionTarget, validateTheme } from '../extensions/engine'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from '../db/database'
import { logDiagnostic } from '../core/service'
import { addedPermissions, isEmptyPermissionSet, normalizePermissions } from '../../shared/permissions'
import { effectiveDependencies, type Manifest } from '../../shared/manifest'
import { verifyManagedVersion } from './managedVersion'
import { assessInstallation } from './eligibility'
import { serialPackageOperation } from './operations'

export interface AuditProblem { packageId: string; reason: 'resources-invalid' | 'dependency-unavailable' | 'incompatible' | 'unsupported-extension' | 'permissions-missing' }
export interface AuditHooks {
  revokePackage(packageId: string): void
  changed(problems: AuditProblem[], revision: number): void
}
interface ActiveRow {
  id: string; granted_permissions_json: string; active_version: string | null; kind: string; storage_version: number; revision: number
  version: string | null; files_dir: string; manifest_json: string; content_fingerprint: string; source_fingerprint: string; status: string
}

/** Run after journal recovery and BEFORE creating any package context. Does not
 * execute code, delete files/data or automatically restore a suspended package.
 * If this throws, the caller must remain in native recovery mode, not launch
 * packages with an incomplete audit. Normal startup is not wired yet.
 */
export function auditActivePackages(db: Database, root: string, hooks: AuditHooks): Promise<AuditProblem[]> {
  if (!path.isAbsolute(root)) return Promise.reject(Error('INSTALL_ROOT_INVALID'))
  return serialPackageOperation(path.normalize(root), async () => {
    const query = `SELECT p.id, p.granted_permissions_json, p.active_version, p.kind, p.storage_version, p.revision,
      v.version, v.files_dir, v.manifest_json, v.content_fingerprint, v.source_fingerprint, v.status
      FROM packages p LEFT JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version
      WHERE p.state = 'active' AND p.id != 'core' ORDER BY p.id`
    const rows = db.all<ActiveRow>(query)
    const problems = new Map<string, AuditProblem['reason']>()
    const manifests: Manifest[] = []
    for (const row of rows) {
      try {
        if (!row.version || row.status !== 'active') throw Error('VERSION_UNAVAILABLE')
        const version = verifyManagedVersion(root, { ...row, version: row.version, package_id: row.id })
        if (version.manifest.kind !== row.kind || version.manifest.storageVersion !== row.storage_version) throw Error('VERSION_METADATA_INVALID')
        manifests.push(version.manifest)
        if (!isEmptyPermissionSet(addedPermissions(normalizePermissions(JSON.parse(row.granted_permissions_json)), normalizePermissions(version.manifest.permissions)))) problems.set(row.id, 'permissions-missing')
        validateExtensionTarget(db, version.manifest)
        if (version.manifest.kind === 'extension' && version.manifest.extensionType === 'theme') validateTheme(version)
      } catch { problems.set(row.id, 'resources-invalid') }
    }
    const themes = new Map<string, string[]>()
    for (const item of manifests) if (item.kind === 'extension' && item.extensionType === 'theme') themes.set(item.target.package, [...(themes.get(item.target.package) ?? []), item.id])
    for (const ids of themes.values()) if (ids.length > 1) for (const id of ids) problems.set(id, 'incompatible')
    if (manifests.length) {
      const [candidate, ...others] = manifests
      for (const issue of assessInstallation(candidate, others)) if (!problems.has(issue.packageId)) problems.set(issue.packageId, issue.code.startsWith('DEPENDENCY_') ? 'dependency-unavailable' : 'incompatible')
    }
    let expanding = true
    while (expanding) {
      expanding = false
      for (const manifest of manifests) if (!problems.has(manifest.id) && Object.keys(effectiveDependencies(manifest)).some(id => problems.has(id))) { problems.set(manifest.id, 'dependency-unavailable'); expanding = true }
    }
    const result = [...problems].map(([packageId, reason]) => ({ packageId, reason })).sort((a, b) => a.packageId.localeCompare(b.packageId))
    if (!result.length) return []
    let failed = false
    for (const problem of result) try {
      const value: unknown = hooks.revokePackage(problem.packageId)
      if (value && typeof (value as { then?: unknown }).then === 'function') { void Promise.resolve(value).catch(() => {}); failed = true }
    } catch { failed = true }
    if (failed) throw Error('AUDIT_REVOCATION_FAILED')
    const revision = db.transaction(() => {
      if (JSON.stringify(db.all(query)) !== JSON.stringify(rows)) throw Error('AUDIT_STATE_CHANGED')
      const now = new Date().toISOString(), operation = randomUUID()
      for (const problem of result) {
        db.run("UPDATE packages SET state = 'suspended', state_reason = ?, revision = revision + 1, updated_at = ? WHERE id = ?", `startup-audit:${problem.reason}`, now, problem.packageId)
        db.run(`INSERT INTO install_journal (operation_id, package_id, action, step, status, detail_json, created_at)
          VALUES (?, ?, 'audit', 'suspended', 'done', ?, ?)`, operation, problem.packageId, JSON.stringify({ reason: problem.reason }), now)
      }
      db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
      return db.get<{ revision: number }>('SELECT revision FROM data_revision WHERE id = 1')!.revision
    })
    const log = () => logDiagnostic(db, { level: 'warn', scope: 'packages', code: 'AUDIT_NOTIFICATION_FAILED', message: 'Startup audit registry notification failed.' })
    try {
      const value: unknown = hooks.changed(result, revision)
      if (value && typeof (value as { then?: unknown }).then === 'function') void Promise.resolve(value).catch(log)
    } catch { log() }
    return result
  })
}
