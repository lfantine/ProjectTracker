import type { ExportInvalidation } from './exports'
import type { InstanceChange } from './instances'
import { randomBytes } from 'node:crypto'
import { AppError } from '../../shared/errors'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { CoreResource } from '../../shared/permissions'
import type { SdkContext, SdkEvent, SdkEventTopic } from '../../shared/sdk'
import { requireCorePermission } from './coreApi'

export interface StorageChange {
  packageId: string
  instanceId: string | null
  collection: string
  id: string
  deleted: boolean
  documentRevision: number
}
// Native-only event feed. Metadata used to authorize delivery never enters the
// frame payload. Only the broker can publish after the corresponding commit.
export class StorageEventBus {
  private listeners = new Set<(change: StorageChange, revision: number) => void>()
  onChange(listener: (change: StorageChange, revision: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  publish(change: StorageChange, revision: number): void {
    for (const listener of this.listeners) { try { listener(change, revision) } catch { /* one view cannot block the others */ } }
  }
}

const SUPPORTED = new Set<SdkEventTopic>(['exports.changed', 'instances.changed', 'context.changed', 'storage.changed', 'core.projects.changed', 'core.notes.changed', 'core.errors.changed'])
export class EventSubscriptions {
  private subscriptions = new Map<string, Set<SdkEventTopic>>()
  constructor(private readonly currentContext: () => SdkContext, private readonly send: (event: SdkEvent) => void, private readonly canReadExports: () => boolean = () => false) {}
  subscribe(topics: SdkEventTopic[]): { subscriptionId: string } {
    const context = this.currentContext()
    // Validate every topic before installing anything: no partial grant.
    for (const topic of topics) {
      if (!SUPPORTED.has(topic)) throw new AppError('UNAVAILABLE', 'Événement SDK non disponible.')
      if (topic === 'exports.changed' && !this.canReadExports()) throw new AppError('PERMISSION_DENIED', 'Aucun export autorisé.')
      if (topic.startsWith('core.')) requireCorePermission(context, topic.split('.')[1] as CoreResource, 'read')
    }
    if (this.subscriptions.size >= RUNTIME_LIMITS.maxSubscriptionsPerContext) throw new AppError('UNAVAILABLE', 'Trop d’abonnements SDK.')
    const subscriptionId = `sub-${randomBytes(16).toString('hex')}`
    this.subscriptions.set(subscriptionId, new Set(topics))
    return { subscriptionId }
  }
  unsubscribe(id: string): { unsubscribed: boolean } { return { unsubscribed: this.subscriptions.delete(id) } }
  clear(): void { this.subscriptions.clear() }
  core(resource: CoreResource, ids: string[], revision: number): void {
    const context = this.currentContext()
    if (!context.permissions.core[resource]?.includes('read')) return
    this.deliver(`core.${resource}.changed`, revision, ids.length <= RUNTIME_LIMITS.maxPageSize && Buffer.byteLength(JSON.stringify(ids)) < RUNTIME_LIMITS.maxMessageBytes / 2 ? { ids } : { invalidate: true })
  }
  storage(change: StorageChange, revision: number): void {
    const context = this.currentContext()
    if (change.packageId !== context.packageId) return
    // Even a major receives notifications only for its currently resolved
    // instance plus package-wide documents. No sibling placement data leaks.
    if (change.instanceId !== null && change.instanceId !== context.instance?.instanceId) return
    this.deliver('storage.changed', revision, { collection: change.collection, id: change.id, instanceId: change.instanceId, deleted: change.deleted, documentRevision: change.documentRevision })
  }
  exports(changes: ExportInvalidation[], revision: number): void { for (const change of changes) this.deliver('exports.changed', revision, { ...change }) }
  context(revision: number): void { this.currentContext(); this.deliver('context.changed', revision, {}) }
  instances(change: InstanceChange): void {
    const context = this.currentContext()
    if (context.packageId !== change.packageId || context.binding.mode === 'none' || context.binding.major.contributionId !== change.majorId) return
    this.deliver('instances.changed', change.revision, { instanceId: change.instanceId, action: change.action })
  }
  private deliver(topic: SdkEventTopic, revision: number, payload: Record<string, unknown>): void {
    for (const [subscriptionId, topics] of this.subscriptions) if (topics.has(topic)) this.send({ subscriptionId, topic, revision, payload })
  }
}

export class InstanceEventBus {
  private listeners = new Set<(change: InstanceChange) => void>()
  onChange(listener: (change: InstanceChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  publish(change: InstanceChange): void { for (const listener of this.listeners) try { listener(change) } catch { /* isolate views */ } }
}
