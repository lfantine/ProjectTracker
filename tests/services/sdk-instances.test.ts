import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { createInstance, getActiveInstanceId, getDocument, listInstances, putDocument } from '../../main/core/packageStore'
import { ContextRegistry } from '../../main/runtime/contexts'
import { SdkBroker } from '../../main/runtime/broker'
import type { InstanceHooks } from '../../main/runtime/instances'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import type { HostToFrameMessage } from '../../shared/sdk'
import { fixturesDir, makeTempDir } from './helpers'

type Response = Extract<HostToFrameMessage, { type: 'response' }>
function value(response: Response): any { if (!response?.ok) throw new Error(JSON.stringify(response)); return response.value }
async function setup(hooks: InstanceHooks = {}, seed = true) {
  const file = path.join(makeTempDir(), 'tracker.sqlite')
  const db = await openDatabase(file)
  const core = new CoreService(db)
  const contexts = new ContextRegistry(db)
  const broker = new SdkBroker(db, contexts, core, hooks)
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests/valid/combined.json'), 'utf8'))) as PackageManifest
  if (seed) for (const instanceId of ['a', 'b']) createInstance(db, { packageId: manifest.id, majorId: 'planner', instanceId, name: instanceId.toUpperCase(), now: '2026-10-15' })
  const sessions: ReturnType<SdkBroker['open']>[] = []
  const open = (kind = 'planner', mode: 'fixed' | 'active' = 'fixed', instanceId = 'b') => {
    const registered = contexts.create({ manifest, contributionId: kind, grantedPermissions: normalizePermissions(manifest.permissions), placementId: null, owner: { kind: 'page' }, binding: kind === 'standalone' ? { mode: 'none' } : mode === 'fixed' ? { mode, major: { packageId: manifest.id, contributionId: 'planner' }, instanceId } : { mode, major: { packageId: manifest.id, contributionId: 'planner' } } })
    const messages: HostToFrameMessage[] = []
    const session = broker.open(registered.id, { send: (message) => messages.push(message), close: () => {} })
    sessions.push(session)
    let sequence = 0
    return {
      registered, messages,
      events: () => messages.filter((message) => message.type === 'event'),
      async call(method: string, params: unknown = {}): Promise<Response> {
        const requestId = `instance-${++sequence}`
        await session.receive({ type: 'request', requestId, method, params })
        return messages.findLast((message) => message.type === 'response' && message.requestId === requestId) as Response
      },
    }
  }
  return { db, file, core, contexts, manifest, broker, open, cleanup: () => { sessions.forEach((session) => session.close()); contexts.close(); db.close() } }
}

describe('gestion native des instances SDK', () => {
  it('réserve les mutations au majeur, sans croire des identités ajoutées aux paramètres', async () => {
    const s = await setup()
    try {
      const minor = s.open('project-slots'), widget = s.open('today'), independent = s.open('standalone')
      for (const client of [minor, widget, independent]) {
        for (const [method, params] of [
          ['instances.create', { name: 'Forbidden', operationId: 'forbidden-operation' }],
          ['instances.rename', { instanceId: 'a', name: 'Forbidden', expectedRevision: 1 }],
          ['instances.delete', { instanceId: 'a', expectedRevision: 1 }],
          ['instances.setActive', { instanceId: 'b', expectedActiveInstanceId: 'a' }],
        ] as const) expect(await client.call(method, params)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      }
      expect(await s.open().call('instances.create', { name: 'Forged', operationId: 'forged-operation', packageId: 'other.package' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(listInstances(s.db, s.manifest.id, 'planner')).toHaveLength(2)
    } finally { s.cleanup() }
  })

  it('crée et duplique atomiquement sans changer l’instance active, avec reprise idempotente durable', async () => {
    const s = await setup()
    let createdId = ''
    try {
      putDocument(s.db, { packageId: s.manifest.id, scope: 'a', collection: 'week', id: 'slots' }, { slots: [1, 2] }, { now: '2026-10-15' })
      const manager = s.open()
      const watcher = s.open('today', 'fixed', 'a')
      value(await watcher.call('events.subscribe', { topics: ['instances.changed'] }))
      const before = s.core.snapshot().revision
      const input = { name: ' Copie ', copyFrom: 'a', operationId: 'copy-operation-1' }
      const copy = value(await manager.call('instances.create', input))
      createdId = copy.instanceId
      expect(copy).toMatchObject({ name: 'Copie', active: false, revision: 1, position: 2 })
      expect(getActiveInstanceId(s.db, s.manifest.id, 'planner')).toBe('a')
      expect(getDocument(s.db, { packageId: s.manifest.id, scope: copy.instanceId, collection: 'week', id: 'slots' })?.value).toEqual({ slots: [1, 2] })
      expect(value(await manager.call('instances.create', input)).instanceId).toBe(copy.instanceId)
      expect(s.core.snapshot().revision).toBe(before + 1)
      expect(watcher.events()).toHaveLength(1)
      expect(await manager.call('instances.create', { ...input, name: 'Other request' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(await manager.call('instances.create', { name: 'copie', operationId: 'copy-operation-2' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      putDocument(s.db, { packageId: s.manifest.id, scope: copy.instanceId, collection: 'week', id: 'slots' }, { slots: [3] }, { now: '2026-10-15', expectedRevision: 1 })
      expect(getDocument(s.db, { packageId: s.manifest.id, scope: 'a', collection: 'week', id: 'slots' })?.value).toEqual({ slots: [1, 2] })
    } finally { s.cleanup() }
    const db = await openDatabase(s.file)
    try {
      const core = new CoreService(db), contexts = new ContextRegistry(db)
      const registered = contexts.create({ manifest: s.manifest, contributionId: 'planner', grantedPermissions: normalizePermissions(s.manifest.permissions), placementId: null, owner: { kind: 'page' }, binding: { mode: 'fixed', major: { packageId: s.manifest.id, contributionId: 'planner' }, instanceId: 'b' } })
      const messages: HostToFrameMessage[] = []
      const session = new SdkBroker(db, contexts, core).open(registered.id, { send: (message) => messages.push(message), close() {} })
      await session.receive({ type: 'request', requestId: 'restart', method: 'instances.create', params: { name: 'Copie', copyFrom: 'a', operationId: 'copy-operation-1' } })
      expect(value(messages.find((message) => message.type === 'response') as Response).instanceId).toBe(createdId)
      expect(listInstances(db, s.manifest.id, 'planner')).toHaveLength(3)
      session.close(); contexts.close()
    } finally { db.close() }
  })

  it('permet la première création depuis un majeur vide, acquitte puis révoque son ancien contexte', async () => {
    const s = await setup({}, false)
    try {
      const manager = s.open('planner', 'active')
      expect(manager.registered.context.instance).toBeNull()
      expect(value(await manager.call('instances.list'))).toEqual({ items: [], nextCursor: null })
      const first = value(await manager.call('instances.create', { name: 'Première', operationId: 'first-operation' }))
      expect(first.active).toBe(true)
      expect(getActiveInstanceId(s.db, s.manifest.id, 'planner')).toBe(first.instanceId)
      expect(() => s.contexts.get(manager.registered.id)).toThrow()
      expect(manager.messages.at(-1)?.type).toBe('revoked')
      expect(value(await s.open('planner', 'active').call('context.get')).instance.instanceId).toBe(first.instanceId)
    } finally { s.cleanup() }
  })

  it('contrôle les révisions et révoque les liaisons renommées ou actives sans toucher aux liaisons fixes', async () => {
    const s = await setup()
    try {
      const manager = s.open(), active = s.open('today', 'active'), fixed = s.open('today', 'fixed', 'a')
      value(await fixed.call('events.subscribe', { topics: ['instances.changed'] }))
      expect(await manager.call('instances.setActive', { instanceId: 'b', expectedActiveInstanceId: 'wrong' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(value(await manager.call('instances.setActive', { instanceId: 'b', expectedActiveInstanceId: 'a' })).active).toBe(true)
      expect(() => s.contexts.get(active.registered.id)).toThrow()
      expect(s.contexts.get(fixed.registered.id).instance?.instanceId).toBe('a')
      expect(fixed.events()).toHaveLength(1)
      expect(await manager.call('instances.rename', { instanceId: 'a', name: 'Renamed' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(await manager.call('instances.rename', { instanceId: 'a', name: 'Renamed', expectedRevision: 9 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(value(await manager.call('instances.rename', { instanceId: 'a', name: 'Renamed', expectedRevision: 1 })).revision).toBe(2)
      expect(() => s.contexts.get(fixed.registered.id)).toThrow()
      const before = s.core.snapshot().revision
      value(await manager.call('instances.rename', { instanceId: 'a', name: 'Renamed', expectedRevision: 2 }))
      expect(s.core.snapshot().revision).toBe(before)
    } finally { s.cleanup() }
  })

  it('refuse la suppression sans confirmation native et revalide après une confirmation retardée', async () => {
    const s = await setup()
    try { expect(await s.open().call('instances.delete', { instanceId: 'a', expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } }) } finally { s.cleanup() }
    const denied = await setup({ confirmDeletion: async () => false })
    try { expect(await denied.open().call('instances.delete', { instanceId: 'a', expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } }) } finally { denied.cleanup() }
    let confirm!: (confirmed: boolean) => void
    const delayed = await setup({ confirmDeletion: () => new Promise((resolve) => { confirm = resolve }) })
    try {
      const manager = delayed.open()
      const request = manager.call('instances.delete', { instanceId: 'a', expectedRevision: 1 })
      delayed.core.commitPackageWrite(() => { putDocument(delayed.db, { packageId: delayed.manifest.id, scope: 'a', collection: 'new', id: 'new' }, 'Added during prompt', { now: '2026-10-15' }); return { changed: true, value: null } })
      confirm(true)
      expect(await request).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(listInstances(delayed.db, delayed.manifest.id, 'planner')).toHaveLength(2)
    } finally { delayed.cleanup() }
  })

  it('supprime uniquement les documents de la cible confirmée et conserve les références fixes', async () => {
    const confirmDeletion = vi.fn(async () => true)
    const s = await setup({ confirmDeletion })
    try {
      for (const scope of ['a', 'b', '']) putDocument(s.db, { packageId: s.manifest.id, scope, collection: 'c', id: 'one' }, scope, { now: '2026-10-15' })
      const binding = JSON.stringify({ mode: 'fixed', major: { packageId: s.manifest.id, contributionId: 'planner' }, instanceId: 'a' })
      s.db.run('INSERT INTO dashboards (id, name, position, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', 'd', 'D', 0, 1, '2026-10-15', '2026-10-15')
      s.db.run('INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_json, binding_json, layouts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'd', 'w', 0, s.manifest.id, 'today', '{}', binding, '{}')
      const manager = s.open(), fixed = s.open('today', 'fixed', 'a')
      expect(value(await manager.call('instances.delete', { instanceId: 'a', expectedRevision: 1 }))).toEqual({ deleted: true })
      expect(confirmDeletion.mock.calls[0][1]).toMatchObject({ instanceId: 'a', name: 'A', documentCount: 1, usages: { dashboardPlacements: 1 } })
      expect(getActiveInstanceId(s.db, s.manifest.id, 'planner')).toBe('b')
      expect(getDocument(s.db, { packageId: s.manifest.id, scope: 'a', collection: 'c', id: 'one' })).toBeNull()
      expect(getDocument(s.db, { packageId: s.manifest.id, scope: 'b', collection: 'c', id: 'one' })?.value).toBe('b')
      expect(getDocument(s.db, { packageId: s.manifest.id, scope: '', collection: 'c', id: 'one' })?.value).toBe('')
      expect(s.db.get<{ binding_json: string }>('SELECT binding_json FROM dashboard_widgets')?.binding_json).toBe(binding)
      expect(() => s.contexts.get(fixed.registered.id)).toThrow()
      expect(() => s.open('today', 'fixed', 'a')).toThrow()
    } finally { s.cleanup() }
  })

  it('annule copie et marqueur d’opération en cas de quota ou d’erreur SQLite', async () => {
    const s = await setup()
    try {
      const manager = s.open()
      putDocument(s.db, { packageId: s.manifest.id, scope: 'a', collection: 'c', id: 'one' }, 'Source', { now: '2026-10-15' })
      s.db.run('UPDATE package_documents SET size_bytes = ?', 30 * 1024 * 1024)
      const input = { name: 'Copy', copyFrom: 'a', operationId: 'rollback-copy' }
      const before = s.core.snapshot().revision
      expect(await manager.call('instances.create', input)).toMatchObject({ ok: false, error: { code: 'STORAGE' } })
      expect(listInstances(s.db, s.manifest.id, 'planner')).toHaveLength(2)
      expect(s.core.snapshot().revision).toBe(before)
      s.db.run('UPDATE package_documents SET size_bytes = ?', Buffer.byteLength(JSON.stringify('Source')))
      s.db.db.exec("CREATE TRIGGER refuse_copy BEFORE INSERT ON package_documents BEGIN SELECT RAISE(ABORT, 'copy failure'); END")
      expect(await manager.call('instances.create', input)).toMatchObject({ ok: false })
      expect(s.db.all('SELECT * FROM operations')).toHaveLength(0)
      s.db.db.exec('DROP TRIGGER refuse_copy')
      expect(value(await manager.call('instances.create', input)).name).toBe('Copy')
      expect(listInstances(s.db, s.manifest.id, 'planner')).toHaveLength(3)
    } finally { s.cleanup() }
  })

  it('pagine dans l’ordre des positions, refuse les curseurs invalides et isole les événements', async () => {
    const s = await setup()
    try {
      const manager = s.open(), independent = s.open('standalone')
      value(await independent.call('events.subscribe', { topics: ['instances.changed'] }))
      const first = value(await manager.call('instances.list', { limit: 1 }))
      expect(first.items[0].instanceId).toBe('a')
      const next = value(await manager.call('instances.list', { limit: 1, cursor: first.nextCursor }))
      expect(next.items[0].instanceId).toBe('b')
      expect(next.nextCursor).toBeNull()
      expect(await manager.call('instances.list', { cursor: 'invalid' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      value(await manager.call('instances.create', { name: 'C', operationId: 'event-create' }))
      expect(independent.events()).toHaveLength(0)
    } finally { s.cleanup() }
  })
})

describe('minimum d’instances déclaré par le manifeste', () => {
  it('protège atomiquement la dernière instance sans demander une confirmation inutile', async () => {
    const confirmDeletion = vi.fn(async () => true)
    const s = await setup({ confirmDeletion })
    try {
      const major = s.manifest.contributions.find(entry => entry.type === 'major')!
      if (major.type === 'major') major.minInstances = 1
      const manager = s.open('planner', 'fixed', 'b')
      expect(value(await manager.call('instances.delete', { instanceId: 'a', expectedRevision: 1 }))).toEqual({ deleted: true })
      expect(await manager.call('instances.delete', { instanceId: 'b', expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(confirmDeletion).toHaveBeenCalledTimes(1)
      expect(listInstances(s.db, s.manifest.id, 'planner').map(row => row.instanceId)).toEqual(['b'])
    } finally { s.cleanup() }
  })
  it('refuse une confirmation devenue périmée après une suppression concurrente', async () => {
    const pending: ((value: boolean) => void)[] = []
    const s = await setup({ confirmDeletion: () => new Promise(resolve => pending.push(resolve)) })
    try {
      const major = s.manifest.contributions.find(entry => entry.type === 'major')!
      if (major.type === 'major') major.minInstances = 1
      const a = s.open(), b = s.open()
      const first = a.call('instances.delete', { instanceId: 'a', expectedRevision: 1 })
      const second = b.call('instances.delete', { instanceId: 'b', expectedRevision: 1 })
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      pending[0](true); expect(value(await first)).toEqual({ deleted: true })
      pending[1](true); expect(await second).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(listInstances(s.db, s.manifest.id, 'planner')).toHaveLength(1)
    } finally { s.cleanup() }
  })
})
