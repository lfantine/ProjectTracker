import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { ContextRegistry } from '../../main/runtime/contexts'
import { SdkBroker } from '../../main/runtime/broker'
import { createInstance, putDocument } from '../../main/core/packageStore'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import type { HostToFrameMessage } from '../../shared/sdk'
import { fixturesDir, makeTempDir } from './helpers'

async function setup() {
  const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
  const provider = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests/valid/combined.json'), 'utf8'))) as PackageManifest
  provider.exports!.push({ id: 'shared', version: 2, scope: 'package', collections: ['public'] })
  db.run("INSERT INTO packages (id, kind, name, author, active_version, state, origin, storage_version, granted_permissions_json, installed_at, updated_at) VALUES (?, 'package', 'Provider', 'Test', ?, 'active', 'archive', 1, '{}', 'now', 'now')", provider.id, provider.version)
  db.run("INSERT INTO package_versions (package_id, version, content_fingerprint, source_fingerprint, manifest_json, files_dir, status, created_at) VALUES (?, ?, 'hash', 'hash', ?, 'test-only', 'active', 'now')", provider.id, provider.version, JSON.stringify(provider))
  for (const instanceId of ['a', 'b']) createInstance(db, { packageId: provider.id, majorId: 'planner', instanceId, name: instanceId.toUpperCase(), now: 'now' })
  for (const scope of ['a', 'b', '']) for (const collection of ['week', 'secret', 'public']) putDocument(db, { packageId: provider.id, scope, collection, id: 'one' }, { value: `${scope}/${collection}` }, { now: 'now' })
  const consumer: PackageManifest = { ...structuredClone(provider), id: 'consumer.report', exports: [], dependencies: { [provider.id]: '^1.0.0' }, permissions: { exports: [{ package: provider.id, export: 'slots' }, { package: provider.id, export: 'shared' }] } }
  const core = new CoreService(db), contexts = new ContextRegistry(db), broker = new SdkBroker(db, contexts, core)
  const sessions: ReturnType<SdkBroker['open']>[] = []
  const open = (manifest = consumer, kind = 'standalone', instanceId = 'a') => {
    const registered = contexts.create({ manifest, contributionId: kind, grantedPermissions: normalizePermissions(manifest.permissions), placementId: null, owner: { kind: 'page' }, binding: kind === 'standalone' ? { mode: 'none' } : { mode: 'fixed', major: { packageId: manifest.id, contributionId: 'planner' }, instanceId } })
    const messages: HostToFrameMessage[] = []
    const session = broker.open(registered.id, { send: (message) => messages.push(message), close: () => {} }); sessions.push(session)
    let n = 0
    return { registered, messages, async call(method: string, params: unknown) {
      const requestId = `export-${++n}`
      await session.receive({ type: 'request', requestId, method, params })
      return messages.findLast((message) => message.type === 'response' && message.requestId === requestId) as any
    } }
  }
  return { db, provider, consumer, core, contexts, open, cleanup: () => { sessions.forEach((s) => s.close()); contexts.close(); db.close() } }
}

describe('exports inter-packages en lecture contrôlée', () => {
  it('projette uniquement les collections déclarées et résout instance explicite/active ou scope partagé', async () => {
    const s = await setup()
    try {
      const client = s.open()
      const request = { package: s.provider.id, export: 'slots' }
      expect(await client.call('packages.readExport', request)).toMatchObject({ ok: true, value: { version: 1, instance: { instanceId: 'a', name: 'A' }, documents: [{ collection: 'week', id: 'one', instanceId: 'a', value: { value: 'a/week' } }] } })
      const explicit = await client.call('packages.readExport', { ...request, instanceId: 'b' })
      expect(explicit.value.documents).toHaveLength(1)
      expect(explicit.value.instance.instanceId).toBe('b')
      expect(JSON.stringify(explicit.value)).not.toContain('secret')
      expect(await client.call('packages.readExport', { ...request, export: 'shared' })).toMatchObject({ ok: true, value: { version: 2, instance: null, documents: [{ collection: 'public', instanceId: null }] } })
      expect(await client.call('packages.readExport', { ...request, export: 'shared', instanceId: 'a' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(await client.call('storage.get', { collection: 'week', id: 'one', instanceId: 'a' })).toMatchObject({ ok: false })
    } finally { s.cleanup() }
  })

  it('vérifie le droit avant l’existence et exige une dépendance compatible, sans croire des champs ajoutés', async () => {
    const s = await setup()
    try {
      const denied = s.open({ ...s.consumer, permissions: {} })
      for (const packageId of [s.provider.id, 'missing.provider']) expect(await denied.call('packages.readExport', { package: packageId, export: 'slots' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(await denied.call('events.subscribe', { topics: ['exports.changed'] })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      const incompatible = s.open({ ...s.consumer, dependencies: { [s.provider.id]: '^9.0.0' } })
      expect(await incompatible.call('packages.readExport', { package: s.provider.id, export: 'slots' })).toMatchObject({ ok: false, error: { code: 'DEPENDENCY' } })
      const absent = s.open({ ...s.consumer, dependencies: {} })
      expect(await absent.call('packages.readExport', { package: s.provider.id, export: 'slots' })).toMatchObject({ ok: false, error: { code: 'DEPENDENCY' } })
      expect(await s.open().call('packages.readExport', { package: s.provider.id, export: 'slots', collection: 'secret' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    } finally { s.cleanup() }
  })

  it('ferme l’accès si le fournisseur est désactivé, son manifeste modifié ou son stockage incompatible', async () => {
    const s = await setup()
    try {
      const client = s.open(), query = { package: s.provider.id, export: 'slots' }
      for (const state of ['disabled', 'suspended', 'uninstalled']) {
        s.db.run('UPDATE packages SET state = ? WHERE id = ?', state, s.provider.id)
        expect(await client.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
      }
      s.db.run("UPDATE packages SET state = 'active', storage_version = 2 WHERE id = ?", s.provider.id)
      expect(await client.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'INCOMPATIBLE' } })
      s.db.run('UPDATE packages SET storage_version = 1 WHERE id = ?', s.provider.id)
      s.db.run('UPDATE package_versions SET manifest_json = ? WHERE package_id = ?', JSON.stringify({ ...s.provider, id: 'forged.provider' }), s.provider.id)
      expect(await client.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'INCOMPATIBLE' } })
    } finally { s.cleanup() }
  })

  it('ne contourne pas l’isolation des instances pour les exports du propre package', async () => {
    const s = await setup()
    try {
      const widget = s.open(s.provider, 'today'), major = s.open(s.provider, 'planner')
      const query = { package: s.provider.id, export: 'slots', instanceId: 'b' }
      expect(await widget.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(await major.call('packages.readExport', query)).toMatchObject({ ok: true, value: { instance: { instanceId: 'b' } } })
      createInstance(s.db, { packageId: s.provider.id, majorId: 'another', instanceId: 'b', name: 'Ambiguous', now: 'now' })
      expect(await major.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(await s.open().call('packages.readExport', { ...query, instanceId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    } finally { s.cleanup() }
  })

  it('refuse un snapshot de plus de 200 documents ou trop gros, sans troncature silencieuse', async () => {
    const s = await setup()
    try {
      const client = s.open(), query = { package: s.provider.id, export: 'slots' }
      for (let n = 0; n < 200; n++) putDocument(s.db, { packageId: s.provider.id, scope: 'a', collection: 'week', id: `doc-${n}` }, {}, { now: 'now' })
      expect(await client.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
      s.db.run("DELETE FROM package_documents WHERE doc_id LIKE 'doc-%'")
      s.db.run("UPDATE package_documents SET value_json = ? WHERE collection = 'week' AND instance_scope = 'a'", JSON.stringify('x'.repeat(1024 * 1024 + 1)))
      expect(await client.call('packages.readExport', query)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
    } finally { s.cleanup() }
  })

  it('notifie après commit seulement les exports accordés et collections publiées, sans contenu ni adresse privée', async () => {
    const s = await setup()
    try {
      const consumer = s.open(), incompatible = s.open({ ...s.consumer, dependencies: {} }), source = s.open(s.provider, 'planner')
      for (const client of [consumer, incompatible]) await client.call('events.subscribe', { topics: ['exports.changed'] })
      const before = s.core.snapshot().revision
      await source.call('storage.put', { collection: 'secret', id: 'hidden', value: 'private', expectedRevision: null })
      expect(consumer.messages.filter((m) => m.type === 'event')).toHaveLength(0)
      await source.call('storage.put', { collection: 'week', id: 'new', value: 'exported-content', expectedRevision: null })
      const events = consumer.messages.filter((m) => m.type === 'event')
      expect(events).toMatchObject([{ event: { topic: 'exports.changed', revision: before + 2, payload: { package: s.provider.id, export: 'slots', instanceId: 'a', invalidate: true } } }])
      expect(JSON.stringify(events)).not.toContain('exported-content')
      expect(JSON.stringify(events)).not.toContain('new')
      expect(incompatible.messages.filter((m) => m.type === 'event')).toEqual([])
      await source.call('storage.put', { collection: 'week', id: 'new', value: 'conflict', expectedRevision: null })
      expect(consumer.messages.filter((m) => m.type === 'event')).toHaveLength(1)
      s.db.run("UPDATE packages SET state = 'disabled' WHERE id = ?", s.provider.id)
      await source.call('storage.delete', { collection: 'week', id: 'new', expectedRevision: 1 })
      expect(consumer.messages.filter((m) => m.type === 'event')).toHaveLength(1)
    } finally { s.cleanup() }
  })
  it('distingue un export accordé absent d’un fournisseur absent, et refuse un manifeste démesuré', async () => {
    const s = await setup()
    try {
      const manifest = structuredClone(s.consumer)
      manifest.permissions!.exports!.push({ package: s.provider.id, export: 'missing' }, { package: 'absent.provider', export: 'slots' })
      manifest.dependencies!['absent.provider'] = '^1.0.0'
      const client = s.open(manifest)
      expect(await client.call('packages.readExport', { package: s.provider.id, export: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      expect(await client.call('packages.readExport', { package: 'absent.provider', export: 'slots' })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
      s.db.run('UPDATE package_versions SET manifest_json = ? WHERE package_id = ?', ' '.repeat(300_000) + JSON.stringify(s.provider), s.provider.id)
      expect(await client.call('packages.readExport', { package: s.provider.id, export: 'slots' })).toMatchObject({ ok: false, error: { code: 'INCOMPATIBLE' } })
    } finally { s.cleanup() }
  })

  it('invalide les changements d’instance et le scope partagé, respecte les propres liaisons fixes et le désabonnement', async () => {
    const s = await setup()
    try {
      const consumer = s.open(), widget = s.open(s.provider, 'today'), source = s.open(s.provider, 'planner')
      const subscription = await consumer.call('events.subscribe', { topics: ['exports.changed'] })
      await widget.call('events.subscribe', { topics: ['exports.changed'] })
      await source.call('instances.setActive', { instanceId: 'b', expectedActiveInstanceId: 'a' })
      expect(consumer.messages.filter((m) => m.type === 'event')).toMatchObject([{ event: { payload: { export: 'slots', instanceId: 'b' } } }])
      expect(widget.messages.filter((m) => m.type === 'event')).toEqual([])
      expect(await consumer.call('packages.readExport', { package: s.provider.id, export: 'slots' })).toMatchObject({ value: { instance: { instanceId: 'b' } } })
      await source.call('storage.put', { scope: 'package', collection: 'public', id: 'shared-write', value: true, expectedRevision: null })
      expect(consumer.messages.filter((m) => m.type === 'event')).toHaveLength(2)
      expect(consumer.messages.filter((m) => m.type === 'event').at(-1)).toMatchObject({ event: { payload: { export: 'shared', instanceId: null } } })
      await consumer.call('events.unsubscribe', subscription.value)
      await source.call('instances.rename', { instanceId: 'b', name: 'New B', expectedRevision: 1 })
      expect(consumer.messages.filter((m) => m.type === 'event')).toHaveLength(2)
    } finally { s.cleanup() }
  })

})
