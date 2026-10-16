import { buildLegacyAppData } from '../../main/core/readModel'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../main/db/database'
import { resolveDataPaths } from '../../main/helpers/paths'
import { buildAppData } from '../../main/core/readModel'
import { CoreService } from '../../main/core/service'
import { importLegacy } from '../../main/legacy/importer'
import { NativeBatch } from '../../renderer/lib/nativeBatch'
import { removeNoteFromData, restoreNoteFromData } from '../../renderer/lib/noteOperations'
import type { AppData } from '../../shared/domain'
import { fixturesDir, makeTempDir, testEnv } from './helpers'

let clockValue = new Date('2026-10-15T12:00:00.000Z')
const clock = () => clockValue

async function service(fixture: string | null = 'full-current') {
  const dataDir = makeTempDir('pt-cmd-')
  if (fixture) {
    for (const file of ['data.json', 'settings.json']) {
      const source = path.join(fixturesDir, 'legacy', fixture, file)
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataDir, file))
    }
  }
  const paths = resolveDataPaths(testEnv(dataDir))
  const db = await openDatabase(paths.database)
  expect(importLegacy(db, paths, clock).ok).toBe(true)
  return new CoreService(db, clock)
}

function run<T = any>(core: CoreService, name: string, params: unknown): T {
  const result = core.execute(name, params)
  if (!result.ok) throw new Error(`${name}: ${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details ?? {})}`)
  return result.value as T
}

// Revisions are a persistence detail absent from the former in-memory model.
function strip(data: AppData): AppData {
  return JSON.parse(JSON.stringify(data, (key, value) => (key === 'revision' ? undefined : value)))
}

describe('commandes natives', () => {
  it('refuse une commande inconnue ou des paramètres invalides', async () => {
    const core = await service()
    expect(core.execute('sql.exec', { sql: 'DROP TABLE projects' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(core.execute('projects.update', { id: 'p_alpha', patch: { name: 42 } })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(core.execute('projects.update', { id: 'p_alpha', patch: { revision: 1 } })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('crée un projet une seule fois pour un même identifiant d’opération', async () => {
    const core = await service()
    const input = { name: "L'atelier \"quoté\"", type: 'dev', category: 'Software', platforms: ['PC'] }
    const first = run(core, 'projects.create', { input, operationId: 'op-create-1' })
    const again = run(core, 'projects.create', { input, operationId: 'op-create-1' })
    expect(again.id).toBe(first.id)
    const data = core.snapshot().data
    expect(data.projects.filter((project) => project.name === input.name)).toHaveLength(1)
    expect(first).toMatchObject({ status: 'actif', description: '', stack: [], path: '', layout: [{ id: 'mod_tasks', type: 'tasks' }, { id: 'mod_deadlines', type: 'deadlines' }] })
  })

  it('refuse une écriture fondée sur une révision périmée', async () => {
    const core = await service()
    const project = core.snapshot().data.projects[0]
    run(core, 'projects.update', { id: project.id, patch: { description: 'A' }, expectedRevision: project.revision })
    const stale = core.execute('projects.update', { id: project.id, patch: { description: 'B' }, expectedRevision: project.revision })
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(core.snapshot().data.projects[0].description).toBe('A')
  })

  it('n’émet des changements qu’après validation', async () => {
    const core = await service()
    const events: unknown[] = []
    core.onChange((changes) => events.push(changes))
    core.execute('tasks.add', { projectId: 'p_alpha', name: 'X', parentId: 'nope' })
    expect(events).toHaveLength(0)
    run(core, 'tasks.add', { projectId: 'p_alpha', name: 'X' })
    expect(events).toHaveLength(1)
  })

  it('maintient les statuts de l’arbre de tâches', async () => {
    const core = await service()
    const parent = run(core, 'tasks.add', { projectId: 'p_beta', name: 'Parent' })
    const child = run(core, 'tasks.add', { projectId: 'p_beta', name: 'Enfant', parentId: parent.id })
    run(core, 'tasks.cycleStatus', { projectId: 'p_beta', taskId: child.id })
    run(core, 'tasks.cycleStatus', { projectId: 'p_beta', taskId: child.id })
    let beta = core.snapshot().data.projects.find((project) => project.id === 'p_beta')!
    expect(beta.tasks[0]).toMatchObject({ status: 'fait', children: [{ status: 'fait' }] })
    const sibling = run(core, 'tasks.add', { projectId: 'p_beta', name: 'Frère' })
    expect(run(core, 'tasks.move', { projectId: 'p_beta', draggedId: sibling.id, targetId: parent.id, position: 'inside' })).toEqual({ moved: true })
    expect(run(core, 'tasks.move', { projectId: 'p_beta', draggedId: parent.id, targetId: sibling.id, position: 'inside' })).toEqual({ moved: false })
    beta = core.snapshot().data.projects.find((project) => project.id === 'p_beta')!
    expect(beta.tasks[0].status).toBe('en_cours')
    expect(beta.tasks[0].children.map((task) => task.name)).toEqual(['Enfant', 'Frère'])
    run(core, 'tasks.remove', { projectId: 'p_beta', taskId: parent.id })
    expect(core.snapshot().data.projects.find((project) => project.id === 'p_beta')!.tasks).toEqual([])
  })

  it('reproduit exactement la suppression et la restauration de note', async () => {
    const core = await service()
    const before = strip(core.snapshot().data)
    const trashed = run(core, 'notes.trash', { id: 'n_spec' })
    const expected = removeNoteFromData(before, 'n_spec')
    const after = strip(core.snapshot().data)
    expect(after.notes).toEqual(expected.notes)
    expect(after.projects.map((project) => [project.noteIds, project.layout])).toEqual(expected.projects.map((project) => [project.noteIds, project.layout]))
    expect(after.trashedNotes!.map(({ deletedAt: _d, ...entry }) => entry)).toEqual(expected.trashedNotes!.map(({ deletedAt: _d, ...entry }) => entry))
    expect(trashed.links.map((link: { projectId: string }) => link.projectId)).toEqual(['p_alpha', 'p_beta'])

    const restored = run(core, 'notes.restore', { id: 'n_spec' })
    expect(restored.title).toBe('Spécification')
    const expectedRestore = restoreNoteFromData(after, 'n_spec')
    const final = strip(core.snapshot().data)
    expect(final.projects.map((project) => [project.noteIds, project.layout])).toEqual(expectedRestore.projects.map((project) => [project.noteIds, project.layout]))
    expect(final.trashedNotes).toEqual(expectedRestore.trashedNotes)
    // Restoring a note whose former project disappeared still works.
    expect(run(core, 'notes.restore', { id: 'n_old' }).id).toBe('n_old')
    expect(core.snapshot().data.projects[0].layout.some((module) => module.id === 'mod_note_old')).toBe(true)
  })

  it('trace les relations retirées avec un projet supprimé', async () => {
    const core = await service()
    run(core, 'projects.delete', { id: 'p_beta' })
    const data = core.snapshot().data
    expect(data.projects.map((project) => project.id)).toEqual(['p_alpha', 'p_gamma'])
    expect(data.projects[0].checklist.find((item) => item.id === 'c_3')!.projectRef).toBeUndefined()
    const refs = core.db.all<{ source_id: string; reason: string }>("SELECT source_id, reason FROM unresolved_refs WHERE target_id = 'p_beta'")
    expect(refs).toEqual([{ source_id: 'c_3', reason: 'deleted' }])
  })

  it('relie les erreurs dans les deux sens comme avant', async () => {
    const core = await service()
    const error = run(core, 'errors.create', { input: { title: 'Nouvelle', content: '', causes: '', solution: '', projectIds: ['p_beta'] }, operationId: 'op-error-1' })
    let data = core.snapshot().data
    expect(data.projects.find((project) => project.id === 'p_beta')!.errorIds).toEqual([error.id])
    run(core, 'projects.unlinkError', { projectId: 'p_beta', errorId: error.id })
    data = core.snapshot().data
    expect(data.projects.find((project) => project.id === 'p_beta')!.errorIds).toEqual([])
    // Unpinning keeps the error-side history, as the former store did.
    expect(data.errors.find((entry) => entry.id === error.id)!.projectIds).toEqual(['p_beta'])
    run(core, 'errors.delete', { id: error.id })
    expect(core.snapshot().data.errors.some((entry) => entry.id === error.id)).toBe(false)
  })

  it('conserve les valeurs textuelles et la configuration des blocs', async () => {
    const core = await service()
    run(core, 'blocks.update', { projectId: 'p_alpha', blockId: 'mod_chart', patch: { chart: { kind: 'bar', points: [{ id: 'a', label: 'x', value: '-' }, { id: 'b', label: 'y', value: '3,' }] } } })
    const chart = core.snapshot().data.projects[0].layout.find((module) => module.id === 'mod_chart')!
    expect(chart).toMatchObject({ title: 'Vitesse', chart: { kind: 'bar', points: [{ value: '-' }, { value: '3,' }] } })
    const layout = run(core, 'blocks.toggleNote', { projectId: 'p_beta', noteId: 'n_spec' })
    expect(layout.map((module: { id: string }) => module.id)).toEqual(['mod_tasks'])
    run(core, 'blocks.setLayout', { projectId: 'p_beta', layout: [] })
    expect(core.snapshot().data.projects.find((project) => project.id === 'p_beta')!.layout).toEqual([])
  })

  it('calcule le statut des échéances et la checklist comme avant', async () => {
    const core = await service()
    const late = run(core, 'deadlines.add', { projectId: 'p_beta', label: 'Passée', date: '2026-10-14' })
    const today = run(core, 'deadlines.add', { projectId: 'p_beta', label: 'Aujourd’hui', date: '2026-10-15' })
    expect([late.status, today.status]).toEqual(['depasse', 'a_venir'])
    expect(run(core, 'deadlines.toggleDone', { projectId: 'p_beta', deadlineId: late.id }).status).toBe('fait')
    expect(run(core, 'deadlines.toggleDone', { projectId: 'p_beta', deadlineId: late.id }).status).toBe('depasse')
    const item = run(core, 'checklist.add', { projectId: 'p_beta', item: { label: 'Câble', type: 'materiel' } })
    expect(item.status).toBe('a_acheter')
    expect(run(core, 'checklist.cycleStatus', { projectId: 'p_beta', itemId: item.id }).status).toBe('commande')
  })

  it('gère les semaines dans l’espace de builtin.week', async () => {
    const core = await service()
    const created = run(core, 'week.create', { name: 'Examens', copy: true, operationId: 'op-week-1' })
    const exam = created.weekPresets.find((preset: { name: string }) => preset.name === 'Examens')
    expect(created.activeWeekPresetId).toBe(exam.id)
    expect(exam.slots.map((slot: { id: string }) => slot.id)).toEqual(['s_1', 's_2'])
    expect(core.execute('week.rename', { name: 'vacances' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const overlap = core.execute('week.setSlots', { slots: [{ id: 'a', title: 'A', day: 0, start: '08:00', end: '10:00' }, { id: 'b', title: 'B', day: 0, start: '09:00', end: '11:00' }] })
    expect(overlap).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(buildLegacyAppData(core.db).weekSlots!.map((slot) => slot.id)).toEqual(['s_1', 's_2'])
    const rows = core.db.all<{ package_id: string }>('SELECT DISTINCT package_id FROM package_documents')
    expect(rows).toEqual([{ package_id: 'builtin.week' }])
  })

  it('convertit les dossiers repliés au format objet et préserve les réglages SQLite existants', async () => {
    const core = await service()
    run(core, 'preferences.update', { patch: { themeMode: 'light' } })
    const adopted = run(core, 'preferences.adoptLegacy', { values: { tracker_theme_mode: 'dark', tracker_collapsed_category_folders: JSON.stringify({ f_manual: true, Hardware: false }) } })
    expect(adopted.preferences).toMatchObject({ themeMode: 'light', collapsedCategoryFolders: ['f_manual'] })
  })

  it('refuse une mutation de bloc sur un projet périmé et une préférence sur un snapshot périmé', async () => {
    const core = await service()
    const before = core.snapshot()
    const project = before.data.projects[0]
    run(core, 'tasks.add', { projectId: project.id, name: 'Changement concurrent' })
    expect(core.execute('blocks.setLayout', { projectId: project.id, layout: [], expectedRevision: project.revision })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(core.execute('preferences.update', { patch: { themeMode: 'dark' }, expectedRevision: before.revision })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(core.snapshot().data.projects[0].layout.length).toBeGreaterThan(0)
  })

  it('applique une proposition composée en une transaction, puis la rejoue sans doublons', async () => {
    const core = await service()
    const events: unknown[] = []
    core.onChange((changes) => events.push(changes))
    const batch = new NativeBatch()
    const note = batch.add('notes.create', { input: { title: 'Proposition IA', content: 'Texte', tags: [] }, operationId: 'batch-note' })
    batch.add('notes.update', { id: note.id, patch: { raw: true } })
    batch.add('projects.linkNote', { projectId: 'p_alpha', noteId: note.id })
    batch.add('blocks.add', { projectId: 'p_alpha', block: { id: 'ai-note', type: 'note', refId: note.id } })
    const input = { steps: batch.steps, operationId: 'batch-valid' }
    const results = run<any[]>(core, 'core.batch', input)
    const created = results[0] as { id: string }
    expect(core.snapshot().data.projects[0].noteIds).toContain(created.id)
    expect(core.snapshot().data.projects[0].layout.find((module) => module.id === 'ai-note')?.refId).toBe(created.id)
    expect(core.snapshot().data.notes.find((entry) => entry.id === created.id)?.raw).toBe(true)
    expect(events).toHaveLength(1)
    expect(run(core, 'core.batch', input)).toEqual(results)
    expect(events).toHaveLength(1)
  })

  it('annule toute la proposition si une étape échoue, puis permet une reprise sans doublons', async () => {
    const core = await service()
    const before = core.snapshot()
    const events: unknown[] = []
    core.onChange((changes) => events.push(changes))
    const batch = new NativeBatch()
    const note = batch.add('notes.create', { input: { title: 'À conserver en brouillon', content: '', tags: [] }, operationId: 'batch-failed-note' })
    batch.add('projects.linkNote', { projectId: 'inexistant', noteId: note.id })
    expect(core.execute('core.batch', { steps: batch.steps, operationId: 'batch-retry' })).toMatchObject({ ok: false })
    expect(core.snapshot()).toEqual(before)
    expect(events).toHaveLength(0)
    batch.steps[1].params.projectId = 'p_alpha'
    run(core, 'core.batch', { steps: batch.steps, operationId: 'batch-retry' })
    expect(core.snapshot().data.notes.filter((entry) => entry.title === 'À conserver en brouillon')).toHaveLength(1)
    expect(events).toHaveLength(1)
  })

  it('compare toutes les révisions d’une proposition avant d’appliquer ses étapes', async () => {
    const core = await service()
    const project = core.snapshot().data.projects[0]
    run(core, 'core.batch', { operationId: 'batch-revisions', steps: [
      { name: 'projects.update', params: { id: project.id, patch: { description: 'Première étape' }, expectedRevision: project.revision } },
      { name: 'projects.update', params: { id: project.id, patch: { name: 'Deuxième étape' }, expectedRevision: project.revision } },
    ] })
    expect(core.snapshot().data.projects[0]).toMatchObject({ description: 'Première étape', name: 'Deuxième étape' })
  })

  it('adopte les préférences locales une seule fois', async () => {
    const core = await service()
    const values = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'legacy', 'full-current', 'renderer-prefs.json'), 'utf8'))
    const first = run(core, 'preferences.adoptLegacy', { values })
    expect(first).toEqual({
      adopted: true,
      preferences: { themeMode: 'dark', sidebarCollapsed: true, collapsedCategoryFolders: ['Hardware', 'f_manual'], pinnedTabs: [{ projectId: 'p_alpha', pinned: true }, { projectId: 'p_deleted', pinned: true }], activeTabId: 'p_alpha' },
    })
    run(core, 'preferences.update', { patch: { themeMode: 'light' } })
    const second = run(core, 'preferences.adoptLegacy', { values })
    expect(second.adopted).toBe(false)
    expect(second.preferences.themeMode).toBe('light')
    expect(core.snapshot().preferencesAdopted).toBe(true)
  })

  it('persiste après réouverture de la base', async () => {
    const dataDir = makeTempDir('pt-cmd-')
    fs.copyFileSync(path.join(fixturesDir, 'legacy', 'full-current', 'data.json'), path.join(dataDir, 'data.json'))
    const paths = resolveDataPaths(testEnv(dataDir))
    const db = await openDatabase(paths.database)
    importLegacy(db, paths, clock)
    const core = new CoreService(db, clock)
    run(core, 'notes.update', { id: 'n_raw', patch: { content: 'modifié' } })
    const snapshot = JSON.stringify(buildAppData(db))
    db.close()
    const reopened = await openDatabase(paths.database)
    expect(JSON.stringify(buildAppData(reopened))).toBe(snapshot)
    reopened.close()
  })
})

clockValue = new Date('2026-10-15T12:00:00.000Z')
