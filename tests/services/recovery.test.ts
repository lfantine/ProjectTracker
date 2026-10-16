import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { startQualifiedCore } from '../../main/core/qualification'
import { startCore } from '../../main/core/startup'
import { createBackup, buildExport } from '../../main/core/backup'
import { restoreRecoveryBackup } from '../../main/core/recovery'
import { openDatabase } from '../../main/db/database'
import { defaultDataDir, legacyDataDir, resolveDataPaths } from '../../main/helpers/paths'
import { fixturesDir, makeTempDir, testEnv } from './helpers'

function pathsFor(fixture?: string) {
  const paths = resolveDataPaths(testEnv(makeTempDir('pt-recovery-')))
  if (fixture) fs.copyFileSync(path.join(fixturesDir, 'legacy', fixture, 'data.json'), paths.legacyData)
  return paths
}

describe('sauvegarde et récupération du socle natif', () => {
  it('bloque la migration personnelle avant qualification sans ouvrir ni créer de données', async () => {
    // The guarded branch never reads the personal directory.
    for (const root of [defaultDataDir(), legacyDataDir()]) {
      const paths = { ...pathsFor(), root }
      const runtime = await startQualifiedCore(paths)
      expect(runtime.status).toMatchObject({ mode: 'recovery', reason: 'migration-not-qualified' })
      expect(runtime.service).toBeNull()
      expect(fs.existsSync(paths.database)).toBe(false)
      runtime.close()
    }
  })

  it('restaure une sauvegarde SQLite cohérente, avec préférences, semaines et composition', async () => {
    const paths = pathsFor('full-current')
    const runtime = await startCore(paths)
    expect(runtime.status.mode).toBe('ready')
    const service = runtime.service!
    expect(service.execute('preferences.update', { patch: { themeMode: 'dark' } }).ok).toBe(true)
    const before = buildExport(service.db, new Date('2026-10-15T10:00:00Z'))
    const saved = await createBackup(service.db, paths)
    runtime.close()
    // Exercise the actual native validator/journal, not a manual SQLite copy.
    const restoredPaths = pathsFor()
    await restoreRecoveryBackup(restoredPaths, saved.directory)
    const restored = await startCore(restoredPaths)
    expect(restored.status).toMatchObject({ mode: 'ready', migratedThisLaunch: false })
    expect(buildExport(restored.service!.db, new Date('2026-10-15T10:00:00Z'))).toEqual(before)
    restored.close()
  })

  it('reprend après correction d’un JSON invalide sans écraser l’original', async () => {
    const paths = pathsFor('invalid-json')
    const original = fs.readFileSync(paths.legacyData, 'utf8')
    const failed = await startCore(paths)
    expect(failed.status).toMatchObject({ mode: 'recovery', reason: 'legacy-invalid' })
    expect(failed.service).toBeNull()
    expect(fs.readFileSync(paths.legacyData, 'utf8')).toBe(original)
    failed.close()
    fs.copyFileSync(path.join(fixturesDir, 'legacy', 'full-current', 'data.json'), paths.legacyData)
    const retried = await startCore(paths)
    expect(retried.status.mode).toBe('ready')
    expect(retried.service!.snapshot().data.projects).toHaveLength(3)
    retried.close()
  })

  it('refuse un second propriétaire sans modifier les données', async () => {
    const paths = pathsFor('full-current')
    const first = await startCore(paths)
    const before = first.service!.snapshot()
    const second = await startCore(paths)
    expect(second.status).toMatchObject({ mode: 'recovery', reason: 'locked' })
    expect(second.service).toBeNull()
    second.close()
    expect(first.service!.snapshot()).toEqual(before)
    first.close()
    const next = await startCore(paths)
    expect(next.status.mode).toBe('ready')
    next.close()
  })

  it('conserve une base plus récente et libère son verrou', async () => {
    const paths = pathsFor()
    const db = await openDatabase(paths.database)
    db.db.exec('PRAGMA user_version = 99')
    db.close()
    const runtime = await startCore(paths)
    expect(runtime.status).toMatchObject({ mode: 'recovery', reason: 'schema-newer' })
    expect(fs.existsSync(paths.lock)).toBe(false)
    runtime.close()
  })

  it('reste utilisable après un échec au commit d’une transaction', async () => {
    const paths = pathsFor()
    const db = await openDatabase(paths.database)
    db.db.exec('CREATE TABLE parent_test (id INTEGER PRIMARY KEY); CREATE TABLE child_test (parent_id INTEGER REFERENCES parent_test(id) DEFERRABLE INITIALLY DEFERRED)')
    expect(() => db.transaction(() => db.run('INSERT INTO child_test VALUES (42)'))).toThrow()
    expect(db.inTransaction).toBe(false)
    db.transaction(() => db.run('INSERT INTO parent_test VALUES (42)'))
    expect(db.get('SELECT id FROM parent_test')).toEqual({ id: 42 })
    expect(db.all('SELECT * FROM child_test')).toEqual([])
    db.close()
  })
})
