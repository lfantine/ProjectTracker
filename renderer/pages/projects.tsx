import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../components/AppShell'
import { ProjectCard } from '../components/ProjectCard'
import { FoldersModal } from '../components/FoldersModal'
import { Card, Chip, PrimaryButton, SecondaryButton } from '../components/ui'
import { useData } from '../lib/store'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_ORDER } from '../lib/constants'
import { projectsInFolder } from '../lib/helpers'
import type { Project, ProjectFolder, ProjectStatus } from '../lib/types'
import { ChevronDownIcon, PlusIcon, FolderIcon, SparklesIcon } from '../components/icons'

const FILTERS: { key: ProjectStatus | 'tous'; label: string }[] = [
  { key: 'tous', label: 'Tous' },
  ...PROJECT_STATUS_ORDER.map((s) => ({ key: s, label: PROJECT_STATUS_LABEL[s] })),
]

const COLLAPSED_STORAGE_KEY = 'tracker_collapsed_category_folders'
const UNFOLDERED_ID = '__unfoldered__'

function byRecentlyUpdated(a: Project, b: Project) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
}

export default function ProjectsPage() {
  const { data, loading, addFolder, updateFolder, removeFolder, updateProject } = useData()
  const router = useRouter()
  const [filter, setFilter] = useState<ProjectStatus | 'tous'>('tous')
  const [foldersModalOpen, setFoldersModalOpen] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
      if (raw) setCollapsedFolders(JSON.parse(raw))
    } catch {
      // ignore malformed/unavailable storage
    }
  }, [])

  function toggleFolderCollapsed(folderId: string) {
    setCollapsedFolders((prev) => {
      const next = { ...prev, [folderId]: !prev[folderId] }
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const groups = useMemo(() => {
    const statuses = filter === 'tous' ? PROJECT_STATUS_ORDER : [filter]
    return statuses
      .map((status) => ({
        status,
        projects: data.projects.filter((p) => p.status === status).sort(byRecentlyUpdated),
      }))
      .filter((g) => g.projects.length > 0)
  }, [data.projects, filter])

  const matches = useMemo(() => {
    const statuses = filter === 'tous' ? PROJECT_STATUS_ORDER : [filter]
    return (p: Project) => statuses.includes(p.status)
  }, [filter])

  const categoryFolders = useMemo(() => data.folders.filter((f) => f.displayMode === 'category'), [data.folders])
  const groupFolders = useMemo(() => data.folders.filter((f) => f.displayMode === 'group'), [data.folders])

  const categorySections = useMemo(
    () =>
      categoryFolders
        .map((f) => ({
          folder: f,
          projects: projectsInFolder(f, data.projects).filter(matches).sort(byRecentlyUpdated),
        }))
        .filter((s) => s.projects.length > 0),
    [categoryFolders, data.projects, matches]
  )

  const groupSections = useMemo(
    () =>
      groupFolders.map((f) => ({
        folder: f,
        count: projectsInFolder(f, data.projects).filter(matches).length,
      })),
    [groupFolders, data.projects, matches]
  )

  const unfoldered = useMemo(
    () => data.projects.filter((p) => !p.folderId).filter(matches).sort(byRecentlyUpdated),
    [data.projects, matches]
  )

  const useFolders = data.folders.length > 0
  const totalCount = useFolders
    ? categorySections.reduce((acc, s) => acc + s.projects.length, 0) +
      groupSections.reduce((acc, s) => acc + s.count, 0) +
      unfoldered.length
    : groups.reduce((acc, g) => acc + g.projects.length, 0)

  return (
    <AppShell title="Projets">
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} active={filter === f.key} onClick={() => setFilter(f.key)} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => setFoldersModalOpen(true)}>
            <span className="flex items-center gap-1.5">
              <FolderIcon size={14} /> Gérer les dossiers
            </span>
          </SecondaryButton>
          <PrimaryButton onClick={() => router.push('/projects/new')}>
            <span className="flex items-center gap-1.5">
              <PlusIcon size={14} /> Nouveau projet
            </span>
          </PrimaryButton>
        </div>
      </div>

      {!loading && totalCount === 0 && (
        <div className="bg-surface border border-dashed border-border rounded-xl p-10 text-center">
          <p className="text-sm text-text-muted">Aucun projet ici.</p>
        </div>
      )}

      {useFolders ? (
        <div className="flex flex-col gap-6">
          {groupFolders.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-[13px] font-bold text-text-faint uppercase tracking-wide">Dossiers</h2>
              </div>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))' }}>
                {groupSections.map(({ folder, count }) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    count={count}
                    onClick={() => router.push(`/projects/folder?id=${folder.id}`)}
                  />
                ))}
              </div>
            </div>
          )}
          {categorySections.map((s) => (
            <CollapsibleProjectSection
              key={s.folder.id}
              id={s.folder.id}
              title={s.folder.name}
              icon={s.folder.kind === 'smart' ? SparklesIcon : FolderIcon}
              iconClassName={s.folder.kind === 'smart' ? 'text-accent' : 'text-text-faint'}
              projects={s.projects}
              filter={filter}
              collapsed={!!collapsedFolders[s.folder.id]}
              onToggle={() => toggleFolderCollapsed(s.folder.id)}
            />
          ))}
          {unfoldered.length > 0 && (
            <CollapsibleProjectSection
              id={UNFOLDERED_ID}
              title="Sans dossier"
              icon={FolderIcon}
              iconClassName="text-text-faint"
              projects={unfoldered}
              filter={filter}
              collapsed={!!collapsedFolders[UNFOLDERED_ID]}
              onToggle={() => toggleFolderCollapsed(UNFOLDERED_ID)}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <div key={g.status}>
              {filter === 'tous' && (
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-[13px] font-bold text-text-faint uppercase tracking-wide">
                    {PROJECT_STATUS_LABEL[g.status]}
                  </h2>
                  <span className="text-[11px] font-semibold text-text-faint">{g.projects.length}</span>
                </div>
              )}
              <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
                {g.projects.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {foldersModalOpen && (
        <FoldersModal
          folders={data.folders}
          projects={data.projects}
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

function CollapsibleProjectSection({
  id,
  title,
  icon: Icon,
  iconClassName,
  projects,
  filter,
  collapsed,
  onToggle,
}: {
  id: string
  title: string
  icon: ComponentType<{ size?: number; className?: string }>
  iconClassName?: string
  projects: Project[]
  filter: ProjectStatus | 'tous'
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div key={id}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 mb-3 bg-transparent border-none cursor-pointer p-0 text-left"
      >
        <Icon size={14} className={`flex-shrink-0 ${iconClassName || ''}`} />
        <h2 className="text-[13px] font-bold text-text-faint uppercase tracking-wide">{title}</h2>
        <span className="text-[11px] font-semibold text-text-faint">{projects.length}</span>
        <ChevronDownIcon
          size={14}
          className={`text-text-faint transition-transform ml-auto ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed && <StatusGroupedProjects projects={projects} filter={filter} />}
    </div>
  )
}

function StatusGroupedProjects({
  projects,
  filter,
}: {
  projects: Project[]
  filter: ProjectStatus | 'tous'
}) {
  const statuses = filter === 'tous' ? PROJECT_STATUS_ORDER : [filter]
  const subgroups = statuses
    .map((status) => ({ status, projects: projects.filter((p) => p.status === status) }))
    .filter((g) => g.projects.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {subgroups.map((g) => (
        <div key={g.status}>
          {filter === 'tous' && (
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-[11.5px] font-bold text-text-faint uppercase tracking-wide">
                {PROJECT_STATUS_LABEL[g.status]}
              </h3>
              <span className="text-[10.5px] font-semibold text-text-faint">{g.projects.length}</span>
            </div>
          )}
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
            {g.projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function FolderCard({
  folder,
  count,
  onClick,
}: {
  folder: ProjectFolder
  count: number
  onClick: () => void
}) {
  return (
    <Card onClick={onClick}>
      <div className="flex items-center gap-2">
        {folder.kind === 'smart' ? (
          <SparklesIcon size={15} className="text-accent flex-shrink-0" />
        ) : (
          <FolderIcon size={15} className="text-text-faint flex-shrink-0" />
        )}
        <span className="text-[14.5px] font-bold truncate">{folder.name}</span>
      </div>
      {folder.description && (
        <p className="text-xs text-text-muted line-clamp-2">{folder.description}</p>
      )}
      <div className="text-[11.5px] text-text-faint mt-0.5">
        {count} projet{count !== 1 ? 's' : ''}
      </div>
    </Card>
  )
}
