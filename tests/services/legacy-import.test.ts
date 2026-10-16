import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../main/db/database'
import { resolveDataPaths, type DataPaths } from '../../main/helpers/paths'
import { buildLegacyAppData } from '../../main/core/readModel'
import { importLegacy, LEGACY_MARKER } from '../../main/legacy/importer'
import { syncTaskStatuses } from '../../shared/tasks'
import { fixturesDir, makeTempDir, testEnv } from './helpers'

const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function setup(fixture: string | null): Promise<{ db: Database; paths: DataPaths; raw: any }> {
  const dataDir = makeTempDir('pt-import-')
  const paths = resolveDataPaths(testEnv(dataDir))
  let raw: any
  if (fixture) {
    for (const file of ['data.json', 'settings.json']) {
      const source = path.join(fixturesDir, 'legacy', fixture, file)
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dataDir, file))
    }
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'))
    } catch {
      raw = undefined
    }
  }
  const db = await openDatabase(paths.database)
  return { db, paths, raw }
}

const fixedClock = () => new Date('2026-10-15T12:00:00.000Z')
const count = (db: Database, table: string) => Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n)

describe('import legacy — format actuel complet', () => {
  it('préserve identifiants, ordres, hiérarchies, contenus et réglages', async () => {
    const { db, paths, raw } = await setup('full-current')
    const before = { data: sha(paths.legacyData), settings: sha(paths.legacySettings) }
    const result = importLegacy(db, paths, fixedClock)
    expect(result.ok).toBe(true)
    const data = buildLegacyAppData(db)

    expect(data.categories).toEqual(raw.categories)
    expect(data.platforms).toEqual(raw.platforms)
    expect(data.folders.map(({ revision: _r, ...folder }) => folder)).toEqual(raw.folders)
    expect(data.projects.map((project) => project.id)).toEqual(['p_alpha', 'p_beta', 'p_gamma'])

    const alpha = data.projects[0]
    const rawAlpha = raw.projects[0]
    expect(alpha.tasks).toEqual(syncTaskStatuses(rawAlpha.tasks))
    expect(alpha.tasks[0].children[0].children[0].id).toBe('t_grandchild')
    expect(alpha.deadlines).toEqual(rawAlpha.deadlines)
    expect(alpha.links).toEqual(rawAlpha.links)
    expect(alpha.stack).toEqual(rawAlpha.stack)
    expect(alpha.path).toBe(rawAlpha.path)
    expect(alpha.lastOpenedAt).toBe(rawAlpha.lastOpenedAt)
    expect(alpha.folderId).toBe('f_manual')
    // Checklist: identical except the reference to a project that does not exist.
    expect(alpha.checklist.slice(0, 3)).toEqual(rawAlpha.checklist.slice(0, 3))
    expect(alpha.checklist[3]).toEqual({ id: 'c_4', label: 'Projet supprimé', type: 'projet', status: 'en_attente' })
    // Orphan references leave the relations but stay in the registry.
    expect(alpha.noteIds).toEqual(['n_spec'])
    expect(alpha.errorIds).toEqual(['e_panic'])

    // Blocks: custom titles, table and chart values kept as typed text.
    const layoutIds = alpha.layout.map((module) => module.id)
    expect(layoutIds).toEqual(rawAlpha.layout.map((module: any) => module.id))
    for (const [index, module] of alpha.layout.entries()) {
      if (rawAlpha.layout[index].type === 'hologram') continue
      expect(module).toEqual(rawAlpha.layout[index])
    }
    const chart = alpha.layout.find((module) => module.type === 'chart')!
    expect(chart.chart!.points.map((point) => point.value)).toEqual(['12.5', '-', '1,', '', '007'])
    const unknown = alpha.layout.find((module) => module.id === 'mod_future')!
    expect(unknown).toMatchObject({ type: 'external', contribution: { packageId: 'core', contributionId: 'hologram' }, config: { title: "Bloc d'un type inconnu", payload: { x: 1 }, legacyType: 'hologram' } })

    // Child identifiers repeated across projects are kept per project.
    const gamma = data.projects[2]
    expect(gamma.tasks[0].id).toBe('t_root')
    expect(gamma.deadlines[0].id).toBe('d_1')
    expect(data.projects[1].layout[0].id).toBe('mod_tasks')
    // Empty legacy layout → effective default blocks of the former app.
    expect(gamma.layout).toEqual([{ id: 'mod_tasks', type: 'tasks' }, { id: 'mod_deadlines', type: 'deadlines' }])
    expect(gamma.folderId).toBeUndefined()

    expect(data.notes.map(({ revision: _r, ...note }) => note)).toEqual(raw.notes)
    expect(data.errors.map(({ revision: _r, ...error }) => error)).toEqual([
      { ...raw.errors[0], projectIds: ['p_alpha', 'p_gamma'] },
      raw.errors[1],
    ])
    expect(data.trashedNotes).toEqual(raw.trashedNotes)

    // Weeks: every preset, copied slot ids, wake times and active selection.
    expect(data.weekPresets!.map((preset) => preset.id)).toEqual(['week-default', 'week-preset_vac'])
    expect(data.activeWeekPresetId).toBe('week-preset_vac')
    expect(data.weekPresets![0].slots.map((slot) => slot.id)).toEqual(['s_1', 's_2', 's_3', 's_4'])
    expect(data.weekPresets![1].slots.map((slot) => slot.id)).toEqual(['s_1', 's_2'])
    expect(data.weekPresets![0].slots[2].color).toBe('#aabbcc')
    expect(data.weekPresets![0].slots[0]).toEqual(raw.weekPresets[0].slots[0])
    expect(data.weekPresets![0].wakeTimes).toEqual(raw.weekPresets[0].wakeTimes)
    expect(data.weekSlots).toEqual(data.weekPresets![1].slots)

    const settings = db.get<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'aiCommand'")
    expect(JSON.parse(settings!.value_json)).toBe('/opt/fixture/bin/fake-ai')

    // Orphans registry.
    const refs = db.all<{ source_kind: string; source_id: string; field: string; target_id: string }>('SELECT source_kind, source_id, field, target_id FROM unresolved_refs ORDER BY id')
    expect(refs).toEqual(expect.arrayContaining([
      { source_kind: 'project', source_id: 'p_alpha', field: 'noteIds', target_id: 'n_missing' },
      { source_kind: 'project', source_id: 'p_alpha', field: 'errorIds', target_id: 'e_missing' },
      { source_kind: 'project', source_id: 'p_gamma', field: 'folderId', target_id: 'f_vanished' },
      { source_kind: 'error', source_id: 'e_panic', field: 'projectIds', target_id: 'p_deleted' },
      { source_kind: 'checklist-item', source_id: 'c_4', field: 'projectRef', target_id: 'p_deleted' },
      { source_kind: 'project-block', source_id: 'mod_note_ghost', field: 'refId', target_id: 'n_missing' },
      { source_kind: 'trashed-note', source_id: 'n_old', field: 'links.projectId', target_id: 'p_deleted' },
      { source_kind: 'week-slot', source_id: 's_4', field: 'projectId', target_id: 'p_deleted' },
    ]))

    // Originals untouched, dated copy and fingerprints kept.
    expect(sha(paths.legacyData)).toBe(before.data)
    expect(sha(paths.legacySettings)).toBe(before.settings)
    const archive = fs.readdirSync(paths.migration).find((entry) => entry.startsWith('legacy-'))!
    expect(sha(path.join(paths.migration, archive, 'data.json'))).toBe(before.data)
    expect(JSON.parse(fs.readFileSync(path.join(paths.migration, archive, 'fingerprints.json'), 'utf8')).data.sha256).toBe(before.data)

    // Initial composition.
    expect(db.all<{ name: string; is_default: number }>('SELECT name, is_default FROM dashboards')).toEqual([{ name: 'Accueil', is_default: 1 }])
    expect(count(db, 'dashboard_widgets')).toBe(9)
    expect(db.all<{ default_key: string }>('SELECT default_key FROM sidebar_entries ORDER BY position').map((row) => row.default_key)).toEqual(['week', 'home', 'projects', 'marketplace', 'notes', 'errors', 'search'])
    db.close()
  })

  it('ne réimporte pas et ne duplique rien lors d’une relance', async () => {
    const { db, paths } = await setup('full-current')
    expect(importLegacy(db, paths, fixedClock).ok).toBe(true)
    const snapshot = JSON.stringify(buildLegacyAppData(db))
    const counts = ['projects', 'tasks', 'notes', 'major_instances', 'package_documents', 'dashboards'].map((table) => count(db, table))
    expect(importLegacy(db, paths, fixedClock)).toEqual({ ok: true, skipped: true })
    expect(JSON.stringify(buildLegacyAppData(db))).toBe(snapshot)
    expect(['projects', 'tasks', 'notes', 'major_instances', 'package_documents', 'dashboards'].map((table) => count(db, table))).toEqual(counts)
    db.close()
  })

  it('annule tout en cas d’échec transactionnel puis reprend sans doublon', async () => {
    const { db, paths } = await setup('full-current')
    const failed = importLegacy(db, paths, fixedClock, { beforeCommit: () => { throw new Error('coupure simulée') } })
    expect(failed).toMatchObject({ ok: false, reason: 'import-failed' })
    for (const table of ['projects', 'tasks', 'notes', 'errors', 'major_instances', 'package_documents', 'dashboards', 'import_markers', 'settings']) expect(count(db, table)).toBe(0)
    const retried = importLegacy(db, paths, fixedClock)
    expect(retried.ok).toBe(true)
    expect(count(db, 'projects')).toBe(3)
    expect(count(db, 'major_instances')).toBe(2)
    db.close()
  })
})

describe('import legacy — anciens formats et cas limites', () => {
  it('convertit l’ancien format et archive les créneaux invalides', async () => {
    const { db, paths } = await setup('legacy-v0')
    const result = importLegacy(db, paths, fixedClock)
    expect(result.ok).toBe(true)
    if (!result.ok || result.skipped) return
    const data = buildLegacyAppData(db)
    expect(data.platforms).toEqual({ dev: ['PC', 'Mac'], video: ['YouTube', 'Instagram', 'TikTok', 'Twitch', 'LinkedIn', 'Autre'] })
    expect(data.folders[0]).toMatchObject({ id: 'f_old', displayMode: 'category' })
    const project = data.projects[0]
    expect(project).toMatchObject({ type: 'dev', tags: [], links: [], noteIds: [] })
    expect(project.layout.map((module) => module.type)).toEqual(['tasks', 'deadlines'])
    expect(project.tasks[0].status).toBe('fait')
    expect(result.report.weekSource).toBe('weekSlots')
    expect(data.weekPresets).toHaveLength(1)
    expect(data.weekSlots!.map((slot) => slot.id)).toEqual(['w_1', 'w_4'])
    expect(data.weekSlots![1].color).toBe('#d1d5db')
    expect(data.wakeTimes).toEqual(['06:30', '06:30', '07:00', '06:30', '06:30', '07:00', '07:00'])
    const reasons = result.report.archived.map((entry) => entry.location)
    expect(reasons).toEqual(expect.arrayContaining(['weekSlots[1]', 'weekSlots[2]', 'weekSlots[3]', 'weekSlots[5]', 'weekSlots[4].color', 'wakeTimes[2]']))
    expect(count(db, 'legacy_archive')).toBe(result.report.archived.length)
    db.close()
  })

  it('privilégie weekPresets et conserve la représentation legacy divergente', async () => {
    const { db, paths } = await setup('divergent-weeks')
    const result = importLegacy(db, paths, fixedClock)
    expect(result.ok).toBe(true)
    if (!result.ok || result.skipped) return
    const data = buildLegacyAppData(db)
    expect(result.report.weekSource).toBe('weekPresets')
    expect(data.weekPresets!.map((preset) => [preset.id, preset.name])).toEqual([['wk_a', 'A'], ['wk_b', 'a (2)']])
    expect(data.activeWeekPresetId).toBe('wk_a')
    expect(data.weekSlots!.map((slot) => slot.id)).toEqual(['s_a'])
    expect(result.report.archived.map((entry) => entry.location)).toEqual(expect.arrayContaining(['weekPresets[2]', 'weekSlots+wakeTimes']))
    expect(result.report.adjustments.map((entry) => entry.location)).toEqual(expect.arrayContaining(['weekPresets[1]', 'activeWeekPresetId']))
    db.close()
  })

  it('refuse une source illisible sans rien écrire', async () => {
    const { db, paths } = await setup('invalid-json')
    const before = sha(paths.legacyData)
    const result = importLegacy(db, paths, fixedClock)
    expect(result).toMatchObject({ ok: false, reason: 'legacy-invalid' })
    expect(count(db, 'import_markers')).toBe(0)
    expect(count(db, 'categories')).toBe(0)
    expect(sha(paths.legacyData)).toBe(before)
    expect(fs.readdirSync(paths.migration).some((file) => file.endsWith('-failed.json'))).toBe(true)
    db.close()
  })

  it('bloque un doublon d’identité avec rapport, sans renuméroter', async () => {
    const { db, paths } = await setup('duplicate-ids')
    const result = importLegacy(db, paths, fixedClock)
    expect(result).toMatchObject({ ok: false, reason: 'legacy-invalid' })
    if (result.ok) return
    expect(result.report.blocking).toEqual([{ location: 'projects[1]', message: 'identifiant « p_dup » en double' }])
    expect(count(db, 'projects')).toBe(0)
    db.close()
  })

  it('initialise une première installation sans source', async () => {
    const { db, paths } = await setup(null)
    const result = importLegacy(db, paths, fixedClock)
    expect(result.ok).toBe(true)
    const data = buildLegacyAppData(db)
    expect(data.categories).toEqual(['Hardware', 'Software', 'Mobile'])
    expect(data.projects).toEqual([])
    expect(data.weekPresets).toEqual([{ id: 'week-default', name: 'Ma semaine', slots: [], wakeTimes: ['07:00', '07:00', '07:00', '07:00', '07:00', '07:00', '07:00'] }])
    expect(db.get<{ kind: string }>('SELECT kind FROM import_markers WHERE kind = ?', LEGACY_MARKER)).toBeTruthy()
    expect(fs.existsSync(paths.legacyData)).toBe(false)
    db.close()
  })
})
