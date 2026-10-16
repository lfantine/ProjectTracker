import os from 'node:os'
import fs from 'node:fs'
import { makeTempDir } from './helpers'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adoptLegacyDataDir, defaultDataDir, legacyDataDir, resolveDataPaths, resolveUserDataOverride } from '../../main/helpers/paths'

describe('résolveur de chemins', () => {
  const home = path.join(os.tmpdir(), 'pt-fake-home')

  it('utilise le répertoire amber hors test', () => {
    const paths = resolveDataPaths({}, home)
    expect(paths.root).toBe(path.join(home, '.data', 'amber'))
    expect(paths.database).toBe(path.join(paths.root, 'tracker.sqlite'))
    expect(paths.legacyData).toBe(path.join(paths.root, 'data.json'))
  })

  it('applique la surcharge de test à tous les chemins', () => {
    const root = path.join(os.tmpdir(), 'pt-isolated')
    const paths = resolveDataPaths({ PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_DATA_DIR: root }, home)
    for (const value of Object.values(paths)) expect(value.startsWith(root)).toBe(true)
  })

  it('refuse le répertoire personnel en mode test', () => {
    expect(() => resolveDataPaths({ PROJECT_TRACKER_TEST: '1' }, home)).toThrow()
    expect(() => resolveDataPaths({ PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_DATA_DIR: defaultDataDir(home) }, home)).toThrow()
    expect(() => resolveDataPaths({ PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_DATA_DIR: path.join(defaultDataDir(home), 'sub') }, home)).toThrow()
    expect(() => resolveDataPaths({ PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_DATA_DIR: legacyDataDir(home) }, home)).toThrow()
  })

  it('renomme une seule fois ~/.data/ProjectTracker en ~/.data/amber', () => {
    const fake = makeTempDir('amber-path-rename-'), legacy = legacyDataDir(fake)
    fs.mkdirSync(path.join(legacy, 'backups'), { recursive: true })
    fs.writeFileSync(path.join(legacy, 'data.json'), '{"projects":[]}')
    expect(resolveDataPaths({}, fake).root).toBe(legacy)
    expect(adoptLegacyDataDir(fake)).toBe(true)
    expect(fs.existsSync(legacy)).toBe(false)
    const target = defaultDataDir(fake)
    expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).toBe('{"projects":[]}')
    expect(fs.readdirSync(target).sort()).toEqual(['backups', 'data.json'])
    expect(resolveDataPaths({}, fake).root).toBe(target)
    expect(adoptLegacyDataDir(fake)).toBe(false)
  })

  it('ne fusionne rien si ~/.data/amber existe déjà', () => {
    const fake = makeTempDir('amber-path-both-')
    fs.mkdirSync(legacyDataDir(fake), { recursive: true }); fs.writeFileSync(path.join(legacyDataDir(fake), 'data.json'), 'old')
    fs.mkdirSync(defaultDataDir(fake), { recursive: true }); fs.writeFileSync(path.join(defaultDataDir(fake), 'data.json'), 'new')
    expect(adoptLegacyDataDir(fake)).toBe(false)
    expect(fs.readFileSync(path.join(legacyDataDir(fake), 'data.json'), 'utf8')).toBe('old')
    expect(resolveDataPaths({}, fake).root).toBe(defaultDataDir(fake))
  })

  it('garde l’ancien répertoire tant qu’une autre instance le verrouille', () => {
    const fake = makeTempDir('amber-path-locked-'), legacy = legacyDataDir(fake)
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'tracker.lock'), JSON.stringify({ pid: process.ppid }))
    expect(adoptLegacyDataDir(fake)).toBe(false)
    expect(fs.existsSync(path.join(legacy, 'tracker.lock'))).toBe(true)
    expect(fs.existsSync(defaultDataDir(fake))).toBe(false)
    expect(resolveDataPaths({}, fake).root).toBe(legacy)
  })

  it('refuse une surcharge personnelle cachée par un lien symbolique', () => {
    const fake = makeTempDir('amber-path-home-'), personal = defaultDataDir(fake)
    fs.mkdirSync(personal, { recursive: true })
    const alias = path.join(makeTempDir('amber-path-link-'), 'alias')
    fs.symlinkSync(personal, alias)
    expect(() => resolveDataPaths({ PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_DATA_DIR: path.join(alias, 'new') }, fake)).toThrow()
  })

  it('refuse les chemins relatifs ou vides', () => {
    expect(() => resolveDataPaths({ PROJECT_TRACKER_DATA_DIR: 'relative/dir' }, home)).toThrow()
    expect(() => resolveDataPaths({ PROJECT_TRACKER_DATA_DIR: ' ' }, home)).toThrow()
  })

  it('exige un profil Electron isolé en mode test', () => {
    expect(() => resolveUserDataOverride({ PROJECT_TRACKER_TEST: '1' })).toThrow()
    expect(resolveUserDataOverride({})).toBeUndefined()
    const profile = path.join(os.tmpdir(), 'pt-profile')
    expect(resolveUserDataOverride({ PROJECT_TRACKER_USER_DATA_DIR: profile })).toBe(profile)
  })
})
