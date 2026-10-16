import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { type Manifest } from '../../shared/manifest'
import { assessInstallation } from '../../main/packages/eligibility'
function pkg(id: string, dependencies: Record<string, string> = {}, version = '1.0.0'): Manifest {
  return { ...JSON.parse(readFileSync('tests/fixtures/manifests/valid/major-only.json', 'utf8')), id, version, dependencies }
}
describe('installation dependency assessment', () => {
  it('accepts compatible installed dependencies and native CORE', () => {
    expect(assessInstallation(pkg('example.consumer', { 'example.provider': '^1.0.0', core: '^1.0.0' }), [pkg('example.provider')])).toEqual([])
  })
  it('does not resolve missing dependencies from available archives', () => {
    expect(assessInstallation(pkg('example.consumer', { 'example.missing': '*' }), [])).toContainEqual({ code: 'DEPENDENCY_MISSING', packageId: 'example.consumer', dependency: 'example.missing' })
  })
  it('blocks breaking an existing reverse dependant on update', () => {
    expect(assessInstallation(pkg('example.provider', {}, '2.0.0'), [pkg('example.provider'), pkg('example.consumer', { 'example.provider': '^1.0.0' })])).toContainEqual({ code: 'DEPENDENCY_INCOMPATIBLE', packageId: 'example.consumer', dependency: 'example.provider' })
  })
  it('rejects cycles through installed providers and self cycles', () => {
    expect(assessInstallation(pkg('example.a', { 'example.b': '*' }), [pkg('example.b', { 'example.a': '*' })]).some(issue => issue.code === 'DEPENDENCY_CYCLE')).toBe(true)
    expect(assessInstallation(pkg('example.a', { 'example.a': '*' }), []).some(issue => issue.code === 'DEPENDENCY_CYCLE')).toBe(true)
  })
  it('rejects host incompatibility, code and storage downgrades', () => {
    const candidate = { ...pkg('example.a'), hostApi: '^2.0.0', storageVersion: 1 }
    expect(assessInstallation(candidate, [{ ...pkg('example.a', {}, '2.0.0'), storageVersion: 2 }]).map(issue => issue.code)).toEqual(['DOWNGRADE', 'STORAGE_DOWNGRADE', 'HOST_INCOMPATIBLE'])
  })
  it('treats extension targets as required dependencies', () => {
    const extension: Manifest = JSON.parse(readFileSync('tests/fixtures/manifests/valid/theme.json', 'utf8'))
    expect(assessInstallation(extension, [])).toEqual([])
    if (extension.kind !== 'extension') throw Error('fixture')
    extension.target = { package: 'example.missing', version: '^1.0.0' }
    expect(assessInstallation(extension, []).some(issue => issue.code === 'DEPENDENCY_MISSING' && issue.dependency === 'example.missing')).toBe(true)
  })
  it('does not implicitly include prerelease providers in ordinary ranges', () => {
    expect(assessInstallation(pkg('example.consumer', { 'example.provider': '^1.0.0' }), [pkg('example.provider', {}, '1.1.0-beta.1')]).some(issue => issue.code === 'DEPENDENCY_INCOMPATIBLE')).toBe(true)
  })
})
