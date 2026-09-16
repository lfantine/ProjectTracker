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

In the description, explain the intended result in enough detail to guide a later creation step. Mention useful ideas where relevant: links or social profiles, images, tags, technology stack, tasks, milestones, deadlines, purchase items, target platforms, or audience.
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
{"type":"project","name":"…","projectType":"dev"|"video","category":"…","platforms":["…"],"tags":["…"],"description":"…","stack":["…"],"links":[{"title":"…","url":"https://…"}],"imageUrl":"https://…","tasks":[{"name":"…","content":"…","status":"a_faire"|"en_cours"|"fait","children":[]}],"checklist":[{"label":"…","type":"generique"|"materiel"|"projet"|"evenement","link":"https://…","description":"…","date":"YYYY-MM-DD"}],"deadlines":[{"label":"…","date":"YYYY-MM-DD"}]}

Only include useful optional values. Use empty arrays when there are no relevant items. A link may have an empty URL only when it is useful to keep it as a placeholder for the user. Only include imageUrl when it is a real, publicly available image URL you are confident exists; never invent an image URL, use an example image, or use a placeholder image. Otherwise use an empty string.
`

export const AI_EDIT_FORMAT = `
For an edit, return the same object format with ONLY the fields that need changing, plus type.
Omitted fields are preserved. Arrays, when supplied, replace the entire array: include unchanged entries with their original IDs and all metadata (status, children, projectRef, etc.). Never reset progress or remove entries unless requested.
The object ID, creation date and object type cannot change. Project type uses projectType; project status, folderId and path can also be updated.
`

export const AI_NOTES_FORMAT = `
You may add a noteActions array alongside the object fields:
- {"action":"create","title":"…","content":"Markdown","tags":[],"projectIds":["existing project ID or $self for the project being created/edited"]}
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
