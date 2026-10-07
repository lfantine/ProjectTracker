import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import type { ErrorEntry, ModuleType, Note, Project, ProjectModule, TaskStatus } from '../lib/types'
import { defaultProjectLayout } from '../lib/types'
import { flattenTasks, reorderById, remainingInstances, uid } from '../lib/helpers'
import { TASK_STATUS_LABEL, TASK_STATUS_ORDER } from '../lib/constants'
import type { TaskDropPosition } from '../lib/helpers'
import type { ModuleCatalogEntry } from '../lib/moduleCatalog'
import { TaskTree } from './TaskTree'
import { TaskKanban } from './TaskKanban'
import { DeadlineList } from './DeadlineList'
import { Markdown } from './Markdown'
import { ChartModuleBody } from './ChartModule'
import {
  ModuleCatalogGrid,
  ModuleCategorySidebar,
  ModuleRemainingBadge,
  ModuleSearchInput,
  useModuleCatalogFilter,
} from './ModuleCatalog'
import { GhostButton, Input, Modal, PrimaryButton, TagChip, Textarea } from './ui'
import {
  AlertIcon,
  ArrowLeftIcon,
  ChartIcon,
  ExternalLinkIcon,
  GripIcon,
  ImageIcon,
  NoteIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './icons'

type TaskViewMode = 'liste' | 'kanban' | 'a_venir'
const TASK_VIEW_LABEL: Record<TaskViewMode, string> = {
  liste: 'Liste',
  kanban: 'Kanban',
  a_venir: 'À venir',
}
const STATUS_DOT: Record<TaskStatus, string> = {
  a_faire: 'bg-text-faint',
  en_cours: 'bg-warning',
  fait: 'bg-success',
}

function readTaskPreferences(projectId: string): { view: TaskViewMode; statuses: TaskStatus[] } {
  const defaults = { view: 'liste' as TaskViewMode, statuses: ['a_faire', 'en_cours'] as TaskStatus[] }
  if (typeof window === 'undefined') return defaults
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(`tracker_task_view_${projectId}`) || '{}')
    return {
      view: ['liste', 'kanban', 'a_venir'].includes(saved.view) ? saved.view : defaults.view,
      statuses: Array.isArray(saved.statuses) ? TASK_STATUS_ORDER.filter((status) => saved.statuses.includes(status)) : defaults.statuses,
    }
  } catch { return defaults }
}

export function ModulesColumn({
  project,
  notes,
  errors,
  setLayout,
  addModule,
  removeModule,
  updateModule,
  updateProject,
  updateNote,
  addTask,
  addSubtask,
  cycleTaskStatus,
  removeTask,
  moveTask,
  updateTask,
  addDeadline,
  toggleDeadlineDone,
  onOpenTask,
}: {
  project: Project
  notes: Note[]
  errors: ErrorEntry[]
  setLayout: (projectId: string, layout: ProjectModule[]) => void
  addModule: (projectId: string, module: ProjectModule) => void
  removeModule: (projectId: string, moduleId: string) => void
  updateModule: (projectId: string, moduleId: string, patch: Partial<ProjectModule>) => void
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'raw'>>) => void
  updateProject: (projectId: string, patch: Partial<Project>) => void
  addTask: (projectId: string, name: string) => void
  addSubtask: (projectId: string, parentId: string, name: string) => void
  cycleTaskStatus: (projectId: string, taskId: string) => void
  removeTask: (projectId: string, taskId: string) => void
  moveTask: (projectId: string, draggedId: string, targetId: string, position: TaskDropPosition) => void
  updateTask: (projectId: string, taskId: string, patch: Partial<{ status: TaskStatus }>) => void
  addDeadline: (projectId: string, label: string, date: string) => void
  toggleDeadlineDone: (projectId: string, deadlineId: string) => void
  onOpenTask: (taskId: string) => void
}) {
  const router = useRouter()
  const layout = project.layout && project.layout.length > 0 ? project.layout : defaultProjectLayout()
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [trashHover, setTrashHover] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [taskView, setTaskView] = useState<TaskViewMode>(() => readTaskPreferences(project.id).view)
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus[]>(() => readTaskPreferences(project.id).statuses)
  useEffect(() => {
    try { window.sessionStorage.setItem(`tracker_task_view_${project.id}`, JSON.stringify({ view: taskView, statuses: taskStatusFilter })) } catch {}
  }, [project.id, taskView, taskStatusFilter])
  const [stackEditing, setStackEditing] = useState(false)
  const [deadlinesEditing, setDeadlinesEditing] = useState(false)
  const [moduleEditing, setModuleEditing] = useState<Record<string, boolean>>({})

  function isModuleEditing(mod: ProjectModule) {
    if (mod.id in moduleEditing) return moduleEditing[mod.id]
    if (mod.type === 'chart') return !mod.title && !(mod.chart?.points.length)
    return !mod.imageUrl && !mod.title && !mod.text
  }

  function resetDrag() {
    setDragId(null)
    setDropTarget(null)
    setTrashHover(false)
  }

  function renderModuleBody(mod: ProjectModule) {
    const drag = { onDragStart: () => setDragId(mod.id), onDragEnd: resetDrag }
    switch (mod.type) {
      case 'stack':
        return (
          <div>
            <ModuleHeader
              title="Stack"
              right={<EditToggle active={stackEditing} onClick={() => setStackEditing((v) => !v)} />}
              {...drag}
            />
            <StackEditor
              stack={project.stack || []}
              editing={stackEditing}
              onChange={(stack) => updateProject(project.id, { stack })}
            />
          </div>
        )
      case 'tasks':
        return (
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <ModuleHeader title="Tâches" {...drag} />
              <div className="flex items-center gap-2">
                <div className="flex bg-surface2 p-1 rounded-lg border border-border">
                  {(['liste', 'kanban', 'a_venir'] as TaskViewMode[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setTaskView(v)}
                      className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${
                        taskView === v ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'
                      }`}
                    >
                      {TASK_VIEW_LABEL[v]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap mb-4" role="group" aria-label="Filtrer par statut">
              {TASK_STATUS_ORDER.map((s) => {
                const active = taskStatusFilter.includes(s)
                const count = flattenTasks(project.tasks).filter(({ node }) => node.status === s).length
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setTaskStatusFilter((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : TASK_STATUS_ORDER.filter((x) => x === s || prev.includes(x))
                      )
                    }
                    className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[12px] font-semibold cursor-pointer transition-colors ${
                      active
                        ? 'border-border bg-surface2 text-text'
                        : 'border-dashed border-border bg-transparent text-text-faint hover:text-text-muted'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${active ? STATUS_DOT[s] : 'bg-border'}`} />
                    {TASK_STATUS_LABEL[s]}
                    <span className="text-[11px] font-medium text-text-faint tabular-nums">{count}</span>
                  </button>
                )
              })}
              {taskStatusFilter.length < TASK_STATUS_ORDER.length && (
                <button
                  type="button"
                  onClick={() => setTaskStatusFilter(TASK_STATUS_ORDER)}
                  className="text-[11.5px] font-medium text-text-faint hover:text-accent bg-transparent border-none cursor-pointer px-1.5"
                >
                  Tout afficher
                </button>
              )}
            </div>

            {taskView === 'liste' && (
              <TaskTree
                tasks={project.tasks}
                visibleStatuses={taskStatusFilter}
                onAddTop={(name) => addTask(project.id, name)}
                onAddSub={(parentId, name) => addSubtask(project.id, parentId, name)}
                onCycleStatus={(taskId) => cycleTaskStatus(project.id, taskId)}
                onRemove={(taskId) => removeTask(project.id, taskId)}
                onOpenDetail={onOpenTask}
                onMove={(draggedId, targetId, position) => moveTask(project.id, draggedId, targetId, position)}
              />
            )}
            {taskView === 'kanban' && (
              <TaskKanban
                tasks={project.tasks}
                visibleStatuses={TASK_STATUS_ORDER.filter((s) => taskStatusFilter.includes(s))}
                onSetStatus={(taskId, status) => updateTask(project.id, taskId, { status })}
                onOpenDetail={onOpenTask}
              />
            )}
            {taskView === 'a_venir' && (
              <TaskTree
                tasks={[...project.tasks].sort((a, b) => Number(b.status === 'en_cours') - Number(a.status === 'en_cours'))}
                visibleStatuses={['en_cours', 'a_faire'].filter((status) => taskStatusFilter.includes(status as TaskStatus)) as TaskStatus[]}
                onAddTop={(name) => addTask(project.id, name)}
                onAddSub={(id, name) => addSubtask(project.id, id, name)}
                onCycleStatus={(id) => cycleTaskStatus(project.id, id)}
                onRemove={(id) => removeTask(project.id, id)}
                onOpenDetail={onOpenTask}
              />
            )}
          </div>
        )
      case 'deadlines':
        return (
          <div>
            <ModuleHeader
              title="Échéances"
              right={<EditToggle active={deadlinesEditing} onClick={() => setDeadlinesEditing((v) => !v)} />}
              {...drag}
            />
            <DeadlineList
              deadlines={project.deadlines}
              editing={deadlinesEditing}
              onAdd={(label, date) => addDeadline(project.id, label, date)}
              onToggle={(deadlineId) => toggleDeadlineDone(project.id, deadlineId)}
            />
          </div>
        )
      case 'note': {
        const note = notes.find((n) => n.id === mod.refId)
        return (
          <div>
            <ModuleHeader
              title={note ? note.title || 'Sans titre' : 'Note introuvable'}
              right={note ? <EditToggle active={editingNoteId === note.id} onClick={() => setEditingNoteId(editingNoteId === note.id ? null : note.id)} /> : undefined}
              icon={<NoteIcon size={15} className="text-text-faint flex-shrink-0" />}
              onRemove={() => removeModule(project.id, mod.id)}
              {...drag}
            />
            {note ? (
              <>
                {editingNoteId === note.id && <div className="flex flex-col gap-3 mb-3">
                  <Input aria-label="Titre de la note" value={note.title} onChange={(e) => updateNote(note.id, { title: e.target.value })} />
                  <Textarea aria-label="Contenu de la note" value={note.content} onChange={(e) => updateNote(note.id, { content: e.target.value })} className="min-h-64 w-full" />
                  <p className="text-xs text-text-faint">Modifications enregistrées automatiquement.</p>
                </div>}
                {note.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {note.tags.map((t) => (
                      <TagChip key={t} label={t} />
                    ))}
                  </div>
                )}
                <div className={`text-sm text-text-muted max-h-[374px] overflow-auto ${editingNoteId === note.id ? 'hidden' : ''}`}>
                  {note.content.trim() ? (
                    note.raw ? (
                      <pre className="whitespace-pre-wrap font-mono text-[12.5px] text-text leading-relaxed">
                        {note.content}
                      </pre>
                    ) : (
                      <Markdown text={note.content} />
                    )
                  ) : (
                    <p className="text-text-faint text-[13px]">Page vide.</p>
                  )}
                </div>
                <GhostButton
                  onClick={() => router.push(`/notes/detail?id=${note.id}&projectId=${project.id}`)}
                  className="mt-2"
                >
                  <ExternalLinkIcon size={12} /> Ouvrir la note
                </GhostButton>
              </>
            ) : (
              <p className="text-[13px] text-text-faint">Cette note a été supprimée.</p>
            )}
          </div>
        )
      }
      case 'error': {
        const err = errors.find((e) => e.id === mod.refId)
        return (
          <div>
            <ModuleHeader
              title={err ? err.title : 'Erreur introuvable'}
              icon={<AlertIcon size={15} className="text-text-faint flex-shrink-0" />}
              onRemove={() => removeModule(project.id, mod.id)}
              {...drag}
            />
            {err ? (
              <>
                <p className="text-[13px] text-text-muted whitespace-pre-wrap mb-2 max-h-[374px] overflow-auto">
                  {err.content}
                </p>
                <GhostButton onClick={() => router.push(`/errors?open=${err.id}`)}>
                  <ExternalLinkIcon size={12} /> Ouvrir l&apos;erreur
                </GhostButton>
              </>
            ) : (
              <p className="text-[13px] text-text-faint">Cette erreur a été supprimée.</p>
            )}
          </div>
        )
      }
      case 'image': {
        const editing = isModuleEditing(mod)
        return (
          <div>
            <ModuleHeader
              title={mod.title || 'Image / Texte'}
              icon={<ImageIcon size={15} className="text-text-faint flex-shrink-0" />}
              right={
                <EditToggle
                  active={editing}
                  onClick={() => setModuleEditing((prev) => ({ ...prev, [mod.id]: !editing }))}
                />
              }
              onRemove={() => removeModule(project.id, mod.id)}
              {...drag}
            />
            <ImageTextEditor
              module={mod}
              editing={editing}
              onChange={(patch) => updateModule(project.id, mod.id, patch)}
            />
          </div>
        )
      }
      case 'chart': {
        const editing = isModuleEditing(mod)
        return (
          <div>
            <ModuleHeader
              title={mod.title || 'Graphique'}
              icon={<ChartIcon size={15} className="text-text-faint flex-shrink-0" />}
              right={
                <EditToggle
                  active={editing}
                  onClick={() => setModuleEditing((prev) => ({ ...prev, [mod.id]: !editing }))}
                />
              }
              onRemove={() => removeModule(project.id, mod.id)}
              {...drag}
            />
            {editing && (
              <Input
                aria-label="Titre du graphique"
                value={mod.title || ''}
                onChange={(e) => updateModule(project.id, mod.id, { title: e.target.value })}
                placeholder="Titre du graphique (optionnel)…"
                className="w-full mb-3"
              />
            )}
            <ChartModuleBody
              config={mod.chart}
              editing={editing}
              onChange={(chart) => updateModule(project.id, mod.id, { chart })}
            />
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4.5 min-w-0">
      {layout.map((mod) => {
        const isOver = dropTarget?.id === mod.id
        return (
          <React.Fragment key={mod.id}>
            {isOver && dropTarget!.position === 'before' && <div className="h-0.5 bg-accent rounded-full -my-2 mx-1" />}
            <div
              onDragOver={(e) => {
                if (!dragId || dragId === mod.id) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const position: 'before' | 'after' = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
                setDropTarget((prev) =>
                  prev && prev.id === mod.id && prev.position === 'before' ? prev : { id: mod.id, position }
                )
              }}
              onDrop={(e) => {
                if (!dragId || dragId === mod.id) return
                e.preventDefault()
                const position = dropTarget?.id === mod.id ? dropTarget.position : 'after'
                setLayout(project.id, reorderById(layout, dragId, mod.id, position))
                resetDrag()
              }}
              className={`bg-surface border border-border rounded-xl p-5 transition-opacity ${
                dragId === mod.id ? 'opacity-40' : ''
              }`}
            >
              {renderModuleBody(mod)}
            </div>
            {isOver && dropTarget!.position === 'after' && <div className="h-0.5 bg-accent rounded-full -my-2 mx-1" />}
          </React.Fragment>
        )
      })}

      <GhostButton onClick={() => setAddModalOpen(true)}>
        <PlusIcon size={12} /> Ajouter un module
      </GhostButton>

      {addModalOpen && (
        <AddModuleModal
          layout={layout}
          linkedNotes={(project.noteIds || []).map((nid) => notes.find((n) => n.id === nid)).filter(Boolean) as Note[]}
          linkedErrors={(project.errorIds || []).map((eid) => errors.find((e) => e.id === eid)).filter(Boolean) as ErrorEntry[]}
          pinnedNoteIds={layout.filter((m) => m.type === 'note').map((m) => m.refId)}
          pinnedErrorIds={layout.filter((m) => m.type === 'error').map((m) => m.refId)}
          onClose={() => setAddModalOpen(false)}
          onAdd={(type) => {
            if (type === 'image') {
              addModule(project.id, { id: uid('mod'), type: 'image', title: '', imageUrl: '', text: '' })
            } else if (type === 'chart') {
              addModule(project.id, { id: uid('mod'), type: 'chart', title: '', chart: { kind: 'bar', points: [] } })
            } else {
              addModule(project.id, { id: uid('mod'), type })
            }
            setAddModalOpen(false)
          }}
          onAddNote={(noteId) => {
            addModule(project.id, { id: uid('mod'), type: 'note', refId: noteId })
            setAddModalOpen(false)
          }}
          onAddError={(errorId) => {
            addModule(project.id, { id: uid('mod'), type: 'error', refId: errorId })
            setAddModalOpen(false)
          }}
        />
      )}
    </div>

    {dragId && (
      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setTrashHover(true)
        }}
        onDragLeave={() => setTrashHover(false)}
        onDrop={(e) => {
          e.preventDefault()
          removeModule(project.id, dragId)
          resetDrag()
        }}
        className={`fixed left-1/2 bottom-7 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3.5 rounded-full border-2 border-dashed shadow-2xl transition-all ${
          trashHover
            ? 'border-danger bg-danger text-white scale-105'
            : 'border-danger/60 bg-surface text-danger'
        }`}
      >
        <TrashIcon size={16} />
        <span className="text-[13px] font-bold">Glisser ici pour supprimer le module</span>
      </div>
    )}
    </>
  )
}

function ModuleHeader({
  title,
  icon,
  right,
  onDragStart,
  onDragEnd,
  onRemove,
}: {
  title: string
  icon?: React.ReactNode
  right?: React.ReactNode
  onDragStart: () => void
  onDragEnd: () => void
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-2 mb-3.5">
      <span
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        className="cursor-grab active:cursor-grabbing text-text-faint flex-shrink-0"
        title="Glisser pour réorganiser"
      >
        <GripIcon size={14} />
      </span>
      {icon}
      <h3 className="text-[15px] font-bold flex-1 truncate">{title}</h3>
      {right}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="border-none bg-transparent text-text-faint hover:text-danger cursor-pointer flex-shrink-0"
        >
          <TrashIcon size={13} />
        </button>
      )}
    </div>
  )
}

function EditToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <GhostButton onClick={onClick} className={active ? 'text-accent!' : ''}>
      <PencilIcon size={12} /> Edit
    </GhostButton>
  )
}

function StackEditor({
  stack,
  editing,
  onChange,
}: {
  stack: string[]
  editing: boolean
  onChange: (stack: string[]) => void
}) {
  const [tag, setTag] = useState('')
  return (
    <div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {stack.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold bg-surface2 text-text pl-2.5 pr-1 py-1 rounded-full"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(stack.filter((x) => x !== t))}
              className="border-none bg-transparent text-text-faint cursor-pointer text-sm leading-none px-1"
            >
              ×
            </button>
          </span>
        ))}
        {stack.length === 0 && !editing && <p className="text-[13px] text-text-faint">Aucune techno.</p>}
      </div>
      {editing && (
        <div className="flex gap-2">
          <Input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Ajouter une techno…"
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tag.trim()) {
              onChange(stack.concat([tag.trim()]))
              setTag('')
            }
          }}
          />
          <PrimaryButton
            onClick={() => {
              if (!tag.trim()) return
              onChange(stack.concat([tag.trim()]))
              setTag('')
            }}
          >
            Ajouter
          </PrimaryButton>
        </div>
      )}
    </div>
  )
}

function ImageTextEditor({
  module: mod,
  editing,
  onChange,
}: {
  module: ProjectModule
  editing: boolean
  onChange: (patch: Partial<ProjectModule>) => void
}) {
  if (editing) {
    return (
      <div className="flex flex-col gap-2.5">
        <input
          defaultValue={mod.title || ''}
          onBlur={(e) => onChange({ title: e.target.value })}
          placeholder="Titre du bloc (optionnel)…"
          className="text-[14px] font-bold bg-transparent border-none outline-none w-full -mt-1"
        />
        <Input
          defaultValue={mod.imageUrl || ''}
          onBlur={(e) => onChange({ imageUrl: e.target.value })}
          placeholder="URL de l'image (https://…)"
          className="w-full"
        />
        <Textarea
          defaultValue={mod.text || ''}
          onBlur={(e) => onChange({ text: e.target.value })}
          placeholder="Texte (markdown, optionnel)…"
          className="w-full"
          style={{ minHeight: 70 }}
        />
      </div>
    )
  }

  const hasText = !!mod.text?.trim()

  return (
    <div className="flex flex-col gap-2.5">
      {mod.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mod.imageUrl}
          alt={mod.title || 'Image'}
          className="w-full rounded-lg border border-border object-cover max-h-64"
        />
      ) : (
        <p className="text-[13px] text-text-faint">Aucune image.</p>
      )}
      {hasText && (
        <div className="bg-bg border border-border rounded-lg px-3 py-2">
          <Markdown text={mod.text as string} />
        </div>
      )}
    </div>
  )
}

function AddModuleModal({
  layout,
  linkedNotes,
  linkedErrors,
  pinnedNoteIds,
  pinnedErrorIds,
  onClose,
  onAdd,
  onAddNote,
  onAddError,
}: {
  layout: ProjectModule[]
  linkedNotes: Note[]
  linkedErrors: ErrorEntry[]
  pinnedNoteIds: (string | undefined)[]
  pinnedErrorIds: (string | undefined)[]
  onClose: () => void
  onAdd: (type: ModuleType) => void
  onAddNote: (noteId: string) => void
  onAddError: (errorId: string) => void
}) {
  const { query, setQuery, category, setCategory, filtered } = useModuleCatalogFilter()
  const [pickerType, setPickerType] = useState<'note' | 'error' | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')

  const availableNotes = linkedNotes.filter((n) => !pinnedNoteIds.includes(n.id))
  const availableErrors = linkedErrors.filter((e) => !pinnedErrorIds.includes(e.id))

  function remainingFor(entry: ModuleCatalogEntry): number | null {
    if (entry.type === 'note') return availableNotes.length
    if (entry.type === 'error') return availableErrors.length
    return remainingInstances(layout, entry.type)
  }

  function handleSelect(entry: ModuleCatalogEntry) {
    if (remainingFor(entry) === 0) return
    if (entry.kind === 'picker') {
      setPickerQuery('')
      setPickerType(entry.type as 'note' | 'error')
      return
    }
    onAdd(entry.type)
  }

  if (pickerType) {
    const items: (Note | ErrorEntry)[] = pickerType === 'note' ? availableNotes : availableErrors
    const q = pickerQuery.trim().toLowerCase()
    const filteredItems = items.filter((it) => !q || (it.title || 'Sans titre').toLowerCase().includes(q))

    return (
      <Modal open onClose={onClose} title="Ajouter un module" width={640} center>
        <button
          type="button"
          onClick={() => setPickerType(null)}
          className="flex items-center gap-1.5 border-none bg-transparent text-text-muted cursor-pointer text-[13px] mb-3 p-0 self-start"
        >
          <ArrowLeftIcon size={13} /> Retour aux modules
        </button>
        <ModuleSearchInput
          value={pickerQuery}
          onChange={setPickerQuery}
          placeholder={pickerType === 'note' ? 'Rechercher une note…' : 'Rechercher une erreur…' }
        />
        <div className="flex flex-col mt-3 max-h-[420px] overflow-auto">
          {filteredItems.length === 0 && (
            <p className="text-[13px] text-text-faint py-6 text-center">Rien à épingler.</p>
          )}
          {filteredItems.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => (pickerType === 'note' ? onAddNote(it.id) : onAddError(it.id))}
              className={`flex items-center gap-2.5 py-2.5 px-2 text-left bg-transparent border-none cursor-pointer rounded-lg hover:bg-surface-hover ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              {pickerType === 'note' ? (
                <NoteIcon size={14} className="text-text-faint flex-shrink-0" />
              ) : (
                <AlertIcon size={14} className="text-text-faint flex-shrink-0" />
              )}
              <span className="text-[13px] text-text truncate">{it.title || 'Sans titre'}</span>
            </button>
          ))}
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title="Ajouter un module" width={760} center>
      <ModuleSearchInput value={query} onChange={setQuery} autoFocus />
      <div className="flex gap-4 mt-4" style={{ minHeight: 300 }}>
        <ModuleCategorySidebar category={category} onChange={setCategory} />
        <div className="flex-1 min-w-0">
          <ModuleCatalogGrid
            entries={filtered}
            renderBadge={(entry) => <ModuleRemainingBadge remaining={remainingFor(entry)} />}
            isDisabled={(entry) => remainingFor(entry) === 0}
            onSelect={handleSelect}
          />
        </div>
      </div>
    </Modal>
  )
}

