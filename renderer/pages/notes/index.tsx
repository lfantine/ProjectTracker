import { useMemo, useState, type MouseEvent } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../../components/AppShell'
import { Card, Chip, Input, PrimaryButton, SecondaryButton, TagChip } from '../../components/ui'
import { FolderIcon, PlusIcon, TrashIcon } from '../../components/icons'
import { useToast } from '../../components/Toast'
import { useData } from '../../lib/store'
import { fmtDate, timeAgo } from '../../lib/helpers'
import type { Note, Project } from '../../lib/types'

type SortMode = 'date' | 'projet'
const SORT_LABEL: Record<SortMode, string> = { date: 'Plus récentes', projet: 'Par projet' }

export default function NotesPage() {
  const { data, loading, addNote, removeNote, restoreNote } = useData()
  const router = useRouter()
  const { showToast } = useToast()
  const [showTrash, setShowTrash] = useState(false)
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('date')

  const withProjects = useMemo(
    () =>
      data.notes.map((n) => ({
        note: n,
        projects: data.projects.filter((p) => (p.noteIds || []).includes(n.id)),
      })),
    [data.notes, data.projects]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = withProjects.filter(
      ({ note: n, projects }) =>
        !query ||
        n.title.toLowerCase().includes(query) ||
        n.content.toLowerCase().includes(query) ||
        n.tags.some((t) => t.toLowerCase().includes(query)) ||
        projects.some((p) => p.name.toLowerCase().includes(query))
    )
    return matches.slice().sort((a, b) => {
      if (sortMode === 'projet') {
        const an = a.projects[0]?.name || '￿'
        const bn = b.projects[0]?.name || '￿'
        const cmp = an.localeCompare(bn)
        if (cmp !== 0) return cmp
      }
      return new Date(b.note.updatedAt).getTime() - new Date(a.note.updatedAt).getTime()
    })
  }, [withProjects, search, sortMode])

  async function createNote() {
    const note = await addNote({ title: 'Sans titre', content: '', tags: [] })
    if (note) router.push(`/notes/detail?id=${note.id}`)
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    if (!await removeNote(id)) return
    showToast('Note déplacée dans la corbeille.', 'default', { label: 'Annuler', onClick: () => restoreNote(id) })
  }

  return (
    <AppShell title="Notes">
      <div className="flex gap-2 mb-4">
        <Chip label="Notes" active={!showTrash} onClick={() => setShowTrash(false)} />
        <Chip label={`Corbeille (${data.trashedNotes?.length || 0})`} active={showTrash} onClick={() => setShowTrash(true)} />
      </div>
      {showTrash ? <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">Les notes restent récupérables ici, avec leur contenu et leurs liens aux projets.</p>
        {!data.trashedNotes?.length && <p className="text-sm text-text-faint">La corbeille est vide.</p>}
        {[...(data.trashedNotes || [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)).map((entry) => <Card key={entry.note.id}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="font-semibold truncate">{entry.note.title || 'Sans titre'}</p><p className="text-xs text-text-faint">Supprimée {timeAgo(entry.deletedAt)}</p></div>
            <SecondaryButton onClick={() => { restoreNote(entry.note.id); showToast('Note restaurée avec ses liens.', 'success') }}>Restaurer</SecondaryButton>
          </div>
          <p className="text-sm text-text-muted whitespace-pre-wrap line-clamp-3">{entry.note.content || 'Page vide.'}</p>
        </Card>)}
      </div> : <>
      <div className="flex items-center justify-between mb-3.5 gap-3 flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="max-w-xs flex-1"
        />
        <PrimaryButton onClick={createNote}>
          <span className="flex items-center gap-1.5">
            <PlusIcon size={14} /> Nouvelle note
          </span>
        </PrimaryButton>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <span className="text-[11px] font-bold text-text-faint uppercase tracking-wide">Trier</span>
        {(['date', 'projet'] as SortMode[]).map((m) => (
          <Chip key={m} label={SORT_LABEL[m]} active={sortMode === m} onClick={() => setSortMode(m)} />
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <div className="bg-surface border border-dashed border-border rounded-xl p-10 text-center">
          <p className="text-sm text-text-muted">
            {search ? 'Aucun résultat.' : 'Aucune note pour l’instant.'}
          </p>
        </div>
      )}

      <div className="grid gap-4.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
        {filtered.map(({ note: n, projects }) => (
          <NoteCard
            key={n.id}
            note={n}
            projects={projects}
            onOpen={() => router.push(`/notes/detail?id=${n.id}`)}
            onOpenProject={(pid) => router.push(`/project?id=${pid}`)}
            onDelete={(e) => handleDelete(e, n.id)}
          />
        ))}
      </div>
      </>}
    </AppShell>
  )
}

function NoteCard({
  note: n,
  projects,
  onOpen,
  onOpenProject,
  onDelete,
}: {
  note: Note
  projects: Project[]
  onOpen: () => void
  onOpenProject: (projectId: string) => void
  onDelete: (e: MouseEvent) => void
}) {
  return (
    <Card onClick={onOpen} className="group">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-bold truncate">{n.title || 'Sans titre'}</div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Mettre ${n.title || 'Sans titre'} dans la corbeille`}
          title="Mettre dans la corbeille"
          className="shrink-0 border-none bg-transparent text-text-faint opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
        >
          <TrashIcon size={13} />
        </button>
      </div>
      {projects.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenProject(p.id)
              }}
              className="inline-flex items-center gap-1 text-[10.5px] font-semibold bg-accent-soft text-accent-soft-text px-1.5 py-0.5 rounded cursor-pointer border-none hover:brightness-105 transition"
            >
              <FolderIcon size={10} /> {p.name}
            </button>
          ))}
        </div>
      )}
      <p
        className="text-[12.5px] text-text-muted overflow-hidden text-ellipsis"
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
      >
        {n.content.trim() ? n.content.replace(/[#*`>-]/g, '').slice(0, 90) : 'Page vide.'}
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {n.tags.map((t) => (
          <TagChip key={t} label={t} />
        ))}
      </div>
      <div className="text-[11px] text-text-faint font-mono" title={fmtDate(n.updatedAt)}>
        {timeAgo(n.updatedAt)}
      </div>
    </Card>
  )
}
