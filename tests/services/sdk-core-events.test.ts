import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { ContextRegistry } from '../../main/runtime/contexts'
import { SdkBroker } from '../../main/runtime/broker'
import { createInstance } from '../../main/core/packageStore'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions, type PermissionSet } from '../../shared/permissions'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { HostToFrameMessage, SdkEvent } from '../../shared/sdk'
import { fixturesDir, makeTempDir } from './helpers'

type Response = Extract<HostToFrameMessage, { type: 'response' }>
function value(response: Response): any { if (!response.ok) throw new Error(JSON.stringify(response.error)); return response.value }
async function setup() {
  const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
  const core = new CoreService(db)
  const contexts = new ContextRegistry(db)
  const broker = new SdkBroker(db, contexts, core)
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests/valid/combined.json'), 'utf8'))) as PackageManifest
  const seed = (command: string, input: unknown) => { const result = core.execute(command, { input, operationId: `seed-${crypto.randomUUID()}` }); if (!result.ok) throw new Error(result.error.message); return result.value as any }
  const project = seed('projects.create', { name: 'SDK project', type: 'dev', category: 'Test', platforms: [], tags: ['public'] })
  const note = seed('notes.create', { title: 'Note', content: 'Body', tags: ['tag'] })
  const error = seed('errors.create', { title: 'Error', content: 'Content', causes: 'Cause', solution: 'Solution', projectIds: [project.id] })
  core.execute('projects.update', { id: project.id, patch: { path: '/private/not-for-the-sdk' } })
  core.execute('notes.update', { id: note.id, patch: { raw: true } })
  db.run('UPDATE errors SET extra_json = ? WHERE id = ?', JSON.stringify({ secret: 'not-for-the-sdk' }), error.id)
  for (const packageId of [manifest.id, 'example.foreign']) for (const instanceId of ['a', 'b']) createInstance(db, { packageId, majorId: 'planner', instanceId, name: instanceId, now: '2026-10-15' })
  const sessions: ReturnType<SdkBroker['open']>[] = []
  const open = (options: { permissions?: PermissionSet; instanceId?: string; foreign?: boolean; independent?: boolean } = {}) => {
    const ownManifest = structuredClone(manifest)
    if (options.foreign) ownManifest.id = 'example.foreign'
    if (options.permissions) ownManifest.permissions = options.permissions
    const registered = contexts.create({ manifest: ownManifest, contributionId: options.independent ? 'standalone' : 'today', grantedPermissions: normalizePermissions(ownManifest.permissions), placementId: null, owner: { kind: 'page' }, binding: options.independent ? { mode: 'none' } : { mode: 'fixed', major: { packageId: ownManifest.id, contributionId: 'planner' }, instanceId: options.instanceId ?? 'a' } })
    const messages: HostToFrameMessage[] = []
    const session = broker.open(registered.id, { send: (message) => messages.push(message), close: () => {} })
    sessions.push(session)
    let sequence = 0
    return {
      registered, messages,
      events: () => messages.filter((message): message is { type: 'event'; event: SdkEvent } => message.type === 'event').map((message) => message.event),
      async call(method: string, params: unknown = {}): Promise<Response> {
        const requestId = `call-${++sequence}`
        await session.receive({ type: 'request', requestId, method, params })
        return messages.findLast((message) => message.type === 'response' && message.requestId === requestId) as Response
      },
    }
  }
  return { db, core, contexts, broker, project, note, error, open, cleanup: () => { sessions.forEach((session) => session.close()); contexts.close(); db.close() } }
}
const all = { core: { projects: ['read', 'write'], notes: ['read', 'write'], errors: ['read', 'write'] }, network: [], exports: [] } satisfies PermissionSet

describe('API CORE contrôlée et événements SDK', () => {
  it('projette uniquement les champs publics et vérifie chaque ressource avant lecture', async () => {
    const s = await setup()
    try {
      const limited = s.open()
      const project = value(await limited.call('core.get', { resource: 'projects', id: s.project.id }))
      expect(Object.keys(project).sort()).toEqual(['id', 'name', 'status', 'type', 'category', 'description', 'revision', 'tags'].sort())
      expect(project).not.toHaveProperty('path')
      expect(project).not.toHaveProperty('tasks')
      for (const resource of ['notes', 'errors']) expect(await limited.call('core.get', { resource, id: 'missing' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      const full = s.open({ permissions: all })
      expect(value(await full.call('core.get', { resource: 'notes', id: s.note.id }))).toEqual({ id: s.note.id, title: 'Note', content: 'Body', tags: ['tag'], revision: 2 })
      expect(value(await full.call('core.get', { resource: 'errors', id: s.error.id }))).toEqual({ id: s.error.id, title: 'Error', content: 'Content', causes: 'Cause', solution: 'Solution', projectIds: [s.project.id], revision: 1 })
      expect(value(await full.call('core.get', { resource: 'notes', id: 'missing' }))).toBeNull()
      expect(await full.call('core.list', { resource: 'settings' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    } finally { s.cleanup() }
  })

  it('met à jour via CORE avec révision obligatoire et une liste de champs limitée', async () => {
    const s = await setup()
    try {
      const full = s.open({ permissions: all })
      for (const [resource, id, patch, forbidden] of [
        ['projects', s.project.id, { name: 'Changed', tags: ['new'] }, { path: '/forbidden' }],
        ['notes', s.note.id, { content: 'Changed' }, { raw: false }],
        ['errors', s.error.id, { solution: 'Changed' }, { projectIds: [] }],
      ] as const) {
        const original = value(await full.call('core.get', { resource, id }))
        expect(await full.call('core.update', { resource, id, patch })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
        expect(await full.call('core.update', { resource, id, patch: forbidden, expectedRevision: original.revision })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
        expect(value(await full.call('core.update', { resource, id, patch, expectedRevision: original.revision }))).toEqual({ revision: original.revision + 1 })
        expect(await full.call('core.update', { resource, id, patch, expectedRevision: original.revision })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      }
      expect(await s.open().call('core.update', { resource: 'projects', id: s.project.id, patch: { name: 'Forbidden' }, expectedRevision: 3 })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      const writeOnly = s.open({ permissions: { core: { notes: ['write'] }, network: [], exports: [] } })
      expect(await writeOnly.call('core.get', { resource: 'notes', id: s.note.id })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(value(await writeOnly.call('core.update', { resource: 'notes', id: s.note.id, patch: { title: 'Write only' }, expectedRevision: 3 }))).toEqual({ revision: 4 })
    } finally { s.cleanup() }
  })

  it('pagine les lectures CORE et limite les métadonnées des instances au module associé', async () => {
    const s = await setup()
    try {
      s.core.execute('notes.create', { input: { title: 'Second', content: '', tags: [] }, operationId: 'sdk-second-note' })
      const full = s.open({ permissions: all })
      const first = value(await full.call('core.list', { resource: 'notes', limit: 1 }))
      const next = value(await full.call('core.list', { resource: 'notes', limit: 1, cursor: first.nextCursor }))
      expect(first.items).toHaveLength(1)
      expect(next.items).toHaveLength(1)
      expect(next.items[0].id).not.toBe(first.items[0].id)
      expect(next.nextCursor).toBeNull()
      expect(await full.call('core.list', { resource: 'notes', limit: 201 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(value(await full.call('instances.list')).items).toEqual([{ instanceId: 'a', name: 'a', position: 0, active: true, revision: 1 }, { instanceId: 'b', name: 'b', position: 1, active: false, revision: 1 }])
      expect(value(await s.open({ independent: true }).call('instances.list'))).toEqual({ items: [], nextCursor: null })
      s.db.transaction(() => { for (let i = 0; i < 199; i++) createInstance(s.db, { packageId: full.registered.context.packageId, majorId: 'planner', instanceId: `extra-${i}`, name: `Extra ${i}`, now: '2026-10-15' }) })
      const page = value(await full.call('instances.list', { limit: 200 }))
      expect(page.items).toHaveLength(200)
      expect(value(await full.call('instances.list', { cursor: page.nextCursor, limit: 200 })).items).toHaveLength(1)
    } finally { s.cleanup() }
  })

  it('filtre les événements CORE par droits, sans contenu personnel, après commit seulement', async () => {
    const s = await setup()
    try {
      const reader = s.open()
      const full = s.open({ permissions: all })
      const subscriptionId = value(await reader.call('events.subscribe', { topics: ['core.projects.changed'] })).subscriptionId
      expect(await reader.call('events.subscribe', { topics: ['core.projects.changed', 'core.notes.changed'] })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      const before = s.core.snapshot().revision
      expect(s.core.execute('projects.update', { id: s.project.id, patch: { name: 'Sensitive new name' }, expectedRevision: s.core.snapshot().data.projects[0].revision }).ok).toBe(true)
      expect(reader.events()).toEqual([{ subscriptionId, topic: 'core.projects.changed', revision: before + 1, payload: { ids: [s.project.id] } }])
      expect(JSON.stringify(reader.events())).not.toContain('Sensitive')
      s.core.execute('notes.update', { id: s.note.id, patch: { content: 'Secret' }, expectedRevision: 2 })
      expect(reader.events()).toHaveLength(1)
      expect(full.events()).toHaveLength(0) // No unsolicited broadcasts.
      expect(await reader.call('core.update', { resource: 'projects', id: s.project.id, patch: { name: 'No' }, expectedRevision: 2 })).toMatchObject({ ok: false })
      expect(reader.events()).toHaveLength(1)
      value(await reader.call('events.unsubscribe', { subscriptionId }))
      s.core.execute('projects.update', { id: s.project.id, patch: { name: 'After unsub' } })
      expect(reader.events()).toHaveLength(1)
    } finally { s.cleanup() }
  })

  it('ne diffuse le stockage privé qu’au package et à l’instance concernés', async () => {
    const s = await setup()
    try {
      const a = s.open(), b = s.open({ instanceId: 'b' }), foreign = s.open({ foreign: true }), independent = s.open({ independent: true })
      for (const client of [a, b, foreign, independent]) value(await client.call('events.subscribe', { topics: ['storage.changed'] }))
      const document = { collection: 'private', id: 'one', value: { secret: 'not in event' }, expectedRevision: null }
      value(await a.call('storage.put', document))
      expect(a.events()).toHaveLength(1)
      expect(b.events()).toHaveLength(0)
      expect(foreign.events()).toHaveLength(0)
      expect(independent.events()).toHaveLength(0)
      expect(a.events()[0].payload).toEqual({ collection: 'private', id: 'one', instanceId: 'a', deleted: false, documentRevision: 1 })
      value(await a.call('storage.put', { ...document, scope: 'package' }))
      expect(a.events()).toHaveLength(2)
      expect(b.events()).toHaveLength(1)
      expect(independent.events()).toHaveLength(1)
      expect(foreign.events()).toHaveLength(0)
      value(await a.call('storage.delete', { collection: 'private', id: 'one', expectedRevision: 1 }))
      expect(a.events().at(-1)?.payload).toMatchObject({ deleted: true, documentRevision: 2 })
      expect(a.events().map((event) => event.revision)).toEqual([...a.events().map((event) => event.revision)].sort((a, b) => a - b))
    } finally { s.cleanup() }
  })

  it('annule révision et notification en cas de quota, conflit ou erreur SQLite', async () => {
    const s = await setup()
    try {
      const client = s.open()
      value(await client.call('events.subscribe', { topics: ['storage.changed'] }))
      const before = s.core.snapshot().revision
      const nativeEvents: unknown[] = []
      const stop = s.core.onChange((changes, revision) => nativeEvents.push({ changes, revision }))
      s.db.db.exec("CREATE TRIGGER refuse_sdk BEFORE INSERT ON package_documents BEGIN SELECT RAISE(ABORT, 'private system error'); END")
      expect(await client.call('storage.put', { collection: 'c', id: 'one', value: 'Secret', expectedRevision: null })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', message: 'Appel SDK indisponible.' } })
      expect(s.core.snapshot().revision).toBe(before)
      expect(client.events()).toHaveLength(0)
      expect(nativeEvents).toHaveLength(0)
      s.db.db.exec('DROP TRIGGER refuse_sdk')
      value(await client.call('storage.put', { collection: 'c', id: 'one', value: 'Secret', expectedRevision: null }))
      expect(nativeEvents).toEqual([{ changes: [], revision: before + 1 }])
      expect(await client.call('storage.put', { collection: 'c', id: 'one', value: 'Conflict', expectedRevision: null })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(client.events()).toHaveLength(1)
      expect(s.core.snapshot().revision).toBe(before + 1)
      stop()
    } finally { s.cleanup() }
  })

  it('refuse un stockage ambigu si deux majeurs legacy réutilisent la même identité d’instance', async () => {
    const s = await setup()
    try {
      const client = s.open()
      createInstance(s.db, { packageId: client.registered.context.packageId, majorId: 'another-major', instanceId: 'a', name: 'Other', now: '2026-10-15' })
      expect(await client.call('storage.put', { collection: 'c', id: 'one', value: 'No alias', expectedRevision: null })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(await client.call('storage.get', { collection: 'c', id: 'one' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(value(await client.call('storage.get', { scope: 'package', collection: 'c', id: 'one' }))).toBeNull()
    } finally { s.cleanup() }
  })

  it('borne les abonnements, les isole par session et nettoie ceux des contextes révoqués', async () => {
    const s = await setup()
    try {
      const first = s.open(), second = s.open()
      const ids: string[] = []
      for (let i = 0; i < RUNTIME_LIMITS.maxSubscriptionsPerContext; i++) ids.push(value(await first.call('events.subscribe', { topics: ['storage.changed'] })).subscriptionId)
      expect(await first.call('events.subscribe', { topics: ['storage.changed'] })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
      expect(value(await second.call('events.unsubscribe', { subscriptionId: ids[0] }))).toEqual({ unsubscribed: false })
      value(await first.call('events.unsubscribe', { subscriptionId: ids[0] }))
      value(await first.call('events.subscribe', { topics: ['context.changed'] }))
      expect(await second.call('events.subscribe', { topics: ['exports.changed'] })).toMatchObject({ ok: true })
      expect(await second.call('events.subscribe', { topics: ['storage.changed', 'storage.changed'] })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      s.contexts.revoke(first.registered.id)
      value(await second.call('storage.put', { collection: 'c', id: 'one', value: 1, expectedRevision: null }))
      expect(first.events()).toHaveLength(0)
    } finally { s.cleanup() }
  })
})

describe('notifications CORE bornées', () => {
  it('remplace une grande liste d’identifiants par une invalidation sans contenu', async () => {
    const { EventSubscriptions } = await import('../../main/runtime/events')
    const s = await setup()
    try {
      const context = s.open().registered.context
      const sent: SdkEvent[] = []
      const subscriptions = new EventSubscriptions(() => context, (event) => sent.push(event))
      const { subscriptionId } = subscriptions.subscribe(['core.projects.changed'])
      subscriptions.core('projects', Array.from({ length: 201 }, (_, i) => `project-${i}`), 42)
      expect(sent).toEqual([{ subscriptionId, topic: 'core.projects.changed', revision: 42, payload: { invalidate: true } }])
      subscriptions.clear()
      subscriptions.core('projects', ['after-clear'], 43)
      expect(sent).toHaveLength(1)
    } finally { s.cleanup() }
  })
})
