import { isNativeCommandName, type AppSnapshot, type CommandResponse, type DataChange } from '../../shared/commands'
import { AppError, type ErrorPayload } from '../../shared/errors'
import { WEEK_MAJOR } from '../../shared/core'
import type { Database } from '../db/database'
import { COMMAND_SCHEMAS } from './commandSchemas'
import { checkCommandRevision, collectChanges, HANDLERS, makeUid, readPreferences, readSettings, PREFERENCES_MARKER, Touched, type CommandContext } from './commands'
import { buildAppData, currentRevision } from './readModel'

export type ChangeListener = (changes: DataChange[], revision: number) => void

const UNIQUE_TABLES: Record<string, string[]> = {
  p: ['SELECT 1 FROM projects WHERE id = ?'],
  n: ['SELECT 1 FROM notes WHERE id = ?', 'SELECT 1 FROM trashed_notes WHERE note_id = ?'],
  e: ['SELECT 1 FROM errors WHERE id = ?'],
  f: ['SELECT 1 FROM folders WHERE id = ?'],
  'week-preset': [`SELECT 1 FROM major_instances WHERE package_id = '${WEEK_MAJOR.packageId}' AND instance_id = ?`],
}

export function logDiagnostic(db: Database, entry: { level: 'info' | 'warn' | 'error'; scope: string; code: string; message: string; packageId?: string; version?: string; step?: string }) {
  try {
    db.run(
      'INSERT INTO diagnostics (at, level, scope, code, package_id, version, step, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      new Date().toISOString(), entry.level, entry.scope, entry.code, entry.packageId ?? null, entry.version ?? null, entry.step ?? null, entry.message.slice(0, 500)
    )
  } catch {
    // Diagnostics must never break the caller.
  }
}

// Owns the database connection of the native core. Writes are serialised by
// construction: commands are synchronous and run one at a time on the main
// process thread; events are emitted only after the commit.
export class CoreService {
  private listeners = new Set<ChangeListener>()

  constructor(readonly db: Database, private readonly clock: () => Date = () => new Date()) {}

  snapshot(): AppSnapshot {
    return {
      data: buildAppData(this.db),
      settings: readSettings(this.db),
      preferences: readPreferences(this.db),
      preferencesAdopted: !!this.db.get('SELECT 1 AS present FROM import_markers WHERE kind = ?', PREFERENCES_MARKER),
      revision: currentRevision(this.db),
    }
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  execute(name: unknown, params: unknown): CommandResponse<unknown> {
    if (!isNativeCommandName(name)) return { ok: false, error: { code: 'VALIDATION', message: 'Commande inconnue.' } }
    const parsed = COMMAND_SCHEMAS[name].safeParse(params ?? {})
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: 'Paramètres invalides.', details: { issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`) } },
      }
    }
    const input = parsed.data as Record<string, unknown>
    const operationId = typeof input.operationId === 'string' ? input.operationId : null
    if (operationId) {
      const previous = this.db.get<{ command: string; result_json: string }>('SELECT command, result_json FROM operations WHERE operation_id = ?', operationId)
      if (previous) {
        if (previous.command !== name) return { ok: false, error: { code: 'CONFLICT', message: 'Identifiant d’opération déjà utilisé.' } }
        return { ok: true, value: JSON.parse(previous.result_json), changes: [], revision: currentRevision(this.db) }
      }
    }
    const date = this.clock()
    const touched = new Touched()
    const ctx: CommandContext = {
      db: this.db,
      now: date.toISOString(),
      today: date.toISOString().slice(0, 10),
      touched,
      uid: (prefix) => makeUid(this.db, prefix, (id) => (UNIQUE_TABLES[prefix] ?? []).some((sql) => !!this.db.get(sql, id))),
    }
    let value: unknown
    let changes: DataChange[]
    let revision: number
    try {
      ;({ value, changes, revision } = this.db.transaction(() => {
        checkCommandRevision(this.db, name, input)
        const result = (HANDLERS[name] as (context: CommandContext, params: unknown) => unknown)(ctx, input)
        if (operationId) this.db.run('INSERT INTO operations (operation_id, command, result_json, created_at) VALUES (?, ?, ?, ?)', operationId, name, JSON.stringify(result ?? null), ctx.now)
        const collected = collectChanges(this.db, touched)
        if (collected.length) this.db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
        return { value: result, changes: collected, revision: currentRevision(this.db) }
      }))
    } catch (error) {
      return { ok: false, error: this.toPayload(error, name) }
    }
    if (changes.length) {
      for (const listener of this.listeners) {
        try {
          listener(changes, revision)
        } catch {
          // A failing listener does not affect the committed write.
        }
      }
    }
    return { ok: true, value: value ?? null, changes, revision }
  }

  // Trusted synchronous package writes share the CORE revision clock, but no
  // private documents are placed in the shell's DataChange stream. An empty
  // change list still advances the confirmed shell revision after commit.
  // Only native adapters may add public CORE changes (e.g. a project block's
  // configuration), never private package documents.
  commitPackageWrite<T>(write: () => { value: T; changed: boolean; changes?: DataChange[] }): { value: T; revision: number } {
    const result = this.db.transaction(() => {
      const { value, changed, changes = [] } = write()
      if (changed) this.db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
      return { value, changed, changes, revision: currentRevision(this.db) }
    })
    if (result.changed) for (const listener of this.listeners) { try { listener(result.changes, result.revision) } catch { /* committed write */ } }
    return { value: result.value, revision: result.revision }
  }

  private toPayload(error: unknown, command: string): ErrorPayload {
    if (error instanceof AppError) return error.toPayload()
    logDiagnostic(this.db, { level: 'error', scope: 'command', code: 'STORAGE', step: command, message: error instanceof Error ? error.message : String(error) })
    return { code: 'STORAGE', message: 'L’enregistrement a échoué. Aucune modification n’a été appliquée.' }
  }
}
