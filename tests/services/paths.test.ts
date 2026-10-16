import os from 'node:os'
import fs from 'node:fs'
import { makeTempDir } from './helpers'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDataDir, resolveDataPaths, resolveUserDataOverride } from '../../main/helpers/paths'

describe('résolveur de chemins', () => {
  const home = path.join(os.tmpdir(), 'pt-fake-home')

  it('utilise le répertoire historique hors test', () => {
    const paths = resolveDataPaths({}, home)
    expect(paths.root).toBe(path.join(home, '.data', 'ProjectTracker'))
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
