export type AiCreationType = 'note' | 'error' | 'project'

export interface AiCreationAnalysis {
  action: 'create' | 'edit'
  needsClarification?: boolean
  targetId?: string
  type: AiCreationType
  title: string
  description: string
}

export interface AiCreationQuestion {
  id: string
  label: string
  description: string
  suggestedAnswer: string
  placeholder: string
  required: boolean
}

// This is deliberately kept outside the modal so the contract with the AI is explicit and reusable.
export const AI_ANALYSIS_FORMAT = `
Return exactly this JSON object:
{"needsClarification":false,"action":"create"|"edit","targetId":"existing object ID for edit only","type":"note"|"error"|"project","title":"short title","description":"one or two sentences describing what will be created"}

Set needsClarification to false by default: questions are optional. Set it to true only when essential missing information prevents a useful draft and cannot be reasonably inferred from the request or existing data. Simple creation or edit requests should proceed directly to creation. Do not ask for optional personalization, tags, deadlines, links, or preferences merely to enrich the result. Do not invent personal facts.

In the description, explain the intended result in enough detail to guide a later creation step. Mention useful ideas where relevant: links or social profiles, images, tags, technology stack, tasks, milestones, deadlines, purchase items, target platforms, audience, or project page modules (stack, image/text blocks, charts, pinned notes or errors).
`

export const AI_REQUIREMENTS_FORMAT = `
Return exactly this JSON object:
{"questions":[{"id":"short_snake_case_id","label":"short question","description":"why this information helps","placeholder":"an example answer","suggestedAnswer":"a reasonable proposed answer, or empty if unknown","required":false}]}

Questions are NOT mandatory. Return {"questions":[]} whenever the original request and existing data are enough for a useful draft. Only ask about essential missing information, not optional enhancements suggested by the analysis. Use reasonable defaults for simple choices and omit irrelevant optional fields. Ask at most 4 questions, in the user's language.
For each question, provide suggestedAnswer when a sensible answer can be proposed, so the user can validate it without typing. This is an editable proposal, not an established fact. Never invent personal details, URLs, dates, credentials, or facts about the user. Leave suggestedAnswer empty when unknown. Set required to true only if proceeding without an answer is impossible.
`

export const AI_CREATION_FORMAT = `
Return exactly one JSON object. Do not wrap it in Markdown or add explanation.

Note:
{"type":"note","title":"…","content":"Markdown content","tags":["…"],"raw":false}

Error:
{"type":"error","title":"…","content":"problem description","causes":"…","solution":"…","projectNames":["existing project name"]}

Project:
{"type":"project","name":"…","projectType":"dev"|"video","category":"…","platforms":["…"],"tags":["…"],"description":"…","stack":["…"],"links":[{"title":"…","url":"https://…"}],"imageUrl":"https://…","tasks":[{"name":"…","content":"…","status":"a_faire"|"en_cours"|"fait","children":[]}],"checklist":[{"label":"…","type":"generique"|"materiel"|"projet"|"evenement","link":"https://…","description":"…","date":"YYYY-MM-DD"}],"deadlines":[{"label":"…","date":"YYYY-MM-DD"}],"modules":[{"type":"tasks"}]}

Only include useful optional values. Use empty arrays when there are no relevant items. A link may have an empty URL only when it is useful to keep it as a placeholder for the user. Only include imageUrl when it is a real, publicly available image URL you are confident exists; never invent an image URL, use an example image, or use a placeholder image. Otherwise use an empty string.
Project modules (optional "modules" array on a project) are the blocks displayed on the project page, in order:
- {"type":"tasks"} and {"type":"deadlines"}: show the project tasks / deadlines (data stays in tasks / deadlines).
- {"type":"stack"}: shows the stack field. At most 1.
- {"type":"image","title":"…","imageUrl":"https://… or empty","text":"Markdown or empty"}: free image and/or text block.
- {"type":"chart","title":"…","chart":{"kind":"bar"|"line","points":[{"label":"…","value":12.5}]}}: simple single-series chart. Only use real or user-supplied numbers; never invent statistics.
- {"type":"note","refId":"existing note ID"} / {"type":"error","refId":"existing error ID"}: pins a note / error on the project (it is linked automatically).
"modules", when supplied, is the COMPLETE ordered layout: keep existing modules with their "id" and unchanged fields, omit "id" for new ones, and leave out a module only to remove it. Omit "modules" entirely to keep the layout as is.
`

export const AI_MODULE_TYPES = ['stack', 'tasks', 'deadlines', 'note', 'error', 'image', 'chart'] as const
const AI_MODULE_MAX: Partial<Record<string, number>> = { stack: 1, deadlines: 2 }

type ProjectModuleT = import('./types').ProjectModule
export type AiModuleSpec = Omit<ProjectModuleT, 'id'> & { id?: string }

/**
 * Normalize the AI "modules" array. With `known`, references and existing IDs are
 * checked strictly so an invalid proposal is rejected (and retried) instead of applied.
 */
export function parseAiModules(
  value: unknown,
  known?: { noteIds: string[]; errorIds: string[]; moduleIds: string[] },
): AiModuleSpec[] {
  if (!Array.isArray(value)) throw new Error('Tableau invalide : modules')
  const counts: Record<string, number> = {}
  const seen = new Set<string>()
  return value.map((item): AiModuleSpec => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Module invalide.')
    const entry = item as Record<string, unknown>
    const type = String(entry.type)
    if (!(AI_MODULE_TYPES as readonly string[]).includes(type)) throw new Error(`Type de module inconnu : ${type}`)
    counts[type] = (counts[type] || 0) + 1
    if (known && counts[type] > (AI_MODULE_MAX[type] ?? Infinity)) throw new Error(`Trop de modules ${type}.`)
    const spec: AiModuleSpec = { type: type as ProjectModuleT['type'] }
    if (typeof entry.id === 'string' && entry.id) {
      if (seen.has(entry.id)) throw new Error('ID de module en double.')
      if (known && !known.moduleIds.includes(entry.id)) throw new Error('ID de module inconnu.')
      seen.add(entry.id)
      spec.id = entry.id
    }
    for (const key of ['title', 'text', 'imageUrl', 'refId'] as const) {
      if (key in entry && entry[key] !== undefined && typeof entry[key] !== 'string') throw new Error(`Texte invalide : module.${key}`)
      if (typeof entry[key] === 'string') spec[key] = (entry[key] as string).trim()
    }
    if (spec.imageUrl && !/^https?:\/\//.test(spec.imageUrl)) throw new Error('URL d’image invalide.')
    if (type === 'note' || type === 'error') {
      if (!spec.refId) throw new Error(`Module ${type} sans refId.`)
      const pool = type === 'note' ? known?.noteIds : known?.errorIds
      if (pool && !pool.includes(spec.refId)) throw new Error(`${type === 'note' ? 'Note' : 'Erreur'} épinglée introuvable.`)
    }
    if (type === 'chart' && 'chart' in entry) {
      const chart = entry.chart as Record<string, unknown> | null
      if (!chart || typeof chart !== 'object' || !Array.isArray(chart.points)) throw new Error('Graphique invalide.')
      const kind = chart.kind === 'line' ? 'line' : chart.kind === 'bar' || chart.kind === undefined ? 'bar' : null
      if (!kind) throw new Error('Type de graphique invalide.')
      spec.chart = {
        kind,
        points: chart.points.map((point, index) => {
          const p = point as Record<string, unknown> | null
          const raw = p && typeof p === 'object' ? p.value : undefined
          const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN
          if (!p || typeof p.label !== 'string' || !Number.isFinite(num)) throw new Error('Point de graphique invalide.')
          return { id: typeof p.id === 'string' && p.id ? p.id : `pt_ai_${index}`, label: p.label.trim(), value: String(num) }
        }),
      }
    }
    return spec
  })
}

/** Build the final layout: retained modules keep their ID and untouched fields. */
export function buildLayoutFromAiModules(specs: AiModuleSpec[], previous: ProjectModuleT[], makeId: () => string): ProjectModuleT[] {
  return specs.map((spec) => {
    const original = spec.id ? previous.find((m) => m.id === spec.id) : undefined
    if (original && original.type === spec.type) return { ...original, ...spec, id: original.id }
    const { id: _ignored, ...rest } = spec
    if (rest.type === 'chart') return { chart: { kind: 'bar', points: [] }, ...rest, id: makeId() }
    return { ...rest, id: makeId() }
  })
}

export const AI_EDIT_FORMAT = `
For an edit, return the same object format with ONLY the fields that need changing, plus type.
Omitted fields are preserved. Arrays, when supplied, replace the entire array: include unchanged entries with their original IDs and all metadata (status, children, projectRef, etc.). Never reset progress or remove entries unless requested.
The object ID, creation date and object type cannot change. Project type uses projectType; project status, folderId and path can also be updated.
`

export const AI_NOTES_FORMAT = `
You may add a noteActions array alongside the object fields:
- {"action":"create","title":"…","content":"Markdown","tags":[],"projectIds":["existing project ID or $self for the project being created/edited"],"pin":false} (pin true also shows the new note as a module on those projects)
- {"action":"link"|"unlink","noteId":"existing note ID or $self for the note being created/edited","projectIds":["existing project ID or $self"]}
- {"action":"delete","noteId":"existing note ID"} (edit mode only, only when explicitly requested; deletes the note everywhere, not just its link).
Use IDs from the supplied inventory. Notes link to projects. Preserve existing links unless asked to remove them. Use unlink to remove only a link. Do not delete the object being edited. Omit noteActions when unnecessary.
`

// Unrelated objects only need identifiers and labels for linking. Keep the edited
// object and its linked notes complete without sending the entire workspace.
export function buildAiContext(data: import('./types').AppData, analysis: AiCreationAnalysis): string {
  const current = analysis.action !== 'edit' ? null
    : analysis.type === 'project' ? data.projects.find((item) => item.id === analysis.targetId)
    : analysis.type === 'note' ? data.notes.find((item) => item.id === analysis.targetId)
    : data.errors.find((item) => item.id === analysis.targetId)
  const linkedNoteIds = current && 'noteIds' in current ? current.noteIds : []
  return JSON.stringify({
    current: current || null,
    linkedNotes: data.notes.filter((note) => linkedNoteIds.includes(note.id)),
    notes: data.notes.map(({ id, title, tags }) => ({ id, title, tags })),
    projects: data.projects.map(({ id, name, noteIds }) => ({ id, name, noteIds })),
    errors: data.errors.map(({ id, title }) => ({ id, title })),
  })
}

export async function requestAiJson<T>(
  request: string,
  call: (request: string) => Promise<string>,
  parser: (answer: string) => T,
  onAttempt: (attempt: number) => void,
): Promise<T> {
  let detail = ''
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    onAttempt(attempt)
    // Transport/provider failures cannot be fixed by parsing the same request again.
    const answer = await call(request)
    try {
      return parser(answer)
    } catch (reason) {
      detail = reason instanceof Error ? reason.message : 'réponse invalide'
    }
  }
  throw new Error(`La proposition de l’IA reste invalide après 3 tentatives (${detail}). Réessaie la génération.`)
}

export interface AiErrorDraft {
  title: string
  content: string
  causes: string
  solution: string
}

export function parseAiErrorDraft(answer: string): AiErrorDraft {
  const draft: unknown = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Fiche erreur invalide.')
  const fields = draft as Record<string, unknown>
  if (['title', 'content', 'causes', 'solution'].some((key) => typeof fields[key] !== 'string') || !(fields.title as string).trim()) throw new Error('Fiche erreur invalide.')
  return { title: (fields.title as string).trim(), content: fields.content as string, causes: fields.causes as string, solution: fields.solution as string }
}

/** A refinement is a patch over the existing proposal, never a fresh object. */
export function mergeAiDraftChanges(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.type !== current.type) throw new Error('Le type du brouillon ne peut pas changer.')
  for (const key of ['id', 'createdAt']) {
    if (key in patch && patch[key] !== current[key]) throw new Error(`Le champ ${key} ne peut pas changer.`)
  }
  return { ...current, ...patch }
}

// Keep full metadata for untouched existing entries, especially task IDs and progress.
export function buildAiDraftProposal(draft: Record<string, unknown>, changes: Record<string, unknown>, current?: Record<string, unknown>): Record<string, unknown> {
  return { ...draft, ...current, ...changes, type: draft.type }
}
