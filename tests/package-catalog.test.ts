import { expect, it } from 'vitest'
import { packageEntries } from '../renderer/lib/packageCatalog'
import type { PackageShellSnapshot } from '../shared/packageShell'
import type { Manifest } from '../shared/manifest'
import combined from './fixtures/manifests/valid/combined.json'

const manifest = (version: string) => ({ ...combined, version }) as unknown as Manifest
type Registry = PackageShellSnapshot['packages'][number]
const registry = (patch: Partial<Registry>): Registry => ({ id: combined.id, name: combined.name, state: 'disabled', activeVersion: null, reason: null, revision: 1, ...patch })
const snapshot = (patch: Partial<PackageShellSnapshot>): PackageShellSnapshot => ({ phase: 'ready', packages: [], versions: [], details: [], catalogue: { status: 'unlinked' }, bundled: [], ...patch })
const source = (version: string) => ({ status: 'available' as const, fileName: `${version}.zip`, manifest: manifest(version), selection: `sel-${version}`, publisherVerified: false as const, sourceSha256: 'a', contentSha256: 'b', issues: [] })

it('folds every native state into one status and one action per package', () => {
  const cases: [Partial<PackageShellSnapshot>, string, string, string | undefined][] = [
    [{ catalogue: { status: 'ok', entries: [source('1.2.3')] } }, 'available', 'install', '1.2.3'],
    [{ packages: [registry({})], details: [{ manifest: manifest('1.2.3'), status: 'ready' }] }, 'ready', 'activate', '1.2.3'],
    [{ packages: [registry({ state: 'active', activeVersion: '1.2.3' })], details: [{ manifest: manifest('1.2.3'), status: 'active' }] }, 'active', 'open', '1.2.3'],
    [{ packages: [registry({ state: 'active', activeVersion: '1.2.3' })], details: [{ manifest: manifest('1.2.3'), status: 'active' }, { manifest: manifest('1.3.0'), status: 'ready' }] }, 'update', 'activate', '1.3.0'],
    [{ packages: [registry({ state: 'active', activeVersion: '1.2.3' })], details: [{ manifest: manifest('1.2.3'), status: 'active' }], catalogue: { status: 'ok', entries: [source('2.0.0')] } }, 'update', 'install', '2.0.0'],
    [{ packages: [registry({ state: 'disabled', activeVersion: '1.2.3', reason: 'user-disabled' })], details: [{ manifest: manifest('1.2.3'), status: 'active' }] }, 'disabled', 'activate', '1.2.3'],
    [{ packages: [registry({ state: 'uninstalled' })], details: [{ manifest: manifest('1.2.3'), status: 'retired' }] }, 'removed', 'activate', '1.2.3'],
  ]
  for (const [patch, status, action, version] of cases) {
    const [entry] = packageEntries(snapshot(patch))
    expect([entry.status, entry.action, entry.target?.manifest.version]).toEqual([status, action, version])
  }
})
it('does not offer re-importing a version already in the store', () => {
  const [entry] = packageEntries(snapshot({ packages: [registry({})], details: [{ manifest: manifest('1.2.3'), status: 'ready' }], catalogue: { status: 'ok', entries: [source('1.2.3')] } }))
  expect(entry.target).toMatchObject({ installed: true }); expect(entry.versions).toHaveLength(1)
})
it('orders versions semantically, not alphabetically', () => {
  const [entry] = packageEntries(snapshot({ packages: [registry({})], details: [{ manifest: manifest('1.9.0'), status: 'ready' }, { manifest: manifest('1.10.0'), status: 'ready' }] }))
  expect(entry.versions.map(version => version.manifest.version)).toEqual(['1.10.0', '1.9.0'])
  expect(entry.target?.manifest.version).toBe('1.10.0')
})
