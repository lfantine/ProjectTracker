import type { ContributionRef } from '../../shared/bindings'
import { isContributionRef } from '../../shared/bindings'
import { resolveCoreContribution, type NativeContribution } from '../../shared/contributionRegistry'
import { CORE_PACKAGE_ID } from '../../shared/ids'
import { validateManifest, type Contribution, type ContributionType } from '../../shared/manifest'
import type { Database } from '../db/database'

export type ContributionResolution =
  | { status: 'available'; contribution: NativeContribution | {
    source: 'package'; ref: ContributionRef; version: string; type: ContributionType; name: string; definition: Contribution
  } }
  | { status: 'unavailable'; reason: 'invalid-reference' | 'unknown-contribution' | 'not-installed' | 'disabled' | 'suspended' | 'uninstalled' | 'version-unavailable' | 'unsupported-extension' | 'wrong-type' }

/** Metadata discovery only, never a launch authorization. Caller still needs
 * qualified startup/audit, managed-file verification and native context creation.
 * No source catalogue is consulted and no package code or filesystem is loaded.
 */
export class ContributionRegistry {
  constructor(private readonly db: Database) {}
  resolve(ref: ContributionRef, type: ContributionType): ContributionResolution {
    if (!isContributionRef(ref) || !['major', 'minor', 'widget'].includes(type)) return { status: 'unavailable', reason: 'invalid-reference' }
    if (ref.packageId === CORE_PACKAGE_ID) {
      const contribution = resolveCoreContribution(ref, type)
      return contribution ? { status: 'available', contribution } : { status: 'unavailable', reason: 'unknown-contribution' }
    }
    const row = this.db.get<{ state: string; kind: string; active_version: string | null; status: string | null; manifest_json: string | null }>(`SELECT p.state, p.kind, p.active_version, v.status, v.manifest_json
      FROM packages p LEFT JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version WHERE p.id = ?`, ref.packageId)
    if (!row) return { status: 'unavailable', reason: 'not-installed' }
    if (row.state === 'disabled' || row.state === 'suspended' || row.state === 'uninstalled') return { status: 'unavailable', reason: row.state }
    if (row.state !== 'active' || row.status !== 'active' || !row.active_version || !row.manifest_json) return { status: 'unavailable', reason: 'version-unavailable' }
    try {
      const parsed = validateManifest(JSON.parse(row.manifest_json))
      if (!parsed.ok || parsed.manifest.id !== ref.packageId || parsed.manifest.version !== row.active_version || parsed.manifest.kind !== row.kind) return { status: 'unavailable', reason: 'version-unavailable' }
      if (parsed.manifest.kind !== 'package') return { status: 'unavailable', reason: 'unsupported-extension' }
      const definition = parsed.manifest.contributions.find(item => item.id === ref.contributionId)
      if (!definition) return { status: 'unavailable', reason: 'unknown-contribution' }
      if (definition.type !== type) return { status: 'unavailable', reason: 'wrong-type' }
      return { status: 'available', contribution: { source: 'package', ref: { ...ref }, version: row.active_version, type, name: definition.name, definition } }
    } catch { return { status: 'unavailable', reason: 'version-unavailable' } }
  }
}
