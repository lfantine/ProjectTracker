import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { ContextRegistry } from '../../main/runtime/contexts'
import { SdkBroker } from '../../main/runtime/broker'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import type { HostToFrameMessage, PlacementOwner } from '../../shared/sdk'
import { RUNTIME_LIMITS } from '../../shared/limits'
import { fixturesDir, makeTempDir } from './helpers'

async function setup() {
  const file = path.join(makeTempDir(), 'tracker.sqlite')
  const db = await openDatabase(file)
  const core = new CoreService(db)
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests/valid/combined.json'), 'utf8'))) as PackageManifest
  const widget = manifest.contributions.find((entry) => entry.id === 'standalone')!
  widget.config = { version: 1, fields: [{ key: 'label', label: 'Label', type: 'string', maxLength: 20 }] }
  const created = core.execute('projects.create', { input: { name: 'Configuration', type: 'dev', category: 'Test', platforms: [] }, operationId: 'config-project-seed' })
  if (!created.ok) throw new Error('Seed failed')
  const projectId = created.value.id
  db.run("INSERT INTO dashboards (id, name, position, created_at, updated_at) VALUES ('config-dashboard', 'Test', 10, 'now', 'now')")
  db.run("INSERT INTO project_blocks (project_id, block_id, position, package_id, contribution_id, config_json, binding_json) VALUES (?, 'same-id', 0, ?, 'standalone', '{}', ?)", projectId, manifest.id, '{"mode":"none"}')
  for (const placement of ['same-id', 'other']) db.run("INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_json, binding_json, layouts_json) VALUES ('config-dashboard', ?, 0, ?, 'standalone', '{}', ?, '{}')", placement, manifest.id, '{"mode":"none"}')
  const contexts = new ContextRegistry(db), broker = new SdkBroker(db, contexts, core)
  const sessions: ReturnType<SdkBroker['open']>[] = []
  const open = (owner: PlacementOwner = { kind: 'dashboard', dashboardId: 'config-dashboard' }, placementId: string | null = 'same-id') => {
    const registered = contexts.create({ manifest, contributionId: 'standalone', grantedPermissions: normalizePermissions(manifest.permissions), placementId, owner, binding: { mode: 'none' }, config: { label: 'Ignored caller value' } })
    const messages: HostToFrameMessage[] = []
    const session = broker.open(registered.id, { send: (message) => messages.push(message), close: () => {} })
    sessions.push(session)
    let counter = 0
    return { registered, messages, async call(method: string, params: unknown = {}) {
      const requestId = `config-${++counter}`
      await session.receive({ type: 'request', requestId, method, params })
      return messages.findLast((message) => message.type === 'response' && message.requestId === requestId) as any
    } }
  }
  return { db, file, core, contexts, manifest, projectId, open, cleanup: () => { sessions.forEach((s) => s.close()); contexts.close(); db.close() } }
}

describe('configuration persistante des emplacements SDK', () => {
  it('lit SQLite plutôt que la configuration fournie, persiste et notifie seulement le même emplacement après commit', async () => {
    const s = await setup()
    try {
      const first = s.open(), second = s.open(), other = s.open(undefined, 'other'), project = s.open({ kind: 'project', projectId: s.projectId })
      expect(first.registered.context).toMatchObject({ config: {}, configRevision: 1 })
      for (const client of [first, second, other, project]) await client.call('events.subscribe', { topics: ['context.changed'] })
      const before = s.core.snapshot().revision
      expect(await first.call('context.updateConfig', { config: { label: 'Confirmed' }, expectedRevision: 1 })).toMatchObject({ ok: true, value: { config: { label: 'Confirmed' }, revision: 2 } })
      expect(s.core.snapshot().revision).toBe(before + 1)
      for (const client of [first, second]) {
        expect(client.messages.filter((m) => m.type === 'event')).toMatchObject([{ event: { topic: 'context.changed', revision: before + 1, payload: {} } }])
        expect(await client.call('context.get')).toMatchObject({ value: { config: { label: 'Confirmed' }, configRevision: 2 } })
      }
      for (const client of [other, project]) expect(client.messages.filter((m) => m.type === 'event')).toEqual([])
      expect(s.open().registered.context.config).toEqual({ label: 'Confirmed' })
      const reopened = await openDatabase(s.file)
      try { expect(JSON.parse(reopened.get<{ config_json: string }>("SELECT config_json FROM dashboard_widgets WHERE dashboard_id = 'config-dashboard' AND placement_id = 'same-id'")!.config_json)).toEqual({ label: 'Confirmed' }) } finally { reopened.close() }
    } finally { s.cleanup() }
  })

  it('exige une révision, refuse les conflits et les identités forgées, et ne réécrit pas une valeur identique', async () => {
    const s = await setup()
    try {
      const client = s.open()
      for (const params of [{ config: {} }, { config: {}, expectedRevision: 1, placementId: 'other' }, { config: { unknown: true }, expectedRevision: 1 }, { config: { label: 5 }, expectedRevision: 1 }]) expect(await client.call('context.updateConfig', params)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      const before = s.core.snapshot().revision
      expect(await client.call('context.updateConfig', { config: {}, expectedRevision: 1 })).toMatchObject({ ok: true, value: { revision: 1 } })
      expect(s.core.snapshot().revision).toBe(before)
      await client.call('context.updateConfig', { config: { label: 'New' }, expectedRevision: 1 })
      expect(await client.call('context.updateConfig', { config: { label: 'Stale' }, expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(s.contexts.get(client.registered.id).config).toEqual({ label: 'New' })
    } finally { s.cleanup() }
  })

  it('révoque un contexte après suppression, remplacement ou changement de liaison de son emplacement', async () => {
    const s = await setup()
    try {
      const client = s.open()
      s.db.run("UPDATE dashboard_widgets SET contribution_id = 'today' WHERE dashboard_id = 'config-dashboard' AND placement_id = 'same-id'")
      expect(() => s.contexts.get(client.registered.id)).toThrow()
      expect(client.messages.at(-1)).toMatchObject({ type: 'revoked' })
      expect(() => s.open()).toThrow()
      s.db.run("UPDATE dashboard_widgets SET contribution_id = 'standalone', binding_json = ? WHERE placement_id = 'same-id'", '{"mode":"active"}')
      expect(() => s.open()).toThrow()
      s.db.run("UPDATE dashboard_widgets SET binding_json = ? WHERE placement_id = 'same-id'", '{"mode":"none"}')
      const removed = s.open()
      s.db.run("DELETE FROM dashboard_widgets WHERE placement_id = 'same-id'")
      expect(() => s.contexts.get(removed.registered.id)).toThrow()
    } finally { s.cleanup() }
  })

  it('met à jour la révision projet et son cache natif ; une erreur SQLite annule tout et ne notifie rien', async () => {
    const s = await setup()
    try {
      const client = s.open({ kind: 'project', projectId: s.projectId })
      await client.call('events.subscribe', { topics: ['context.changed'] })
      const changes: unknown[] = []
      const stop = s.core.onChange((events) => changes.push(events))
      const before = s.core.snapshot().data.projects.find((p) => p.id === s.projectId)!.revision!
      s.db.db.exec("CREATE TRIGGER deny_config BEFORE UPDATE ON project_blocks BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
      const clock = s.core.snapshot().revision
      expect(await client.call('context.updateConfig', { config: { label: 'Failure' }, expectedRevision: 1 })).toMatchObject({ ok: false })
      expect(s.core.snapshot().revision).toBe(clock)
      expect(changes).toEqual([])
      expect(client.messages.filter((m) => m.type === 'event')).toEqual([])
      s.db.db.exec('DROP TRIGGER deny_config')
      expect(await client.call('context.updateConfig', { config: { label: 'Saved' }, expectedRevision: 1 })).toMatchObject({ ok: true })
      expect(s.core.snapshot().data.projects.find((p) => p.id === s.projectId)!.revision).toBe(before + 1)
      expect(changes).toMatchObject([[{ entity: 'project', id: s.projectId, value: { revision: before + 1 } }]])
      stop()
    } finally { s.cleanup() }
  })

  it('refuse les pages sans persistance, les versions incompatibles et les configurations trop volumineuses', async () => {
    const s = await setup()
    try {
      const page = s.open({ kind: 'page' }, null)
      expect(page.registered.context.configRevision).toBeNull()
      expect(await page.call('context.updateConfig', { config: {}, expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
      s.db.run("UPDATE dashboard_widgets SET config_version = 2 WHERE placement_id = 'same-id'")
      expect(() => s.open()).toThrow()
      s.db.run("UPDATE dashboard_widgets SET config_version = 1 WHERE placement_id = 'same-id'")
      s.manifest.contributions.find((entry) => entry.id === 'standalone')!.config = { version: 1, fields: [], customUi: true }
      const client = s.open()
      expect(await client.call('context.updateConfig', { config: { large: 'x'.repeat(RUNTIME_LIMITS.maxDocumentBytes) }, expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(s.contexts.get(client.registered.id).configRevision).toBe(1)
    } finally { s.cleanup() }
  })
  it('préserve les clés JSON spéciales des configurations custom sans modifier leur prototype', async () => {
    const s = await setup()
    try {
      s.manifest.contributions.find((entry) => entry.id === 'standalone')!.config = { version: 1, fields: [], customUi: true }
      const client = s.open()
      const config = JSON.parse('{"__proto__":{"polluted":true},"label":"safe"}')
      expect(await client.call('context.updateConfig', { config, expectedRevision: 1 })).toMatchObject({ ok: true, value: { revision: 2 } })
      const stored = s.contexts.get(client.registered.id).config
      expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
      expect(Object.hasOwn(stored, '__proto__')).toBe(true)
      expect(stored.polluted).toBeUndefined()
      expect(await client.call('context.updateConfig', { config, expectedRevision: 2 })).toMatchObject({ ok: true, value: { revision: 2 } })
    } finally { s.cleanup() }
  })

})
