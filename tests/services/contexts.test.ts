import { isQualifiedRelease } from '../../main/core/release'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ContextRegistry, EXTERNAL_RUNTIME_QUALIFIED, pluginOrigin } from '../../main/runtime/contexts'
import { openDatabase } from '../../main/db/database'
import { createInstance, setActiveInstance } from '../../main/core/packageStore'
import { manifestSchema, type PackageManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'
import { RUNTIME_LIMITS } from '../../shared/limits'
import { fixturesDir, makeTempDir } from './helpers'

async function setup() {
  const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(fixturesDir, 'manifests', 'valid', 'combined.json'), 'utf8'))) as PackageManifest
  for (const id of ['a', 'b']) createInstance(db, { packageId: manifest.id, majorId: 'planner', instanceId: id, name: id, now: '2026-10-15T12:00:00Z' })
  const registry = new ContextRegistry(db)
  const input = { manifest, contributionId: 'today', grantedPermissions: normalizePermissions(manifest.permissions), placementId: 'widget-1', owner: { kind: 'page' as const }, binding: { mode: 'active' as const, major: { packageId: manifest.id, contributionId: 'planner' } } }
  return { db, manifest, registry, input }
}

describe('registre natif des contextes (admission native requise)', () => {
  it('refuse les nouvelles inscriptions pendant une suspension native, avec libération idempotente', async () => {
    const { db, registry, input } = await setup()
    try {
      const old = registry.create(input)
      const release = registry.suspendPackage(input.manifest.id)
      const releaseSecond = registry.suspendPackage(input.manifest.id)
      expect(() => registry.get(old.id)).toThrow()
      expect(() => registry.create(input)).toThrow()
      release(); release()
      expect(() => registry.create(input)).toThrow()
      releaseSecond()
      expect(registry.create(input).id).not.toBe(old.id)
    } finally { registry.close(); db.close() }
  })

  it('crée des origines distinctes et ne croit pas une identité fournie par un message', async () => {
    const { db, registry, input } = await setup()
    try {
      const a = registry.create(input)
      const b = registry.create(input)
      expect(a.id).not.toBe(b.id)
      expect(a.origin).toBe(pluginOrigin(a.id))
      expect(() => registry.get('ctx-forged')).toThrow()
      a.context.packageId = 'forged.package'
      a.context.permissions.core.projects!.push('write')
      expect(registry.get(a.id).packageId).toBe(input.manifest.id)
      expect(registry.get(a.id).permissions.core.projects).toEqual(['read'])
      expect(EXTERNAL_RUNTIME_QUALIFIED).toBe(true)
      expect(isQualifiedRelease()).toBe(false)
    } finally { registry.close(); db.close() }
  })

  it('résout les liaisons côté natif, puis exige une nouvelle identité après changement', async () => {
    const { db, registry, input } = await setup()
    try {
      const first = registry.create(input)
      expect(first.context.instance?.instanceId).toBe('a')
      setActiveInstance(db, input.manifest.id, 'planner', 'b')
      // An old context also becomes unusable if a host caller forgot to
      // explicitly revoke it before changing the active binding.
      expect(() => registry.get(first.id)).toThrow()
      const second = registry.create(input)
      expect(second.context.instance?.instanceId).toBe('b')
      expect(() => registry.get(first.id)).toThrow()
      const fixed = registry.create({ ...input, binding: { ...input.binding, mode: 'fixed', instanceId: 'a' } })
      expect(fixed.context.instance?.instanceId).toBe('a')
    } finally { registry.close(); db.close() }
  })

  it('refuse une liaison étrangère, une instance disparue ou des droits incomplets', async () => {
    const { db, registry, input } = await setup()
    try {
      expect(() => registry.create({ ...input, grantedPermissions: { core: {}, network: [], exports: [] } })).toThrow()
      expect(() => registry.create({ ...input, binding: { mode: 'fixed', major: input.binding.major, instanceId: 'missing' } })).toThrow()
      expect(() => registry.create({ ...input, binding: { mode: 'active', major: { packageId: 'other.package', contributionId: 'planner' } } })).toThrow()
    } finally { registry.close(); db.close() }
  })

  it('annule requêtes et abonnements même si un nettoyage échoue', async () => {
    const { db, registry, input } = await setup()
    try {
      const a = registry.create(input)
      const signal = registry.signal(a.id)
      const cleaned = vi.fn()
      registry.onRevoke(a.id, () => { throw new Error('cleanup failed') })
      registry.onRevoke(a.id, cleaned)
      registry.revokePackage(input.manifest.id)
      expect(signal.aborted).toBe(true)
      expect(cleaned).toHaveBeenCalledOnce()
      registry.revoke(a.id)
      expect(cleaned).toHaveBeenCalledOnce()
    } finally { registry.close(); db.close() }
  })

  it('révoque un contexte dont le bootstrap ne répond pas dans le délai', async () => {
    const { db, registry, input } = await setup()
    vi.useFakeTimers()
    try {
      const a = registry.create(input)
      const b = registry.create(input)
      registry.ready(b.id)
      vi.advanceTimersByTime(RUNTIME_LIMITS.initTimeoutMs)
      expect(() => registry.get(a.id)).toThrow()
      expect(registry.get(b.id).packageId).toBe(input.manifest.id)
      expect(() => registry.ready(b.id)).toThrow()
    } finally { registry.close(); vi.useRealTimers(); db.close() }
  })
})

describe('ressources privées des contextes (sans protocole actif)', () => {
  it('sert uniquement les chemins et contenus de l’inventaire vérifié', async () => {
    const { createHash } = await import('node:crypto')
    const { ResourceCatalog } = await import('../../main/runtime/resources')
    const { db, registry, input } = await setup()
    const catalog = new ResourceCatalog(registry, 'app://.')
    try {
      const root = makeTempDir('pt-resources-')
      const content = '<html><body>Fixture contrôlée</body></html>'
      fs.writeFileSync(path.join(root, 'today.html'), content)
      fs.writeFileSync(path.join(root, 'secret.txt'), 'non déclaré')
      const context = registry.create(input)
      catalog.add(context.id, root, [{ path: 'today.html', sha256: createHash('sha256').update(content).digest('hex') }])
      const result = catalog.read(`${context.origin}/today.html`)
      expect(Buffer.from(result.body).toString()).toBe(content)
      expect(result.headers['Content-Security-Policy']).toContain("connect-src 'none'")
      expect(result.headers['X-Content-Type-Options']).toBe('nosniff')
      for (const file of ['secret.txt', '../secret.txt', '%2e%2e/secret.txt', '%252e%252e/secret.txt', '%2ftoday.html', 'today.html%00', 'x\\today.html']) {
        expect(() => catalog.read(`${context.origin}/${file}`)).toThrow()
      }
      fs.writeFileSync(path.join(root, 'today.html'), 'contenu remplacé après validation')
      expect(() => catalog.read(`${context.origin}/today.html`)).toThrow()
      registry.revoke(context.id)
      expect(() => catalog.read(`${context.origin}/today.html`)).toThrow()
    } finally { catalog.close(); registry.close(); db.close() }
  })

  it('refuse les liens symboliques et les inventaires ambigus sur macOS', async () => {
    const { createHash } = await import('node:crypto')
    const { ResourceCatalog } = await import('../../main/runtime/resources')
    const { db, registry, input } = await setup()
    const catalog = new ResourceCatalog(registry, 'http://localhost:8888')
    try {
      const root = makeTempDir('pt-resources-')
      const outside = path.join(makeTempDir(), 'outside.html')
      fs.writeFileSync(outside, 'hors du package')
      fs.symlinkSync(outside, path.join(root, 'link.html'))
      const context = registry.create(input)
      const sha256 = createHash('sha256').update('hors du package').digest('hex')
      expect(() => catalog.add(context.id, root, [{ path: 'a.html', sha256 }, { path: 'A.html', sha256 }])).toThrow()
      catalog.add(context.id, root, [{ path: 'link.html', sha256 }])
      expect(() => catalog.read(`${context.origin}/link.html`)).toThrow()
    } finally { catalog.close(); registry.close(); db.close() }
  })
})


describe('bootstrap contrôlé par l’hôte', () => {
  it('ne livre jamais le HTML tiers avant le SDK et réserve ses ressources', async () => {
    const { createHash } = await import('node:crypto')
    const { ResourceCatalog } = await import('../../main/runtime/resources')
    const { db, registry, input } = await setup()
    const catalog = new ResourceCatalog(registry, 'app://.')
    try {
      const root = makeTempDir('pt-bootstrap-')
      const html = '<html><body><script src="nested/main.js"></script></body></html>'
      fs.writeFileSync(path.join(root, 'today.html'), html)
      const context = registry.create(input)
      const sha256 = createHash('sha256').update(html).digest('hex')
      expect(() => catalog.add(context.id, root, [{ path: '__PT_HOST__/bootstrap.js', sha256 }])).toThrow()
      catalog.add(context.id, root, [{ path: 'today.html', sha256 }])
      const url = catalog.prepareBootstrap(context.id, 'today.html', 'var PtBootstrap = { start() {} };')
      const wrapper = Buffer.from(catalog.read(url).body).toString()
      expect(wrapper).toContain('src="bootstrap.js"')
      expect(wrapper).not.toContain('nested/main.js')
      expect(() => catalog.read(`${context.origin}/today.html`)).toThrow()
      const script = Buffer.from(catalog.read(`${context.origin}/__pt_host__/bootstrap.js`).body).toString()
      expect(script).toContain('PtBootstrap.start(')
      expect(script).toContain('app://.')
      expect(script).toContain(`${context.origin}/today.html`)
      expect(() => catalog.prepareBootstrap(context.id, 'today.html', '')).toThrow()
      registry.revoke(context.id)
      expect(() => catalog.read(url)).toThrow()
    } finally { catalog.close(); registry.close(); db.close() }
  })
})
