import { readSidebarOrganization } from './sidebarGroups'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { inventoryRecoveryFiles, validateRecoveryDatabase } from './recovery'
import { CORE_VERSION } from '../../shared/version'
import { timestampForFile, type Database } from '../db/database'
import type { DataPaths } from '../helpers/paths'
import { readPreferences, readSettings } from './commands'
import { parseJson } from './json'
import { buildLegacyAppData } from './readModel'

export const EXPORT_FORMAT = 'projecttracker-export'
export const EXPORT_VERSION = 1

function packageInventory(db: Database) {
  return db.all<{ id: string; kind: string; active_version: string | null; state: string; storage_version: number }>('SELECT id, kind, active_version, state, storage_version FROM packages ORDER BY id')
}

// Consistent recovery backup: the database through the SQLite backup API (safe
// with WAL) plus metadata. Managed package files are copied next to it once
// packages are installed. External files linked from projects (images, project
// folders) are not part of the backup.
export async function createBackup(db: Database, paths: DataPaths, label = 'manual', now = new Date()): Promise<{ directory: string }> {
  if (!/^[a-z0-9-]+$/.test(label)) throw Error('BACKUP_LABEL')
  fs.mkdirSync(paths.backups, { recursive: true })
  const directory = path.join(paths.backups, `${label}-${timestampForFile(now)}-${randomUUID()}`)
  const staging = `${directory}.pending`
  fs.mkdirSync(staging)
  try {
    await db.backupTo(path.join(staging, 'tracker.sqlite'))
    if (fs.existsSync(paths.packages)) {
      // Reject symlinks before copying; never include incomplete extraction.
      inventoryRecoveryFiles(paths.packages)
      fs.cpSync(paths.packages, path.join(staging, 'packages'), { recursive: true,
        filter: source => !path.relative(paths.packages, source).split(path.sep).some(part => part.startsWith('.')) })
    }
    await validateRecoveryDatabase(path.join(staging, 'tracker.sqlite'), path.join(staging, 'packages'))
    fs.writeFileSync(path.join(staging, 'backup.json'), JSON.stringify({
      format: 'projecttracker-backup', version: 2, createdAt: now.toISOString(), coreVersion: CORE_VERSION,
      schemaVersion: db.userVersion, files: inventoryRecoveryFiles(staging),
      note: 'Les fichiers externes liés aux projets (images, dossiers) ne sont pas inclus.',
    }, null, 2))
    fs.renameSync(staging, directory)
    return { directory }
  } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error }
}

// Versioned JSON export of the data, usable for recovery. Not an executable
// archive and not a replacement for package files.
export function buildExport(db: Database, now = new Date()) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    coreVersion: CORE_VERSION,
    schemaVersion: db.userVersion,
    data: buildLegacyAppData(db),
    settings: readSettings(db),
    preferences: readPreferences(db),
    composition: {
      sidebarOrganization: readSidebarOrganization(db),
      dashboards: db.all('SELECT * FROM dashboards ORDER BY position'),
      widgets: db.all<{ config_json: string; binding_json: string; layouts_json: string }>('SELECT * FROM dashboard_widgets ORDER BY dashboard_id, position').map((row) => ({
        ...row,
        config_json: undefined,
        binding_json: undefined,
        layouts_json: undefined,
        config: parseJson(row.config_json, {}),
        binding: parseJson(row.binding_json, {}),
        layouts: parseJson(row.layouts_json, {}),
      })),
      sidebar: db.all<{ target_json: string }>('SELECT * FROM sidebar_entries ORDER BY position').map((row) => ({ ...row, target_json: undefined, target: parseJson(row.target_json, {}) })),
    },
    packages: {
      installed: packageInventory(db),
      instances: db.all('SELECT * FROM major_instances ORDER BY package_id, major_id, position'),
      active: db.all('SELECT * FROM active_instances'),
      documents: db.all<{ value_json: string }>('SELECT package_id, instance_scope, collection, doc_id, revision, updated_at, value_json FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id').map((row) => ({ ...row, value_json: undefined, value: parseJson(row.value_json, null) })),
    },
    migrationReports: db.all<{ report_json: string }>('SELECT report_json FROM migration_reports ORDER BY created_at').map((row) => parseJson(row.report_json, null)),
    legacyArchive: db.all<{ value_json: string }>('SELECT report_id, location, reason, value_json FROM legacy_archive ORDER BY id').map(({ value_json, ...row }) => ({ ...row, value: parseJson(value_json, null) })),
    unresolvedReferences: db.all('SELECT source_kind, source_id, source_scope, field, target_kind, target_id, reason, recorded_at FROM unresolved_refs ORDER BY id'),
  }
}

export function writeExport(db: Database, paths: DataPaths, now = new Date()): { file: string } {
  fs.mkdirSync(paths.backups, { recursive: true })
  const file = path.join(paths.backups, `export-${timestampForFile(now)}.json`)
  fs.writeFileSync(file, JSON.stringify(buildExport(db, now), null, 2))
  return { file }
}
