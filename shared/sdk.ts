import type { MigrationEntry } from './migration'
import type { ContributionRef, InstanceBinding } from './bindings'
import type { ErrorPayload, SdkErrorCode } from './errors'
import type { CoreAction, CoreResource } from './permissions'

// Protocol between a contribution frame and the host. The frame never names
// its own package, project or instance in a way the host would trust: the host
// resolves them from the registered context bound to the MessagePort.

export type SdkRequest = { requestId: string; method: SdkMethod; params: unknown }
export type { SdkErrorCode }

// Closed list. A method absent from this table is refused; the host never
// dispatches to an arbitrary function or IPC channel.
export const SDK_METHODS = {
  'migration.read': { family: 'migration' },
  'migration.write': { family: 'migration' },
  'migration.delete': { family: 'migration' },
  'migration.complete': { family: 'migration' },
  'migration.fail': { family: 'migration' },
  'context.get': { family: 'context' },
  'context.updateConfig': { family: 'context' },
  'storage.get': { family: 'storage' },
  'storage.put': { family: 'storage' },
  'storage.delete': { family: 'storage' },
  'storage.list': { family: 'storage' },
  'instances.list': { family: 'instances' },
  'instances.create': { family: 'instances', majorOnly: true },
  'instances.rename': { family: 'instances', majorOnly: true },
  'instances.delete': { family: 'instances', majorOnly: true },
  'instances.setActive': { family: 'instances', majorOnly: true },
  'instances.select': { family: 'instances', majorOnly: true },
  'core.list': { family: 'core' },
  'core.get': { family: 'core' },
  'core.update': { family: 'core' },
  'packages.readExport': { family: 'packages' },
  'events.subscribe': { family: 'events' },
  'events.unsubscribe': { family: 'events' },
  'navigation.open': { family: 'navigation' },
  'network.fetch': { family: 'network' },
} as const satisfies Record<string, { family: SdkFamily; majorOnly?: boolean }>

export type SdkFamily = 'migration' | 'context' | 'storage' | 'instances' | 'core' | 'packages' | 'events' | 'navigation' | 'network'
export type SdkMethod = keyof typeof SDK_METHODS

export function isSdkMethod(value: unknown): value is SdkMethod {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SDK_METHODS, value)
}

// ---------------------------------------------------------------------------
// Context

export type ContextKind = 'major' | 'minor' | 'widget' | 'feature' | 'migration'

export type PlacementOwner =
  | { kind: 'project'; projectId: string }
  | { kind: 'dashboard'; dashboardId: string }
  | { kind: 'page' }
  | { kind: 'slot'; target: ContributionRef; slotId: string }
  | { kind: 'none' }

export interface ResolvedInstance {
  instanceId: string
  name: string
}

export interface SdkContext {
  sdkVersion: string
  hostApi: string
  packageId: string
  packageVersion: string
  contributionId: string
  kind: ContextKind
  placementId: string | null
  owner: PlacementOwner
  binding: InstanceBinding
  // Instance the context works on; null when unresolved (deleted instance,
  // unavailable package) or for independent components.
  instance: ResolvedInstance | null
  config: Record<string, unknown>
  // Persisted placement revision; null for non-persistent contexts.
  configRevision: number | null
  locale: string
  theme: { mode: 'light' | 'dark'; tokens: Record<string, string> }
  // Granted rights, as resolved by the host; informative only.
  permissions: { core: Partial<Record<CoreResource, CoreAction[]>>; network: string[]; exports: { package: string; export: string }[] }
}

// ---------------------------------------------------------------------------
// Methods parameters and results

export type StorageScope = 'package' | 'instance'

export interface StorageAddress {
  collection: string
  id: string
  // "instance": the document belongs to the context's resolved instance (or
  // `instanceId` for a major managing several instances).
  scope?: StorageScope
  instanceId?: string
}

export interface StoredDocument<T = unknown> {
  id: string
  collection: string
  instanceId: string | null
  revision: number
  value: T
  updatedAt: string
}

export interface SdkParams {
  'migration.read': { cursor?: string; limit?: number }
  'migration.write': { entry: MigrationEntry }
  'migration.delete': { entry: MigrationEntry }
  'migration.complete': Record<string, never>
  'migration.fail': Record<string, never>
  'context.get': Record<string, never>
  'context.updateConfig': { config: Record<string, unknown>; expectedRevision: number }
  'storage.get': StorageAddress
  'storage.put': StorageAddress & { value: unknown; expectedRevision: number | null }
  'storage.delete': StorageAddress & { expectedRevision: number }
  'storage.list': { collection: string; scope?: StorageScope; instanceId?: string; cursor?: string; limit?: number }
  'instances.list': { cursor?: string; limit?: number }
  'instances.create': { name: string; copyFrom?: string; operationId: string }
  'instances.rename': { instanceId: string; name: string; expectedRevision: number }
  'instances.delete': { instanceId: string; expectedRevision: number }
  'instances.setActive': { instanceId: string; expectedActiveInstanceId: string | null }
  'instances.select': { instanceId: string }
  'core.list': { resource: CoreResource; cursor?: string; limit?: number }
  'core.get': { resource: CoreResource; id: string }
  'core.update': { resource: CoreResource; id: string; patch: Record<string, unknown>; expectedRevision: number }
  'packages.readExport': { package: string; export: string; instanceId?: string }
  'events.subscribe': { topics: SdkEventTopic[] }
  'events.unsubscribe': { subscriptionId: string }
  'navigation.open': NavigationRequest
  'network.fetch': NetworkRequest
}

export interface InstanceSummary {
  instanceId: string
  name: string
  position: number
  active: boolean
  revision: number
}

export interface CoreProjectView {
  id: string
  name: string
  status: string
  type: string
  category: string
  tags: string[]
  description?: string
  revision: number
}

export interface CoreNoteView {
  id: string
  title: string
  content: string
  tags: string[]
  revision: number
}

export interface CoreErrorView {
  id: string
  title: string
  content: string
  causes: string
  solution: string
  projectIds: string[]
  revision: number
}

export type NavigationRequest =
  | { kind: 'project'; projectId: string }
  | { kind: 'major'; instanceId?: string }
  | { kind: 'external'; url: string }

export interface NetworkRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  headers?: Record<string, string>
  body?: string
}

export interface NetworkResponse {
  status: number
  url: string
  headers: Record<string, string>
  body: string
}

export interface ExportSnapshot {
  package: string
  export: string
  version: number
  instance: ResolvedInstance | null
  documents: StoredDocument[]
}

export interface SdkResults {
  'migration.read': { fromVersion: number; toVersion: number; entries: MigrationEntry[]; nextCursor: string | null }
  'migration.write': { updated: boolean }
  'migration.delete': { updated: boolean }
  'migration.complete': { completed: boolean }
  'migration.fail': { completed: boolean }
  'context.get': SdkContext
  'context.updateConfig': { config: Record<string, unknown>; revision: number }
  'storage.get': StoredDocument | null
  'storage.put': { revision: number }
  'storage.delete': { deleted: boolean }
  'storage.list': { items: StoredDocument[]; nextCursor: string | null }
  'instances.list': { items: InstanceSummary[]; nextCursor: string | null }
  'instances.create': InstanceSummary
  'instances.rename': InstanceSummary
  'instances.delete': { deleted: boolean }
  'instances.setActive': InstanceSummary
  'instances.select': InstanceSummary
  'core.list': { items: (CoreProjectView | CoreNoteView | CoreErrorView)[]; nextCursor: string | null }
  'core.get': CoreProjectView | CoreNoteView | CoreErrorView | null
  'core.update': { revision: number }
  'packages.readExport': ExportSnapshot
  'events.subscribe': { subscriptionId: string }
  'events.unsubscribe': { unsubscribed: boolean }
  'navigation.open': { opened: boolean }
  'network.fetch': NetworkResponse
}

// ---------------------------------------------------------------------------
// Events

export const SDK_EVENT_TOPICS = [
  // Configuration, binding, instance resolution or theme of this context changed.
  'context.changed',
  'instances.changed',
  'storage.changed',
  'core.projects.changed',
  'core.notes.changed',
  'core.errors.changed',
  'exports.changed',
] as const
export type SdkEventTopic = (typeof SDK_EVENT_TOPICS)[number]

export interface SdkEvent {
  subscriptionId: string
  topic: SdkEventTopic
  revision: number
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Wire messages

export const SDK_HELLO = 'pt-sdk/hello'
export const SDK_WELCOME = 'pt-sdk/welcome'

export interface SdkHello {
  type: typeof SDK_HELLO
  sdkVersion: string
}

export interface SdkWelcome {
  type: typeof SDK_WELCOME
  hostApi: string
  context: SdkContext
}

export type HostToFrameMessage =
  | { type: 'response'; requestId: string; ok: true; value: unknown }
  | { type: 'response'; requestId: string; ok: false; error: ErrorPayload }
  | { type: 'event'; event: SdkEvent }
  | { type: 'revoked'; reason: string }

export type FrameToHostMessage = { type: 'request' } & SdkRequest

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function parseFrameMessage(data: unknown): FrameToHostMessage | null {
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  if (message.type !== 'request' || typeof message.requestId !== 'string' || !REQUEST_ID_PATTERN.test(message.requestId)) return null
  if (!isSdkMethod(message.method)) return null
  const params = message.params === undefined ? {} : message.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  return { type: 'request', requestId: message.requestId, method: message.method, params }
}
