import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { AppShell } from '../../components/AppShell'
import { ProjectCard } from '../../components/ProjectCard'
import { FoldersModal } from '../../components/FoldersModal'
import { SecondaryButton, Spinner } from '../../components/ui'
import { useData } from '../../lib/store'
import { projectsInFolder } from '../../lib/helpers'
import { ChevronRightIcon, FolderIcon, PencilIcon, SparklesIcon } from '../../components/icons'

export default function FolderDetailPage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const { data, loading, addFolder, updateFolder, removeFolder, updateProject } = useData()
  const [foldersModalOpen, setFoldersModalOpen] = useState(false)

  const folder = id ? data.folders.find((f) => f.id === id) : undefined
  const projects = useMemo(
    () => (folder ? projectsInFolder(folder, data.projects).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) : []),
    [folder, data.projects]
  )

  if (loading) {
    return (
      <AppShell title="Dossier">
        <div className="flex items-center gap-2 text-sm text-text-faint">
          <Spinner size={16} /> Chargement…
        </div>
      </AppShell>
    )
  }

  if (!folder) {
    return (
      <AppShell title="Dossier introuvable">
        <p className="text-sm text-text-muted">Ce dossier n&apos;existe pas ou plus.</p>
        <Link href="/projects" className="mt-3 inline-block text-accent font-semibold">
          ← Retour aux projets
        </Link>
      </AppShell>
    )
  }

  return (
    <AppShell title={folder.name}>
      <div className="flex items-center gap-1.5 text-[13px] mb-4">
        <Link href="/projects" className="text-text-muted hover:text-accent transition-colors">
          Projets
        </Link>
        <ChevronRightIcon size={13} className="text-text-faint" />
        <span className="font-semibold text-text">{folder.name}</span>
      </div>

      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-start gap-2.5">
          {folder.kind === 'smart' ? (
            <SparklesIcon size={20} className="text-accent flex-shrink-0 mt-0.5" />
          ) : (
            <FolderIcon size={20} className="text-text-faint flex-shrink-0 mt-0.5" />
          )}
          <div>
            <h1 className="text-[24px] font-bold leading-tight">{folder.name}</h1>
            {folder.description && (
              <p className="text-sm text-text-muted mt-1 max-w-xl">{folder.description}</p>
            )}
            <p className="text-[12.5px] text-text-faint mt-1">
              {projects.length} projet{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <SecondaryButton onClick={() => setFoldersModalOpen(true)}>
          <span className="flex items-center gap-1.5">
            <PencilIcon size={13} /> Gérer ce dossier
          </span>
        </SecondaryButton>
      </div>

      {projects.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-xl p-10 text-center">
          <p className="text-sm text-text-muted">Aucun projet dans ce dossier.</p>
        </div>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {foldersModalOpen && (
        <FoldersModal
          folders={data.folders}
          projects={data.projects}
          initialEditingId={folder.id}
          onClose={() => setFoldersModalOpen(false)}
          addFolder={addFolder}
          updateFolder={updateFolder}
          removeFolder={removeFolder}
          updateProject={updateProject}
        />
      )}
    </AppShell>
  )
}
