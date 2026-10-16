import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { InstanceBinding, ContributionRef } from '../../shared/bindings'
import type { InstanceSummary, NavigationRequest, SdkContext } from '../../shared/sdk'
import type { Database } from '../db/database'
import { getActiveInstanceId, getInstance } from '../core/packageStore'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
export const navigationSchemas = {
  'navigation.open': z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('project'), projectId: id }).strict(),
    z.object({ kind: z.literal('major'), instanceId: id.optional() }).strict(),
    z.object({ kind: z.literal('external'), url: z.string().min(1).max(4096) }).strict(),
  ]),
  'instances.select': z.object({ instanceId: id }).strict(),
}
// Native descriptors, never arbitrary URLs, renderer routes or IPC channels.
export type InternalNavigationTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'major'; major: ContributionRef; binding: Exclude<InstanceBinding, { mode: 'none' }> }
export interface NavigationHooks {
  confirmExternal?: (source: { contextId: string; context: SdkContext }, url: string, signal: AbortSignal) => Promise<boolean>
  openExternal?: (url: string) => Promise<void>

  // Synchronously accept a validated request without navigating yet. Return a
  // synchronous commit to run AFTER the SDK acknowledgement, or null to refuse.
  // Do not allocate resources or perform side effects while preparing. The
  // native shell owns route changes, remounting and revocation of old frames.
  prepareNavigation?: (source: { contextId: string; context: SdkContext }, target: InternalNavigationTarget) => (() => void) | null
}
export class NavigationApi {
  constructor(private readonly db: Database, private readonly hooks: NavigationHooks) {}

  private instance(context: SdkContext, instanceId: string): InstanceSummary {
    if (context.binding.mode === 'none') throw new AppError('PERMISSION_DENIED', 'Aucun module majeur associé.')
    const major = context.binding.major
    if (major.packageId !== context.packageId) throw new AppError('PERMISSION_DENIED', 'Module non autorisé.')
    const row = getInstance(this.db, context.packageId, major.contributionId, instanceId)
    if (!row) throw new AppError('NOT_FOUND', 'Instance introuvable.')
    if (this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM major_instances WHERE package_id = ? AND instance_id = ?', context.packageId, instanceId)?.count !== 1) throw new AppError('CONFLICT', 'Adresse d’instance ambiguë.')
    return { instanceId: row.instanceId, name: row.name, position: row.position, revision: row.revision, active: getActiveInstanceId(this.db, context.packageId, major.contributionId) === row.instanceId }
  }

  private target(context: SdkContext, request: NavigationRequest): InternalNavigationTarget {
    if (request.kind === 'external') throw new AppError('UNAVAILABLE', 'Ouverture externe confirmée non disponible.')
    if (request.kind === 'project') {
      // A project placement may open its owner without acquiring general read
      // access. Other projects require the explicit CORE read grant.
      if (!(context.owner.kind === 'project' && context.owner.projectId === request.projectId) && !context.permissions.core.projects?.includes('read')) throw new AppError('PERMISSION_DENIED', 'Projet non autorisé.')
      if (!this.db.get('SELECT 1 FROM projects WHERE id = ?', request.projectId)) throw new AppError('NOT_FOUND', 'Projet introuvable.')
      return { kind: 'project', projectId: request.projectId }
    }
    if (context.binding.mode === 'none' || context.binding.major.packageId !== context.packageId) throw new AppError('PERMISSION_DENIED', 'Aucun module majeur associé.')
    const major = context.binding.major
    const instanceId = request.instanceId ?? context.instance?.instanceId
    if (instanceId) this.instance(context, instanceId)
    return { kind: 'major', major: structuredClone(major), binding: instanceId ? { mode: 'fixed', major: structuredClone(major), instanceId } : { mode: 'active', major: structuredClone(major) } }
  }

  prepare(contextId: string, context: SdkContext, request: NavigationRequest, current: () => SdkContext): () => void {
    const target = this.target(context, request)
    if (!this.hooks.prepareNavigation) throw new AppError('UNAVAILABLE', 'Navigation native indisponible.')
    const commit = this.hooks.prepareNavigation({ contextId, context: structuredClone(context) }, structuredClone(target))
    if (typeof commit !== 'function') throw new AppError('PERMISSION_DENIED', 'Navigation refusée.')
    return () => {
      // Another queued request may have removed a target or revoked the source
      // before this acknowledgement. Never navigate with stale authority.
      this.target(current(), request)
      commit()
    }
  }

  async prepareExternal(contextId: string, context: SdkContext, raw: string, signal: AbortSignal, current: () => SdkContext): Promise<() => void> {
    let url: URL
    try { url = new URL(raw) } catch { throw new AppError('VALIDATION', 'Lien web invalide.') }
    if (raw !== raw.trim() || /[\u0000-\u0020\u007f]/.test(raw) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new AppError('VALIDATION', 'Lien web invalide.')
    const canonical = url.href
    if (!this.hooks.confirmExternal || !this.hooks.openExternal) throw new AppError('UNAVAILABLE', 'Ouverture externe confirmée non disponible.')
    if (signal.aborted) throw new AppError('UNAVAILABLE', 'Contexte indisponible.')
    const accepted = await this.hooks.confirmExternal({ contextId, context: structuredClone(context) }, canonical, signal)
    current()
    if (signal.aborted) throw new AppError('UNAVAILABLE', 'Contexte indisponible.')
    if (!accepted) throw new AppError('PERMISSION_DENIED', 'Ouverture externe refusée.')
    return () => {
      current()
      if (signal.aborted) return
      // Native adapter must not throw asynchronously into the process.
      void this.hooks.openExternal!(canonical).catch(() => {})
    }
  }

  select(contextId: string, context: SdkContext, instanceId: string, current: () => SdkContext) {
    if (context.kind !== 'major') throw new AppError('PERMISSION_DENIED', 'Sélection réservée au module majeur.')
    const value = this.instance(context, instanceId)
    const commit = this.prepare(contextId, context, { kind: 'major', instanceId }, current)
    return { value, commit }
  }
}
