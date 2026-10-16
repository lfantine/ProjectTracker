import { vi } from 'vitest'
import type { ProjectTrackerSdk } from '../sdk/src'

/** In-memory SDK with real CAS semantics and small pages, for package tests. */
export function fakePlannerSdk(options: { instance?: { instanceId: string; name: string } | null; kind?: string; pageSize?: number } = {}) {
  const documents = new Map<string, { id: string; collection: string; instanceId: string; revision: number; value: unknown; updatedAt: string }>()
  const instance = options.instance === undefined ? { instanceId: 'profile-one', name: 'Perso' } : options.instance
  const context = { packageId: 'lfantine.linkedin-post-planner', kind: options.kind ?? 'major', instance, theme: { mode: 'light', tokens: {} }, binding: { mode: 'none' } }
  const key = (collection: string, id: string, instanceId = instance?.instanceId ?? '') => `${instanceId}/${collection}/${id}`
  const conflict = () => Object.assign(Error('CONFLICT'), { code: 'CONFLICT' })
  const storage = {
    get: vi.fn(async ({ collection, id, instanceId }: { collection: string; id: string; instanceId?: string }) => structuredClone(documents.get(key(collection, id, instanceId)) ?? null)),
    put: vi.fn(async ({ collection, id, instanceId, value, expectedRevision }: { collection: string; id: string; instanceId?: string; value: unknown; expectedRevision: number | null }) => {
      const current = documents.get(key(collection, id, instanceId))
      if ((current?.revision ?? null) !== expectedRevision) throw conflict()
      const revision = (current?.revision ?? 0) + 1
      documents.set(key(collection, id, instanceId), { id, collection, instanceId: instanceId ?? instance!.instanceId, revision, value: structuredClone(value), updatedAt: 'now' })
      return { revision }
    }),
    delete: vi.fn(async ({ collection, id, instanceId, expectedRevision }: { collection: string; id: string; instanceId?: string; expectedRevision: number }) => {
      const current = documents.get(key(collection, id, instanceId))
      if (!current || current.revision !== expectedRevision) throw conflict()
      documents.delete(key(collection, id, instanceId)); return { deleted: true }
    }),
    list: vi.fn(async ({ collection, instanceId, cursor }: { collection: string; instanceId?: string; cursor?: string }) => {
      const prefix = `${instanceId ?? instance?.instanceId}/${collection}/`
      const all = [...documents].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => structuredClone(item))
      const start = cursor ? Number(cursor) : 0, size = options.pageSize ?? 200
      return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
    }),
  }
  const sdk = {
    context, revoked: false,
    call: vi.fn(async () => structuredClone(context)),
    storage,
    instances: { list: vi.fn(async () => ({ items: instance ? [{ ...instance, position: 0, active: true, revision: 1 }] : [], nextCursor: null })), create: vi.fn(async () => ({})) },
    navigation: { open: vi.fn(async () => ({ opened: true })) },
    onContextChange: vi.fn(() => () => {}),
    events: { subscribe: vi.fn(async () => async () => {}) },
  }
  return { sdk, client: sdk as unknown as ProjectTrackerSdk, documents, key }
}
