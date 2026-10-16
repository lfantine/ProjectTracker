import { extensionRuntime } from '../../shared/extensions'
import type { Manifest } from '../../shared/manifest'
import { isDeepStrictEqual } from 'node:util'
import { CoreService } from '../core/service'
import { readProject } from '../core/readModel'
import type { DataChange } from '../../shared/commands'
import { randomBytes } from 'node:crypto'
import { satisfies } from 'semver'
import { bindingMatchesDeclaration, isInstanceBinding, type InstanceBinding } from '../../shared/bindings'
import { AppError } from '../../shared/errors'
import { manifestSchema, validateConfig, type PackageManifest, type ConfigSchema } from '../../shared/manifest'
import { addedPermissions, isEmptyPermissionSet, normalizePermissions, type PermissionSet } from '../../shared/permissions'
import { HOST_API_VERSION, SDK_VERSION } from '../../shared/version'
import type { PlacementOwner, SdkContext } from '../../shared/sdk'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { Database } from '../db/database'
import { getActiveInstanceId, getInstance } from '../core/packageStore'

// Native-only precursor of the runtime. No IPC handler exposes registration and
// no imported code is activated by this module. The installer will supply only
// validated, active installations through a qualified install/activation pipeline.
// Lot 3 is qualified in the isolated harness, NOT in the normal application.
export const EXTERNAL_RUNTIME_QUALIFIED = true

export interface ContextRegistration {
  manifest: PackageManifest
  contributionId: string
  grantedPermissions: PermissionSet
  placementId: string | null
  owner: PlacementOwner
  binding: InstanceBinding
  config?: Record<string, unknown>
  locale?: string
  theme?: SdkContext['theme']
  runtimeKind?: 'feature'
}

interface ContextRecord {
  manifest: PackageManifest
  context: SdkContext
  controller: AbortController
  cleanups: Set<() => void>
  configSchema: ConfigSchema | undefined
  initialized: boolean
  initTimer: ReturnType<typeof setTimeout>
}

export function pluginOrigin(id: string): string {
  if (!/^ctx-[a-f0-9]{48}$/.test(id)) throw new AppError('VALIDATION', 'Identité de contexte invalide.')
  // Node represents custom-scheme URL.origin as "null". Never use it to
  // compare the origin Chromium supplies for a privileged standard protocol.
  return `pt-plugin://${id}`
}

export class ContextRegistry {
  private suspendedPackages = new Map<string, number>()
  private configListeners = new Set<(id: string, revision: number) => void>()
  private records = new Map<string, ContextRecord>()

  constructor(private readonly db: Database) {}

  create(input: ContextRegistration): { id: string; origin: string; context: SdkContext } {
    const parsed = manifestSchema.safeParse(input.manifest)
    if (!parsed.success || parsed.data.kind !== 'package') throw new AppError('VALIDATION', 'Package attendu.')
    const manifest = parsed.data
    if (this.suspendedPackages.has(manifest.id)) throw new AppError('UNAVAILABLE', 'Package suspendu pendant une opération native.')
    if (!satisfies(HOST_API_VERSION, manifest.hostApi)) throw new AppError('INCOMPATIBLE', 'Version de l’API hôte incompatible.')
    const contribution = manifest.contributions.find((entry) => entry.id === input.contributionId)
    if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable.')
    const majorId = contribution.type === 'major' ? contribution.id : contribution.major
    const major = majorId ? { packageId: manifest.id, contributionId: majorId } : null
    if (!isInstanceBinding(input.binding) || !bindingMatchesDeclaration(input.binding, major)) throw new AppError('VALIDATION', 'Liaison incompatible avec la contribution.')
    if (input.runtimeKind && (contribution.type !== 'widget' || input.binding.mode !== 'none')) throw new AppError('VALIDATION', 'Contexte feature invalide.')
    const permissions = normalizePermissions(manifest.permissions)
    if (!isEmptyPermissionSet(addedPermissions(normalizePermissions(input.grantedPermissions), permissions))) throw new AppError('PERMISSION_DENIED', 'Les droits requis ne sont pas accordés.')
    const placement = this.placement({ packageId: manifest.id, contributionId: contribution.id, owner: input.owner, placementId: input.placementId, binding: input.binding })
    if (placement && placement.config_version !== (contribution.config?.version ?? 1)) throw new AppError('INCOMPATIBLE', 'Migration de configuration requise.')
    const config = validateConfig(contribution.config, placement ? JSON.parse(placement.config_json) : input.config ?? {})
    if (!config.ok) throw new AppError('VALIDATION', 'Configuration invalide.')
    const instanceId = input.binding.mode === 'none' ? null : input.binding.mode === 'fixed' ? input.binding.instanceId : getActiveInstanceId(this.db, manifest.id, majorId!)
    const instance = instanceId && majorId ? getInstance(this.db, manifest.id, majorId, instanceId) : null
    const emptyMajorPage = contribution.type === 'major' && input.owner.kind === 'page' && input.binding.mode === 'active' && !instanceId
    if (major && !instance && !emptyMajorPage) throw new AppError('UNAVAILABLE', 'L’instance liée n’est plus disponible.')
    if (input.owner.kind === 'project' && !this.db.get('SELECT 1 FROM projects WHERE id = ?', input.owner.projectId)) throw new AppError('NOT_FOUND', 'Projet introuvable.')
    if (input.owner.kind === 'dashboard' && !this.db.get('SELECT 1 FROM dashboards WHERE id = ?', input.owner.dashboardId)) throw new AppError('NOT_FOUND', 'Dashboard introuvable.')
    const id = `ctx-${randomBytes(24).toString('hex')}`
    const context: SdkContext = structuredClone({
      sdkVersion: SDK_VERSION, hostApi: HOST_API_VERSION,
      packageId: manifest.id, packageVersion: manifest.version, contributionId: contribution.id, kind: input.runtimeKind ?? contribution.type,
      placementId: input.placementId, owner: input.owner, binding: input.binding,
      instance: instance ? { instanceId: instance.instanceId, name: instance.name } : null,
      config: config.values, configRevision: placement?.revision ?? null, locale: input.locale ?? 'fr-FR', theme: input.theme ?? { mode: 'light', tokens: {} }, permissions,
    })
    const record: ContextRecord = { context, manifest: structuredClone(manifest), configSchema: contribution.config, controller: new AbortController(), cleanups: new Set(), initialized: false, initTimer: setTimeout(() => this.revoke(id), RUNTIME_LIMITS.initTimeoutMs) }
    record.initTimer.unref()
    this.records.set(id, record)
    return { id, origin: pluginOrigin(id), context: structuredClone(context) }
  }

  createFeature(manifest: Manifest, featureId: string, parentId: string, grantedPermissions: PermissionSet) {
    const checked = manifestSchema.safeParse(manifest)
    if (!checked.success) throw new AppError('VALIDATION', 'Extension invalide.')
    manifest = checked.data
    if (manifest.kind !== 'extension' || manifest.extensionType !== 'features') throw new AppError('VALIDATION', 'Extension attendue.')
    const parent = this.get(parentId), feature = manifest.features.find(item => item.id === featureId)
    if (!feature || parent.kind !== 'major' || parent.packageId !== manifest.target.package) throw new AppError('VALIDATION', 'Slot incompatible.')
    const target = this.manifest(parentId)
    if (!satisfies(target.version, manifest.target.version)) throw new AppError('INCOMPATIBLE', 'Cible incompatible.')
    if (!target.slots?.some(slot => slot.id === feature.slot.id && slot.version === feature.slot.version && slot.contribution === parent.contributionId)) throw new AppError('VALIDATION', 'Slot incompatible.')
    const registration = this.create({ manifest: extensionRuntime(manifest), contributionId: featureId, grantedPermissions, placementId: null, owner: { kind: 'none' }, binding: { mode: 'none' }, theme: parent.theme })
    const record = this.records.get(registration.id)!
    record.context.kind = 'feature'
    record.context.owner = { kind: 'slot', target: { packageId: parent.packageId, contributionId: parent.contributionId }, slotId: feature.slot.id }
    record.context.instance = parent.instance
    const stop = this.onRevoke(parentId, () => this.revoke(registration.id))
    this.onRevoke(registration.id, stop)
    return { ...registration, context: structuredClone(record.context) }
  }

  // Native-only migration identity, never registered by a frame or installer UI.
  createMigration(input: PackageManifest): { id: string; origin: string; context: SdkContext } {
    const manifest = manifestSchema.parse(input)
    if (manifest.kind !== 'package' || !manifest.migrations || !satisfies(HOST_API_VERSION, manifest.hostApi)) throw new AppError('INCOMPATIBLE', 'Migration incompatible.')
    const id = `ctx-${randomBytes(24).toString('hex')}`
    const context: SdkContext = { sdkVersion: SDK_VERSION, hostApi: HOST_API_VERSION, packageId: manifest.id, packageVersion: manifest.version, contributionId: 'migration', kind: 'migration', placementId: null, owner: { kind: 'none' }, binding: { mode: 'none' }, instance: null, config: {}, configRevision: null, locale: 'fr-FR', theme: { mode: 'light', tokens: {} }, permissions: normalizePermissions({}) }
    const initTimer = setTimeout(() => this.revoke(id), RUNTIME_LIMITS.initTimeoutMs)
    initTimer.unref()
    this.records.set(id, { manifest, context, configSchema: undefined, controller: new AbortController(), cleanups: new Set(), initialized: false, initTimer })
    return { id, origin: pluginOrigin(id), context: structuredClone(context) }
  }

  get(id: string): SdkContext {
    const record = this.records.get(id)
    if (!record || record.controller.signal.aborted) throw new AppError('UNAVAILABLE', 'Contexte indisponible ou révoqué.')
    const { binding, instance } = record.context
    if (binding.mode !== 'none') {
      const resolvedId = binding.mode === 'fixed' ? binding.instanceId : getActiveInstanceId(this.db, binding.major.packageId, binding.major.contributionId)
      const resolved = resolvedId ? getInstance(this.db, binding.major.packageId, binding.major.contributionId, resolvedId) : null
      const emptyMajorPage = record.context.kind === 'major' && record.context.owner.kind === 'page' && binding.mode === 'active' && !resolvedId && instance === null
      if (!emptyMajorPage && (!resolved || resolved.instanceId !== instance?.instanceId || resolved.name !== instance?.name)) {
        this.revoke(id)
        throw new AppError('UNAVAILABLE', 'La liaison du contexte a changé.')
      }
    }
    try {
      const placement = this.placement(record.context)
      if (placement) {
        if (placement.config_version !== (record.configSchema?.version ?? 1)) throw new Error('Configuration version changed')
        const config = validateConfig(record.configSchema, JSON.parse(placement.config_json))
        if (!config.ok) throw new Error('Invalid persisted config')
        record.context.config = config.values
        record.context.configRevision = placement.revision
      }
    } catch { this.revoke(id); throw new AppError('UNAVAILABLE', 'Emplacement indisponible ou modifié.') }
    return structuredClone(record.context)
  }

  private placement(context: Pick<SdkContext, 'packageId' | 'contributionId' | 'owner' | 'placementId' | 'binding'>) {
    const { owner, placementId } = context
    if (owner.kind !== 'project' && owner.kind !== 'dashboard') return null
    if (!placementId) throw new AppError('NOT_FOUND', 'Emplacement introuvable.')
    const row = owner.kind === 'project'
      ? this.db.get<{ package_id: string; contribution_id: string; binding_json: string; config_json: string; config_version: number; revision: number }>('SELECT package_id, contribution_id, binding_json, config_json, config_version, revision FROM project_blocks WHERE project_id = ? AND block_id = ?', owner.projectId, placementId)
      : this.db.get<{ package_id: string; contribution_id: string; binding_json: string; config_json: string; config_version: number; revision: number }>('SELECT package_id, contribution_id, binding_json, config_json, config_version, revision FROM dashboard_widgets WHERE dashboard_id = ? AND placement_id = ?', owner.dashboardId, placementId)
    if (!row || row.package_id !== context.packageId || row.contribution_id !== context.contributionId || !isDeepStrictEqual(JSON.parse(row.binding_json), context.binding)) throw new AppError('UNAVAILABLE', 'Emplacement modifié ou supprimé.')
    return row
  }

  onConfigChange(listener: (id: string, revision: number) => void): () => void {
    this.configListeners.add(listener)
    return () => this.configListeners.delete(listener)
  }

  updateConfig(id: string, values: Record<string, unknown>, expectedRevision: number, core: CoreService) {
    if (core.db !== this.db) throw new AppError('VALIDATION', 'Services incohérents.')
    const context = this.get(id)
    const schema = this.records.get(id)!.configSchema
    const config = validateConfig(schema, values)
    if (!config.ok) throw new AppError('VALIDATION', 'Configuration invalide.')
    const json = JSON.stringify(config.values)
    if (Buffer.byteLength(json) > RUNTIME_LIMITS.maxDocumentBytes) throw new AppError('VALIDATION', 'Configuration trop volumineuse.')
    let changed = false
    const result = core.commitPackageWrite(() => {
      const row = this.placement(context)
      if (!row) throw new AppError('UNAVAILABLE', 'Ce contexte ne possède pas de configuration persistante.')
      if (row.revision !== expectedRevision) throw new AppError('CONFLICT', 'Configuration modifiée ailleurs.', { revision: row.revision })
      changed = !isDeepStrictEqual(JSON.parse(row.config_json), config.values)
      const changes: DataChange[] = []
      if (changed) {
        const now = new Date().toISOString()
        if (context.owner.kind === 'project') {
          this.db.run('UPDATE project_blocks SET config_json = ?, revision = revision + 1 WHERE project_id = ? AND block_id = ?', json, context.owner.projectId, context.placementId)
          this.db.run('UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?', now, context.owner.projectId)
          const project = readProject(this.db, context.owner.projectId)!
          changes.push({ entity: 'project', id: context.owner.projectId, value: project })
        } else if (context.owner.kind === 'dashboard') {
          this.db.run('UPDATE dashboard_widgets SET config_json = ?, revision = revision + 1 WHERE dashboard_id = ? AND placement_id = ?', json, context.owner.dashboardId, context.placementId)
          this.db.run('UPDATE dashboards SET revision = revision + 1, updated_at = ? WHERE id = ?', now, context.owner.dashboardId)
        }
      }
      return { changed, changes, value: { config: config.values, revision: row.revision + (changed ? 1 : 0) } }
    })
    if (changed) for (const [otherId, record] of this.records) {
      if (record.context.placementId === context.placementId && isDeepStrictEqual(record.context.owner, context.owner)) {
        try { this.get(otherId) } catch { continue }
        for (const listener of this.configListeners) try { listener(otherId, result.revision) } catch { /* isolate subscribers */ }
      }
    }
    return result.value
  }

  manifest(id: string): PackageManifest {
    this.get(id)
    return structuredClone(this.records.get(id)!.manifest)
  }

  signal(id: string): AbortSignal {
    this.get(id)
    return this.records.get(id)!.controller.signal
  }

  ready(id: string): void {
    this.get(id)
    const record = this.records.get(id)!
    if (record.initialized) throw new AppError('CONFLICT', 'Ce contexte est déjà initialisé.')
    record.initialized = true
    clearTimeout(record.initTimer)
  }

  isReady(id: string): boolean { this.get(id); return this.records.get(id)!.initialized }

  onRevoke(id: string, cleanup: () => void): () => void {
    this.get(id)
    const record = this.records.get(id)!
    record.cleanups.add(cleanup)
    return () => { record.cleanups.delete(cleanup) }
  }

  revoke(id: string): void {
    const record = this.records.get(id)
    if (!record) return
    this.records.delete(id) // No callback can use this identity again.
    clearTimeout(record.initTimer)
    record.controller.abort()
    for (const cleanup of record.cleanups) { try { cleanup() } catch { /* revoke all other resources */ } }
    record.cleanups.clear()
  }

  // Revoke stale bindings immediately after a native instance commit. Only
  // the initiating request may finish its mutation acknowledgement first;
  // it gains no access to any new context/instance through this exception.
  reconcile(exceptId?: string): void {
    for (const id of [...this.records.keys()]) {
      if (id === exceptId) continue
      try { this.get(id) } catch { this.revoke(id) }
    }
  }

  // Native write/context fence held while an activation awaits third-party
  // migration code. Revocation alone would allow a fresh registration meanwhile.
  suspendPackage(packageId: string): () => void {
    this.suspendedPackages.set(packageId, (this.suspendedPackages.get(packageId) ?? 0) + 1)
    this.revokePackage(packageId)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = this.suspendedPackages.get(packageId) ?? 1
      if (count <= 1) this.suspendedPackages.delete(packageId)
      else this.suspendedPackages.set(packageId, count - 1)
    }
  }

  revokePackage(packageId: string): void {
    for (const [id, record] of this.records) if (record.context.packageId === packageId) this.revoke(id)
  }

  revokePlacement(owner: PlacementOwner, placementId: string | null): void {
    for (const [id, record] of this.records) {
      if (record.context.placementId === placementId && JSON.stringify(record.context.owner) === JSON.stringify(owner)) this.revoke(id)
    }
  }

  close(): void {
    for (const id of this.records.keys()) this.revoke(id)
    this.configListeners.clear()
  }
}
