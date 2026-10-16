import fs from 'fs'
import { finishPendingRestore } from './recovery'
import type { StartupStatus } from '../../shared/commands'
import { AppError } from '../../shared/errors'
import { openDatabase, type Database } from '../db/database'
import { acquireDataLock, type DataLock } from '../db/lock'
import type { DataPaths } from '../helpers/paths'
import { importLegacy, type ImportReport } from '../legacy/importer'
import { CoreService, logDiagnostic } from './service'

export interface CoreRuntime {
  paths: DataPaths
  status: StartupStatus
  service: CoreService | null
  lastReport: ImportReport | null
  close(): void
}

// Starts the native core without running any third-party code. Any failure
// leaves the application in recovery mode: the shell and settings stay usable,
// no business data is served, and the legacy JSON files are never replaced.
export async function startCore(paths: DataPaths, clock: () => Date = () => new Date()): Promise<CoreRuntime> {
  let lock: DataLock | null = null
  let db: Database | null = null
  const runtime: CoreRuntime = {
    paths,
    status: { mode: 'recovery', reason: 'database-error', message: 'Démarrage incomplet.', reportId: null },
    service: null,
    lastReport: null,
    close() {
      db?.close()
      db = null
      lock?.release()
      lock = null
      this.service = null
    },
  }
  try {
    fs.mkdirSync(paths.root, { recursive: true })
    lock = acquireDataLock(paths.lock)
    if (!lock) {
      runtime.status = { mode: 'recovery', reason: 'locked', message: 'Les données sont déjà utilisées par une autre instance de l’application.', reportId: null }
      return runtime
    }
    finishPendingRestore(paths)
    try {
      db = await openDatabase(paths.database, { backupDir: paths.backups, now: clock })
    } catch (error) {
      const newer = error instanceof AppError && error.code === 'INCOMPATIBLE'
      runtime.status = {
        mode: 'recovery',
        reason: newer ? 'schema-newer' : 'database-error',
        message: newer ? 'Ces données ont été créées par une version plus récente de l’application. Elles ne seront pas modifiées.' : 'La base de données ne peut pas être ouverte.',
        reportId: null,
      }
      lock.release()
      lock = null
      return runtime
    }
    const imported = importLegacy(db, paths, clock)
    if (!imported.ok) {
      runtime.lastReport = imported.report
      logDiagnostic(db, { level: 'error', scope: 'migration', code: imported.reason, message: imported.report.blocking.map((entry) => `${entry.location}: ${entry.message}`).join(' ; ') || imported.report.failure || 'échec' })
      runtime.status = {
        mode: 'recovery',
        reason: imported.reason,
        message:
          imported.reason === 'legacy-invalid'
            ? 'Les données existantes n’ont pas pu être converties. Elles n’ont pas été modifiées.'
            : 'La migration a échoué et a été annulée. Les données d’origine sont intactes.',
        reportId: imported.report.id,
      }
      return runtime
    }
    if (!imported.skipped) runtime.lastReport = imported.report
    else {
      const stored = db.get<{ report_json: string }>("SELECT report_json FROM migration_reports WHERE kind = 'legacy-json' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1")
      if (stored) runtime.lastReport = JSON.parse(stored.report_json) as ImportReport
    }
    runtime.service = new CoreService(db, clock)
    runtime.status = { mode: 'ready', migratedThisLaunch: !imported.skipped, reportId: imported.skipped ? null : imported.report.id }
    return runtime
  } catch (error) {
    runtime.status = { mode: 'recovery', reason: 'database-error', message: error instanceof Error ? error.message : 'Erreur inconnue', reportId: null }
    return runtime
  }
}
