import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../components/AppShell'
import { useData } from '../lib/store'
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  PROJECT_TYPE_LABEL,
  TASK_STATUS_LABEL,
  statusTone,
} from '../lib/constants'
import { findTaskNode, slugify, timeAgo } from '../lib/helpers'
import { ChecklistList } from '../components/ChecklistList'
import { ModulesColumn } from '../components/ProjectModules'
import { Markdown } from '../components/Markdown'
import { TagsInput } from '../components/TagsInput'
import {
  FieldLabel,
  GhostButton,
  IconButton,
  Input,
  Modal,
  PrimaryButton,
  Select,
  Spinner,
  StatusPill,
  Switch,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/Toast'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  ExternalLinkIcon,
  FolderIcon,
  FolderOpenIcon,
  LinkIcon,
  NoteIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  TerminalIcon,
  TrashIcon,
  VideoIcon,
} from '../components/icons'
import type { ProjectStatus, TaskNode } from '../lib/types'
import { defaultProjectLayout } from '../lib/types'

export default function ProjectDetailPage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const {
    data,
    loading,
    findProject,
    updateProject,
    removeProject,
    touchProjectOpened,
    linkNote,
    unlinkNote,
    linkError,
    unlinkError,
    addChecklistItem,
    cycleChecklistStatus,
    setChecklistStatus,
    updateChecklistItem,
    removeChecklistItem,
    addTask,
    addSubtask,
    cycleTaskStatus,
    removeTask,
    updateTask,
    updateNote,
    moveTask,
    addDeadline,
    toggleDeadlineDone,
    addNote,
    addLink,
    updateLink,
    removeLink,
    setLayout,
    addModule,
    removeModule,
    updateModule,
    toggleNoteModule,
  } = useData()
  const { showToast } = useToast()

  const project = id ? findProject(id) : undefined
  const [taskPath, setTaskPath] = useState<string[]>(() => {
    if (typeof window === 'undefined' || !id) return []
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(`tracker_task_path_${id}`) || '[]')
      return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : []
    } catch { return [] }
  })
  useEffect(() => {
    if (!id) return
    try { window.sessionStorage.setItem(`tracker_task_path_${id}`, JSON.stringify(taskPath)) } catch {}
  }, [id, taskPath])
  const [pickNote, setPickNote] = useState('')
  const [pickError, setPickError] = useState('')

  const openedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (id && openedRef.current !== id) {
      openedRef.current = id
      touchProjectOpened(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const linkedNotes = useMemo(
    () => (project?.noteIds || []).map((nid) => data.notes.find((n) => n.id === nid)).filter(Boolean),
    [project?.noteIds, data.notes]
  )
  const unlinkedNotes = useMemo(
    () => data.notes.filter((n) => !(project?.noteIds || []).includes(n.id)),
    [data.notes, project?.noteIds]
  )
  const linkedErrors = useMemo(
    () => (project?.errorIds || []).map((eid) => data.errors.find((e) => e.id === eid)).filter(Boolean),
    [project?.errorIds, data.errors]
  )
  const unlinkedErrors = useMemo(
    () => data.errors.filter((e) => !(project?.errorIds || []).includes(e.id)),
    [data.errors, project?.errorIds]
  )
  const pinnedNoteIds = useMemo(() => {
    const layout = project?.layout && project.layout.length > 0 ? project.layout : defaultProjectLayout()
    return layout.filter((m) => m.type === 'note').map((m) => m.refId)
  }, [project?.layout])

  if (loading) {
    return (
      <AppShell title="Projet">
        <div className="flex items-center gap-2 text-sm text-text-faint">
          <Spinner size={16} /> Chargement…
        </div>
      </AppShell>
    )
  }

  if (!project) {
    return (
      <AppShell title="Projet introuvable">
        <p className="text-sm text-text-muted">Ce projet n&apos;existe pas ou plus.</p>
        <button
          onClick={() => router.push('/projects')}
          className="mt-3 border-none bg-transparent text-accent font-semibold cursor-pointer"
        >
          ← Retour aux projets
        </button>
      </AppShell>
    )
  }

  const currentTaskId = taskPath[taskPath.length - 1] ?? null
  const selectedTask = currentTaskId ? findTaskNode(project.tasks, currentTaskId) : null
  const taskAncestors = taskPath
    .slice(0, -1)
    .map((tid) => findTaskNode(project.tasks, tid))
    .filter((t): t is TaskNode => !!t)
  const projectFolder = project.folderId ? data.folders.find((f) => f.id === project.folderId) : undefined
  const allProjectTags = Array.from(new Set(data.projects.flatMap((p) => p.tags || []))).sort()

  return (
    <AppShell title={project.name}>
      <button
        type="button"
        onClick={() => router.push('/projects')}
        className="flex items-center gap-1.5 border-none bg-transparent text-text-muted cursor-pointer text-[13px] mb-2.5 p-0"
      >
        <ArrowLeftIcon size={14} /> Projets
      </button>

      <div className="flex items-center gap-3 flex-wrap mb-2">
        <h1 className="text-[26px] font-bold">{project.name}</h1>
        <Select
          value={project.status}
          onChange={(e) => updateProject(project.id, { status: e.target.value as ProjectStatus })}
          className="py-1!"
        >
          {PROJECT_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="flex items-center gap-1 text-xs font-semibold bg-accent-soft text-accent-soft-text px-2.5 py-1 rounded-md">
          {project.type === 'video' ? <VideoIcon size={12} /> : <CodeIcon size={12} />}
          {PROJECT_TYPE_LABEL[project.type]}
        </span>
        <span className="text-xs font-semibold bg-surface2 text-text-muted px-2.5 py-1 rounded-md">
          {project.category}
        </span>
        {(project.platforms || []).map((pl) => (
          <span key={pl} className="text-xs font-semibold bg-surface2 text-text-muted px-2.5 py-1 rounded-md">
            {pl}
          </span>
        ))}
        {projectFolder && (
          <span className="flex items-center gap-1 text-xs font-semibold bg-surface2 text-text-muted px-2.5 py-1 rounded-md">
            <FolderIcon size={12} />
            {projectFolder.name}
          </span>
        )}
        <span className="text-[12.5px] text-text-faint ml-1">Modifié {timeAgo(project.updatedAt)}</span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Supprimer définitivement « ${project.name} » ?`)) {
              removeProject(project.id)
              router.push('/projects')
            }
          }}
          className="ml-auto border-none bg-transparent text-danger text-xs font-semibold cursor-pointer flex items-center gap-1"
        >
          <TrashIcon size={13} /> Supprimer le projet
        </button>
      </div>

      <DescriptionSection
        value={project.description || ''}
        onChange={(description) => updateProject(project.id, { description })}
      />

      <PageSection title="Mandatory">
        <ChecklistList
          items={project.checklist}
          projects={data.projects.filter((p) => p.id !== project.id)}
          onAdd={(input) => addChecklistItem(project.id, input)}
          onCycleStatus={(itemId) => cycleChecklistStatus(project.id, itemId)}
          onSetStatus={(itemId, status) => setChecklistStatus(project.id, itemId, status)}
          onUpdate={(itemId, patch) => updateChecklistItem(project.id, itemId, patch)}
          onRemove={(itemId) => removeChecklistItem(project.id, itemId)}
        />
      </PageSection>

      <div className="grid gap-5 items-start mb-5" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        <ModulesColumn
          project={project}
          notes={data.notes}
          errors={data.errors}
          setLayout={setLayout}
          addModule={addModule}
          removeModule={removeModule}
          updateModule={updateModule}
          updateProject={updateProject}
          updateNote={updateNote}
          addTask={addTask}
          addSubtask={addSubtask}
          cycleTaskStatus={cycleTaskStatus}
          removeTask={removeTask}
          moveTask={moveTask}
          updateTask={updateTask}
          addDeadline={addDeadline}
          toggleDeadlineDone={toggleDeadlineDone}
          onOpenTask={(taskId) => setTaskPath([taskId])}
        />

        <div className="flex flex-col gap-4.5 min-w-0">
          <Panel title="Emplacement">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={project.path || ''}
                onChange={(e) => updateProject(project.id, { path: e.target.value })}
                placeholder="~/Projects/…"
                className="font-mono text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg text-text-muted flex-1"
                style={{ minWidth: 140 }}
              />
              <IconButton
                title="Parcourir"
                onClick={async () => {
                  const chosen = await window.api.chooseFolder()
                  if (chosen) updateProject(project.id, { path: chosen })
                  else if (!project.path) {
                    updateProject(project.id, { path: `~/Projects/${slugify(project.name)}` })
                  }
                }}
              >
                <FolderOpenIcon size={15} />
              </IconButton>
            </div>
            <div className="flex gap-2 mt-3">
              <IconButton
                title="Ouvrir dans le Finder"
                onClick={async () => {
                  if (!project.path) return showToast('Définis un chemin d’abord.', 'danger')
                  const err = await window.api.revealInFinder(project.path)
                  showToast(err || 'Ouvert dans le Finder', err ? 'danger' : 'success')
                }}
              >
                <FolderOpenIcon size={15} />
              </IconButton>
              <IconButton
                title="Ouvrir dans le Terminal"
                onClick={async () => {
                  if (!project.path) return showToast('Définis un chemin d’abord.', 'danger')
                  const err = await window.api.openWith('terminal', project.path)
                  showToast(err || 'Ouvert dans Terminal', err ? 'danger' : 'success')
                }}
              >
                <TerminalIcon size={15} />
              </IconButton>
              <IconButton
                title="Ouvrir dans Zed"
                onClick={async () => {
                  if (!project.path) return showToast('Définis un chemin d’abord.', 'danger')
                  const err = await window.api.openWith('zed', project.path)
                  showToast(err || 'Ouvert dans Zed', err ? 'danger' : 'success')
                }}
              >
                <CodeIcon size={15} />
              </IconButton>
            </div>
          </Panel>

          <Panel title="Tags">
            <TagsInput
              tags={project.tags || []}
              onChange={(tags) => updateProject(project.id, { tags })}
              suggestions={allProjectTags}
              placeholder="Ajouter un tag…"
            />
            <p className="text-[11.5px] text-text-faint mt-2">
              Utilisés par les SmartFolders pour regrouper des projets automatiquement.
            </p>
          </Panel>

          <Panel title="Liens utiles">
            <LinksPanel
              links={project.links || []}
              onAdd={(input) => addLink(project.id, input)}
              onUpdate={(linkId, patch) => updateLink(project.id, linkId, patch)}
              onRemove={(linkId) => removeLink(project.id, linkId)}
            />
          </Panel>

          <Panel title="Notes liées">
            <div className="flex flex-col mb-2">
              {linkedNotes.map((n, i) => {
                const pinned = pinnedNoteIds.includes(n!.id)
                return (
                  <div
                    key={n!.id}
                    className={`group flex items-center gap-2.5 py-2 ${i > 0 ? 'border-t border-border' : ''}`}
                  >
                    <NoteIcon size={14} className="text-text-faint flex-shrink-0" />
                    <div
                      onClick={() => router.push(`/notes/detail?id=${n!.id}&projectId=${project.id}`)}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                      <div className="text-[13px] font-semibold text-text truncate group-hover:text-accent transition-colors">
                        {n!.title || 'Sans titre'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleNoteModule(project.id, n!.id)}
                      title={pinned ? 'Retirer de la colonne de gauche' : 'Épingler dans la colonne de gauche'}
                      className={`border-none bg-transparent cursor-pointer p-1 flex-shrink-0 transition-colors ${
                        pinned ? 'text-accent' : 'text-text-faint opacity-0 group-hover:opacity-100 hover:text-accent'
                      }`}
                    >
                      <PinIcon size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => unlinkNote(project.id, n!.id)}
                      className="border-none bg-transparent text-text-faint hover:text-danger cursor-pointer p-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                )
              })}
              {linkedNotes.length === 0 && <p className="text-[13px] text-text-faint pb-2">Aucune note liée.</p>}
            </div>
            {unlinkedNotes.length > 0 && (
              <Select
                value={pickNote}
                onChange={(e) => {
                  if (e.target.value) {
                    linkNote(project.id, e.target.value)
                    setPickNote('')
                  }
                }}
                className="w-full mb-2"
              >
                <option value="">Lier une note existante…</option>
                {unlinkedNotes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </Select>
            )}
            <GhostButton
              onClick={() => {
                const note = addNote({ title: 'Sans titre', content: '', tags: [project.name] })
                linkNote(project.id, note.id)
                router.push(`/notes/detail?id=${note.id}&projectId=${project.id}`)
              }}
            >
              <PlusIcon size={12} /> Créer et lier une note
            </GhostButton>
          </Panel>

          <Panel title="Erreurs liées">
            <div className="flex flex-col gap-1.5 mb-3">
              {linkedErrors.map((er) => (
                <div
                  key={er!.id}
                  onClick={() => router.push(`/errors?open=${er!.id}`)}
                  className="flex justify-between items-center px-3 py-2 rounded-lg bg-surface2 border border-border cursor-pointer"
                >
                  <span className="text-[13px] text-text truncate">{er!.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      unlinkError(project.id, er!.id)
                    }}
                    className="border-none bg-transparent text-text-faint cursor-pointer flex-shrink-0"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              ))}
              {linkedErrors.length === 0 && <p className="text-[13px] text-text-faint">Aucune erreur liée.</p>}
            </div>
            {unlinkedErrors.length > 0 && (
              <Select
                value={pickError}
                onChange={(e) => {
                  if (e.target.value) {
                    linkError(project.id, e.target.value)
                    setPickError('')
                  }
                }}
                className="w-full mb-2"
              >
                <option value="">Lier une erreur existante…</option>
                {unlinkedErrors.map((er) => (
                  <option key={er.id} value={er.id}>
                    {er.title}
                  </option>
                ))}
              </Select>
            )}
            <button
              type="button"
              onClick={() => router.push(`/errors?newForProject=${project.id}`)}
              className="border-none bg-transparent text-accent text-xs font-bold cursor-pointer"
            >
              + Nouvelle erreur pour ce projet
            </button>
          </Panel>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailModal
          key={selectedTask.id}
          task={selectedTask}
          ancestors={taskAncestors}
          onClose={() => setTaskPath([])}
          onOpenChild={(childId) => setTaskPath((p) => [...p, childId])}
          onBreadcrumbClick={(index) => setTaskPath((p) => p.slice(0, index + 1))}
          onUpdate={(patch) => updateTask(project.id, selectedTask.id, patch)}
          onAddSub={(name) => addSubtask(project.id, selectedTask.id, name)}
          onRemove={() => {
            removeTask(project.id, selectedTask.id)
            setTaskPath([])
          }}
        />
      )}
    </AppShell>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <h3 className="text-[15px] font-bold mb-3.5">{title}</h3>
      {children}
    </div>
  )
}

function PageSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-5 pb-5 border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer p-0"
        style={{ marginBottom: open ? 16 : 0 }}
      >
        <h2 className="text-[16px] font-bold">{title}</h2>
        <ChevronDownIcon
          size={17}
          className={`text-text-faint transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && children}
    </div>
  )
}

function DescriptionSection({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function startEditing() {
    setDraft(value)
    setEditing(true)
  }

  function save() {
    onChange(draft)
    setEditing(false)
  }

  return (
    <div className="mb-5 pb-5 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[16px] font-bold">Description</h2>
        {editing ? (
          <GhostButton onClick={save}>Terminé</GhostButton>
        ) : (
          <GhostButton onClick={startEditing}>
            <PencilIcon size={12} /> Modifier
          </GhostButton>
        )}
      </div>
      {editing ? (
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          placeholder="Décris ce projet…"
          className="w-full"
          style={{ minHeight: 240 }}
        />
      ) : value ? (
        <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-sm text-text-faint">Aucune description.</p>
      )}
    </div>
  )
}

function LinksPanel({
  links,
  onAdd,
  onUpdate,
  onRemove,
}: {
  links: { id: string; title: string; url: string }[]
  onAdd: (input: { title: string; url: string }) => void
  onUpdate: (linkId: string, patch: { title?: string; url?: string }) => void
  onRemove: (linkId: string) => void
}) {
  const [modalOpen, setModalOpen] = useState(false)

  function hostname(url: string) {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  async function open(url: string) {
    const err = await window.api.openExternal(url)
    if (err) window.alert(err)
  }

  return (
    <div>
      <div className="flex flex-col mb-1">
        {links.map((link, index) => (
          <ProjectLinkRow
            key={link.id}
            link={link}
            bordered={index > 0}
            hostname={hostname}
            onOpen={open}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
        {links.length === 0 && <p className="text-[13px] text-text-faint pb-2">Aucun lien pour l’instant.</p>}
      </div>
      <GhostButton onClick={() => setModalOpen(true)} className="mt-2">
        <PlusIcon size={12} /> Ajouter un lien
      </GhostButton>

      {modalOpen && (
        <AddLinkModal
          onClose={() => setModalOpen(false)}
          onAdd={(input) => {
            onAdd(input)
            setModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function ProjectLinkRow({
  link,
  bordered,
  hostname,
  onOpen,
  onUpdate,
  onRemove,
}: {
  link: { id: string; title: string; url: string }
  bordered: boolean
  hostname: (url: string) => string
  onOpen: (url: string) => void
  onUpdate: (id: string, patch: { title?: string; url?: string }) => void
  onRemove: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(link.title)
  const [url, setUrl] = useState(link.url)
  const waitingForUrl = !link.url.trim()

  function save() {
    const nextTitle = title.trim() || link.title
    const trimmedUrl = url.trim()
    const nextUrl = trimmedUrl && !/^https?:\/\//i.test(trimmedUrl) ? `https://${trimmedUrl}` : trimmedUrl
    onUpdate(link.id, { title: nextTitle, url: nextUrl })
    setTitle(nextTitle)
    setUrl(nextUrl)
    setEditing(false)
  }

  if (editing || waitingForUrl) {
    return (
      <div className={`flex items-start gap-2.5 py-2 ${bordered ? 'border-t border-border' : ''}`}>
        <span className="w-7 h-7 mt-1 rounded-full bg-warning-soft text-warning flex items-center justify-center flex-shrink-0"><LinkIcon size={13} /></span>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {editing && <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titre du lien" className="w-full py-1.5" />}
          <Input
            autoFocus={waitingForUrl}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => { if (event.key === 'Enter') save() }}
            placeholder="Coller le lien ici…"
            className="w-full py-1.5"
          />
          {waitingForUrl && <p className="text-[11px] text-warning">En attente du lien — colle l&apos;URL puis quitte le champ.</p>}
        </div>
        <button type="button" onClick={() => onRemove(link.id)} className="mt-1 border-none bg-transparent text-text-faint hover:text-danger cursor-pointer p-1"><TrashIcon size={13} /></button>
      </div>
    )
  }

  return (
    <div onClick={() => onOpen(link.url)} className={`group flex items-center gap-2.5 py-2 cursor-pointer ${bordered ? 'border-t border-border' : ''}`}>
      <span className="w-7 h-7 rounded-full bg-accent-soft text-accent-soft-text flex items-center justify-center flex-shrink-0"><LinkIcon size={13} /></span>
      <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-text truncate group-hover:text-accent transition-colors">{link.title}</div><div className="text-[11px] text-text-faint truncate">{hostname(link.url)}</div></div>
      <button type="button" onClick={(event) => { event.stopPropagation(); setEditing(true) }} className="border-none bg-transparent text-text-faint hover:text-text cursor-pointer p-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Modifier le lien"><PencilIcon size={13} /></button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(link.id) }} className="border-none bg-transparent text-text-faint hover:text-danger cursor-pointer p-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><TrashIcon size={13} /></button>
      <ExternalLinkIcon size={13} className="text-text-faint flex-shrink-0" />
    </div>
  )
}

function AddLinkModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (input: { title: string; url: string }) => void
}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  function submit() {
    if (!title.trim()) return
    const normalizedUrl = url.trim()
      ? (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`)
      : ''
    onAdd({ title: title.trim(), url: normalizedUrl })
  }

  return (
    <Modal open onClose={onClose} title="Ajouter un lien" width={420}>
      <FieldLabel>Titre</FieldLabel>
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Documentation, Figma…"
        className="w-full"
      />
      <FieldLabel>Lien</FieldLabel>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        className="w-full"
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <div className="flex justify-end mt-4">
        <PrimaryButton onClick={submit} disabled={!title.trim()}>
          Ajouter
        </PrimaryButton>
      </div>
    </Modal>
  )
}

function TaskDetailModal({
  task,
  ancestors,
  onClose,
  onOpenChild,
  onBreadcrumbClick,
  onUpdate,
  onAddSub,
  onRemove,
}: {
  task: TaskNode
  ancestors: TaskNode[]
  onClose: () => void
  onOpenChild: (id: string) => void
  onBreadcrumbClick: (index: number) => void
  onUpdate: (patch: Partial<TaskNode>) => void
  onAddSub: (name: string) => void
  onRemove: () => void
}) {
  const [subName, setSubName] = useState('')
  const [previewMode, setPreviewMode] = useState(false)

  useEffect(() => {
    setPreviewMode(false)
    setSubName('')
  }, [task.id])

  return (
    <Modal open onClose={onClose} title="Détail de la tâche" width={640} center allowProjectSwitch>
      {ancestors.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-2 -mt-1 shrink-0">
          {ancestors.map((a, i) => (
            <React.Fragment key={a.id}>
              <button
                type="button"
                onClick={() => onBreadcrumbClick(i)}
                className="border-none bg-transparent text-accent text-[12px] font-semibold cursor-pointer hover:underline p-0"
              >
                {a.name}
              </button>
              <ChevronRightIcon size={12} className="text-text-faint" />
            </React.Fragment>
          ))}
        </div>
      )}
      <input
        value={task.name}
        aria-label="Titre de la tâche"
        onChange={(e) => onUpdate({ name: e.target.value })}
        className="text-[16px] font-bold bg-transparent border-none outline-none w-full mb-2 py-1 shrink-0"
      />
      <div className="flex gap-2 mb-3 shrink-0">
        {(['a_faire', 'en_cours', 'fait'] as const).map((st) => (
          <StatusPill
            key={st}
            label={TASK_STATUS_LABEL[st]}
            tone={statusTone(st)}
            onClick={task.children.length ? undefined : () => onUpdate({ status: st })}
            className={task.status === st ? 'ring-2 ring-accent' : ''}
          />
        ))}
      </div>
      {task.children.length > 0 && <p className="text-xs text-text-faint mb-3 shrink-0">Statut calculé automatiquement à partir des sous-tâches.</p>}
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <span className="text-[11px] font-bold text-text-faint uppercase tracking-wide">Description</span>
        <Switch checked={previewMode} onChange={setPreviewMode} label="Aperçu" />
      </div>
      {previewMode ? (
        <div className="bg-bg border border-border rounded-lg px-3 py-2 flex-1 min-h-32 shrink-0 overflow-auto">
          {task.content ? (
            <Markdown text={task.content} />
          ) : (
            <p className="text-[13px] text-text-faint">Rien à prévisualiser.</p>
          )}
        </div>
      ) : (
        <Textarea
          value={task.content}
          aria-label="Description de la tâche"
          onChange={(e) => onUpdate({ content: e.target.value })}
          placeholder="Notes sur cette tâche… (#, ##, -, **gras**)"
          className="w-full flex-1 min-h-32 shrink-0"
          style={{ resize: 'none' }}
        />
      )}
      {task.children.length > 0 && (
        <div className="mt-3 max-h-36 overflow-auto shrink-0">
          <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-1.5">
            Sous-tâches
          </div>
          {task.children.map((ch) => (
            <div
              key={ch.id}
              onClick={() => onOpenChild(ch.id)}
              className="flex items-center gap-2 py-1.5 border-b border-border cursor-pointer"
            >
              <span className="text-[13px] text-text flex-1">{ch.name}</span>
              <StatusPill label={TASK_STATUS_LABEL[ch.status]} tone={statusTone(ch.status)} />
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-3 shrink-0">
        <Input
          value={subName}
          onChange={(e) => setSubName(e.target.value)}
          placeholder="Ajouter une sous-tâche…"
          className="flex-1"
        />
        <PrimaryButton
          onClick={() => {
            if (!subName.trim()) return
            onAddSub(subName.trim())
            setSubName('')
          }}
        >
          Ajouter
        </PrimaryButton>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center gap-1.5 border-none bg-transparent text-danger text-xs font-semibold cursor-pointer mt-4 self-start shrink-0"
      >
        <TrashIcon size={13} /> Supprimer cette tâche
      </button>
    </Modal>
  )
}
