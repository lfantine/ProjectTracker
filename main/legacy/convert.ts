import type { ChecklistItem, Deadline, ErrorEntry, Note, Project, ProjectFolder, ProjectLink, ProjectModule, ProjectType, TaskNode, TrashedNote } from '../../shared/domain'
import { isCoreBlockType } from '../../shared/core'
import { syncTaskStatuses } from '../../shared/tasks'
import { DEFAULT_SLOT_COLOR, minutes, normalizeWakeTimes, slotColor, slotError, WEEK_DAYS, type WeekPreset, type WeekSlot } from '../../shared/week'
import { defaultSettings, type AppSettings } from '../../shared/models'

// Pure conversion of the legacy JSON files into an insert plan. Nothing here
// touches the disk or the database. The converter reads the raw values, never
// the renderer normalisation (which silently drops invalid entries): every
// value it cannot convert is archived in the report.

export interface UnresolvedRef {
  sourceKind: string
  sourceId: string
  scope?: string
  field: string
  targetKind: string
  targetId: string
}

export interface ArchivedValue {
  location: string
  reason: string
  value: unknown
}

export interface ConversionReport {
  blocking: { location: string; message: string }[]
  unresolved: UnresolvedRef[]
  archived: ArchivedValue[]
  adjustments: { location: string; message: string }[]
  weekSource: 'weekPresets' | 'weekSlots' | 'default'
}

export interface ConvertedProject {
  project: Project
  // Resolved references only; the others are listed in report.unresolved.
  folderId: string | null
  noteIds: string[]
  errorIds: string[]
  checklistRefs: Map<string, string | null>
}

export interface ConversionPlan {
  categories: string[]
  platforms: Record<string, string[]>
  folders: ProjectFolder[]
  projects: ConvertedProject[]
  notes: Note[]
  errors: { error: ErrorEntry; projectIds: string[] }[]
  trash: { entry: TrashedNote; projectNames: Map<string, string | null> }[]
  weeks: { presets: WeekPreset[]; activeId: string }
  settings: AppSettings & Record<string, unknown>
}

export const DEFAULT_CATEGORIES = ['Hardware', 'Software', 'Mobile']
export const DEFAULT_PLATFORMS: Record<ProjectType, string[]> = {
  dev: ['PC', 'Tablette', 'Mobile', 'Docker', 'Embarqué', 'Personnel'],
  video: ['YouTube', 'Instagram', 'TikTok', 'Twitch', 'LinkedIn', 'Autre'],
}
// Effective default blocks of the former application for an absent or empty
// layout. Only applied by the migration.
export const LEGACY_DEFAULT_LAYOUT: ProjectModule[] = [
  { id: 'mod_tasks', type: 'tasks' },
  { id: 'mod_deadlines', type: 'deadlines' },
]

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value)
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

class Context {
  report: ConversionReport = { blocking: [], unresolved: [], archived: [], adjustments: [], weekSource: 'default' }
  constructor(readonly now: string) {}
  block(location: string, message: string) {
    this.report.blocking.push({ location, message })
  }
  archive(location: string, reason: string, value: unknown) {
    this.report.archived.push({ location, reason, value })
  }
  adjust(location: string, message: string) {
    this.report.adjustments.push({ location, message })
  }
  unresolved(ref: UnresolvedRef) {
    this.report.unresolved.push(ref)
  }

  // Array field: absent → fallback; present but not an array → unconvertible.
  array(source: Obj, key: string, location: string): unknown[] | undefined {
    const value = source[key]
    if (value === undefined || value === null) return undefined
    if (!Array.isArray(value)) {
      this.archive(`${location}.${key}`, 'liste attendue', value)
      return undefined
    }
    return value
  }

  string(source: Obj, key: string, location: string, fallback: string): string {
    const value = source[key]
    if (typeof value === 'string') return value
    if (value !== undefined && value !== null) this.archive(`${location}.${key}`, 'texte attendu', value)
    else if (fallback !== '') this.adjust(`${location}.${key}`, `valeur absente remplacée par « ${fallback} »`)
    return fallback
  }

  optionalString(source: Obj, key: string, location: string): string | undefined {
    const value = source[key]
    if (value === undefined || value === null) return undefined
    if (typeof value === 'string') return value
    this.archive(`${location}.${key}`, 'texte attendu', value)
    return undefined
  }

  strings(source: Obj, key: string, location: string): string[] | undefined {
    const list = this.array(source, key, location)
    if (!list) return undefined
    const result: string[] = []
    list.forEach((value, index) => {
      if (typeof value === 'string') result.push(value)
      else this.archive(`${location}.${key}[${index}]`, 'texte attendu', value)
    })
    return result
  }
}

function unique(values: string[], location: string, ctx: Context): string[] {
  const result = [...new Set(values)]
  if (result.length !== values.length) ctx.adjust(location, 'doublons fusionnés')
  return result
}

// Top-level business entities: a duplicated identity cannot be converted
// without ambiguity and blocks the import.
function collectEntities(list: unknown[] | undefined, location: string, ctx: Context): Obj[] {
  const seen = new Set<string>()
  const result: Obj[] = []
  ;(list ?? []).forEach((entry, index) => {
    const at = `${location}[${index}]`
    if (!isObj(entry) || !nonEmptyString(entry.id)) {
      ctx.archive(at, 'entrée sans identifiant exploitable', entry)
      return
    }
    if (seen.has(entry.id)) {
      ctx.block(at, `identifiant « ${entry.id} » en double`)
      return
    }
    seen.add(entry.id)
    result.push(entry)
  })
  return result
}

function convertTasks(list: unknown[] | undefined, location: string, ids: Set<string>, ctx: Context): TaskNode[] {
  const result: TaskNode[] = []
  ;(list ?? []).forEach((entry, index) => {
    const at = `${location}[${index}]`
    if (!isObj(entry) || !nonEmptyString(entry.id)) {
      ctx.archive(at, 'tâche sans identifiant exploitable', entry)
      return
    }
    if (ids.has(entry.id)) {
      ctx.block(at, `tâche « ${entry.id} » en double dans le projet`)
      return
    }
    ids.add(entry.id)
    const { children: _children, ...rest } = entry
    void _children
    result.push({
      ...rest,
      id: entry.id,
      name: ctx.string(entry, 'name', at, ''),
      content: ctx.string(entry, 'content', at, ''),
      status: (['a_faire', 'en_cours', 'fait'].includes(entry.status as string) ? entry.status : (ctx.archive(`${at}.status`, 'statut inconnu', entry.status), 'a_faire')) as TaskNode['status'],
      children: convertTasks(ctx.array(entry, 'children', at), `${at}.children`, ids, ctx),
    })
  })
  return result
}

function childEntities(list: unknown[] | undefined, location: string, kind: string, ctx: Context): Obj[] {
  const seen = new Set<string>()
  const result: Obj[] = []
  ;(list ?? []).forEach((entry, index) => {
    const at = `${location}[${index}]`
    if (!isObj(entry) || !nonEmptyString(entry.id)) {
      ctx.archive(at, `${kind} sans identifiant exploitable`, entry)
      return
    }
    if (seen.has(entry.id)) {
      ctx.block(at, `${kind} « ${entry.id} » en double dans le projet`)
      return
    }
    seen.add(entry.id)
    result.push(entry)
  })
  return result
}

function convertModule(entry: Obj, at: string, ctx: Context, notes: Set<string>, errors: Set<string>, projectId: string): ProjectModule {
  const type = entry.type
  if (!isCoreBlockType(type)) {
    ctx.adjust(at, `type de bloc inconnu « ${String(type)} » conservé comme emplacement indisponible`)
    const { id, type: _t, ...config } = entry
    void _t
    return {
      id: id as string,
      type: 'external',
      contribution: { packageId: 'core', contributionId: typeof type === 'string' && type ? type : 'unknown' },
      binding: { mode: 'none' },
      config: { ...config, legacyType: type },
    }
  }
  if (type === 'note' && nonEmptyString(entry.refId) && !notes.has(entry.refId)) {
    ctx.unresolved({ sourceKind: 'project-block', sourceId: entry.id as string, scope: projectId, field: 'refId', targetKind: 'note', targetId: entry.refId })
  }
  if (type === 'error' && nonEmptyString(entry.refId) && !errors.has(entry.refId)) {
    ctx.unresolved({ sourceKind: 'project-block', sourceId: entry.id as string, scope: projectId, field: 'refId', targetKind: 'error', targetId: entry.refId })
  }
  // Chart values stay typed text: no numeric coercion.
  return { ...entry, id: entry.id as string, type } as ProjectModule
}

// ------------------------------------------------------------------- weeks

function convertSlots(raw: unknown, location: string, ctx: Context): WeekSlot[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    ctx.archive(location, 'liste de créneaux attendue', raw)
    return []
  }
  const accepted: WeekSlot[] = []
  const known = ['id', 'title', 'day', 'start', 'end', 'description', 'projectId', 'location', 'people', 'link', 'color']
  raw.forEach((entry, index) => {
    const at = `${location}[${index}]`
    if (!isObj(entry) || !nonEmptyString(entry.id) || typeof entry.title !== 'string' || typeof entry.start !== 'string' || typeof entry.end !== 'string') {
      ctx.archive(at, 'créneau incomplet', entry)
      return
    }
    if (accepted.some((slot) => slot.id === entry.id)) {
      ctx.archive(at, `identifiant de créneau « ${entry.id} » en double (le premier est conservé)`, entry)
      return
    }
    const candidate = { title: entry.title, day: entry.day as number, start: entry.start, end: entry.end }
    const problem = slotError(candidate, accepted)
    if (problem) {
      ctx.archive(at, problem, entry)
      return
    }
    const slot: WeekSlot = { id: entry.id, ...candidate }
    if (typeof entry.description === 'string') slot.description = entry.description
    if (typeof entry.projectId === 'string') slot.projectId = entry.projectId
    if (typeof entry.location === 'string') slot.location = entry.location
    if (typeof entry.link === 'string') slot.link = entry.link
    if (Array.isArray(entry.people)) {
      slot.people = entry.people.filter((person): person is string => typeof person === 'string')
      if (slot.people.length !== entry.people.length) ctx.archive(`${at}.people`, 'personnes non textuelles ignorées', entry.people)
    }
    if (entry.color !== undefined) {
      slot.color = slotColor(entry.color as string)
      if (slot.color === DEFAULT_SLOT_COLOR && String(entry.color).toLowerCase() !== DEFAULT_SLOT_COLOR) ctx.archive(`${at}.color`, 'couleur invalide remplacée par la couleur par défaut', entry.color)
    }
    for (const key of Object.keys(entry)) if (!known.includes(key)) ctx.archive(`${at}.${key}`, 'champ de créneau inconnu', entry[key])
    accepted.push(slot)
  })
  return accepted
}

function convertWakeTimes(raw: unknown, location: string, ctx: Context): string[] {
  const result = normalizeWakeTimes(raw)
  if (raw !== undefined && raw !== null && !Array.isArray(raw)) ctx.archive(location, 'liste d’heures attendue', raw)
  if (Array.isArray(raw)) {
    raw.forEach((value, day) => {
      if (day >= WEEK_DAYS.length) ctx.archive(`${location}[${day}]`, 'jour inexistant', value)
      else if (typeof value !== 'string' || !Number.isFinite(minutes(value))) ctx.archive(`${location}[${day}]`, 'heure invalide remplacée par 07:00', value)
    })
  }
  return result
}

function sameWeek(a: { slots: WeekSlot[]; wakeTimes: string[] }, b: { slots: WeekSlot[]; wakeTimes: string[] }) {
  return JSON.stringify(a.slots) === JSON.stringify(b.slots) && JSON.stringify(a.wakeTimes) === JSON.stringify(b.wakeTimes)
}

function convertWeeks(data: Obj, ctx: Context): { presets: WeekPreset[]; activeId: string } {
  const rawPresets = data.weekPresets
  const usable = Array.isArray(rawPresets) && rawPresets.some((entry) => isObj(entry) && nonEmptyString(entry.id) && typeof entry.name === 'string' && entry.name.trim())
  if (rawPresets !== undefined && !usable) ctx.archive('weekPresets', 'semaines types inexploitables', rawPresets)
  const hasLegacy = data.weekSlots !== undefined || data.wakeTimes !== undefined
  const presets: WeekPreset[] = []
  if (usable) {
    ctx.report.weekSource = 'weekPresets'
    ;(rawPresets as unknown[]).forEach((entry, index) => {
      const at = `weekPresets[${index}]`
      if (!isObj(entry) || !nonEmptyString(entry.id) || typeof entry.name !== 'string' || !entry.name.trim()) {
        ctx.archive(at, 'semaine sans identifiant ou sans nom', entry)
        return
      }
      if (presets.some((preset) => preset.id === entry.id)) {
        ctx.archive(at, `identifiant de semaine « ${entry.id} » en double (la première est conservée)`, entry)
        return
      }
      let name = entry.name.trim()
      if (presets.some((preset) => preset.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) {
        let suffix = 2
        while (presets.some((preset) => preset.name.toLocaleLowerCase('fr') === `${name} (${suffix})`.toLocaleLowerCase('fr'))) suffix++
        ctx.adjust(at, `nom « ${name} » déjà utilisé, renommé « ${name} (${suffix}) »`)
        name = `${name} (${suffix})`
      }
      presets.push({ id: entry.id, name, slots: convertSlots(entry.slots, `${at}.slots`, ctx), wakeTimes: convertWakeTimes(entry.wakeTimes, `${at}.wakeTimes`, ctx) })
    })
  } else {
    ctx.report.weekSource = hasLegacy ? 'weekSlots' : 'default'
    presets.push({ id: 'week-default', name: 'Ma semaine', slots: convertSlots(data.weekSlots, 'weekSlots', ctx), wakeTimes: convertWakeTimes(data.wakeTimes, 'wakeTimes', ctx) })
  }
  const requested = data.activeWeekPresetId
  let active = presets.find((preset) => preset.id === requested)
  if (!active) {
    active = presets[0]
    if (requested !== undefined) ctx.adjust('activeWeekPresetId', `semaine active « ${String(requested)} » introuvable, « ${active.name} » sélectionnée`)
  }
  // Both formats present: weekPresets wins, the diverging legacy representation
  // is kept in the report without overwriting the presets.
  if (usable && hasLegacy) {
    const quiet = new Context(ctx.now)
    const legacy = { slots: convertSlots(data.weekSlots, 'weekSlots', quiet), wakeTimes: convertWakeTimes(data.wakeTimes, 'wakeTimes', quiet) }
    if (!sameWeek(legacy, active)) ctx.archive('weekSlots+wakeTimes', 'représentation legacy divergente de la semaine active', { weekSlots: data.weekSlots, wakeTimes: data.wakeTimes })
  }
  return { presets, activeId: active.id }
}

// -------------------------------------------------------------- conversion

export function convertLegacy(rawData: unknown, rawSettings: unknown, now: string): { plan: ConversionPlan; report: ConversionReport } {
  const ctx = new Context(now)
  const data: Obj = isObj(rawData) ? rawData : {}
  if (rawData !== undefined && !isObj(rawData)) ctx.block('(racine)', 'data.json ne contient pas un objet')
  for (const key of ['projects', 'notes', 'errors', 'folders', 'trashedNotes', 'categories']) {
    if (data[key] !== undefined && data[key] !== null && !Array.isArray(data[key])) ctx.block(key, 'liste attendue')
  }

  // Taxonomy.
  const categories = data.categories === undefined ? [...DEFAULT_CATEGORIES] : unique(ctx.strings(data, 'categories', '(racine)') ?? [], 'categories', ctx)
  let platforms: Record<string, string[]>
  if (Array.isArray(data.platforms)) {
    ctx.adjust('platforms', 'ancienne liste plate convertie en plateformes « dev » ; plateformes vidéo par défaut')
    platforms = { dev: unique(ctx.strings(data, 'platforms', '(racine)') ?? [], 'platforms.dev', ctx), video: [...DEFAULT_PLATFORMS.video] }
  } else if (isObj(data.platforms)) {
    platforms = {}
    for (const [type, list] of Object.entries(data.platforms)) {
      if (!Array.isArray(list)) ctx.archive(`platforms.${type}`, 'liste attendue', list)
      else platforms[type] = unique(ctx.strings(data.platforms, type, 'platforms') ?? [], `platforms.${type}`, ctx)
    }
    platforms.dev ??= [...DEFAULT_PLATFORMS.dev]
    platforms.video ??= [...DEFAULT_PLATFORMS.video]
  } else {
    if (data.platforms !== undefined) ctx.archive('platforms', 'plateformes inexploitables', data.platforms)
    platforms = { dev: [...DEFAULT_PLATFORMS.dev], video: [...DEFAULT_PLATFORMS.video] }
  }

  const rawProjects = collectEntities(ctx.array(data, 'projects', '(racine)'), 'projects', ctx)
  const rawNotes = collectEntities(ctx.array(data, 'notes', '(racine)'), 'notes', ctx)
  const rawErrors = collectEntities(ctx.array(data, 'errors', '(racine)'), 'errors', ctx)
  const rawFolders = collectEntities(ctx.array(data, 'folders', '(racine)'), 'folders', ctx)
  const projectIds = new Set(rawProjects.map((entry) => entry.id as string))
  const noteIds = new Set(rawNotes.map((entry) => entry.id as string))
  const errorIds = new Set(rawErrors.map((entry) => entry.id as string))
  const folderIds = new Set(rawFolders.map((entry) => entry.id as string))
  const projectNames = new Map(rawProjects.map((entry) => [entry.id as string, typeof entry.name === 'string' ? entry.name : null]))

  const folders: ProjectFolder[] = rawFolders.map((entry, index) => {
    const at = `folders[${index}]`
    const kind = entry.kind === 'smart' ? 'smart' : 'manual'
    if (entry.kind !== 'smart' && entry.kind !== 'manual') ctx.archive(`${at}.kind`, 'type de dossier inconnu, dossier manuel', entry.kind)
    const displayMode = entry.displayMode === 'group' ? 'group' : 'category'
    if (entry.displayMode === undefined) ctx.adjust(`${at}.displayMode`, 'mode d’affichage par défaut « category »')
    else if (entry.displayMode !== 'group' && entry.displayMode !== 'category') ctx.archive(`${at}.displayMode`, 'mode d’affichage inconnu', entry.displayMode)
    const folder: ProjectFolder = { ...entry, id: entry.id as string, name: ctx.string(entry, 'name', at, ''), kind, displayMode }
    const description = ctx.optionalString(entry, 'description', at)
    if (description === undefined) delete folder.description
    else folder.description = description
    const tagFilter = ctx.strings(entry, 'tagFilter', at)
    if (tagFilter === undefined) delete folder.tagFilter
    else folder.tagFilter = tagFilter
    return folder
  })

  const notes: Note[] = rawNotes.map((entry, index) => {
    const at = `notes[${index}]`
    const note: Note = {
      ...entry,
      id: entry.id as string,
      title: ctx.string(entry, 'title', at, ''),
      content: ctx.string(entry, 'content', at, ''),
      tags: ctx.strings(entry, 'tags', at) ?? [],
      createdAt: ctx.string(entry, 'createdAt', at, now),
      updatedAt: ctx.string(entry, 'updatedAt', at, now),
    }
    if (typeof entry.raw === 'boolean') note.raw = entry.raw
    else {
      if (entry.raw !== undefined) ctx.archive(`${at}.raw`, 'booléen attendu', entry.raw)
      delete note.raw
    }
    return note
  })

  const errors = rawErrors.map((entry, index) => {
    const at = `errors[${index}]`
    const linked = unique(ctx.strings(entry, 'projectIds', at) ?? [], `${at}.projectIds`, ctx)
    const resolved = linked.filter((projectId) => {
      if (projectIds.has(projectId)) return true
      ctx.unresolved({ sourceKind: 'error', sourceId: entry.id as string, field: 'projectIds', targetKind: 'project', targetId: projectId })
      return false
    })
    const error: ErrorEntry = {
      ...entry,
      id: entry.id as string,
      title: ctx.string(entry, 'title', at, ''),
      content: ctx.string(entry, 'content', at, ''),
      causes: ctx.string(entry, 'causes', at, ''),
      solution: ctx.string(entry, 'solution', at, ''),
      createdAt: ctx.string(entry, 'createdAt', at, now),
      projectIds: linked,
    }
    return { error, projectIds: resolved }
  })

  const projects: ConvertedProject[] = rawProjects.map((entry, index) => {
    const at = `projects[${index}]`
    const id = entry.id as string
    const checklistRefs = new Map<string, string | null>()
    const checklist: ChecklistItem[] = childEntities(ctx.array(entry, 'checklist', at), `${at}.checklist`, 'élément de checklist', ctx).map((item, position) => {
      const itemAt = `${at}.checklist[${position}]`
      const converted = { ...item, id: item.id as string, label: ctx.string(item, 'label', itemAt, ''), type: ctx.string(item, 'type', itemAt, 'generique'), status: ctx.string(item, 'status', itemAt, 'a_faire') } as ChecklistItem
      for (const key of ['link', 'date', 'description', 'projectRef'] as const) {
        const value = ctx.optionalString(item, key, itemAt)
        if (value === undefined) delete converted[key]
        else converted[key] = value
      }
      if (converted.projectRef !== undefined && !projectIds.has(converted.projectRef)) {
        ctx.unresolved({ sourceKind: 'checklist-item', sourceId: converted.id, scope: id, field: 'projectRef', targetKind: 'project', targetId: converted.projectRef })
        checklistRefs.set(converted.id, null)
      } else checklistRefs.set(converted.id, converted.projectRef ?? null)
      return converted
    })
    const rawTasks = convertTasks(ctx.array(entry, 'tasks', at), `${at}.tasks`, new Set(), ctx)
    const tasks = syncTaskStatuses(rawTasks)
    if (tasks !== rawTasks) ctx.adjust(`${at}.tasks`, 'statuts des tâches parentes recalculés depuis leurs sous-tâches')
    const deadlines: Deadline[] = childEntities(ctx.array(entry, 'deadlines', at), `${at}.deadlines`, 'échéance', ctx).map((item, position) => ({
      ...item,
      id: item.id as string,
      label: ctx.string(item, 'label', `${at}.deadlines[${position}]`, ''),
      date: ctx.string(item, 'date', `${at}.deadlines[${position}]`, ''),
      status: ctx.string(item, 'status', `${at}.deadlines[${position}]`, 'a_venir') as Deadline['status'],
    }))
    const links: ProjectLink[] = childEntities(ctx.array(entry, 'links', at), `${at}.links`, 'lien', ctx).map((item, position) => ({
      ...item,
      id: item.id as string,
      title: ctx.string(item, 'title', `${at}.links[${position}]`, ''),
      url: ctx.string(item, 'url', `${at}.links[${position}]`, ''),
    }))
    const rawLayout = ctx.array(entry, 'layout', at)
    let layout: ProjectModule[]
    if (!rawLayout || rawLayout.length === 0) {
      ctx.adjust(`${at}.layout`, 'disposition absente ou vide : blocs par défaut de l’ancienne application')
      layout = LEGACY_DEFAULT_LAYOUT.map((module) => ({ ...module }))
    } else {
      layout = childEntities(rawLayout, `${at}.layout`, 'bloc', ctx).map((module, position) => convertModule(module, `${at}.layout[${position}]`, ctx, noteIds, errorIds, id))
    }

    const folderRef = ctx.optionalString(entry, 'folderId', at)
    let folderId: string | null = null
    if (folderRef !== undefined) {
      if (folderIds.has(folderRef)) folderId = folderRef
      else ctx.unresolved({ sourceKind: 'project', sourceId: id, field: 'folderId', targetKind: 'folder', targetId: folderRef })
    }
    const linkedNotes = unique(ctx.strings(entry, 'noteIds', at) ?? [], `${at}.noteIds`, ctx)
    const linkedErrors = unique(ctx.strings(entry, 'errorIds', at) ?? [], `${at}.errorIds`, ctx)
    for (const noteId of linkedNotes) if (!noteIds.has(noteId)) ctx.unresolved({ sourceKind: 'project', sourceId: id, field: 'noteIds', targetKind: 'note', targetId: noteId })
    for (const errorId of linkedErrors) if (!errorIds.has(errorId)) ctx.unresolved({ sourceKind: 'project', sourceId: id, field: 'errorIds', targetKind: 'error', targetId: errorId })

    if (entry.type === undefined) ctx.adjust(`${at}.type`, 'type absent : « dev »')
    const project: Project = {
      ...entry,
      id,
      name: ctx.string(entry, 'name', at, ''),
      type: (typeof entry.type === 'string' ? entry.type : 'dev') as ProjectType,
      category: ctx.string(entry, 'category', at, ''),
      platforms: ctx.strings(entry, 'platforms', at) ?? [],
      tags: ctx.strings(entry, 'tags', at) ?? [],
      status: ctx.string(entry, 'status', at, 'actif') as Project['status'],
      createdAt: ctx.string(entry, 'createdAt', at, now),
      updatedAt: ctx.string(entry, 'updatedAt', at, now),
      noteIds: linkedNotes,
      errorIds: linkedErrors,
      checklist,
      tasks,
      deadlines,
      links,
      layout,
    }
    for (const key of ['lastOpenedAt', 'description', 'path', 'folderId'] as const) {
      const value = key === 'folderId' ? folderRef : ctx.optionalString(entry, key, at)
      if (value === undefined) delete project[key]
      else project[key] = value
    }
    const stack = ctx.strings(entry, 'stack', at)
    if (stack === undefined) delete project.stack
    else project.stack = stack
    return {
      project,
      folderId,
      noteIds: linkedNotes.filter((noteId) => noteIds.has(noteId)),
      errorIds: linkedErrors.filter((errorId) => errorIds.has(errorId)),
      checklistRefs,
    }
  })

  const trash: ConversionPlan['trash'] = []
  const trashed = new Set<string>()
  ;(ctx.array(data, 'trashedNotes', '(racine)') ?? []).forEach((entry, index) => {
    const at = `trashedNotes[${index}]`
    if (!isObj(entry) || !isObj(entry.note) || !nonEmptyString(entry.note.id)) {
      ctx.archive(at, 'note supprimée inexploitable', entry)
      return
    }
    const noteId = entry.note.id
    if (trashed.has(noteId)) {
      ctx.block(at, `note supprimée « ${noteId} » en double`)
      return
    }
    trashed.add(noteId)
    const names = new Map<string, string | null>()
    const links = (ctx.array(entry, 'links', at) ?? []).flatMap((link, position) => {
      if (!isObj(link) || !nonEmptyString(link.projectId)) {
        ctx.archive(`${at}.links[${position}]`, 'lien de corbeille inexploitable', link)
        return []
      }
      names.set(link.projectId, projectNames.get(link.projectId) ?? null)
      if (!projectIds.has(link.projectId)) ctx.unresolved({ sourceKind: 'trashed-note', sourceId: noteId, field: 'links.projectId', targetKind: 'project', targetId: link.projectId })
      return [{ projectId: link.projectId, modules: (Array.isArray(link.modules) ? link.modules : []) as ProjectModule[] }]
    })
    trash.push({ entry: { note: entry.note as unknown as Note, deletedAt: ctx.string(entry, 'deletedAt', at, now), links }, projectNames: names })
  })

  const weeks = convertWeeks(data, ctx)
  for (const preset of weeks.presets) {
    for (const slot of preset.slots) {
      if (slot.projectId !== undefined && !projectIds.has(slot.projectId)) {
        ctx.unresolved({ sourceKind: 'week-slot', sourceId: slot.id, scope: preset.id, field: 'projectId', targetKind: 'project', targetId: slot.projectId })
      }
    }
  }

  let settings: ConversionPlan['settings'] = { ...defaultSettings() }
  if (rawSettings !== undefined) {
    if (!isObj(rawSettings)) ctx.block('settings.json', 'settings.json ne contient pas un objet')
    else {
      settings = { ...settings, ...rawSettings }
      if (typeof rawSettings.aiCommand !== 'string') {
        if (rawSettings.aiCommand !== undefined) ctx.archive('settings.aiCommand', 'texte attendu', rawSettings.aiCommand)
        settings.aiCommand = defaultSettings().aiCommand
      }
    }
  }

  return {
    plan: { categories, platforms, folders, projects, notes, errors, trash, weeks, settings },
    report: ctx.report,
  }
}
