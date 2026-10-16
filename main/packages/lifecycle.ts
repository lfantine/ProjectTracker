import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { effectiveDependencies, type Manifest } from '../../shared/manifest'
import type { Database } from '../db/database'
import { logDiagnostic } from '../core/service'
import { serialPackageOperation } from './operations'

export type StopAction = 'disable' | 'uninstall'
export interface StopProposal { packageId: string; action: StopAction; suspendedDependants: string[] }
export type ConfirmStop = (proposal: StopProposal, signal?: AbortSignal) => Promise<boolean>
export interface LifecycleHooks {
  /** Must synchronously close ports, subscriptions and in-flight calls. */
  revokePackage(packageId: string): void
  /** Native registry/shell invalidation, after commit only, never personal data. */
  changed(change: StopProposal & { affected: string[]; revision: number }): void
}
interface PackageRow {
  id: string
  state: 'active' | 'disabled' | 'suspended' | 'uninstalled'
  revision: number
  active_version: string | null
  manifest_json: string | null
}
export interface StopResult { status: 'changed' | 'unchanged'; affected: string[] }

/** Logical uninstall: retain version files, private data, configuration and
 * placement identities. No implicit reinstall of bundled packages and no purge.
 * Runtime integration is mandatory for callers; normal app wiring is not open.
 */
export class PackageLifecycle {
  private readonly root: string
  constructor(private readonly db: Database, root: string, private readonly confirm: ConfirmStop, private readonly hooks: LifecycleHooks) {
    if (!path.isAbsolute(root)) throw new Error('INSTALL_ROOT_INVALID')
    this.root = path.normalize(root)
  }
  private snapshot(): PackageRow[] {
    return this.db.all<PackageRow>(`SELECT p.id, p.state, p.revision, p.active_version, v.manifest_json
      FROM packages p LEFT JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version ORDER BY p.id`)
  }
  private dependants(rows: PackageRow[], packageId: string): string[] {
    const affected = new Set([packageId])
    const dependencies = rows.filter(row => row.state === 'active').map(row => {
      if (!row.manifest_json) throw new Error('PACKAGE_MANIFEST_MISSING')
      return { id: row.id, dependencies: Object.keys(effectiveDependencies(JSON.parse(row.manifest_json) as Manifest)) }
    })
    let changed = true
    while (changed) {
      changed = false
      for (const row of dependencies) if (!affected.has(row.id) && row.dependencies.some(id => affected.has(id))) {
        affected.add(row.id)
        changed = true
      }
    }
    return [...affected].filter(id => id !== packageId).sort()
  }
  stop(packageId: string, action: StopAction, signal?: AbortSignal): Promise<StopResult> {
    return serialPackageOperation(this.root, async () => {
      if (action !== 'disable' && action !== 'uninstall') throw new Error('PACKAGE_ACTION_INVALID')
      if (packageId === 'core') throw new Error('PACKAGE_CORE_PROTECTED')
      if (signal?.aborted) throw new Error('PACKAGE_CANCELLED')
      const before = this.snapshot()
      const target = before.find(row => row.id === packageId)
      if (!target) throw new Error('PACKAGE_NOT_FOUND')
      const desiredState = action === 'uninstall' ? 'uninstalled' : 'disabled'
      if (target.state === desiredState || target.state === 'uninstalled') return { status: 'unchanged', affected: [] }
      const proposal: StopProposal = { packageId, action, suspendedDependants: this.dependants(before, packageId) }
      if (!await this.confirm(structuredClone(proposal), signal) || signal?.aborted) throw new Error('PACKAGE_CANCELLED')
      if (JSON.stringify(this.snapshot()) !== JSON.stringify(before)) throw new Error('PACKAGE_STATE_CHANGED')
      const affected = [packageId, ...proposal.suspendedDependants]
      // No await between revocation and commit. A failed commit may leave views
      // closed, never alive with revoked rights. Reopening is an explicit action.
      let revokeFailed = false
      for (const id of affected) {
        try {
          const result: unknown = this.hooks.revokePackage(id)
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            void Promise.resolve(result).catch(() => {})
            revokeFailed = true
          }
        } catch { revokeFailed = true }
      }
      if (revokeFailed) throw new Error('PACKAGE_REVOCATION_FAILED')
      const revision = this.db.transaction(() => {
        if (JSON.stringify(this.snapshot()) !== JSON.stringify(before)) throw new Error('PACKAGE_STATE_CHANGED')
        const now = new Date().toISOString()
        this.db.run(`UPDATE packages SET state = ?, state_reason = ?, active_version = CASE WHEN ? = 'uninstall' THEN NULL ELSE active_version END,
          revision = revision + 1, updated_at = ? WHERE id = ?`, desiredState, action === 'uninstall' ? 'user-uninstalled' : 'user-disabled', action, now, packageId)
        if (action === 'uninstall') this.db.run("UPDATE package_versions SET status = 'retired' WHERE package_id = ?", packageId)
        for (const id of proposal.suspendedDependants) this.db.run(`UPDATE packages SET state = 'suspended', state_reason = ?, revision = revision + 1, updated_at = ? WHERE id = ?`, `dependency-unavailable:${packageId}`, now, id)
        this.db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
        this.db.run(`INSERT INTO install_journal (operation_id, package_id, version, action, step, status, detail_json, created_at)
          VALUES (?, ?, ?, ?, 'committed', 'done', ?, ?)`, randomUUID(), packageId, target.active_version, action, JSON.stringify({ suspendedDependants: proposal.suspendedDependants }), now)
        return this.db.get<{ revision: number }>('SELECT revision FROM data_revision WHERE id = 1')!.revision
      })
      const logNotificationFailure = () => logDiagnostic(this.db, { level: 'warn', scope: 'packages', code: 'LIFECYCLE_NOTIFICATION_FAILED', packageId, step: action, message: 'Registry notification failed after package lifecycle commit.' })
      try {
        const result: unknown = this.hooks.changed({ ...proposal, affected, revision })
        if (result && typeof (result as { then?: unknown }).then === 'function') void Promise.resolve(result).catch(logNotificationFailure)
      } catch { logNotificationFailure() }
      return { status: 'changed', affected }
    })
  }
}
