import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoreService } from '../../main/core/service'
import { SdkBroker, isBoundedJson } from '../../main/runtime/broker'
import { negotiateSdk } from '../../main/runtime/handshake'
import { ContextRegistry } from '../../main/runtime/contexts'
import { openDatabase } from '../../main/db/database'
import { createInstance, getDocument, putDocument, setActiveInstance } from '../../main/core/packageStore'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import type { HostToFrameMessage } from '../../shared/sdk'
import { fixturesDir, makeTempDir } from './helpers'

async function setup(kind = 'today', prevalidation = false) {
  const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests/valid/combined.json'), 'utf8'))) as PackageManifest
  for (const instanceId of ['a', 'b']) createInstance(db, { packageId: manifest.id, majorId: 'planner', instanceId, name: instanceId, now: '2026-10-15' })
  const contexts = new ContextRegistry(db)
  const registered = contexts.create({ manifest, contributionId: kind, grantedPermissions: normalizePermissions(manifest.permissions), placementId: null, owner: { kind: 'page' }, binding: { mode: 'active', major: { packageId: manifest.id, contributionId: 'planner' } } })
  const messages: HostToFrameMessage[] = []
  let closed = false
  const core = new CoreService(db)
  const session = new SdkBroker(db, contexts, core, { prevalidation }).open(registered.id, { send: (message) => messages.push(message), close: () => { closed = true } })
  let id = 0
  const call = async (method: string, params: unknown = {}) => {
    await session.receive({ type: 'request', requestId: `r${++id}`, method, params })
    return messages.at(-1) as Extract<HostToFrameMessage, { type: 'response' }>
  }
  return { db, core, manifest, contexts, registered, messages, session, call, closed: () => closed, cleanup: () => { session.close(); contexts.close(); db.close() } }
}

describe('broker natif SDK, sans activation externe', () => {
  it('prévalidation : refuse toutes les API métier même avec les droits déclarés', async () => {
    const s = await setup('planner', true)
    try {
      const before = s.db.all('SELECT * FROM package_documents')
      expect(await s.call('context.get')).toMatchObject({ ok: true })
      expect(await s.call('events.subscribe', { topics: ['context.changed'] })).toMatchObject({ ok: true })
      for (const method of ['core.get', 'core.list', 'core.update', 'storage.get', 'storage.list', 'storage.put', 'storage.delete', 'instances.list', 'instances.create', 'instances.delete', 'instances.rename', 'instances.setActive', 'instances.select', 'packages.readExport', 'network.fetch', 'navigation.open', 'context.updateConfig', 'migration.read', 'migration.write', 'migration.complete']) {
        expect(await s.call(method), method).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      }
      expect(await s.call('events.subscribe', { topics: ['storage.changed'] })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(s.db.all('SELECT * FROM package_documents')).toEqual(before)
    } finally { s.cleanup() }
  })

  it('déduit l’identité native, refuse les paramètres étrangers et les méthodes non implémentées', async () => {
    const s = await setup()
    try {
      expect(await s.call('context.get')).toMatchObject({ ok: true, value: { packageId: s.manifest.id, instance: { instanceId: 'a' } } })
      expect(await s.call('context.get', { packageId: 'forged.package' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(await s.call('network.fetch', { url: 'https://example.com' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(await s.call('storage.get', { collection: 'c', id: 'x', packageId: 'forged.package' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    } finally { s.cleanup() }
  })

  it('isole package et instance, exige les révisions et annule les écritures en conflit', async () => {
    const s = await setup()
    try {
      const address = { collection: 'data', id: 'one' }
      expect(await s.call('storage.put', { ...address, value: { n: 1 } })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(await s.call('storage.put', { ...address, value: { n: 1 }, expectedRevision: null })).toMatchObject({ ok: true, value: { revision: 1 } })
      expect(await s.call('storage.put', { ...address, value: { n: 2 }, expectedRevision: null })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(await s.call('storage.put', { ...address, value: { n: 2 }, expectedRevision: 1 })).toMatchObject({ ok: true, value: { revision: 2 } })
      expect(await s.call('storage.get', { ...address, instanceId: 'b' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(await s.call('storage.get', { ...address, scope: 'package' })).toMatchObject({ ok: true, value: null })
      expect(await s.call('storage.get', address)).toMatchObject({ ok: true, value: { value: { n: 2 } } })
      expect(await s.call('storage.delete', { ...address, expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(await s.call('storage.delete', { ...address, expectedRevision: 2 })).toMatchObject({ ok: true, value: { deleted: true } })
    } finally { s.cleanup() }
  })

  it('autorise seulement un majeur à gérer le stockage d’une autre de ses instances', async () => {
    const s = await setup('planner')
    try {
      expect(await s.call('storage.put', { collection: 'c', id: 'x', instanceId: 'b', value: 'B', expectedRevision: null })).toMatchObject({ ok: true })
      expect(getDocument(s.db, { packageId: s.manifest.id, scope: 'b', collection: 'c', id: 'x' })?.value).toBe('B')
      expect(await s.call('storage.get', { collection: 'c', id: 'x', instanceId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    } finally { s.cleanup() }
  })

  it('borne les pages, documents et réponses sans divulguer les erreurs internes', async () => {
    const s = await setup()
    try {
      for (const id of ['a', 'b', 'c']) putDocument(s.db, { packageId: s.manifest.id, scope: 'a', collection: 'c', id }, id, { now: '2026-10-15' })
      expect(await s.call('storage.list', { collection: 'c', limit: 2 })).toMatchObject({ ok: true, value: { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' } })
      expect(await s.call('storage.list', { collection: 'c', limit: 201 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(await s.call('storage.put', { collection: 'c', id: 'huge', value: 'x'.repeat(1024 * 1024), expectedRevision: null })).toMatchObject({ ok: false, error: { code: 'STORAGE' } })
    } finally { s.cleanup() }
  })

  it('ferme les sessions sur message forgé, dupliqué ou sur révocation', async () => {
    const s = await setup()
    try {
      const pending = s.session.receive({ type: 'request', requestId: 'duplicate', method: 'context.get', params: {} })
      await s.session.receive({ type: 'request', requestId: 'duplicate', method: 'context.get', params: {} })
      await pending
      expect(s.closed()).toBe(true)
      expect(s.messages.filter((message) => message.type === 'response')).toHaveLength(0)
    } finally { s.cleanup() }
    const t = await setup()
    try {
      setActiveInstance(t.db, t.manifest.id, 'planner', 'b')
      await t.call('context.get')
      expect(t.closed()).toBe(true)
      const count = t.messages.length
      await t.call('storage.get', { collection: 'x', id: 'x' })
      expect(t.messages).toHaveLength(count)
    } finally { t.cleanup() }
  })

  it('négocie une seule fois et refuse les identités ou versions ajoutées au hello', async () => {
    const s = await setup()
    const port = { send: () => {}, close: () => {} }
    const broker = new SdkBroker(s.db, s.contexts, s.core)
    try {
      expect(() => negotiateSdk(s.contexts, broker, s.registered.id, { type: 'pt-sdk/hello', sdkVersion: '99.0.0' }, port)).toThrow()
      expect(() => negotiateSdk(s.contexts, broker, s.registered.id, { type: 'pt-sdk/hello', sdkVersion: '1.0.0', packageId: 'forged' }, port)).toThrow()
      const result = negotiateSdk(s.contexts, broker, s.registered.id, { type: 'pt-sdk/hello', sdkVersion: '1.0.0' }, port)
      expect(result.welcome.context.packageId).toBe(s.manifest.id)
      expect(() => negotiateSdk(s.contexts, broker, s.registered.id, { type: 'pt-sdk/hello', sdkVersion: '1.0.0' }, port)).toThrow()
      result.session.close()
    } finally { s.cleanup() }
  })

  it('refuse les messages non JSON, cycliques, trop profonds ou trop grands', () => {
    const cycle: unknown[] = []; cycle.push(cycle)
    for (const value of [cycle, new Uint8Array(5), new Date(), { x: undefined }, { x: NaN }, 'x'.repeat(3 * 1024 * 1024)]) expect(isBoundedJson(value)).toBe(false)
    expect(isBoundedJson({ safe: [null, true, 42, 'é'] })).toBe(true)
    let value: unknown = null
    for (let i = 0; i < 100; i++) value = { value }
    expect(isBoundedJson(value)).toBe(false)
  })
})
