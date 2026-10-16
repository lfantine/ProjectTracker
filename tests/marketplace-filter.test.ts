import { expect, it } from 'vitest'
import { matchesMarketplace } from '../shared/marketplace'
import { validateManifest, type Manifest } from '../shared/manifest'
import combined from './fixtures/manifests/valid/combined.json'
const parsed = validateManifest(combined)
if (!parsed.ok) throw Error('fixture')
const manifest = parsed.manifest
const filter = { query: '', contributions: [] }
it('matches name, author, description and included contributions without accents or case', () => {
  for (const query of [manifest.name.toUpperCase(), manifest.author, 'standalone']) expect(matchesMarketplace(manifest, { ...filter, query })).toBe(true)
  expect(matchesMarketplace(manifest, { ...filter, query: 'absent unlikely' })).toBe(false)
})
it('combines contribution categories by union and never filters the manifest contents', () => {
  expect(matchesMarketplace(manifest, { ...filter, contributions: ['major', 'widget'] })).toBe(true)
  expect(matchesMarketplace(manifest, filter)).toBe(true)
  expect(manifest.kind === 'package' && manifest.contributions).toHaveLength(4)
})
it('keeps extension types and exact targets distinct from standalone packages', () => {
  const extension = { ...combined, kind: 'extension', extensionType: 'theme', target: { package: 'builtin.week', version: '^1.0.0' }, theme: 'theme.json' } as unknown as Manifest
  expect(matchesMarketplace(extension, { ...filter, extensionType: 'theme', target: 'builtin.week' })).toBe(true)
  expect(matchesMarketplace(extension, { ...filter, extensionType: 'features' })).toBe(false)
  expect(matchesMarketplace(extension, { ...filter, target: 'other' })).toBe(false)
  expect(matchesMarketplace(extension, { ...filter, contributions: ['widget'] })).toBe(false)
  expect(matchesMarketplace(manifest, { ...filter, extensionType: 'theme' })).toBe(false)
})
