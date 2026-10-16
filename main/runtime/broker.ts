import type { MigrationCopy } from './migrationCopy'
import { NetworkApi, networkSchemas } from './network'
import { ExportApi, exportSchemas } from './exports'
import { NavigationApi, navigationSchemas, type NavigationHooks } from './navigation'
import { InstanceApi, instanceSchemas, type InstanceHooks } from './instances'
import { CoreApi, coreSchemas } from './coreApi'
import { EventSubscriptions, StorageEventBus, InstanceEventBus } from './events'
import { CoreService } from '../core/service'
import { SDK_EVENT_TOPICS, type SdkParams } from '../../shared/sdk'
import { AppError } from '../../shared/errors'
import { NETWORK_LIMITS, RUNTIME_LIMITS } from '../../shared/limits'
import { parseFrameMessage, type HostToFrameMessage, type SdkContext, type SdkMethod } from '../../shared/sdk'
import type { Database } from '../db/database'
import { deleteDocument, getDocument, getInstance, listDocuments, putDocument } from '../core/packageStore'
import { ContextRegistry } from './contexts'
import { z } from 'zod'

const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const address = z.object({ collection: name, id: name, scope: z.enum(['package', 'instance']).optional(), instanceId: name.optional() }).strict()
const revision = z.number().int().positive()
const schemas = {
  ...coreSchemas,
  ...instanceSchemas,
  ...navigationSchemas,
  ...exportSchemas,
  ...networkSchemas,
  'events.subscribe': z.object({ topics: z.array(z.enum(SDK_EVENT_TOPICS)).min(1).max(SDK_EVENT_TOPICS.length).refine((topics) => new Set(topics).size === topics.length) }).strict(),
  'events.unsubscribe': z.object({ subscriptionId: z.string().regex(/^sub-[a-f0-9]{32}$/) }).strict(),
  'context.get': z.object({}).strict(),
  'context.updateConfig': z.object({ config: z.custom<Record<string, unknown>>((value) => value !== null && typeof value === 'object' && !Array.isArray(value)), expectedRevision: revision }).strict(),
  'storage.get': address,
  'storage.put': address.extend({ value: z.json(), expectedRevision: revision.nullable() }),
  'storage.delete': address.extend({ expectedRevision: revision }),
  'storage.list': address.omit({ id: true }).extend({ cursor: name.optional(), limit: z.number().int().min(1).max(RUNTIME_LIMITS.maxPageSize).optional() }),
} as const

// Transport-independent boundary. The Electron adapter must bind one
// trusted main-frame sender and one registered context to each session. Neither
// context identity nor package/instance authority is taken from wire messages.
export interface BrokerPort {
  send(message: HostToFrameMessage): void
  close(): void
}
export class SdkBroker {
  private readonly storageEvents = new StorageEventBus()
  private readonly instanceEvents = new InstanceEventBus()
  private readonly networkApi = new NetworkApi()
  private readonly exportApi: ExportApi
  private readonly navigationApi: NavigationApi
  private readonly instanceApi: InstanceApi
  private readonly coreApi: CoreApi
  constructor(private readonly db: Database, private readonly contexts: ContextRegistry, private readonly core: CoreService, private readonly hooks: InstanceHooks & NavigationHooks & { migration?: MigrationCopy; prevalidation?: boolean } = {}) {
    if (core.db !== db) throw new AppError('VALIDATION', 'Services de stockage incohérents.')
    this.coreApi = new CoreApi(db, core)
    this.exportApi = new ExportApi(db, contexts)
    this.navigationApi = new NavigationApi(db, hooks)
    this.instanceApi = new InstanceApi(db, core, hooks)
  }

  open(contextId: string, port: BrokerPort): { receive(data: unknown): Promise<void>; close(): void } {
    this.contexts.get(contextId)
    const pending = new Map<string, AbortController>()
    let closed = false
    let stop: () => void = () => {}
    const close = () => {
      if (closed) return
      closed = true
      for (const controller of pending.values()) controller.abort()
      pending.clear()
      stop()
      stopCore()
      stopStorage()
      stopInstances()
      stopConfig()
      subscriptions.clear()
      try { port.send({ type: 'revoked', reason: 'Contexte indisponible' }) } catch { /* dead port */ }
      try { port.close() } catch { /* already closed */ }
    }
    const subscriptions = new EventSubscriptions(() => this.contexts.get(contextId), (event) => {
      if (!closed) try { port.send({ type: 'event', event }) } catch { close() }
    }, () => this.exportApi.hasExports(contextId))
    const stopCore = this.core.onChange((changes, revision) => {
      try {
        for (const [entity, resource] of [['project', 'projects'], ['note', 'notes'], ['error', 'errors']] as const) {
          const ids = changes.filter((change) => change.entity === entity).map((change) => 'id' in change ? change.id : '')
          if (ids.length) subscriptions.core(resource, ids, revision)
        }
      } catch { close() }
    })
    const stopStorage = this.storageEvents.onChange((change, revision) => { try { subscriptions.storage(change, revision); subscriptions.exports(this.exportApi.invalidations(contextId, change), revision) } catch { close() } })
    const stopInstances = this.instanceEvents.onChange((change) => { try { subscriptions.instances(change); subscriptions.exports(this.exportApi.invalidations(contextId, change), change.revision) } catch { close() } })
    const stopConfig = this.contexts.onConfigChange((id, revision) => { if (id === contextId) try { subscriptions.context(revision) } catch { close() } })
    try { stop = this.contexts.onRevoke(contextId, close) } catch (error) { close(); throw error }
    const receive = async (data: unknown): Promise<void> => {
      if (closed) return
      // JSON-only protocol: reject cycles, binary data, class instances and
      // over-budget messages, before dispatching or querying the database.
      if (!isBoundedJson(data)) { close(); return }
      const request = parseFrameMessage(data)
      if (!request || Object.keys(data as object).some((key) => !['type', 'requestId', 'method', 'params'].includes(key))) { close(); return }
      if (pending.has(request.requestId)) { close(); return }
      const respond = (message: HostToFrameMessage) => { if (!closed) { try { port.send(message) } catch { close() } } }
      if (pending.size >= RUNTIME_LIMITS.maxPendingRequestsPerContext) {
        respond({ type: 'response', requestId: request.requestId, ok: false, error: { code: 'UNAVAILABLE', message: 'Trop de requêtes en cours.' } })
        return
      }
      const controller = new AbortController()
      pending.set(request.requestId, controller)
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      const lifecycle: { committed: boolean; acknowledged: boolean; afterReply: (() => void)[] } = { committed: false, acknowledged: false, afterReply: [] }
      try {
        const context = this.contexts.get(contextId)
        const contextSignal = this.contexts.signal(contextId)
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { reject(new AppError('TIMEOUT', 'Délai SDK dépassé.')); controller.abort() }, request.method === 'network.fetch' ? NETWORK_LIMITS.timeoutMs : RUNTIME_LIMITS.callTimeoutMs)
        })
        const cancelled = new Promise<never>((_, reject) => {
          onAbort = () => reject(new AppError('UNAVAILABLE', 'Contexte indisponible.'))
          controller.signal.addEventListener('abort', onAbort, { once: true })
        })
        const value = await Promise.race([this.dispatch(context, request.method, request.params, controller.signal, subscriptions, contextId, lifecycle), deadline, cancelled])
        // Only an already committed instance mutation may acknowledge before
        // revoking its own old binding. All other stale results are refused.
        if (lifecycle.committed) { if (contextSignal.aborted) throw new AppError('UNAVAILABLE', 'Contexte révoqué.') }
        else this.contexts.get(contextId)
        if (!isBoundedJson(value)) throw new AppError('UNAVAILABLE', 'Réponse SDK trop volumineuse.')
        respond({ type: 'response', requestId: request.requestId, ok: true, value })
        lifecycle.acknowledged = !closed
      } catch (error) {
        respond({ type: 'response', requestId: request.requestId, ok: false, error: error instanceof AppError ? error.toPayload() : { code: 'UNAVAILABLE', message: 'Appel SDK indisponible.' } })
      } finally {
        if (timer) clearTimeout(timer)
        if (onAbort) controller.signal.removeEventListener('abort', onAbort)
        pending.delete(request.requestId)
        for (const action of lifecycle.afterReply) try { action() } catch { close() }
      }
    }
    return { receive, close }
  }

  private async dispatch(context: SdkContext, method: SdkMethod, params: unknown, signal: AbortSignal, subscriptions: EventSubscriptions, contextId: string, lifecycle: { committed: boolean; acknowledged: boolean; afterReply: (() => void)[] }): Promise<unknown> {
    if (signal.aborted) throw new AppError('UNAVAILABLE', 'Contexte indisponible.')
    // Native-only preflight: no reads of business data, mutations, network,
    // navigation, notifications or migrations, even if the manifest requests it.
    if (this.hooks.prevalidation) {
      if (!['context.get', 'events.subscribe', 'events.unsubscribe'].includes(method)) throw new AppError('PERMISSION_DENIED', 'API indisponible en prévalidation.')
      if (method === 'events.subscribe' && JSON.stringify(params) !== JSON.stringify({ topics: ['context.changed'] })) throw new AppError('PERMISSION_DENIED', 'Abonnement indisponible en prévalidation.')
    }
    if (context.kind === 'migration' && !['context.get', 'events.subscribe', 'events.unsubscribe'].includes(method)) {
      if (!this.hooks.migration) throw new AppError('UNAVAILABLE', 'Copie de migration indisponible.')
      const actions: (() => void)[] = []
      const result = this.hooks.migration.dispatch(method, params, actions)
      lifecycle.afterReply.push(() => { if (lifecycle.acknowledged) for (const action of actions) action() })
      return result
    }
    if (context.kind === 'migration' && method === 'events.subscribe' && JSON.stringify(params) !== JSON.stringify({ topics: ['context.changed'] })) throw new AppError('PERMISSION_DENIED', 'Abonnement indisponible en migration.')
    // Unimplemented methods fail closed; no reflection, generic IPC or fallback.
    if (!Object.prototype.hasOwnProperty.call(schemas, method)) throw new AppError('UNAVAILABLE', 'Méthode SDK non disponible.')
    const parsed = schemas[method as keyof typeof schemas].safeParse(params)
    if (!parsed.success) throw new AppError('VALIDATION', 'Paramètres SDK invalides.')
    if (method === 'context.get') return context
    if (method === 'context.updateConfig') {
      const input = parsed.data as SdkParams['context.updateConfig']
      return this.contexts.updateConfig(contextId, input.config, input.expectedRevision, this.core)
    }
    if (method === 'events.subscribe') return subscriptions.subscribe((parsed.data as SdkParams['events.subscribe']).topics)
    if (method === 'events.unsubscribe') return subscriptions.unsubscribe((parsed.data as SdkParams['events.unsubscribe']).subscriptionId)
    if (method === 'core.get') {
      const input = parsed.data as SdkParams['core.get']
      return this.coreApi.get(context, input.resource, input.id)
    }
    if (method === 'core.list') {
      const input = parsed.data as SdkParams['core.list']
      return this.coreApi.list(context, input.resource, input.cursor, input.limit)
    }
    if (method === 'core.update') {
      const input = parsed.data as SdkParams['core.update']
      return this.coreApi.update(context, input.resource, input.id, input.patch, input.expectedRevision)
    }
    if (method === 'network.fetch') return this.networkApi.fetch(context, parsed.data as SdkParams['network.fetch'], signal)
    if (method === 'packages.readExport') return this.exportApi.read(contextId, parsed.data as SdkParams['packages.readExport'])
    if (method === 'navigation.open') {
      const request = parsed.data as SdkParams['navigation.open']
      const commit = request.kind === 'external' ? await this.navigationApi.prepareExternal(contextId, context, request.url, signal, () => this.contexts.get(contextId)) : this.navigationApi.prepare(contextId, context, request, () => this.contexts.get(contextId))
      lifecycle.afterReply.push(() => { if (lifecycle.acknowledged) commit() })
      return { opened: true }
    }
    if (method === 'instances.select') {
      const result = this.navigationApi.select(contextId, context, (parsed.data as SdkParams['instances.select']).instanceId, () => this.contexts.get(contextId))
      lifecycle.afterReply.push(() => { if (lifecycle.acknowledged) result.commit() })
      return result.value
    }
    if (method === 'instances.list') return this.instanceApi.list(context, parsed.data as SdkParams['instances.list'])
    if (method === 'instances.create' || method === 'instances.rename' || method === 'instances.setActive' || method === 'instances.delete') {
      const result = method === 'instances.create' ? this.instanceApi.create(context, parsed.data as SdkParams['instances.create'])
        : method === 'instances.rename' ? this.instanceApi.rename(context, parsed.data as SdkParams['instances.rename'])
        : method === 'instances.setActive' ? this.instanceApi.setActive(context, parsed.data as SdkParams['instances.setActive'])
        : await this.instanceApi.delete(context, parsed.data as SdkParams['instances.delete'], signal, (() => {
          const major = this.contexts.manifest(contextId).contributions.find(entry => entry.id === context.contributionId)
          return major?.type === 'major' ? major.minInstances ?? 0 : 0
        })())
      lifecycle.committed = true
      if (result.change) {
        this.contexts.reconcile(contextId)
        const change = result.change
        lifecycle.afterReply.push(() => { this.contexts.reconcile(); this.instanceEvents.publish(change) })
      }
      return result.value
    }
    const input = parsed.data as z.infer<typeof address> & { value?: unknown; expectedRevision?: number | null; cursor?: string; limit?: number }
    const scope = this.resolveScope(context, input)
    const target = { packageId: context.packageId, scope, collection: input.collection, id: input.id }
    switch (method) {
      case 'storage.get': return getDocument(this.db, target)
      case 'storage.list': return listDocuments(this.db, { ...target, cursor: input.cursor, limit: input.limit })
      case 'storage.put': {
        const result = this.core.commitPackageWrite(() => ({ value: { revision: putDocument(this.db, target, input.value, { now: new Date().toISOString(), expectedRevision: input.expectedRevision, enforceQuota: true }).revision }, changed: true }))
        this.storageEvents.publish({ packageId: context.packageId, instanceId: scope || null, collection: input.collection, id: input.id, deleted: false, documentRevision: result.value.revision }, result.revision)
        return result.value
      }
      case 'storage.delete': {
        const result = this.core.commitPackageWrite(() => { const deleted = deleteDocument(this.db, target, input.expectedRevision as number); return { value: { deleted }, changed: deleted } })
        if (result.value.deleted) this.storageEvents.publish({ packageId: context.packageId, instanceId: scope || null, collection: input.collection, id: input.id, deleted: true, documentRevision: (input.expectedRevision as number) + 1 }, result.revision)
        return result.value
      }
      default: throw new AppError('UNAVAILABLE', 'Méthode SDK non disponible.')
    }
  }

  private resolveScope(context: SdkContext, input: { scope?: string; instanceId?: string }): string {
    if (input.scope === 'package') {
      if (input.instanceId) throw new AppError('VALIDATION', 'Instance inattendue pour le stockage du package.')
      return ''
    }
    // Associated minor/widget contributions can only access their resolved
    // instance. A major may explicitly address another of its own instances.
    const instanceId = input.instanceId ?? context.instance?.instanceId
    if (!instanceId) {
      if (input.scope === 'instance') throw new AppError('UNAVAILABLE', 'Aucune instance liée.')
      return ''
    }
    if (context.kind !== 'major' && instanceId !== context.instance?.instanceId) throw new AppError('PERMISSION_DENIED', 'Instance non autorisée.')
    const majorId = context.binding.mode === 'none' ? null : context.binding.major.contributionId
    if (!majorId || !getInstance(this.db, context.packageId, majorId, instanceId)) throw new AppError('NOT_FOUND', 'Instance introuvable.')
    // Legacy/native data may reuse an instance id across two majors. The
    // document table has a package/instance namespace, so never silently alias
    // such addresses. New SDK instance creation must guarantee uniqueness.
    const matches = this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM major_instances WHERE package_id = ? AND instance_id = ?', context.packageId, instanceId)?.count
    if (matches !== 1) throw new AppError('CONFLICT', 'Adresse d’instance ambiguë.')
    return instanceId
  }
}

// Iterative bounded walk avoids stack overflows and JSON.stringify on enormous
// structured-clone inputs. This bound is bytes of JSON on the wire, not objects.
export function isBoundedJson(value: unknown): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  const seen = new Set<object>()
  let bytes = 0
  while (stack.length) {
    const entry = stack.pop()!
    const current = entry.value
    if (entry.depth > 64) return false
    if (current === null || typeof current === 'boolean') bytes += 5
    else if (typeof current === 'number') { if (!Number.isFinite(current)) return false; bytes += String(current).length }
    else if (typeof current === 'string') {
      if (current.length > RUNTIME_LIMITS.maxMessageBytes) return false
      bytes += Buffer.byteLength(JSON.stringify(current))
    } else if (typeof current === 'object') {
      if (seen.has(current)) return false
      seen.add(current)
      if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false
      const keys = Object.keys(current)
      if (Array.isArray(current) && (current.length !== keys.length || keys.some((key, index) => key !== String(index)))) return false
      bytes += 2 + keys.length
      if (keys.length > RUNTIME_LIMITS.maxMessageBytes / 2) return false
      for (const key of keys) {
        if (!Array.isArray(current)) bytes += Buffer.byteLength(JSON.stringify(key)) + 1
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (!descriptor || !('value' in descriptor)) return false
        stack.push({ value: descriptor.value, depth: entry.depth + 1 })
      }
    } else return false
    if (bytes > RUNTIME_LIMITS.maxMessageBytes || stack.length > RUNTIME_LIMITS.maxMessageBytes / 2) return false
  }
  return true
}
