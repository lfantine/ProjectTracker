import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { NativeBatch } from '../lib/nativeBatch'
import type { CommandParams, NativeCommandName } from '../../shared/commands'
import { operationId } from '../lib/store'
import { useData } from '../lib/store'
import { Markdown } from './Markdown'
import { PrimaryButton, SecondaryButton, Spinner, Textarea } from './ui'
import { SparklesIcon, XIcon } from './icons'
import {
  AI_ANALYSIS_FORMAT,
  buildAiContext,
  mergeAiDraftChanges,
  buildAiDraftProposal,
  requestAiJson,
  AI_EDIT_FORMAT,
  AI_NOTES_FORMAT,
  AI_CREATION_FORMAT,
  AI_REQUIREMENTS_FORMAT,
  buildLayoutFromAiModules,
  parseAiModules,
  type AiModuleSpec,
  type AiCreationAnalysis,
  type AiCreationQuestion,
} from '../lib/aiCreation'
import { defaultChecklistStatus } from '../lib/constants'
import { todayISO, uid } from '../lib/helpers'
import { defaultProjectLayout } from '../lib/types'
import type { ChecklistType, ProjectModule, ProjectType, TaskNode, TaskStatus } from '../lib/types'
import { MODULE_CATALOG } from '../lib/moduleCatalog'

type AiTask = { name: string; content: string; status: TaskStatus; children: AiTask[] }
type AiChecklist = { label: string; type: ChecklistType; link?: string; description?: string; date?: string }
type AiDeadline = { label: string; date: string }

type AiDraft =
  | { type: 'note'; title: string; content: string; tags: string[]; raw: boolean }
  | {
      type: 'error'
      title: string
      content: string
      causes: string
      solution: string
      projectNames: string[]
    }
  | {
      type: 'project'
      name: string
      projectType: ProjectType
      category: string
      platforms: string[]
      tags: string[]
      description: string
      stack: string[]
      links: { title: string; url: string }[]
      imageUrl: string
      tasks: AiTask[]
      checklist: AiChecklist[]
      deadlines: AiDeadline[]
      // null = the proposal leaves the page layout untouched
      modules: AiModuleSpec[] | null
    }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : []
}

function parseTasks(value: unknown): AiTask[] {
  return objectList(value)
    .map((item) => {
      const name = stringValue(item.name)
      if (!name) return null
      const status: TaskStatus = item.status === 'en_cours' || item.status === 'fait' ? item.status : 'a_faire'
      return { name, content: stringValue(item.content), status, children: parseTasks(item.children) }
    })
    .filter((item): item is AiTask => item !== null)
}

function parseChecklist(value: unknown): AiChecklist[] {
  const items: AiChecklist[] = []
  for (const item of objectList(value)) {
    const label = stringValue(item.label)
    if (!label) continue
    const type: ChecklistType = ['materiel', 'projet', 'evenement'].includes(stringValue(item.type))
      ? (stringValue(item.type) as ChecklistType)
      : 'generique'
    const link = stringValue(item.link)
    const description = stringValue(item.description)
    const date = stringValue(item.date)
    items.push({
      label,
      type,
      ...(link && { link }),
      ...(description && { description }),
      ...( /^\d{4}-\d{2}-\d{2}$/.test(date) && { date }),
    })
  }
  return items
}

function parseDeadlines(value: unknown): AiDeadline[] {
  return objectList(value)
    .map((item) => ({ label: stringValue(item.label), date: stringValue(item.date) }))
    .filter((item) => item.label && /^\d{4}-\d{2}-\d{2}$/.test(item.date))
}

function parseAnalysis(answer: string): AiCreationAnalysis {
  const value = parseJson(answer)
  const type = stringValue(value.type).toLowerCase()
  const title = stringValue(value.title)
  const description = stringValue(value.description)
  if (!title || !description || !['note', 'error', 'project'].includes(type)) {
    throw new Error('L’analyse doit contenir un type, un titre et une description valides.')
  }
  if (value.action !== 'create' && value.action !== 'edit') throw new Error('Action invalide.')
  return { needsClarification: value.needsClarification === true, action: value.action, targetId: stringValue(value.targetId) || undefined, type: type as AiCreationAnalysis['type'], title, description }
}

function parseQuestions(answer: string): AiCreationQuestion[] {
  const data = parseJson(answer)
  if (!Array.isArray(data.questions)) {
    throw new Error('La réponse des besoins doit contenir un tableau « questions ».')
  }
  return objectList(data.questions)
    .map((question) => {
      const id = stringValue(question.id).replace(/[^a-z0-9_]/gi, '_')
      const label = stringValue(question.label)
      if (!id || !label) return null
      return {
        id,
        label,
        description: stringValue(question.description),
        placeholder: stringValue(question.placeholder),
        suggestedAnswer: stringValue(question.suggestedAnswer),
        required: question.required === true,
      }
    })
    .filter((question): question is AiCreationQuestion => question !== null)
}

function parseJson(answer: string): Record<string, unknown> {
  const json = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const value = asRecord(JSON.parse(json))
    if (!value) throw new Error()
    return value
  } catch {
    throw new Error('La réponse de l’IA n’est pas un JSON valide. Réessaie.')
  }
}

function parseAiDraft(answer: string, fallbackCategory: string): AiDraft {
  const data = parseJson(answer)

  const type = stringValue(data.type).toLowerCase()
  if (type === 'note') {
    const title = stringValue(data.title)
    if (!title) throw new Error('La note proposée doit avoir un titre.')
    return { type: 'note', title, content: stringValue(data.content), tags: stringList(data.tags), raw: data.raw === true }
  }
  if (type === 'error' || type === 'erreur') {
    const title = stringValue(data.title)
    if (!title) throw new Error('L’erreur proposée doit avoir un titre.')
    return {
      type: 'error',
      title,
      content: stringValue(data.content),
      causes: stringValue(data.causes),
      solution: stringValue(data.solution),
      projectNames: stringList(data.projectNames),
    }
  }
  if (type === 'project' || type === 'projet') {
    const name = stringValue(data.name) || stringValue(data.title)
    if (!name) throw new Error('Le projet proposé doit avoir un nom.')
    const projectType = data.projectType === 'video' || data.project_type === 'video' ? 'video' : 'dev'
    return {
      type: 'project', name, projectType, category: stringValue(data.category) || fallbackCategory,
      platforms: stringList(data.platforms),
      tags: stringList(data.tags),
      description: stringValue(data.description),
      stack: stringList(data.stack),
      links: objectList(data.links)
        .map((link) => ({ title: stringValue(link.title), url: stringValue(link.url) }))
        .filter((link) => link.title && (!link.url || /^https?:\/\//.test(link.url))),
      imageUrl: /^https?:\/\//.test(stringValue(data.imageUrl)) ? stringValue(data.imageUrl) : '',
      tasks: parseTasks(data.tasks),
      checklist: parseChecklist(data.checklist),
      deadlines: parseDeadlines(data.deadlines),
      modules: data.modules == null ? null : parseAiModules(data.modules),
    }
  }
  throw new Error('Type non pris en charge. Utilise « note », « error » ou « project ».')
}

export function CreateWithAiModal({ open, onClose, initialTargetId, initialPrompt = '', embedded = false, onPromptChange, onBusyChange }: { open: boolean; onClose: () => void; initialTargetId?: string; initialPrompt?: string; embedded?: boolean; onPromptChange?: (prompt: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const { data, applyBatch } = useData()
  const proposalData = useRef(data)
  const batchOperation = useRef({ key: '', id: '' })
  const router = useRouter()
  const [selection, setSelection] = useState('auto')
  useEffect(() => { if (open) setSelection(initialTargetId || 'auto') }, [open, initialTargetId])
  const [changes, setChanges] = useState<Record<string, unknown>>({})
  const [noteActions, setNoteActions] = useState<Record<string, unknown>[]>([])
  const objects = [
    ...data.projects.map((item) => ({ type: 'project', id: item.id, title: item.name, item })),
    ...data.notes.map((item) => ({ type: 'note', id: item.id, title: item.title, item })),
    ...data.errors.map((item) => ({ type: 'error', id: item.id, title: item.title, item })),
  ]
  const inventory = JSON.stringify(objects.map(({ item, ...entry }) => entry))
  const [prompt, setPrompt] = useState('')
  useEffect(() => { if (open) setPrompt(initialPrompt) }, [open, initialPrompt])
  const [analysis, setAnalysis] = useState<AiCreationAnalysis | null>(null)
  const target = analysis?.action === 'edit' ? objects.find((item) => item.id === analysis.targetId && item.type === analysis.type) : undefined
  const [questions, setQuestions] = useState<AiCreationQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<AiDraft | null>(null)
  const [refinement, setRefinement] = useState('')
  const [history, setHistory] = useState<{ draft: AiDraft; changes: Record<string, unknown>; actions: Record<string, unknown>[] }[]>([])
  const [revisionFields, setRevisionFields] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => { onBusyChange?.(loading || !!draft); return () => onBusyChange?.(false) }, [loading, draft, onBusyChange])
  const [step, setStep] = useState<'analysis' | 'requirements' | 'creation' | 'refinement' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  useEffect(() => () => { requestIdRef.current += 1 }, [])
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || embedded) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], summary') || []).filter((element) => element.offsetParent !== null)
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [open, embedded])

  function reset() {
    requestIdRef.current += 1
    setRefinement('')
    setHistory([])
    setRevisionFields([])
    setPrompt('')
    onPromptChange?.('')
    setSelection('auto')
    setChanges({})
    setNoteActions([])
    setAnalysis(null)
    setQuestions([])
    setAnswers({})
    setDraft(null)
    setError(null)
    setLoading(false)
    setStep(null)
    setAttempt(0)
  }

  function close() {
    reset()
    onClose()
  }

  async function aiCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const instruction = prompt.trim()
    if (!instruction || loading) return
    proposalData.current = data

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setStep('analysis')
    setError(null)
    setAnalysis(null)
    setQuestions([])
    setAnswers({})
    setDraft(null)
    const request = [
      'Analyse une demande de création ou de modification dans une application de suivi de projets. Identifie un objet existant si la demande vise à le modifier.',
      `Inventaire complet : ${inventory}`,
      `Choix utilisateur : ${selection}. auto = déduire de la demande ; create = création obligatoire ; sinon modifier cet ID.`,
      'Réponds uniquement avec un objet JSON valide, sans Markdown, sans texte autour.',
      AI_ANALYSIS_FORMAT,
      '',
      `Demande utilisateur : ${instruction}`,
    ].join('\n')

    try {
      const result = await callWithJson(request, (answer) => {
        const result = parseAnalysis(answer)
        if (selection === 'create' && result.action !== 'create') throw new Error('Création attendue.')
        if (selection !== 'auto' && selection !== 'create' && (result.action !== 'edit' || result.targetId !== selection)) throw new Error('Objet sélectionné incorrect.')
        if (result.action === 'edit' && !objects.some((item) => item.id === result.targetId && item.type === result.type)) throw new Error('Objet à modifier introuvable.')
        return result
      })
      if (requestIdRef.current !== requestId) return
      setAnalysis(result)
      if (result.needsClarification) await collectRequirements(result, requestId)
      else await generateFinal(result, {}, requestId)
    } catch (reason) {
      if (requestIdRef.current !== requestId) return
      setError(reason instanceof Error ? reason.message : 'La génération a échoué. Réessaie.')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }

  async function collectRequirements(currentAnalysis: AiCreationAnalysis, requestId: number) {
    if (requestIdRef.current !== requestId) return
    setStep('requirements')
    const request = [
      'Check whether any essential information is missing. Prefer proceeding without questions when a useful draft is possible.',
      AI_REQUIREMENTS_FORMAT,
      '',
      `Original request: ${prompt.trim()}`,
      `Analysis / upgraded prompt: ${JSON.stringify(currentAnalysis)}`,
      `Current data and linking inventory: ${buildAiContext(data, currentAnalysis)}`,
    ].join('\n')

    try {
      const result = await callWithJson(request, parseQuestions)
      if (requestIdRef.current !== requestId) return
      setQuestions(result)
      setAnswers(Object.fromEntries(result.map((question) => [question.id, question.suggestedAnswer])))
      if (result.length === 0) await generateFinal(currentAnalysis, {}, requestId)
    } catch (reason) {
      if (requestIdRef.current !== requestId) return
      throw reason
    }
  }

  async function submitAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!analysis || loading) return
    if (questions.some((question) => question.required && !answers[question.id]?.trim())) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    try {
      await generateFinal(analysis, answers, requestId)
    } catch (reason) {
      if (requestIdRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : 'La création détaillée a échoué. Réessaie.')
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }

  async function generateFinal(
    currentAnalysis: AiCreationAnalysis,
    currentAnswers: Record<string, string>,
    requestId: number
  ) {
    if (requestIdRef.current !== requestId) return
    setStep('creation')
    const request = [
      currentAnalysis.action === 'edit' ? 'Update the existing object according to the upgraded prompt. Return only changed fields.' : 'Create the complete data for this approved analysis in a project-tracking application.',
      AI_CREATION_FORMAT,
      currentAnalysis.action === 'edit' ? AI_EDIT_FORMAT : '',
      AI_NOTES_FORMAT,
      `Existing project names (only use these in error.projectNames): ${data.projects.map((project) => project.name).join(', ') || 'none'}.`,
      '',
      `Original request: ${prompt.trim()}`,
      `Analysis / upgraded prompt: ${JSON.stringify(currentAnalysis)}`,
      `Current data and linking inventory: ${buildAiContext(data, currentAnalysis)}`,
      `User answers: ${JSON.stringify(currentAnswers)}`,
      'Include every useful supported detail: URLs, image URL, tags, stack, tasks, checklist items, and deadlines when relevant.',
    ].join('\n')

    try {
      const result = await callWithJson(request, (answer) => {
        return parseProposal(answer, currentAnalysis)
      })
      if (requestIdRef.current !== requestId) return
      setDraft(result.draft)
      setChanges(result.raw)
      setNoteActions(result.actions)
    } catch (reason) {
      if (requestIdRef.current !== requestId) return
      throw reason
    }
  }

  function parseProposal(answer: string, currentAnalysis: AiCreationAnalysis, previous?: Record<string, unknown>) {
    const patch = parseJson(answer)
    const raw = previous ? mergeAiDraftChanges(previous, patch) : patch
    if (raw.type !== currentAnalysis.type) throw new Error('Le type doit correspondre à l’analyse.')
    const existing = objects.find((item) => item.id === currentAnalysis.targetId)?.item
    const base = existing ? { ...existing, ...('name' in existing ? { projectType: existing.type, projectNames: [], modules: projectLayout(existing.layout) } : {}), ...('projectIds' in existing ? { projectNames: data.projects.filter((p) => existing.projectIds.includes(p.id)).map((p) => p.name) } : {}) } : {}
    validateChanges(raw)
    if ('modules' in raw) {
      const layout = existing && 'name' in existing ? projectLayout(existing.layout) : []
      parseAiModules(raw.modules, { noteIds: data.notes.map((n) => n.id), errorIds: data.errors.map((e) => e.id), moduleIds: layout.map((m) => m.id) })
    }
    const actions = objectList(raw.noteActions)
    if (Array.isArray(raw.noteActions) && actions.length !== raw.noteActions.length) throw new Error('Action de note invalide.')
    for (const action of actions) {
      if ('projectIds' in action && (!Array.isArray(action.projectIds) || action.projectIds.some((id) => typeof id !== 'string'))) throw new Error('Liaisons de notes invalides.')
      if (!['create', 'delete', 'link', 'unlink'].includes(String(action.action))) throw new Error('Action de note invalide.')
      if (action.action === 'create' && !stringValue(action.title)) throw new Error('Titre de note manquant.')
      if (action.action !== 'create' && !(action.noteId === '$self' && currentAnalysis.type === 'note') && !data.notes.some((n) => n.id === action.noteId)) throw new Error('Note introuvable.')
      if (action.action === 'delete' && (currentAnalysis.action !== 'edit' || action.noteId === currentAnalysis.targetId || action.noteId === '$self')) throw new Error('Suppression de note non autorisée.')
      if (stringList(action.projectIds).some((id) => !(id === '$self' && currentAnalysis.type === 'project') && !data.projects.some((p) => p.id === id))) throw new Error('Projet lié introuvable.')
      if (actions.some((other) => other.action === 'delete' && other !== action && other.noteId === action.noteId)) throw new Error('Actions de notes contradictoires.')
    }
    return { draft: parseAiDraft(JSON.stringify({ ...base, ...raw }), data.categories[0] || 'Software'), raw, actions, fields: Object.keys(patch).filter((key) => key !== 'type' && JSON.stringify(patch[key]) !== JSON.stringify(previous?.[key])) }
  }

  async function refineDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !analysis || !refinement.trim() || loading) return
    const snapshot = { draft, changes, actions: noteActions }
    const requestId = ++requestIdRef.current
    setLoading(true)
    setStep('refinement')
    setError(null)
    const request = [
      'Modifie uniquement le brouillon ci-dessous selon cette nouvelle demande. Ne repars pas de zéro. Réponds en JSON avec type et seulement les champs modifiés. Conserve tous les détails non concernés, les IDs et les statuts existants.',
      AI_CREATION_FORMAT, AI_EDIT_FORMAT, AI_NOTES_FORMAT,
      'Pour un tableau modifié, renvoie le tableau complet avec les entrées conservées et toutes leurs métadonnées. noteActions représente la liste complète des actions proposées, pas des actions supplémentaires. Ne supprime une entrée que si la demande le justifie.',
      `Brouillon actuel : ${JSON.stringify({ ...buildAiDraftProposal({ ...draft }, changes, target ? { ...target.item } : undefined), noteActions })}`,
      `Contexte : ${buildAiContext(data, analysis)}`,
      `Demande initiale : ${prompt}`,
      `Nouvelle demande : ${refinement.trim()}`,
    ].join('\n')
    try {
      const result = await callWithJson(request, (answer) => parseProposal(answer, analysis, changes))
      if (requestIdRef.current !== requestId) return
      setHistory((previous) => [...previous, snapshot])
      setDraft(result.draft)
      setChanges(result.raw)
      setNoteActions(result.actions)
      setRevisionFields(result.fields)
      setRefinement('')
    } catch (reason) {
      if (requestIdRef.current === requestId) setError(reason instanceof Error ? reason.message : 'La modification a échoué. Le brouillon précédent est conservé.')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }

  function undoRefinement() {
    const previous = history[history.length - 1]
    if (!previous || loading) return
    setDraft(previous.draft)
    setChanges(previous.changes)
    setNoteActions(previous.actions)
    setHistory((items) => items.slice(0, -1))
    setRevisionFields([])
    setError(null)
  }

  function refTitle(id?: string): string {
    return data.notes.find((n) => n.id === id)?.title || data.errors.find((e) => e.id === id)?.title || 'introuvable'
  }

  async function callWithJson<T>(request: string, parser: (answer: string) => T): Promise<T> {
    return requestAiJson(request, (value) => window.api.ai.call(value), parser, setAttempt)
  }

  async function persistDraft() {
    if (!draft || loading) return
    const batch = new NativeBatch()
    const baseline = proposalData.current
    const target = analysis?.action === 'edit' ? [
      ...baseline.projects.map((item) => ({ type: 'project', id: item.id, item })),
      ...baseline.notes.map((item) => ({ type: 'note', id: item.id, item })),
      ...baseline.errors.map((item) => ({ type: 'error', id: item.id, item })),
    ].find((item) => item.id === analysis.targetId && item.type === analysis.type) : undefined
    const addNote = async (input: CommandParams<'notes.create'>['input']) => batch.add('notes.create', { input, operationId: operationId() })
    const addProject = async (input: CommandParams<'projects.create'>['input']) => batch.add('projects.create', { input, operationId: operationId() })
    const addError = async (input: CommandParams<'errors.create'>['input']) => batch.add('errors.create', { input, operationId: operationId() })
    const record = async <K extends Exclude<NativeCommandName, 'core.batch'>>(name: K, params: CommandParams<K>) => {
      batch.add(name, params)
      return true
    }
    const updateNote = (id: string, patch: CommandParams<'notes.update'>['patch']) => record('notes.update', { id, patch, expectedRevision: baseline.notes.find((item) => item.id === id)?.revision })
    const updateProject = (id: string, patch: CommandParams<'projects.update'>['patch']) => record('projects.update', { id, patch, expectedRevision: baseline.projects.find((item) => item.id === id)?.revision })
    const updateError = (id: string, patch: CommandParams<'errors.update'>['patch']) => record('errors.update', { id, patch, expectedRevision: baseline.errors.find((item) => item.id === id)?.revision })
    const removeNote = (id: string) => record('notes.trash', { id })
    const linkNote = (projectId: string, noteId: string) => record('projects.linkNote', { projectId, noteId })
    const unlinkNote = (projectId: string, noteId: string) => record('projects.unlinkNote', { projectId, noteId })
    const linkError = (projectId: string, errorId: string) => record('projects.linkError', { projectId, errorId })
    const unlinkError = (projectId: string, errorId: string) => record('projects.unlinkError', { projectId, errorId })
    const addModule = (projectId: string, block: ProjectModule) => record('blocks.add', { projectId, block })
    const finish = async (route: string) => {
      const key = JSON.stringify({ draft, changes, noteActions, analysis })
      if (batchOperation.current.key !== key) batchOperation.current = { key, id: operationId() }
      const results = batch.steps.length ? await applyBatch(batch.steps, batchOperation.current.id) : []
      if (!results) throw new Error('L’enregistrement a échoué. Aucune modification de la proposition n’a été appliquée.')
      close()
      await router.push(batch.resolveRoute(route, results))
    }
    async function applyNotes(selfId: string) {
      for (const action of noteActions) {
        const projectIds = stringList(action.projectIds).map((id) => id === '$self' ? selfId : id)
        const created = action.action === 'create' ? await addNote({ title: stringValue(action.title), content: stringValue(action.content), tags: stringList(action.tags) }) : null
        if (action.action === 'create' && !created) throw new Error('La note n’a pas été enregistrée.')
        const noteId = created ? created.id : action.noteId === '$self' ? selfId : String(action.noteId)
        if (action.action === 'delete') await requireSaved(removeNote(noteId))
        else for (const projectId of projectIds) {
          if (action.action === 'unlink') await requireSaved(unlinkNote(projectId, noteId))
          else await requireSaved(linkNote(projectId, noteId))
          if (action.action === 'create' && action.pin === true) await requireSaved(addModule(projectId, { id: uid('mod'), type: 'note', refId: noteId }))
        }
      }
    }

    // A pinned note/error module only renders for items linked to the project.
    async function linkPinned(projectId: string, layout: ProjectModule[]) {
      for (const m of layout) {
        if (m.type === 'note' && m.refId) await requireSaved(linkNote(projectId, m.refId))
        if (m.type === 'error' && m.refId) await requireSaved(linkError(projectId, m.refId))
      }
    }

    if (analysis?.action === 'edit') {
      if (!target) { setError('L’objet à modifier n’existe plus.'); return }
      if (draft.type === 'note') await requireSaved(updateNote(target.id, { title: draft.title, content: draft.content, tags: draft.tags, raw: draft.raw }))
      if (draft.type === 'error') {
        await requireSaved(updateError(target.id, { title: draft.title, content: draft.content, causes: draft.causes, solution: draft.solution }))
        if ('projectNames' in changes) for (const project of data.projects) {
          if (draft.projectNames.includes(project.name)) await requireSaved(linkError(project.id, target.id))
          else await requireSaved(unlinkError(project.id, target.id))
        }
      }
      if (draft.type === 'project' && 'name' in target.item) {
        const patch: Record<string, unknown> = {}
        for (const key of ['name', 'category', 'platforms', 'tags', 'description', 'stack', 'tasks', 'checklist', 'deadlines', 'links'] as const) {
          if (key in changes) patch[key] = draft[key]
        }
        for (const key of ['tasks', 'checklist', 'deadlines', 'links'] as const) {
          if (key in changes) patch[key] = restoreEntries(objectList(changes[key]), objectList(target.item[key]), key)
        }
        if ('projectType' in changes) patch.type = draft.projectType
        if (['actif', 'pause', 'termine', 'aborted'].includes(String(changes.status))) patch.status = changes.status
        if (typeof changes.path === 'string') patch.path = changes.path
        if (typeof changes.folderId === 'string' && data.folders.some((f) => f.id === changes.folderId)) patch.folderId = changes.folderId
        const currentLayout = projectLayout(target.item.layout)
        let layout = 'modules' in changes && draft.modules ? buildLayoutFromAiModules(draft.modules, currentLayout, () => uid('mod')) : currentLayout
        if ('imageUrl' in changes && !('modules' in changes)) layout = withImageUrl(layout, draft.imageUrl)
        if ('stack' in changes) layout = withStackModule(layout, draft.stack)
        if (layout !== currentLayout) patch.layout = layout
        await requireSaved(updateProject(target.id, patch))
        await linkPinned(target.id, layout)
      }
      await applyNotes(target.id)
      const url = draft.type === 'project' ? `/project?id=${target.id}` : draft.type === 'note' ? `/notes/detail?id=${target.id}` : '/errors'
      await finish(url)
      return
    }
    if (draft.type === 'note') {
      const note = await addNote({ title: draft.title, content: draft.content, tags: draft.tags })
      if (!note) return
      if (draft.raw) await requireSaved(updateNote(note.id, { raw: true }))
      await applyNotes(note.id)
      await finish(`/notes/detail?id=${note.id}`)
      return
    }
    if (draft.type === 'error') {
      const projectIds = data.projects
        .filter((project) => draft.projectNames.some((name) => name.toLowerCase() === project.name.toLowerCase()))
        .map((project) => project.id)
      const createdError = await addError({
        title: draft.title,
        content: draft.content,
        causes: draft.causes,
        solution: draft.solution,
        projectIds,
      })
      if (!createdError) return
      await applyNotes(createdError.id)
      await finish('/errors')
      return
    }
    let createdLayout: ProjectModule[] = draft.modules ? buildLayoutFromAiModules(draft.modules, [], () => uid('mod')) : defaultProjectLayout()
    if (draft.imageUrl && !createdLayout.some((m) => m.type === 'image' && m.imageUrl === draft.imageUrl)) createdLayout = withImageUrl(createdLayout, draft.imageUrl)
    createdLayout = withStackModule(createdLayout, draft.stack)
    const project = await addProject({
      name: draft.name, type: draft.projectType, category: draft.category,
      platforms: draft.platforms,
      tags: draft.tags,
      tasks: createTaskNodes(draft.tasks),
      checklist: draft.checklist.map((item) => ({
        id: uid('c'),
        ...item,
        status: defaultChecklistStatus(item.type),
      })),
      deadlines: draft.deadlines.map((deadline) => ({
        id: uid('d'),
        ...deadline,
        status: deadline.date < todayISO() ? 'depasse' : 'a_venir',
      })),
    })
    if (!project) return
    await requireSaved(updateProject(project.id, {
      description: draft.description,
      stack: draft.stack,
      links: draft.links.map((link) => ({ id: uid('l'), ...link })),
      layout: createdLayout,
    }))
    await linkPinned(project.id, createdLayout)
    await applyNotes(project.id)
    await finish(`/project?id=${project.id}`)
  }

  async function requireSaved(result: Promise<boolean>) {
    if (!await result) throw new Error('L’enregistrement a échoué. Le brouillon est conservé.')
  }

  async function applyDraft() {
    if (loading) return
    setLoading(true)
    try { await persistDraft() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'L’enregistrement a échoué.') }
    finally { setLoading(false) }
  }

  if (!open) return null

  return (
    <div className={embedded ? "min-w-0" : "fixed inset-0 bg-overlay flex items-center justify-center z-50 p-8"} onClick={embedded ? undefined : close}>
      <div ref={dialogRef} tabIndex={-1} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="Créer ou modifier avec l’IA" onClick={(event) => event.stopPropagation()} className={embedded ? "contents" : "bg-surface border border-border rounded-2xl shadow-2xl flex flex-col w-full"} style={embedded ? { width: '100%' } : { width: '80vw', maxWidth: 'calc(100vw - 32px)', height: '80vh', maxHeight: '80vh' }}>
        {!embedded && <div className="flex items-center justify-between border-b border-border flex-shrink-0 px-7 py-5">
          <div className="flex items-center gap-2"><SparklesIcon size={17} /><h2 className={embedded ? "text-[14px] font-bold" : "text-[18px] font-bold"}>Créer ou modifier avec l&apos;IA</h2></div>
          {!embedded && <button type="button" onClick={close} className="border-none bg-transparent text-text-muted cursor-pointer flex items-center" aria-label="Fermer"><XIcon size={20} /></button>}
        </div>}
        <div className={`flex-1 overflow-auto ${embedded ? "px-5 pb-4" : "px-7 py-6"}`}>
          <form onSubmit={aiCall} className={embedded ? "flex flex-wrap items-end justify-between gap-3" : "flex flex-col gap-3"}>
            {!embedded && <p className="text-[13.5px] text-text-muted leading-relaxed">Décris ce que tu veux créer ou modifier. L&apos;IA prépare une proposition structurée que tu pourras vérifier avant de l&apos;appliquer.</p>}
            <label className={embedded ? "flex min-w-0 flex-1 flex-col gap-1.5 text-[11px] text-text-muted" : "flex flex-col gap-2 text-[13px]"}>{embedded ? "Contexte" : "Étape 1 · Objet à créer ou modifier"}
              <select aria-label="Objet à créer ou modifier" value={selection} disabled={loading || !!draft} onChange={(event) => { setSelection(event.target.value); setAnalysis(null); setDraft(null); setQuestions([]); setError(null) }} className="bg-bg border border-border rounded-lg p-2">
                <option value="auto">Laisser l’IA choisir selon la demande</option>
                <option value="create">Créer un nouvel objet</option>
                {objects.map((item) => <option key={item.id} value={item.id}>Modifier · {item.type} · {item.title}</option>)}
              </select>
              {!embedded && <span className="text-text-muted">{objects.length} objets existants disponibles dans la liste.</span>}
            </label>
            {!embedded && <Textarea aria-label="Demande pour l’IA" value={prompt} onChange={(event) => { setPrompt(event.target.value); onPromptChange?.(event.target.value); setDraft(null); setAnalysis(null); setQuestions([]) }} placeholder="Ex. Crée un projet vidéo pour une série de tutoriels ESP32, avec YouTube et TikTok." disabled={loading || !!draft} required autoFocus={!embedded} className="w-full" style={{ minHeight: 100 }} />}
            <div className="flex justify-end"><PrimaryButton type="submit" disabled={!prompt.trim() || loading || !!draft}><span className="flex items-center gap-1.5">{loading && <Spinner size={13} />}<SparklesIcon size={13} /> {loading ? 'Génération…' : 'Générer la proposition'}</span></PrimaryButton></div>
          </form>
          {loading && <ProcessingPanel step={step} attempt={attempt} />}
          {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
          {analysis && !draft && (
            <div className="mt-6 pt-5 border-t border-border">
              <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-2">Étape 1 sur 3 · Analyse</div>
              <div className="rounded-xl border border-border bg-bg p-4">
                <p className="text-[11px] font-bold text-accent-soft-text uppercase tracking-wide mb-1">{analysis.action === 'edit' ? 'Modifier' : 'Créer'} · {analysis.type}</p>
                <h3 className="text-[17px] font-bold mb-2">{analysis.title}</h3>
                <p className="text-[13.5px] text-text-muted">{analysis.description}</p>
              </div>
            </div>
          )}
          {analysis && questions.length > 0 && !draft && !loading && (
            <form onSubmit={submitAnswers} className="mt-5 rounded-xl border border-border bg-bg p-4">
              <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-2">Étape 2 sur 3 · Précisions</div>
              <p className="text-[13.5px] text-text-muted mb-4">Valide les réponses proposées ou ajuste-les. Les champs sans astérisque sont facultatifs.</p>
              <div className="flex flex-col gap-3">
                {questions.map((question) => <label key={question.id} className="flex flex-col gap-1"><span className="text-[13px] font-bold">{question.label}{question.required && ' *'}</span>{question.suggestedAnswer && <span className="text-[12px] text-accent-soft-text">Réponse proposée · modifiable</span>}{question.description && <span className="text-[12px] text-text-faint">{question.description}</span>}<Textarea value={answers[question.id] || ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.placeholder} required={question.required} className="w-full" style={{ minHeight: 68 }} /></label>)}
              </div>
              <div className="flex justify-end mt-4"><PrimaryButton type="submit"><span className="flex items-center gap-1.5"><SparklesIcon size={13} /> Valider et générer la proposition</span></PrimaryButton></div>
            </form>
          )}
          {draft && <div className="mt-6 pt-5 border-t border-border"><div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-2">{analysis?.action === 'edit' ? `Modification de ${target?.title || ''}` : 'Élément à créer'}</div><DraftPreview draft={draft} refTitle={refTitle} />
            {analysis?.action === 'edit' && <><PreviewField label="Champs modifiés" value={Object.keys(changes).filter((key) => !['type', 'noteActions'].includes(key)).join(', ')} /><details className="mt-3"><summary className="cursor-pointer text-[13px]">Voir toutes les modifications</summary><pre className="mt-2 whitespace-pre-wrap text-[12px] overflow-auto">{JSON.stringify(Object.fromEntries(Object.entries(changes).filter(([key]) => !['type', 'noteActions'].includes(key))), null, 2)}</pre></details></>}
            {noteActions.length > 0 && <div className="mt-4 flex flex-col gap-3"><h3 className="font-bold">Notes et liaisons proposées</h3>{noteActions.map((action, index) => <div key={index} className="border border-border rounded-lg p-3"><PreviewField label={action.action === 'delete' ? 'Supprimer partout' : action.action === 'create' ? 'Créer une note' : action.action === 'unlink' ? 'Délier la note' : 'Lier la note'} value={stringValue(action.title) || data.notes.find((n) => n.id === action.noteId)?.title || 'Cet objet'} />{Boolean(action.content) && <Markdown text={String(action.content)} />}<PreviewField label="Projets" value={stringList(action.projectIds).map((id) => id === '$self' ? 'Ce projet' : data.projects.find((p) => p.id === id)?.name || id).join(', ')} /></div>)}</div>}</div>}
          {draft && <form onSubmit={refineDraft} className="mt-5 border-t border-border pt-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold">Ajuster cette proposition{history.length > 0 ? ` · version ${history.length + 1}` : ''}</h3>
              <SecondaryButton onClick={undoRefinement} disabled={loading || !history.length}>Annuler le dernier ajustement</SecondaryButton>
            </div>
            {history.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-text-muted">Voir la version précédente</summary><div className="mt-3"><DraftPreview draft={history[history.length - 1].draft} refTitle={refTitle} /></div></details>}
            {revisionFields.length > 0 && <p role="status" className="text-xs text-text-muted">Champs ajustés : {revisionFields.map((key) => ({ name: 'nom', title: 'titre', tasks: 'tâches', checklist: 'checklist', deadlines: 'échéances', description: 'description', content: 'contenu', stack: 'stack', links: 'liens', noteActions: 'notes liées', modules: 'modules', tags: 'tags', projectType: 'type de projet', causes: 'causes', solution: 'solution', projectNames: 'projets liés' } as Record<string, string>)[key] || key).join(', ')}.</p>}
            <Textarea aria-label="Ajustements du brouillon" value={refinement} onChange={(event) => setRefinement(event.target.value)} placeholder="Ex. Ajoute les tests aux tâches et avance la première échéance. Garde le reste." disabled={loading} className="w-full min-h-24" />
            <p className="text-xs text-text-faint">Le brouillon reste ici jusqu’à validation. Les ajustements conservent les autres détails.</p>
            <div className="flex justify-between gap-2">
              <SecondaryButton onClick={reset} disabled={loading}>Nouvelle demande</SecondaryButton>
              <PrimaryButton type="submit" disabled={loading || !refinement.trim()}>{loading ? 'Modification…' : 'Ajuster le brouillon'}</PrimaryButton>
            </div>
          </form>}
        </div>
        {draft && <div className="flex justify-end gap-2 px-7 py-4 border-t border-border flex-shrink-0"><SecondaryButton onClick={close}>Abandonner</SecondaryButton><PrimaryButton onClick={applyDraft} disabled={loading}>{analysis?.action === 'edit' ? 'Appliquer les modifications' : 'Approuver la création'}</PrimaryButton></div>}
      </div>
    </div>
  )
}

function ProcessingPanel({ step, attempt }: { step: 'analysis' | 'requirements' | 'creation' | 'refinement' | null; attempt: number }) {
  const isAnalysis = step === 'analysis'
  const isRequirements = step === 'requirements'
  const isRefinement = step === 'refinement'
  return (
    <div className="mt-5 rounded-xl border border-accent bg-accent-soft p-5 flex items-center gap-3 text-[13.5px] text-accent-soft-text">
      <Spinner size={18} />
      <div>
        <p className="font-bold">{isRefinement ? 'Ajustement du brouillon' : <>Étape {isAnalysis ? '1' : isRequirements ? '2' : '3'} sur 3 · {isAnalysis ? 'Analyse de la demande' : isRequirements ? 'Recherche des informations manquantes' : 'Création de la proposition'}</>}</p>
        <p className="text-[12.5px] opacity-80">{isRefinement ? 'L’IA modifie la proposition actuelle et conserve les détails non concernés.' : isAnalysis ? 'L’IA identifie le type, le titre et l’objectif de l’élément.' : isRequirements ? 'L’IA vérifie si une précision est indispensable avant de continuer.' : 'L’IA ajoute les détails utiles : liens, image, tags, tâches et échéances.'}{attempt > 1 && ` Nouvelle tentative JSON (${attempt}/3).`}</p>
      </div>
    </div>
  )
}

function DraftPreview({ draft, refTitle }: { draft: AiDraft; refTitle: (id?: string) => string }) {
  if (draft.type === 'note') {
    return <div className="rounded-xl border border-border bg-bg p-4">
      <p className="text-[11px] font-bold text-accent-soft-text uppercase tracking-wide mb-1">Note</p>
      <h3 className="text-[17px] font-bold mb-2">{draft.title}</h3>
      {draft.tags.length > 0 && <p className="text-[12px] text-text-faint mb-3">Tags : {draft.tags.join(', ')}</p>}
      {draft.raw ? <pre className="whitespace-pre-wrap font-mono text-[13.5px] text-text">{draft.content}</pre> : <Markdown text={draft.content} />}
    </div>
  }
  if (draft.type === 'error') {
    return <div className="rounded-xl border border-border bg-bg p-4">
      <p className="text-[11px] font-bold text-danger uppercase tracking-wide mb-1">Erreur</p>
      <h3 className="text-[17px] font-bold mb-3">{draft.title}</h3>
      <PreviewField label="Description" value={draft.content} />
      <PreviewField label="Causes" value={draft.causes} />
      <PreviewField label="Solution" value={draft.solution} />
      {draft.projectNames.length > 0 && <PreviewField label="Projets liés" value={draft.projectNames.join(', ')} />}
    </div>
  }
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <p className="text-[11px] font-bold text-accent-soft-text uppercase tracking-wide mb-1">Projet</p>
      <h3 className="text-[17px] font-bold mb-3">{draft.name}</h3>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-[13px]">
        <PreviewField label="Type" value={draft.projectType === 'video' ? 'Vidéo' : 'Développement'} />
        <PreviewField label="Catégorie" value={draft.category} />
        <PreviewField label="Plateformes" value={draft.platforms.join(', ') || 'Aucune'} />
        <PreviewField label="Tags" value={draft.tags.join(', ') || 'Aucun'} />
        <PreviewField label="Stack" value={draft.stack.join(', ') || 'Aucune'} />
        <PreviewField label="Contenu" value={`${draft.tasks.length} tâche(s), ${draft.checklist.length} élément(s), ${draft.deadlines.length} échéance(s)`} />
      </div>
      {draft.description && <div className="mt-3 pt-3 border-t border-border"><PreviewField label="Description" value={draft.description} /></div>}
      {draft.links.length > 0 && <div className="mt-3"><PreviewField label="Liens" value={draft.links.map((link) => `${link.title} — ${link.url}`).join('\n')} /></div>}
      {draft.tasks.length > 0 && <details open className="mt-4">
        <summary className="font-semibold text-sm cursor-pointer">Tâches proposées</summary>
        <DraftTaskList tasks={draft.tasks} />
      </details>}
      {draft.checklist.length > 0 && <details className="mt-3">
        <summary className="font-semibold text-sm cursor-pointer">Checklist</summary>
        <ul className="mt-2 text-sm">{draft.checklist.map((item, index) => <li key={index} className="border-b border-border py-2">
          <span className="font-semibold">{item.label}</span>
          {item.description && <p className="text-text-muted text-xs mt-1">{item.description}</p>}
        </li>)}</ul>
      </details>}
      {draft.deadlines.length > 0 && <div className="mt-3"><PreviewField label="Échéances" value={draft.deadlines.map((item) => `${item.date} · ${item.label}`).join('\n')} /></div>}
      {draft.modules && <div className="mt-3"><PreviewField label="Modules de la page" value={draft.modules.length ? draft.modules.map((m, i) => `${i + 1}. ${moduleLabel(m, refTitle)}`).join('\n') : 'Aucun (disposition par défaut)'} /></div>}
      {draft.imageUrl && <img src={draft.imageUrl} alt="Illustration proposée" className="mt-3 max-h-48 rounded-lg border border-border object-cover" />}
    </div>
  )
}

function DraftTaskList({ tasks }: { tasks: AiTask[] }) {
  return <ul className="mt-2 flex flex-col gap-2 border-l border-border pl-3">{tasks.map((task, index) => <li key={index}>
    <div className="flex items-start justify-between gap-3 text-sm"><span className="font-semibold">{task.name}</span><span className="text-xs text-text-faint whitespace-nowrap">{task.status === 'fait' ? 'Fait' : task.status === 'en_cours' ? 'En cours' : 'À faire'}</span></div>
    {task.content && <div className="mt-1 text-xs text-text-muted"><Markdown text={task.content} /></div>}
    {task.children.length > 0 && <DraftTaskList tasks={task.children} />}
  </li>)}</ul>
}

function createTaskNodes(tasks: AiTask[]): TaskNode[] {
  return tasks.map((task) => ({
    id: uid('t'),
    name: task.name,
    content: task.content,
    status: task.status,
    children: createTaskNodes(task.children),
  }))
}

function projectLayout(layout?: ProjectModule[]): ProjectModule[] {
  return layout && layout.length > 0 ? layout : defaultProjectLayout()
}

function moduleLabel(m: AiModuleSpec, refTitle: (id?: string) => string): string {
  const base = m.type === 'tasks' ? 'Tâches' : MODULE_CATALOG.find((entry) => entry.type === m.type)?.title || m.type
  if (m.type === 'note' || m.type === 'error') return `${base} · ${refTitle(m.refId)}`
  if (m.type === 'chart') return `${base}${m.title ? ` « ${m.title} »` : ''} · ${m.chart?.kind === 'line' ? 'courbe' : 'barres'}, ${m.chart?.points.length || 0} valeur(s)`
  if (m.type === 'image') return `${base}${m.title ? ` « ${m.title} »` : ''}${m.imageUrl ? ' · image' : ''}${m.text ? ' · texte' : ''}`
  return base
}

// Set the image without wiping user-written image/text blocks.
function withImageUrl(layout: ProjectModule[], imageUrl: string): ProjectModule[] {
  const index = layout.findIndex((m) => m.type === 'image')
  if (imageUrl) {
    if (index === -1) return layout.concat([{ id: uid('mod'), type: 'image', title: '', imageUrl, text: '' }])
    return layout.map((m, i) => (i === index ? { ...m, imageUrl } : m))
  }
  return layout
    .filter((m) => !(m.type === 'image' && !m.title && !m.text?.trim()))
    .map((m) => (m.type === 'image' ? { ...m, imageUrl: '' } : m))
}

// A stack filled by the AI is useless if the page has no Stack module to show it.
function withStackModule(layout: ProjectModule[], stack: string[]): ProjectModule[] {
  if (!stack.length || layout.some((m) => m.type === 'stack')) return layout
  return layout.concat([{ id: uid('mod'), type: 'stack' }])
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-0.5">{label}</p><p className="whitespace-pre-wrap text-[13.5px] text-text">{value || '—'}</p></div>
}

// Preserve IDs and metadata on retained entries; assign IDs only to new entries.
function restoreEntries(entries: Record<string, unknown>[], previous: Record<string, unknown>[], kind: string): Record<string, unknown>[] {
  return entries.map((entry) => {
    const original = previous.find((item) => item.id === entry.id)
    const merged = { ...original, ...entry, id: original?.id || uid(kind) }
    if (kind === 'tasks') return { status: 'a_faire', content: '', ...merged, children: restoreEntries(objectList(entry.children ?? original?.children), objectList(original?.children), kind) }
    if (kind === 'checklist') return { status: defaultChecklistStatus((entry.type || original?.type || 'generique') as ChecklistType), ...merged }
    if (kind === 'links') return { url: '', ...merged }
    if (kind === 'deadlines') return { status: String(entry.date) < todayISO() ? 'depasse' : 'a_venir', ...merged }
    return merged
  })
}

function validateChanges(raw: Record<string, unknown>) {
  const arrays = ['tags', 'platforms', 'stack', 'projectNames', 'tasks', 'checklist', 'deadlines', 'links', 'noteActions']
  for (const key of arrays) if (key in raw && !Array.isArray(raw[key])) throw new Error(`Tableau invalide : ${key}`)
  for (const key of ['tags', 'platforms', 'stack', 'projectNames']) {
    if (Array.isArray(raw[key]) && raw[key].some((value) => typeof value !== 'string')) throw new Error(`Liste de textes invalide : ${key}`)
  }
  if ('projectType' in raw && !['dev', 'video'].includes(String(raw.projectType))) throw new Error('Type de projet invalide.')
  if ('status' in raw && !['actif', 'pause', 'termine', 'aborted'].includes(String(raw.status))) throw new Error('Statut de projet invalide.')
  if ('raw' in raw && typeof raw.raw !== 'boolean') throw new Error('Mode de note invalide.')
  for (const key of ['title', 'name', 'content', 'description', 'causes', 'solution', 'category', 'imageUrl']) {
    if (key in raw && typeof raw[key] !== 'string') throw new Error(`Texte invalide : ${key}`)
  }
  const visit = (entries: unknown, kind: string) => {
    if (!Array.isArray(entries)) throw new Error(`Tableau invalide : ${kind}`)
    for (const value of entries) {
      const entry = asRecord(value)
      if (!entry || !stringValue(entry[kind === 'tasks' ? 'name' : kind === 'links' ? 'title' : 'label'])) throw new Error(`Élément invalide : ${kind}`)
      if (kind === 'links' && 'url' in entry && (typeof entry.url !== 'string' || (entry.url && !/^https?:\/\//.test(entry.url)))) throw new Error('URL de lien invalide.')
      if (kind === 'tasks') {
        if ('status' in entry && !['a_faire', 'en_cours', 'fait'].includes(String(entry.status))) throw new Error('Statut de tâche invalide.')
        if ('children' in entry) visit(entry.children, kind)
      }
      if (kind === 'checklist' && !['generique', 'materiel', 'projet', 'evenement'].includes(String(entry.type))) throw new Error('Type de checklist invalide.')
      if (kind === 'checklist' && 'status' in entry && !['a_faire', 'en_cours', 'fait', 'bloque', 'a_acheter', 'commande', 'achete', 'a_venir', 'annule', 'en_attente', 'pret'].includes(String(entry.status))) throw new Error('Statut de checklist invalide.')
      if (kind === 'deadlines' && 'status' in entry && !['a_venir', 'fait', 'depasse'].includes(String(entry.status))) throw new Error('Statut d’échéance invalide.')
      if (kind === 'deadlines' && !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date))) throw new Error('Date invalide.')
    }
  }
  for (const key of ['tasks', 'checklist', 'deadlines', 'links']) if (key in raw) visit(raw[key], key)
}
