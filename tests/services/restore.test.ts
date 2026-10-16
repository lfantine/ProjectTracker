import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { startCore } from '../../main/core/startup'
import { createBackup } from '../../main/core/backup'
import { inventoryRecoveryFiles, restoreRecoveryBackup, validateRecoveryBackup } from '../../main/core/recovery'
import { resolveDataPaths } from '../../main/helpers/paths'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageActivation } from '../../main/packages/activation'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'
import { makeTempDir, testEnv } from './helpers'

const pathsFor = () => resolveDataPaths(testEnv(makeTempDir('amber-restore-')))
async function fixture(withPackage = false) {
  const paths = pathsFor(), runtime = await startCore(paths)
  const db = runtime.service!.db
  runtime.service!.execute('preferences.update', { patch: { themeMode: 'dark' } })
  if (withPackage) {
    await new LocalPackageInstaller(db, paths.packages, async () => true).importArchive(await packageArchive(paths.root))
    await new PackageActivation(db, paths.packages, isolatedActivationHooks(), true).activate('example.boards', '1.0.0')
  }
  const { directory } = await createBackup(db, paths)
  runtime.close()
  return { paths, directory }
}
function reseal(directory: string) {
  const file = path.join(directory, 'backup.json'), metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
  metadata.files = inventoryRecoveryFiles(directory)
  fs.writeFileSync(file, JSON.stringify(metadata))
}

describe('restauration native sans code tiers', () => {
  it('valide le snapshot et les ressources, remplace sans fusion et exige un nouvel accord', async () => {
    const { directory } = await fixture(true), paths = pathsFor()
    const current = await startCore(paths)
    current.service!.execute('preferences.update', { patch: { themeMode: 'light' } })
    current.close()
    await restoreRecoveryBackup(paths, directory)
    const restored = await startCore(paths)
    expect(restored.status.mode).toBe('ready')
    expect(restored.service!.snapshot().preferences.themeMode).toBe('dark')
    expect(restored.service!.db.get('SELECT state, state_reason FROM packages')).toEqual({ state: 'disabled', state_reason: 'restored-requires-consent' })
    expect(fs.readdirSync(paths.root).some(name => name.startsWith('restore-'))).toBe(true)
    restored.close()
    await validateRecoveryBackup(directory)
  })

  it('refuse tant que le runtime détient le verrou', async () => {
    const { directory } = await fixture(), paths = pathsFor(), running = await startCore(paths)
    await expect(restoreRecoveryBackup(paths, directory)).rejects.toThrow('RECOVERY_LOCKED')
    expect(running.service!.snapshot().preferences.themeMode).toBe('system')
    running.close()
  })

  it('refuse contenu altéré, schéma exécutable même réempreinté et liens symboliques', async () => {
    const { directory } = await fixture()
    const database = path.join(directory, 'tracker.sqlite'), original = fs.readFileSync(database)
    fs.appendFileSync(database, 'changed')
    await expect(validateRecoveryBackup(directory)).rejects.toThrow('RECOVERY_CHECKSUM')
    fs.writeFileSync(database, original)
    const db = new DatabaseSync(database)
    db.exec('CREATE TRIGGER unexpected AFTER UPDATE ON preferences BEGIN SELECT 1; END;')
    db.close(); reseal(directory)
    await expect(validateRecoveryBackup(directory)).rejects.toThrow('RECOVERY_SCHEMA')
    fs.writeFileSync(database, original); reseal(directory)
    fs.symlinkSync(database, path.join(directory, 'escape'))
    await expect(validateRecoveryBackup(directory)).rejects.toThrow('RECOVERY_PATH')
  })

  it.each(['journal-committed', 'saved-tracker.sqlite', 'installed-tracker.sqlite', 'saved-packages', 'installed-packages'])('reprend après SIGKILL au point %s', async phase => {
    const { directory } = await fixture(true), paths = pathsFor(), current = await startCore(paths)
    current.close()
    const worker = spawnSync(process.execPath, [path.resolve('tests/fixtures/restore-crash.cjs'), paths.root, directory, phase], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROJECT_TRACKER_TEST: '1' }, encoding: 'utf8', timeout: 15000,
    })
    expect(worker.error, worker.stderr).toBeUndefined()
    expect(worker.signal, worker.stderr).toBe('SIGKILL')
    const restarted = await startCore(paths)
    expect(restarted.status.mode).toBe('ready')
    expect(restarted.service!.snapshot().preferences.themeMode).toBe('dark')
    expect(restarted.service!.db.get('SELECT state FROM packages')).toEqual({ state: 'disabled' })
    expect(fs.existsSync(path.join(paths.root, 'restore-pending.json'))).toBe(false)
    restarted.close()
  }, 20000)
})

describe('diagnostic technique exportable', () => {
  it('ne contient jamais les messages libres ni des documents métier', async () => {
    const { diagnosticSummary, exportDiagnostics } = await import('../../main/core/diagnostics')
    const paths = pathsFor(), runtime = await startCore(paths)
    runtime.service!.db.run("INSERT INTO diagnostics(at, level, scope, code, message) VALUES ('now', 'error', 'storage', 'STORAGE', 'SECRET contenu personnel')")
    expect(JSON.stringify(diagnosticSummary(runtime.service!.db))).not.toContain('SECRET')
    const exported = exportDiagnostics(runtime.service!.db, paths)
    expect(fs.readFileSync(path.join(paths.logs, exported.name), 'utf8')).not.toContain('SECRET')
    runtime.close()
  })
})
