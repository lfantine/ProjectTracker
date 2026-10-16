import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import type { TablePreset } from '../lib/tables'
import { TablePresetPicker } from '../components/TablePresetPicker'
import { Modal, GhostButton } from '../components/ui'
import { useData } from '../lib/store'
import { createTableModule } from '../lib/tables'
import { uid } from '../lib/helpers'
import { defaultProjectLayout } from '../lib/types'
import type { ModuleType, Project, ProjectModule } from '../lib/types'
import { MODULE_CATALOG, MODULE_CATEGORY_LABEL } from '../lib/moduleCatalog'
import {
  ModuleCatalogGrid,
  ModuleCategorySidebar,
  ModuleSearchInput,
  useModuleCatalogFilter,
} from '../components/ModuleCatalog'
import { IconButton } from '../components/ui'
import { ExternalLinkIcon, PlusIcon, XIcon } from '../components/icons'

function projectHasModule(project: Project, type: ModuleType): boolean {
  const layout = project.layout && project.layout.length > 0 ? project.layout : defaultProjectLayout()
  return layout.some((m) => m.type === type)
}

function newModuleFor(type: ModuleType): ProjectModule {
  if (type === 'table') return createTableModule(uid('mod'), 'applications')
  if (type === 'image') return { id: uid('mod'), type: 'image', title: '', imageUrl: '', text: '' }
  if (type === 'chart') return { id: uid('mod'), type: 'chart', title: '', chart: { kind: 'bar', points: [] } }
  return { id: uid('mod'), type }
}

export function CoreMarketplace() {
  const { data, addModule } = useData()
  const router = useRouter()
  const [tableProjectId, setTableProjectId] = useState<string | null>(null)
  const { query, setQuery, category, setCategory, filtered } = useModuleCatalogFilter()
  const [selectedType, setSelectedType] = useState<ModuleType | null>(null)

  const selectedEntry = useMemo(
    () => (selectedType ? MODULE_CATALOG.find((e) => e.type === selectedType) : undefined),
    [selectedType]
  )

  const { used, missing } = useMemo(() => {
    if (!selectedType) return { used: [] as Project[], missing: [] as Project[] }
    const used: Project[] = []
    const missing: Project[] = []
    for (const p of data.projects) {
      if (projectHasModule(p, selectedType)) used.push(p)
      else missing.push(p)
    }
    return { used, missing }
  }, [data.projects, selectedType])

  const total = data.projects.length

  return (
    <>
      <div className="flex gap-5 items-start">
        <ModuleCategorySidebar category={category} onChange={setCategory} />

        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <ModuleSearchInput value={query} onChange={setQuery} />

            <div className="flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <ModuleCatalogGrid
                  entries={filtered}
                  isActive={(entry) => entry.type === selectedType}
                  renderBadge={(entry) => {
                    const count = data.projects.filter((p) => projectHasModule(p, entry.type)).length
                    return (
                      <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-surface2 text-text-muted whitespace-nowrap">
                        {count}/{total} projets
                      </span>
                    )
                  }}
                  onSelect={(entry) => setSelectedType((cur) => (cur === entry.type ? null : entry.type))}
                />
              </div>

              {selectedEntry && (
                <div
                  className="w-[320px] flex-shrink-0 bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 overflow-auto"
                  style={{ maxHeight: 560 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-10 h-10 rounded-lg bg-accent-soft text-accent-soft-text flex items-center justify-center flex-shrink-0">
                        <selectedEntry.icon size={19} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold truncate">{selectedEntry.title}</div>
                        <div className="text-[11px] font-semibold text-text-faint">
                          {MODULE_CATEGORY_LABEL[selectedEntry.category]}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedType(null)}
                      className="border-none bg-transparent text-text-faint cursor-pointer flex-shrink-0" title="Fermer" aria-label="Fermer"
                    >
                      <XIcon size={16} />
                    </button>
                  </div>

                  <p className="text-[13px] text-text-muted leading-relaxed">{selectedEntry.description}</p>

                  <div className="text-[12.5px] text-text-faint">
                    Utilisé dans <strong className="text-text">{used.length}</strong> projet
                    {used.length !== 1 ? 's' : ''} sur {total}.
                  </div>

                  {used.length > 0 && (
                    <div>
                      <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-1.5">
                        Déjà utilisé
                      </div>
                      <div className="flex flex-col">
                        {used.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => router.push(`/project?id=${p.id}`)}
                            className="flex items-center justify-between gap-2 text-left border-none bg-transparent cursor-pointer py-1.5 hover:text-accent transition-colors" title="Ouvrir le lien dans le navigateur" aria-label="Ouvrir le lien dans le navigateur"
                          >
                            <span className="text-[13px] truncate">{p.name}</span>
                            <ExternalLinkIcon size={12} className="flex-shrink-0 text-text-faint" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {missing.length > 0 && (
                    <div>
                      <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-1.5">
                        Pourrait être ajouté à
                      </div>
                      <div className="flex flex-col">
                        {missing.map((p) => (
                          <div key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => router.push(`/project?id=${p.id}`)}
                              className="flex-1 min-w-0 text-left text-[13px] truncate border-none bg-transparent cursor-pointer hover:text-accent transition-colors"
                            >
                              {p.name}
                            </button>
                            {selectedEntry.kind === 'direct' ? (
                              <IconButton
                                title="Ajouter à ce projet"
                                onClick={() => selectedEntry.type === 'table' ? setTableProjectId(p.id) : addModule(p.id, newModuleFor(selectedEntry.type))}
                              >
                                <PlusIcon size={12} />
                              </IconButton>
                            ) : (
                              <ExternalLinkIcon size={12} className="flex-shrink-0 text-text-faint" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
        </div>
      </div>
      {tableProjectId && <Modal open title="Nouvelle table" compact center width={460} onClose={() => setTableProjectId(null)}>
        <GhostButton onClick={() => setTableProjectId(null)}>← Retour aux modules</GhostButton>
        <TablePresetPicker onSelect={(preset: TablePreset) => { addModule(tableProjectId, createTableModule(uid('mod'), preset)); setTableProjectId(null) }} />
      </Modal>}
    </>
  )
}
