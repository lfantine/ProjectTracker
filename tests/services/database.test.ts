import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { acquireDataLock } from '../../main/db/lock'
import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from '../../main/db/schema'
import { makeTempDir } from './helpers'

const EXPECTED_TABLES = [
  // technical
  'schema_migrations', 'data_revision', 'import_markers', 'migration_reports', 'unresolved_refs', 'legacy_archive', 'operations', 'diagnostics',
  // core content
  'categories', 'platforms', 'folders', 'projects', 'project_platforms', 'project_tags', 'project_stack', 'tasks', 'checklist_items',
  'deadlines', 'project_links', 'project_blocks', 'notes', 'note_tags', 'project_notes', 'trashed_notes', 'trashed_note_links',
  'errors', 'project_errors', 'error_projects',
  // installations
  'packages', 'package_versions', 'package_dependencies', 'install_journal', 'package_sources', 'theme_selection',
  // third-party instances
  'major_instances', 'active_instances', 'package_documents',
  // composition and preferences
  'dashboards', 'dashboard_widgets', 'sidebar_entries', 'settings', 'preferences',
]

describe('schéma SQLite', () => {
  it('crée l’inventaire complet avec clés étrangères et WAL', async () => {
    const file = path.join(makeTempDir(), 'tracker.sqlite')
    const db = await openDatabase(file)
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((row) => row.name)
    expect(tables.sort()).toEqual([...EXPECTED_TABLES].sort())
    expect(db.userVersion).toBe(LATEST_SCHEMA_VERSION)
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1)
    expect(db.get<{ journal_mode: string }>('PRAGMA journal_mode')?.journal_mode).toBe('wal')
    db.close()
  })

  it('n’applique pas deux fois les migrations', async () => {
    const file = path.join(makeTempDir(), 'tracker.sqlite')
    ;(await openDatabase(file)).close()
    const db = await openDatabase(file)
    expect(db.all('SELECT * FROM schema_migrations')).toHaveLength(SCHEMA_MIGRATIONS.length)
    db.close()
  })

  it('refuse un schéma plus récent que l’application', async () => {
    const file = path.join(makeTempDir(), 'tracker.sqlite')
    ;(await openDatabase(file)).close()
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 99')
    raw.close()
    await expect(openDatabase(file)).rejects.toMatchObject({ code: 'INCOMPATIBLE' })
  })

  it('sauvegarde avant une montée de schéma et annule une migration défaillante', async () => {
    const dir = makeTempDir()
    const file = path.join(dir, 'tracker.sqlite')
    const backups = path.join(dir, 'backups')
    const first = [{ version: 1, name: 'one', sql: 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT); CREATE TABLE a (x TEXT); INSERT INTO a VALUES (\'kept\');' }]
    ;(await openDatabase(file, { migrations: first })).close()
    const broken = [...first, { version: 2, name: 'broken', sql: 'CREATE TABLE b (y TEXT); INSERT INTO missing_table VALUES (1);' }]
    await expect(openDatabase(file, { migrations: broken, backupDir: backups })).rejects.toThrow()
    const backupFiles = fs.readdirSync(backups)
    expect(backupFiles).toHaveLength(1)
    const copy = new DatabaseSync(path.join(backups, backupFiles[0]), { readOnly: true })
    expect(copy.prepare('SELECT x FROM a').get()).toEqual({ x: 'kept' })
    copy.close()
    const db = await openDatabase(file, { migrations: first })
    expect(db.userVersion).toBe(1)
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 'b'")).toEqual([])
    db.close()
  })

  it('refuse d’attendre une opération asynchrone dans une transaction', async () => {
    const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
    expect(() => db.transaction(() => Promise.resolve(1))).toThrow(/asynchrone/)
    expect(db.inTransaction).toBe(false)
    db.close()
  })

  it('annule une transaction imbriquée sans perdre la transaction englobante', async () => {
    const db = await openDatabase(path.join(makeTempDir(), 'tracker.sqlite'))
    db.transaction(() => {
      db.run('INSERT INTO categories (name, position) VALUES (?, ?)', 'A', 0)
      expect(() => db.transaction(() => {
        db.run('INSERT INTO categories (name, position) VALUES (?, ?)', 'B', 1)
        throw new Error('stop')
      })).toThrow('stop')
    })
    expect(db.all<{ name: string }>('SELECT name FROM categories').map((row) => row.name)).toEqual(['A'])
    db.close()
  })
})

describe('verrou du répertoire de données', () => {
  it('ne vole pas un verrou dont le propriétaire est encore en cours d’écriture', () => {
    const file = path.join(makeTempDir(), 'tracker.lock')
    fs.writeFileSync(file, '')
    expect(acquireDataLock(file)).toBeNull()
    expect(fs.readFileSync(file, 'utf8')).toBe('')
  })

  it('empêche une seconde prise et récupère un verrou abandonné', () => {
    const lockFile = path.join(makeTempDir(), 'tracker.lock')
    const lock = acquireDataLock(lockFile)
    expect(lock).not.toBeNull()
    expect(acquireDataLock(lockFile)).toBeNull()
    lock!.release()
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 2 ** 22 + 12345 }))
    const recovered = acquireDataLock(lockFile)
    expect(recovered).not.toBeNull()
    recovered!.release()
    expect(fs.existsSync(lockFile)).toBe(false)
  })
})
