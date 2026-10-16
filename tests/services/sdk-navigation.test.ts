import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { CoreService } from '../../main/core/service'
import { ContextRegistry } from '../../main/runtime/contexts'
import { SdkBroker } from '../../main/runtime/broker'
import type { InternalNavigationTarget, NavigationHooks } from '../../main/runtime/navigation'
import { createInstance, getActiveInstanceId } from '../../main/core/packageStore'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import type { HostToFrameMessage } from '../../shared/sdk'
import { fixturesDir, makeTempDir } from './helpers'

async function setup(hooks: NavigationHooks = {}) {
  const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
  const core = new CoreService(db), contexts = new ContextRegistry(db), broker = new SdkBroker(db, contexts, core, hooks)
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests/valid/combined.json'), 'utf8'))) as PackageManifest
  for (const instanceId of ['a', 'b']) createInstance(db, { packageId: manifest.id, majorId: 'planner', instanceId, name: instanceId, now: 'now' })
  const projects = [1, 2].map((n) => {
    const result = core.execute('projects.create', { input: { name: `Project ${n}`, type: 'dev', category: 'Test', platforms: [] }, operationId: `navigation-project-${n}` })
    if (!result.ok) throw new Error('Seed failed')
    return result.value.id
  })
  db.run("INSERT INTO project_blocks (project_id, block_id, position, package_id, contribution_id, config_json, binding_json) VALUES (?, 'placement', 0, ?, 'project-slots', '{}', ?)", projects[0], manifest.id, JSON.stringify({ mode: 'fixed', major: { packageId: manifest.id, contributionId: 'planner' }, instanceId: 'a' }))
  const sessions: ReturnType<SdkBroker['open']>[] = []
  const open = (kind = 'planner', ownerProject = false) => {
    const registered = contexts.create({ manifest, contributionId: kind, grantedPermissions: normalizePermissions(manifest.permissions), owner: ownerProject ? { kind: 'project', projectId: projects[0] } : { kind: 'page' }, placementId: ownerProject ? 'placement' : null, binding: kind === 'standalone' ? { mode: 'none' } : { mode: 'fixed', major: { packageId: manifest.id, contributionId: 'planner' }, instanceId: 'a' } })
    const messages: HostToFrameMessage[] = []
    const session = broker.open(registered.id, { send: (message) => messages.push(message), close: () => {} })
    sessions.push(session)
    let n = 0
    return { registered, messages, async call(method: string, params: unknown) {
      const requestId = `navigation-${++n}`
      await session.receive({ type: 'request', requestId, method, params })
      return messages.findLast((message) => message.type === 'response' && message.requestId === requestId) as any
    } }
  }
  return { db, core, contexts, manifest, projects, open, cleanup: () => { sessions.forEach((s) => s.close()); contexts.close(); db.close() } }
}

describe('navigation native bornée du SDK', () => {
  it('confirme un lien web canonique puis l’ouvre uniquement après réponse', async () => {
    const opened: string[] = [], confirms: string[] = []
    let client: any
    const s = await setup({ confirmExternal: async (_source,url) => {confirms.push(url);return true}, openExternal: async url => {expect(client.messages.at(-1)).toMatchObject({ok:true,value:{opened:true}});opened.push(url)} })
    try {
      client=s.open()
      expect(await client.call('navigation.open',{kind:'external',url:'https://example.com'})).toMatchObject({ok:true})
      expect(confirms).toEqual(['https://example.com/']);expect(opened).toEqual(confirms)
      for(const url of ['file:///etc/hosts','javascript:alert(1)','https://user:pass@example.com/',' https://example.com/','https://example.com/\n']) expect(await client.call('navigation.open',{kind:'external',url})).toMatchObject({ok:false,error:{code:'VALIDATION'}})
      expect(opened).toHaveLength(1)
    } finally {s.cleanup()}
  })
  it('refus de confirmation et révocation pendant confirmation n’ouvrent aucun navigateur', async () => {
    let allow=false, revoke:()=>void=()=>{}, opened=0
    const s=await setup({confirmExternal:async()=>{revoke();return allow},openExternal:async()=>{opened++}})
    try {
      const client=s.open()
      expect(await client.call('navigation.open',{kind:'external',url:'https://example.com/'})).toMatchObject({ok:false,error:{code:'PERMISSION_DENIED'}})
      allow=true;revoke=()=>s.contexts.revoke(client.registered.id)
      await client.call('navigation.open',{kind:'external',url:'https://example.com/'})
      expect(opened).toBe(0)
    } finally {s.cleanup()}
  })
  it('refuse sans adaptateur natif et refuse toujours les liens externes non confirmés', async () => {
    const s = await setup()
    try {
      const client = s.open()
      for (const [method, params] of [['instances.select', { instanceId: 'b' }], ['navigation.open', { kind: 'major' }], ['navigation.open', { kind: 'project', projectId: s.projects[0] }], ['navigation.open', { kind: 'external', url: 'https://example.com' }]] as const) expect(await client.call(method, params)).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
      expect(getActiveInstanceId(s.db, s.manifest.id, 'planner')).toBe('a')
    } finally { s.cleanup() }
  })

  it('sélectionne une instance consultée sans changer l’active, répond avant la navigation/révocation et préserve les autres placements', async () => {
    const targets: InternalNavigationTarget[] = []
    let s: Awaited<ReturnType<typeof setup>>, client: ReturnType<typeof s.open>
    s = await setup({ prepareNavigation: (source, target) => () => {
      expect(client.messages.at(-1)).toMatchObject({ type: 'response', ok: true, value: { instanceId: 'b', active: false } })
      targets.push(target)
      s.contexts.revoke(source.contextId)
    } })
    try {
      client = s.open()
      const widget = s.open('today')
      const before = s.core.snapshot().revision
      expect(await client.call('instances.select', { instanceId: 'b' })).toMatchObject({ ok: true, value: { instanceId: 'b', active: false } })
      expect(targets).toEqual([{ kind: 'major', major: { packageId: s.manifest.id, contributionId: 'planner' }, binding: { mode: 'fixed', major: { packageId: s.manifest.id, contributionId: 'planner' }, instanceId: 'b' } }])
      expect(client.messages.at(-1)).toMatchObject({ type: 'revoked' })
      expect(s.contexts.get(widget.registered.id).instance?.instanceId).toBe('a')
      expect(getActiveInstanceId(s.db, s.manifest.id, 'planner')).toBe('a')
      expect(s.core.snapshot().revision).toBe(before)
    } finally { s.cleanup() }
  })

  it('limite la sélection au majeur, permet au widget d’ouvrir son majeur et refuse toute identité ou route ajoutée', async () => {
    const targets: InternalNavigationTarget[] = []
    const s = await setup({ prepareNavigation: (_source, target) => () => { targets.push(target) } })
    try {
      const widget = s.open('today'), independent = s.open('standalone')
      expect(await widget.call('instances.select', { instanceId: 'b' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      expect(await independent.call('navigation.open', { kind: 'major' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      for (const params of [{ kind: 'major', packageId: 'other.package' }, { kind: 'major', instanceId: 'a', url: 'file:///etc/passwd' }, { kind: 'project', projectId: s.projects[0], channel: 'arbitrary' }, { kind: 'native', page: 'settings' }]) expect(await widget.call('navigation.open', params)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(targets).toEqual([])
      expect(await widget.call('navigation.open', { kind: 'major' })).toMatchObject({ ok: true, value: { opened: true } })
      expect(targets).toMatchObject([{ kind: 'major', binding: { mode: 'fixed', instanceId: 'a' } }])
    } finally { s.cleanup() }
  })

  it('exige read pour un autre projet, permet seulement au placement son propre projet sans read et vérifie l’existence', async () => {
    const targets: InternalNavigationTarget[] = []
    const s = await setup({ prepareNavigation: (_source, target) => () => { targets.push(target) } })
    try {
      s.manifest.permissions = {}
      const minor = s.open('project-slots', true), independent = s.open('standalone')
      expect(await minor.call('navigation.open', { kind: 'project', projectId: s.projects[0] })).toMatchObject({ ok: true })
      for (const client of [minor, independent]) expect(await client.call('navigation.open', { kind: 'project', projectId: s.projects[1] })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
      s.manifest.permissions = { core: { projects: ['read'] } }
      const reader = s.open()
      expect(await reader.call('navigation.open', { kind: 'project', projectId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      expect(await reader.call('navigation.open', { kind: 'project', projectId: s.projects[1] })).toMatchObject({ ok: true })
      expect(targets).toEqual([{ kind: 'project', projectId: s.projects[0] }, { kind: 'project', projectId: s.projects[1] }])
    } finally { s.cleanup() }
  })

  it('refuse les instances absentes/ambiguës et le refus natif sans committer de navigation', async () => {
    const s = await setup({ prepareNavigation: () => null })
    try {
      const client = s.open()
      expect(await client.call('instances.select', { instanceId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      createInstance(s.db, { packageId: s.manifest.id, majorId: 'another', instanceId: 'b', name: 'Other', now: 'now' })
      expect(await client.call('instances.select', { instanceId: 'b' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(await client.call('instances.select', { instanceId: 'a' })).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } })
    } finally { s.cleanup() }
  })

  it('revalide la source avant commit si une autre requête l’a révoquée', async () => {
    let commits = 0
    let s: Awaited<ReturnType<typeof setup>>
    s = await setup({ prepareNavigation: (source) => { queueMicrotask(() => s.contexts.revoke(source.contextId)); return () => { commits++ } } })
    try {
      await s.open().call('navigation.open', { kind: 'major', instanceId: 'b' })
      expect(commits).toBe(0)
    } finally { s.cleanup() }
  })
  it('ne navigue pas si le transport ne peut pas envoyer l’accusé de réception', async () => {
    let commits = 0
    const s = await setup({ prepareNavigation: () => () => { commits++ } })
    try {
      const context = s.open().registered
      const broker = new SdkBroker(s.db, s.contexts, s.core, { prepareNavigation: () => () => { commits++ } })
      const session = broker.open(context.id, { send: () => { throw new Error('closed transport') }, close: () => {} })
      await session.receive({ type: 'request', requestId: 'failed-ack', method: 'navigation.open', params: { kind: 'major' } })
      expect(commits).toBe(0)
      session.close()
    } finally { s.cleanup() }
  })

})
