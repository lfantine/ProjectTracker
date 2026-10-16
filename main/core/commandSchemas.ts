import { z } from 'zod'
import { NATIVE_COMMAND_NAMES, type NativeCommandName } from '../../shared/commands'

// Runtime validation of native command parameters. The renderer is trusted
// code, but every IPC payload is still checked before it reaches SQLite.

const id = z.string().min(1).max(200)
const text = z.string().max(1_000_000)
const shortText = z.string().max(10_000)
const strings = z.array(z.string().max(10_000)).max(10_000)
const operationId = z.string().min(8).max(100)
const revision = z.number().int().nonnegative().optional()
const projectType = z.enum(['dev', 'video'])
const projectStatus = z.enum(['actif', 'pause', 'termine', 'aborted'])
const taskStatus = z.enum(['a_faire', 'en_cours', 'fait'])
const checklistType = z.enum(['generique', 'materiel', 'projet', 'evenement'])
const checklistStatus = z.enum(['a_faire', 'en_cours', 'fait', 'bloque', 'a_acheter', 'commande', 'achete', 'a_venir', 'annule', 'en_attente', 'pret'])

type TaskInput = { id: string; name: string; content: string; status: string; children: TaskInput[] }
const task: z.ZodType<TaskInput> = z.lazy(() =>
  z.looseObject({ id, name: shortText, content: text, status: taskStatus, children: z.array(task).max(5000) })
)
const checklistItem = z.looseObject({
  id,
  label: shortText,
  type: checklistType,
  status: checklistStatus,
  link: shortText.optional(),
  projectRef: id.optional(),
  date: z.string().max(40).optional(),
  description: shortText.optional(),
})
const deadline = z.looseObject({ id, label: shortText, date: z.string().max(40), status: z.enum(['a_venir', 'fait', 'depasse']) })
const link = z.looseObject({ id, title: shortText, url: shortText })
const contributionRef = z.strictObject({ packageId: id, contributionId: id })
const binding = z.union([
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('active'), major: contributionRef }),
  z.strictObject({ mode: z.literal('fixed'), major: contributionRef, instanceId: id }),
])
const module = z.looseObject({
  id,
  type: z.enum(['stack', 'tasks', 'deadlines', 'note', 'error', 'image', 'chart', 'table', 'external']),
  contribution: contributionRef.optional(),
  binding: binding.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})
const layout = z.array(module).max(500)
const slot = z.looseObject({ id, title: shortText, day: z.number().int(), start: z.string().max(5), end: z.string().max(5) })

const projectPatch = z.strictObject({
  name: shortText.optional(),
  type: projectType.optional(),
  category: shortText.optional(),
  platforms: strings.optional(),
  tags: strings.optional(),
  folderId: id.nullable().optional(),
  status: projectStatus.optional(),
  description: text.optional(),
  stack: strings.optional(),
  path: shortText.optional(),
  tasks: z.array(task).max(5000).optional(),
  checklist: z.array(checklistItem).max(5000).optional(),
  deadlines: z.array(deadline).max(5000).optional(),
  links: z.array(link).max(5000).optional(),
  layout: layout.optional(),
})

const preferencesPatch = z.strictObject({
  themeMode: z.enum(['system', 'light', 'dark']).optional(),
  sidebarCollapsed: z.boolean().optional(),
  collapsedCategoryFolders: strings.optional(),
  pinnedTabs: z.array(z.strictObject({ projectId: id, pinned: z.boolean() })).max(200).optional(),
  activeTabId: id.nullable().optional(),
})

const empty = z.strictObject({})

const BASE_SCHEMAS: Record<NativeCommandName, z.ZodType> = {
  'core.batch': z.strictObject({
    operationId,
    steps: z.array(z.strictObject({
      name: z.enum(NATIVE_COMMAND_NAMES).refine((name) => name !== 'core.batch' && name !== 'settings.get' && name !== 'preferences.adoptLegacy', 'Commande exclue des opérations groupées'),
      params: z.record(z.string(), z.unknown()),
      bindings: z.array(z.strictObject({ field: z.enum(['id', 'projectId', 'noteId', 'errorId', 'block.refId']), resultIndex: z.number().int().nonnegative() })).max(5).optional(),
    })).min(1).max(200),
  }),
  'projects.create': z.strictObject({
    input: z.strictObject({
      name: shortText,
      type: projectType,
      category: shortText,
      platforms: strings,
      tags: strings.optional(),
      noteIds: z.array(id).max(5000).optional(),
      errorIds: z.array(id).max(5000).optional(),
      checklist: z.array(checklistItem).max(5000).optional(),
      tasks: z.array(task).max(5000).optional(),
      deadlines: z.array(deadline).max(5000).optional(),
    }),
    operationId,
  }),
  'projects.update': z.strictObject({ id, patch: projectPatch, expectedRevision: revision }),
  'projects.delete': z.strictObject({ id }),
  'projects.touchOpened': z.strictObject({ id }),
  'projects.linkNote': z.strictObject({ projectId: id, noteId: id }),
  'projects.unlinkNote': z.strictObject({ projectId: id, noteId: id }),
  'projects.linkError': z.strictObject({ projectId: id, errorId: id }),
  'projects.unlinkError': z.strictObject({ projectId: id, errorId: id }),
  'folders.create': z.strictObject({
    input: z.strictObject({ name: shortText, kind: z.enum(['manual', 'smart']), displayMode: z.enum(['category', 'group']), description: shortText.optional(), tagFilter: strings.optional() }),
    operationId,
  }),
  'folders.update': z.strictObject({
    id,
    patch: z.strictObject({ name: shortText.optional(), description: shortText.optional(), displayMode: z.enum(['category', 'group']).optional(), tagFilter: strings.optional() }),
  }),
  'folders.delete': z.strictObject({ id }),
  'notes.create': z.strictObject({ input: z.strictObject({ title: shortText, content: text, tags: strings }), operationId }),
  'notes.update': z.strictObject({ id, patch: z.strictObject({ title: shortText.optional(), content: text.optional(), tags: strings.optional(), raw: z.boolean().optional() }), expectedRevision: revision }),
  'notes.trash': z.strictObject({ id }),
  'notes.restore': z.strictObject({ id }),
  'errors.create': z.strictObject({ input: z.strictObject({ title: shortText, content: text, causes: text, solution: text, projectIds: z.array(id).max(5000) }), operationId }),
  'errors.update': z.strictObject({ id, patch: z.strictObject({ title: shortText.optional(), content: text.optional(), causes: text.optional(), solution: text.optional() }), expectedRevision: revision }),
  'errors.delete': z.strictObject({ id }),
  'checklist.add': z.strictObject({
    projectId: id,
    item: z.strictObject({ label: shortText, type: checklistType, link: shortText.optional(), projectRef: id.optional(), date: z.string().max(40).optional(), description: shortText.optional() }),
  }),
  'checklist.update': z.strictObject({
    projectId: id,
    itemId: id,
    patch: z.strictObject({ label: shortText.optional(), type: checklistType.optional(), status: checklistStatus.optional(), link: shortText.optional(), projectRef: id.optional(), date: z.string().max(40).optional(), description: shortText.optional() }),
  }),
  'checklist.cycleStatus': z.strictObject({ projectId: id, itemId: id }),
  'checklist.setStatus': z.strictObject({ projectId: id, itemId: id, status: checklistStatus }),
  'checklist.remove': z.strictObject({ projectId: id, itemId: id }),
  'tasks.add': z.strictObject({ projectId: id, name: shortText, parentId: id.optional() }),
  'tasks.update': z.strictObject({ projectId: id, taskId: id, patch: z.strictObject({ name: shortText.optional(), content: text.optional(), status: taskStatus.optional() }) }),
  'tasks.cycleStatus': z.strictObject({ projectId: id, taskId: id }),
  'tasks.remove': z.strictObject({ projectId: id, taskId: id }),
  'tasks.move': z.strictObject({ projectId: id, draggedId: id, targetId: id, position: z.enum(['before', 'after', 'inside']) }),
  'deadlines.add': z.strictObject({ projectId: id, label: shortText, date: z.string().max(40) }),
  'deadlines.toggleDone': z.strictObject({ projectId: id, deadlineId: id }),
  'deadlines.remove': z.strictObject({ projectId: id, deadlineId: id }),
  'links.add': z.strictObject({ projectId: id, input: z.strictObject({ title: shortText, url: shortText }) }),
  'links.update': z.strictObject({ projectId: id, linkId: id, patch: z.strictObject({ title: shortText.optional(), url: shortText.optional() }) }),
  'links.remove': z.strictObject({ projectId: id, linkId: id }),
  'blocks.setLayout': z.strictObject({ projectId: id, layout }),
  'blocks.add': z.strictObject({ projectId: id, block: module }),
  'blocks.remove': z.strictObject({ projectId: id, blockId: id }),
  'blocks.update': z.strictObject({ projectId: id, blockId: id, patch: z.record(z.string(), z.unknown()) }),
  'blocks.toggleNote': z.strictObject({ projectId: id, noteId: id }),
  'taxonomy.addCategory': z.strictObject({ name: shortText.min(1) }),
  'taxonomy.addPlatform': z.strictObject({ type: projectType, name: shortText.min(1) }),
  'week.setSlots': z.strictObject({ slots: z.array(slot).max(2000) }),
  'week.setWakeTimes': z.strictObject({ wakeTimes: z.array(z.string().max(5)).length(7) }),
  'week.select': z.strictObject({ id }),
  'week.create': z.strictObject({ name: shortText, copy: z.boolean(), operationId }),
  'week.rename': z.strictObject({ name: shortText }),
  'settings.get': empty,
  'settings.update': z.strictObject({ patch: z.strictObject({ aiCommand: z.string().max(4096).optional() }) }),
  'preferences.update': z.strictObject({ patch: preferencesPatch }),
  'preferences.adoptLegacy': z.strictObject({ values: z.record(z.string().max(100), z.string().max(1_000_000).nullable()) }),
}


// Keep a closed payload while allowing a revision on every targeted mutation.
export const COMMAND_SCHEMAS = Object.fromEntries(Object.entries(BASE_SCHEMAS).map(([name, schema]) => [
  name, (schema as z.ZodObject).extend({ expectedRevision: revision }),
])) as unknown as Record<NativeCommandName, z.ZodType>
