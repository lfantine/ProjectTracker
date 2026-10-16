import { z } from 'zod'
import type { ModuleHostRequest } from '../../shared/moduleHost'
import type { InstanceBinding, ContributionRef } from '../../shared/bindings'
import type { PlacementOwner } from '../../shared/sdk'
import type { CoreService } from '../core/service'
import type { PackageManager } from '../packages/manager'
import { verifyManagedVersion } from '../packages/managedVersion'
import { ContextRegistry } from '../runtime/contexts'
import { ResourceCatalog } from '../runtime/resources'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const ref = z.object({ packageId: id, contributionId: id }).strict()
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('major'), major: ref, instanceId: id.optional() }).strict(),
  z.object({ kind: z.literal('project'), projectId: id, placementId: id }).strict(),
  z.object({ kind: z.literal('dashboard'), dashboardId: id.optional(), placementId: id.optional() }).strict(),
])
interface Placement { package_id: string; contribution_id: string; binding_json: string }
interface Version { package_id: string; version: string; files_dir: string; manifest_json: string; content_fingerprint: string; source_fingerprint: string; granted_permissions_json: string }

/** The only shell launch seam. Metadata discovery is never sufficient: check
 * current active pointer and managed bytes again before admitting each frame. */
export class ModuleLauncher {
  constructor(private readonly core: CoreService, private readonly root: string, private readonly manager: PackageManager,
    private readonly contexts: ContextRegistry, private readonly catalog: ResourceCatalog, private readonly bootstrap: string) {}

  open(raw: unknown) {
    const input: ModuleHostRequest = requestSchema.parse(raw)
    const db = this.core.db
    let contribution: ContributionRef, owner: PlacementOwner, binding: InstanceBinding, placementId: string | null = null
    let type: 'major' | 'minor' | 'widget'
    if (input.kind === 'major') {
      contribution = input.major; owner = { kind: 'page' }; type = 'major'
      binding = input.instanceId ? { mode: 'fixed', major: contribution, instanceId: input.instanceId } : { mode: 'active', major: contribution }
    } else if (input.kind === 'project') {
      const row = db.get<Placement>('SELECT package_id, contribution_id, binding_json FROM project_blocks WHERE project_id = ? AND block_id = ?', input.projectId, input.placementId)
      if (!row) throw Error('PLACEMENT_UNAVAILABLE')
      contribution = { packageId: row.package_id, contributionId: row.contribution_id }
      binding = JSON.parse(row.binding_json); owner = { kind: 'project', projectId: input.projectId }; placementId = input.placementId; type = 'minor'
    } else {
      const dashboardId = input.dashboardId ?? db.get<{ id: string }>('SELECT id FROM dashboards WHERE is_default = 1')?.id
      if (!dashboardId) throw Error('DASHBOARD_UNAVAILABLE')
      // No placement means the existing fixed home's week widget, not a newly
      // synthesized placement. Lot 6 will supply explicit placement identities.
      const row = input.placementId
        ? db.get<Placement & { placement_id: string }>('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? AND placement_id = ?', dashboardId, input.placementId)
        : db.get<Placement & { placement_id: string }>("SELECT * FROM dashboard_widgets WHERE dashboard_id = ? AND package_id = 'builtin.week' AND contribution_id = 'today' ORDER BY position LIMIT 1", dashboardId)
      if (!row) throw Error('PLACEMENT_UNAVAILABLE')
      contribution = { packageId: row.package_id, contributionId: row.contribution_id }
      binding = JSON.parse(row.binding_json); owner = { kind: 'dashboard', dashboardId }; placementId = row.placement_id; type = 'widget'
    }
    const resolved = this.manager.resolveContribution(contribution, type)
    if (resolved.status !== 'available' || resolved.contribution.source !== 'package') throw Error('CONTRIBUTION_UNAVAILABLE')
    const row = db.get<Version>(`SELECT v.*, p.granted_permissions_json FROM packages p JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version
      WHERE p.id = ? AND p.state = 'active' AND v.status = 'active'`, contribution.packageId)
    if (!row) throw Error('PACKAGE_UNAVAILABLE')
    const artifact = verifyManagedVersion(this.root, row)
    if (artifact.manifest.kind !== 'package') throw Error('PACKAGE_UNAVAILABLE')
    const theme = this.manager.themeFor(contribution.packageId)
    const mode = this.core.snapshot().preferences.themeMode
    const registration = this.contexts.create({ manifest: artifact.manifest, contributionId: contribution.contributionId,
      grantedPermissions: JSON.parse(row.granted_permissions_json), owner, binding, placementId, theme: { mode: mode === 'dark' ? 'dark' : 'light', tokens: (mode === 'dark' ? theme?.dark : theme?.light) ?? {} } })
    try {
      this.catalog.add(registration.id, artifact.root, artifact.files)
      const definition = artifact.manifest.contributions.find(item => item.id === contribution.contributionId)!
      const url = this.catalog.prepareBootstrap(registration.id, definition.entry, this.bootstrap, { ...(theme ?? { light: {}, dark: {}, texts: {} }), mode })
      const features: { contextId: string; origin: string; url: string; name: string }[] = []
      if (type === 'major') for (const item of this.manager.extensionArtifacts()) {
        const manifest = item.artifact.manifest
        if (manifest.kind !== 'extension' || manifest.extensionType !== 'features' || manifest.target.package !== contribution.packageId) continue
        for (const feature of manifest.features) {
          if (!artifact.manifest.slots?.some(slot => slot.id === feature.slot.id && slot.version === feature.slot.version && slot.contribution === contribution.contributionId)) continue
          const child = this.contexts.createFeature(manifest, feature.id, registration.id, item.permissions)
          try { this.catalog.add(child.id, item.artifact.root, item.artifact.files); features.push({ contextId: child.id, origin: child.origin, url: this.catalog.prepareBootstrap(child.id, feature.entry, this.bootstrap), name: feature.name }) }
          catch (error) { this.contexts.revoke(child.id); throw error }
        }
      }
      return { status: 'available' as const, contextId: registration.id, origin: registration.origin, url, features, theme }
    } catch (error) { this.contexts.revoke(registration.id); throw error }
  }
}
