import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Database } from '../db/database'
import { timestampForFile } from '../db/database'
import type { DataPaths } from '../helpers/paths'
import { WEEK_MAJOR } from '../../shared/core'
import { createInstance, setActiveInstance } from '../core/packageStore'
import { writeWeekDocument } from '../core/week'
import {
  insertBlock,
  insertChecklistItem,
  insertDeadline,
  insertError,
  insertFolder,
  insertLink,
  insertNote,
  insertProjectRow,
  insertTaskTree,
  insertTrashEntry,
  replaceProjectList,
  setErrorProjects,
} from '../core/writers'
import { seedComposition } from '../core/composition'
import { convertLegacy, type ConversionPlan, type ConversionReport } from './convert'

export const LEGACY_MARKER = 'legacy-json'

export interface SourceInfo {
  file: string
  present: boolean
  bytes?: number
  sha256?: string
}

export interface ImportReport extends Omit<ConversionReport, 'blocking'> {
  id: string
  status: 'succeeded' | 'failed'
  startedAt: string
  finishedAt: string
  sources: { data: SourceInfo; settings: SourceInfo }
  archiveDir: string | null
  counts: Record<string, number>
  blocking: ConversionReport['blocking']
  failure?: string
}

export type LegacyImportResult =
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; report: ImportReport }
  | { ok: false; reason: 'legacy-invalid' | 'import-failed'; report: ImportReport }

export function hasMarker(db: Database, kind: string): boolean {
  return !!db.get('SELECT 1 AS present FROM import_markers WHERE kind = ?', kind)
}

function readSource(file: string): { info: SourceInfo; buffer?: Buffer } {
  try {
    const buffer = fs.readFileSync(file)
    return { info: { file, present: true, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }, buffer }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { info: { file, present: false } }
    throw error
  }
}

function writeReportFile(paths: DataPaths, report: ImportReport) {
  try {
    fs.mkdirSync(paths.migration, { recursive: true })
    fs.writeFileSync(path.join(paths.migration, `report-${timestampForFile(new Date(report.finishedAt))}-${report.status}.json`), JSON.stringify(report, null, 2))
  } catch {
    // The report is also stored in the database on success.
  }
}

function countPlan(plan: ConversionPlan): Record<string, number> {
  const countTasks = (tasks: { children?: unknown[] }[]): number => tasks.reduce((total, task) => total + 1 + countTasks((task.children ?? []) as { children?: unknown[] }[]), 0)
  return {
    projects: plan.projects.length,
    tasks: plan.projects.reduce((total, entry) => total + countTasks(entry.project.tasks), 0),
    checklistItems: plan.projects.reduce((total, entry) => total + entry.project.checklist.length, 0),
    deadlines: plan.projects.reduce((total, entry) => total + entry.project.deadlines.length, 0),
    links: plan.projects.reduce((total, entry) => total + entry.project.links.length, 0),
    blocks: plan.projects.reduce((total, entry) => total + entry.project.layout.length, 0),
    notes: plan.notes.length,
    errors: plan.errors.length,
    folders: plan.folders.length,
    trashedNotes: plan.trash.length,
    categories: plan.categories.length,
    weeks: plan.weeks.presets.length,
    weekSlots: plan.weeks.presets.reduce((total, preset) => total + preset.slots.length, 0),
  }
}

export function applyPlan(db: Database, plan: ConversionPlan, report: ConversionReport, reportId: string, now: string) {
  plan.categories.forEach((name, index) => db.run('INSERT INTO categories (name, position) VALUES (?, ?)', name, index))
  for (const [type, names] of Object.entries(plan.platforms)) {
    names.forEach((name, index) => db.run('INSERT INTO platforms (project_type, name, position) VALUES (?, ?, ?)', type, name, index))
  }
  plan.folders.forEach((folder, index) => insertFolder(db, folder, index))
  plan.notes.forEach((note, index) => insertNote(db, note, index))
  // Projects first (without relations to errors), then errors, then the
  // relation tables, so that every foreign key points to an existing row.
  plan.projects.forEach((entry, index) => insertProjectRow(db, entry.project, index, entry.folderId))
  plan.errors.forEach((entry, index) => insertError(db, entry.error, index))
  for (const entry of plan.projects) {
    const { project } = entry
    replaceProjectList(db, project.id, 'platforms', project.platforms)
    replaceProjectList(db, project.id, 'tags', project.tags)
    if (project.stack) replaceProjectList(db, project.id, 'stack', project.stack)
    insertTaskTree(db, project.id, project.tasks)
    project.checklist.forEach((item, index) => insertChecklistItem(db, project.id, item, index, entry.checklistRefs.get(item.id) ?? null))
    project.deadlines.forEach((deadline, index) => insertDeadline(db, project.id, deadline, index))
    project.links.forEach((link, index) => insertLink(db, project.id, link, index))
    project.layout.forEach((module, index) => insertBlock(db, project.id, module, index))
    entry.noteIds.forEach((noteId, index) => db.run('INSERT INTO project_notes (project_id, note_id, position) VALUES (?, ?, ?)', project.id, noteId, index))
    entry.errorIds.forEach((errorId, index) => db.run('INSERT INTO project_errors (project_id, error_id, position) VALUES (?, ?, ?)', project.id, errorId, index))
  }
  for (const entry of plan.errors) setErrorProjects(db, entry.error.id, entry.projectIds)
  plan.trash.forEach((entry, index) => insertTrashEntry(db, entry.entry, index, (projectId) => entry.projectNames.get(projectId) ?? null))

  // Week data goes straight to the builtin.week storage namespace.
  for (const preset of plan.weeks.presets) {
    createInstance(db, { packageId: WEEK_MAJOR.packageId, majorId: WEEK_MAJOR.contributionId, instanceId: preset.id, name: preset.name, now, activateIfFirst: false })
    writeWeekDocument(db, preset.id, { slots: preset.slots, wakeTimes: preset.wakeTimes }, now)
  }
  setActiveInstance(db, WEEK_MAJOR.packageId, WEEK_MAJOR.contributionId, plan.weeks.activeId)

  for (const [key, value] of Object.entries(plan.settings)) {
    db.run('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now)
  }
  for (const ref of report.unresolved) {
    db.run(
      'INSERT INTO unresolved_refs (source_kind, source_id, source_scope, field, target_kind, target_id, original_json, reason, report_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ref.sourceKind, ref.sourceId, ref.scope ?? '', ref.field, ref.targetKind, ref.targetId, JSON.stringify(ref.targetId), 'absent-at-import', reportId, now
    )
  }
  for (const value of report.archived) {
    db.run('INSERT INTO legacy_archive (report_id, location, reason, value_json) VALUES (?, ?, ?, ?)', reportId, value.location, value.reason, JSON.stringify(value.value ?? null) ?? 'null')
  }
}

// Imports data.json and settings.json once. The originals are never modified
// or removed. On any failure nothing is committed and no marker is written,
// so the next start retries from the same untouched sources.
export interface ImportHooks {
  // Test seam: called inside the transaction right before the marker is written.
  beforeCommit?: () => void
}

export function importLegacy(db: Database, paths: DataPaths, clock: () => Date = () => new Date(), hooks: ImportHooks = {}): LegacyImportResult {
  if (hasMarker(db, LEGACY_MARKER)) return { ok: true, skipped: true }
  const startedAt = clock().toISOString()
  const reportId = `import-${timestampForFile(clock())}-${randomUUID().slice(0, 8)}`
  const dataSource = readSource(paths.legacyData)
  const settingsSource = readSource(paths.legacySettings)
  const base = (): ImportReport => ({
    id: reportId,
    status: 'failed',
    startedAt,
    finishedAt: clock().toISOString(),
    sources: { data: dataSource.info, settings: settingsSource.info },
    archiveDir: null,
    counts: {},
    blocking: [],
    unresolved: [],
    archived: [],
    adjustments: [],
    weekSource: 'default',
  })

  // Dated copy and fingerprints of the raw sources, before any conversion.
  let archiveDir: string | null = null
  if (dataSource.info.present || settingsSource.info.present) {
    archiveDir = path.join(paths.migration, `legacy-${timestampForFile(clock())}`)
    fs.mkdirSync(archiveDir, { recursive: true })
    if (dataSource.buffer) fs.writeFileSync(path.join(archiveDir, 'data.json'), dataSource.buffer)
    if (settingsSource.buffer) fs.writeFileSync(path.join(archiveDir, 'settings.json'), settingsSource.buffer)
    fs.writeFileSync(path.join(archiveDir, 'fingerprints.json'), JSON.stringify({ data: dataSource.info, settings: settingsSource.info }, null, 2))
  }

  const parse = (source: { info: SourceInfo; buffer?: Buffer }, label: string): { ok: true; value: unknown } | { ok: false; message: string } => {
    if (!source.buffer) return { ok: true, value: undefined }
    try {
      return { ok: true, value: JSON.parse(source.buffer.toString('utf8')) }
    } catch (error) {
      return { ok: false, message: `${label} illisible : ${(error as Error).message}` }
    }
  }
  const data = parse(dataSource, 'data.json')
  const settings = parse(settingsSource, 'settings.json')
  if (!data.ok || !settings.ok) {
    const report = { ...base(), archiveDir, blocking: [!data.ok ? { location: 'data.json', message: data.message } : null, !settings.ok ? { location: 'settings.json', message: settings.message } : null].filter((entry): entry is { location: string; message: string } => !!entry) }
    writeReportFile(paths, report)
    return { ok: false, reason: 'legacy-invalid', report }
  }

  const now = clock().toISOString()
  const { plan, report: conversion } = convertLegacy(data.value, settings.value, now)
  const counts = countPlan(plan)
  if (conversion.blocking.length) {
    const report: ImportReport = { ...base(), ...conversion, archiveDir, counts }
    writeReportFile(paths, report)
    return { ok: false, reason: 'legacy-invalid', report }
  }

  const report: ImportReport = { ...base(), ...conversion, status: 'succeeded', archiveDir, counts }
  try {
    db.transaction(() => {
      applyPlan(db, plan, conversion, reportId, now)
      seedComposition(db, now)
      report.finishedAt = clock().toISOString()
      db.run(
        'INSERT INTO migration_reports (id, kind, status, created_at, summary_json, report_json) VALUES (?, ?, ?, ?, ?, ?)',
        reportId, LEGACY_MARKER, 'succeeded', report.finishedAt,
        JSON.stringify({ counts, unresolved: conversion.unresolved.length, archived: conversion.archived.length, adjustments: conversion.adjustments.length, weekSource: conversion.weekSource }),
        JSON.stringify(report)
      )
      db.run('INSERT INTO import_markers (kind, completed_at, source_fingerprint, report_id) VALUES (?, ?, ?, ?)', LEGACY_MARKER, report.finishedAt, dataSource.info.sha256 ?? null, reportId)
      db.run('UPDATE data_revision SET revision = revision + 1 WHERE id = 1')
      hooks.beforeCommit?.()
    })
  } catch (error) {
    const failed: ImportReport = { ...report, status: 'failed', finishedAt: clock().toISOString(), failure: (error as Error).message }
    writeReportFile(paths, failed)
    return { ok: false, reason: 'import-failed', report: failed }
  }
  writeReportFile(paths, report)
  return { ok: true, skipped: false, report }
}
