import type { ErrorPayload, SdkErrorCode } from '../../shared/errors'
import {
  SDK_HELLO,
  SDK_WELCOME,
  type HostToFrameMessage,
  type SdkContext,
  type SdkEvent,
  type SdkEventTopic,
  type SdkMethod,
  type SdkParams,
  type SdkResults,
  type SdkWelcome,
} from '../../shared/sdk'
import { SDK_VERSION, HOST_API_VERSION } from '../../shared/version'
import { RUNTIME_LIMITS, NETWORK_LIMITS } from '../../shared/limits'

// Client side of the ProjectTracker SDK, executed inside an isolated
// contribution frame. It only knows a MessagePort handed over by the host; it
// has no access to Node, IPC or the shell DOM.

export class SdkError extends Error {
  readonly code: SdkErrorCode
  readonly details?: Record<string, unknown>
  constructor(payload: ErrorPayload) {
    super(payload.message)
    this.name = 'SdkError'
    this.code = payload.code
    this.details = payload.details
  }
}

type EventHandler = (event: SdkEvent) => void

export interface ProjectTrackerSdk {
  readonly context: SdkContext
  call<M extends SdkMethod>(method: M, params: SdkParams[M]): Promise<SdkResults[M]>
  storage: {
    get(address: SdkParams['storage.get']): Promise<SdkResults['storage.get']>
    put(input: SdkParams['storage.put']): Promise<SdkResults['storage.put']>
    delete(address: SdkParams['storage.delete']): Promise<SdkResults['storage.delete']>
    list(query: SdkParams['storage.list']): Promise<SdkResults['storage.list']>
  }
  instances: {
    list(query?: SdkParams['instances.list']): Promise<SdkResults['instances.list']>
    create(input: Omit<SdkParams['instances.create'], 'operationId'> & { operationId?: string }): Promise<SdkResults['instances.create']>
    rename(instanceId: string, name: string, expectedRevision: number): Promise<SdkResults['instances.rename']>
    delete(instanceId: string, expectedRevision: number): Promise<SdkResults['instances.delete']>
    setActive(instanceId: string, expectedActiveInstanceId: string | null): Promise<SdkResults['instances.setActive']>
    select(instanceId: string): Promise<SdkResults['instances.select']>
  }
  core: {
    list(query: SdkParams['core.list']): Promise<SdkResults['core.list']>
    get(query: SdkParams['core.get']): Promise<SdkResults['core.get']>
    update(input: SdkParams['core.update']): Promise<SdkResults['core.update']>
  }
  packages: {
    readExport(query: SdkParams['packages.readExport']): Promise<SdkResults['packages.readExport']>
  }
  events: {
    // Returns a function that cancels the subscription.
    subscribe(topics: SdkEventTopic[], handler: EventHandler): Promise<() => Promise<void>>
  }
  navigation: {
    open(request: SdkParams['navigation.open']): Promise<SdkResults['navigation.open']>
  }
  network: {
    fetch(request: SdkParams['network.fetch']): Promise<SdkResults['network.fetch']>
  }
  config: {
    update(config: Record<string, unknown>, expectedRevision: number): Promise<SdkResults['context.updateConfig']>
  }
  // Called with the fresh context after a `context.changed` event.
  onContextChange(handler: (context: SdkContext) => void): () => void
  // Set when the host revoked this context (unmount, update, permission change).
  readonly revoked: boolean
}

function randomId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createClient(port: MessagePort, welcome: SdkWelcome, timeoutMs: number): ProjectTrackerSdk {
  let context = welcome.context
  let revoked = false
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const handlers = new Map<string, EventHandler>()
  const contextHandlers = new Set<(context: SdkContext) => void>()

  const revoke = () => {
    if (revoked) return
    revoked = true
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new SdkError({ code: 'UNAVAILABLE', message: 'Contexte révoqué' }))
    }
    pending.clear()
    handlers.clear()
    contextHandlers.clear()
    port.close()
  }
  port.addEventListener('close', revoke)
  port.onmessageerror = revoke

  port.onmessage = (event: MessageEvent<HostToFrameMessage>) => {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.type === 'response') {
      const entry = pending.get(message.requestId)
      if (!entry) return
      pending.delete(message.requestId)
      clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(new SdkError(message.error))
    } else if (message.type === 'event') {
      handlers.get(message.event.subscriptionId)?.(message.event)
    } else if (message.type === 'revoked') {
      revoke()
    }
  }

  function call<M extends SdkMethod>(method: M, params: SdkParams[M]): Promise<SdkResults[M]> {
    if (revoked) return Promise.reject(new SdkError({ code: 'UNAVAILABLE', message: 'Contexte révoqué' }))
    if (pending.size >= RUNTIME_LIMITS.maxPendingRequestsPerContext) return Promise.reject(new SdkError({ code: 'UNAVAILABLE', message: 'Trop de requêtes en cours' }))
    const requestId = randomId()
    return new Promise<SdkResults[M]>((resolve, reject) => {
      // Network calls have their own (longer) host-side deadline.
      const limit = method === 'network.fetch' ? NETWORK_LIMITS.timeoutMs + 1000 : timeoutMs
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new SdkError({ code: 'TIMEOUT', message: `Délai dépassé pour ${method}` }))
      }, limit)
      pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        port.postMessage({ type: 'request', requestId, method, params })
      } catch {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(new SdkError({ code: 'VALIDATION', message: 'Message SDK non sérialisable' }))
      }
    })
  }

  port.start()

  // Keep the cached context fresh for helpers relying on it.
  const contextSubscription = call('events.subscribe', { topics: ['context.changed'] })
    .then(({ subscriptionId }) => {
      handlers.set(subscriptionId, () => {
        void call('context.get', {}).then((next) => {
          context = next
          for (const handler of contextHandlers) handler(next)
        }).catch(() => undefined)
      })
    })
    .catch(() => undefined)
  void contextSubscription

  return {
    get context() {
      return context
    },
    get revoked() {
      return revoked
    },
    call,
    storage: {
      get: (address) => call('storage.get', address),
      put: (input) => call('storage.put', input),
      delete: (address) => call('storage.delete', address),
      list: (query) => call('storage.list', query),
    },
    instances: {
      list: (query = {}) => call('instances.list', query),
      create: (input) => call('instances.create', { ...input, operationId: input.operationId ?? randomId() }),
      rename: (instanceId, name, expectedRevision) => call('instances.rename', { instanceId, name, expectedRevision }),
      delete: (instanceId, expectedRevision) => call('instances.delete', { instanceId, expectedRevision }),
      setActive: (instanceId, expectedActiveInstanceId) => call('instances.setActive', { instanceId, expectedActiveInstanceId }),
      select: (instanceId) => call('instances.select', { instanceId }),
    },
    core: {
      list: (query) => call('core.list', query),
      get: (query) => call('core.get', query),
      update: (input) => call('core.update', input),
    },
    packages: {
      readExport: (query) => call('packages.readExport', query),
    },
    events: {
      async subscribe(topics, handler) {
        const { subscriptionId } = await call('events.subscribe', { topics })
        handlers.set(subscriptionId, handler)
        return async () => {
          handlers.delete(subscriptionId)
          await call('events.unsubscribe', { subscriptionId }).catch(() => undefined)
        }
      },
    },
    navigation: {
      open: (request) => call('navigation.open', request),
    },
    network: {
      fetch: (request) => call('network.fetch', request),
    },
    config: {
      update: (config, expectedRevision) => call('context.updateConfig', { config, expectedRevision }),
    },
    onContextChange(handler) {
      contextHandlers.add(handler)
      return () => contextHandlers.delete(handler)
    },
  }
}

// Waits for the host handshake. The frame announces itself to its parent; the
// host answers with a MessagePort bound to the context it registered for this
// frame. Nothing in the hello message is trusted by the host.
export function connect(options: { hostOrigin: string; timeoutMs?: number }): Promise<ProjectTrackerSdk> {
  // Provided by the host bootstrap, never inferred from an untrusted message.
  const hostOrigin = options.hostOrigin
  if (!/^(?:app:\/\/[a-zA-Z0-9.-]+|http:\/\/localhost:\d{1,5})$/.test(hostOrigin)) return Promise.reject(new SdkError({ code: 'VALIDATION', message: 'Origine hôte invalide' }))
  const timeoutMs = options.timeoutMs ?? RUNTIME_LIMITS.initTimeoutMs
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new SdkError({ code: 'TIMEOUT', message: 'L’hôte n’a pas répondu' }))
    }, timeoutMs)
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent || event.origin !== hostOrigin) return
      const data = event.data as SdkWelcome | undefined
      if (!data || data.type !== SDK_WELCOME || event.ports.length !== 1 || data.hostApi !== HOST_API_VERSION || !data.context || data.context.hostApi !== data.hostApi || data.context.sdkVersion !== SDK_VERSION) return
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(createClient(event.ports[0], data, timeoutMs))
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: SDK_HELLO, sdkVersion: SDK_VERSION }, hostOrigin)
  })
}

export { SDK_VERSION }
export type { SdkContext, SdkEvent, SdkEventTopic, SdkMethod, SdkParams, SdkResults }
