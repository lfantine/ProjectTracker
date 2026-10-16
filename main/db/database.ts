import fs from 'fs'
import path from 'path'
import { DatabaseSync, backup } from 'node:sqlite'
import { AppError } from '../../shared/errors'
import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS, type SchemaMigration } from './schema'

// SQLite is the source of truth and is only ever opened by the main process.
// Every access goes through prepared statements; there is no API for running
// arbitrary SQL coming from the renderer or a package.

export type SqlValue = null | number | bigint | string | Uint8Array

export class Database {
  readonly db: DatabaseSync
  readonly file: string
  private depth = 0

  constructor(file: string) {
    this.file = file
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    if (file !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = NORMAL')
    }
  }

  get userVersion(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  run(sql: string, ...params: SqlValue[]) {
    return this.db.prepare(sql).run(...params)
  }

  // Synchronous transaction: nothing asynchronous (network, third-party code)
  // can be awaited inside. Nested calls use savepoints.
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`
    this.db.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    const previousDepth = this.depth
    this.depth++
    try {
      const result = fn()
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('Une transaction SQLite ne peut pas attendre une opération asynchrone')
      }
      this.db.exec(previousDepth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
      return result
    } catch (error) {
      if (previousDepth === 0) this.db.exec('ROLLBACK')
      else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      throw error
    } finally {
      this.depth = previousDepth
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0
  }

  // Consistent copy through the SQLite backup API (safe with WAL, unlike a
  // file copy of the main database file).
  async backupTo(target: string): Promise<void> {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await backup(this.db, target)
  }

  close() {
    if (this.db.isOpen) this.db.close()
  }
}

export interface OpenOptions {
  // Directory receiving the automatic backup made before a schema upgrade.
  backupDir?: string
  migrations?: SchemaMigration[]
  now?: () => Date
}

export function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

// Opens the database, refuses a schema newer than this application, backs the
// database up before upgrading an existing schema, then applies the pending
// migrations one transaction at a time.
export async function openDatabase(file: string, options: OpenOptions = {}): Promise<Database> {
  const migrations = options.migrations ?? SCHEMA_MIGRATIONS
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const database = new Database(file)
  try {
    const current = database.userVersion
    if (current > latest) {
      throw new AppError('INCOMPATIBLE', 'La base de données a été créée par une version plus récente de l’application.', { schemaVersion: current, supported: latest })
    }
    const pending = migrations.filter((migration) => migration.version > current)
    if (pending.length && current > 0 && options.backupDir) {
      const now = options.now?.() ?? new Date()
      await database.backupTo(path.join(options.backupDir, `before-schema-${current}-to-${latest}-${timestampForFile(now)}.sqlite`))
    }
    for (const migration of pending) {
      database.transaction(() => {
        database.db.exec(migration.sql)
        database.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', migration.version, migration.name, (options.now?.() ?? new Date()).toISOString())
        database.db.exec(`PRAGMA user_version = ${migration.version}`)
      })
    }
    const violations = database.all<Record<string, unknown>>('PRAGMA foreign_key_check')
    if (violations.length) throw new AppError('STORAGE', 'Contraintes relationnelles non respectées dans la base.', { violations: violations.length })
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export { LATEST_SCHEMA_VERSION }
