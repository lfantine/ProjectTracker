import fs from 'node:fs'
import path from 'node:path'
import type { Database } from '../db/database'
import type { DataPaths } from '../helpers/paths'
import { timestampForFile } from '../db/database'

export function diagnosticSummary(db: Database) {
  return db.all<{ at: string; level: string; scope: string; code: string; package_id: string | null; version: string | null; step: string | null }>(
    'SELECT at, level, scope, code, package_id, version, step FROM diagnostics ORDER BY id DESC LIMIT 200'
  ).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? null : String(value).replace(/[^a-zA-Z0-9_.:+/-]/g, '').slice(0, 100)])))
}
export function exportDiagnostics(db: Database, paths: DataPaths) {
  fs.mkdirSync(paths.logs, { recursive: true })
  const name = `diagnostics-${timestampForFile(new Date())}.json`
  fs.writeFileSync(path.join(paths.logs, name), JSON.stringify({ format: 'amber-diagnostics', version: 1, entries: diagnosticSummary(db) }, null, 2), { flag: 'wx', mode: 0o600 })
  return { name }
}
