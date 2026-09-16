import { useState } from 'react'
import type { FolderDisplayMode, FolderKind, Project, ProjectFolder } from '../lib/types'
import { PROJECT_STATUS_LABEL, statusTone } from '../lib/constants'
import {
  FieldLabel,
  GhostButton,
  IconButton,
  Input,
  Modal,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  Textarea,
} from './ui'
import { TagsInput } from './TagsInput'
import { FolderIcon, PencilIcon, PlusIcon, SparklesIcon, TrashIcon } from './icons'

const DISPLAY_MODE_LABEL: Record<FolderDisplayMode, string> = {
  category: 'Catégorie',
  group: 'Groupe',
}

export function FoldersModal({
  folders,
  projects,
  initialEditingId,
  onClose,
  addFolder,
  updateFolder,
  removeFolder,
  updateProject,
}: {
  folders: ProjectFolder[]
  projects: Project[]
  initialEditingId?: string
  onClose: () => void
  addFolder: (input: {
    name: string
    kind: FolderKind
    displayMode: FolderDisplayMode
    description?: string
    tagFilter?: string[]
  }) => ProjectFolder
  updateFolder: (
    id: string,
    patch: Partial<Pick<ProjectFolder, 'name' | 'description' | 'displayMode' | 'tagFilter'>>
  ) => void
  removeFolder: (id: string) => void
  updateProject: (id: string, patch: Partial<Project>) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(initialEditingId ?? null)
  const [creating, setCreating] = useState(false)
  const [newKind, setNewKind] = useState<FolderKind>('manual')
  const [newMode, setNewMode] = useState<FolderDisplayMode>('category')
  const [newName, setNewName] = useState('')

  const allTags = Array.from(new Set(projects.flatMap((p) => p.tags || []))).sort()
  const editingFolder = editingId ? folders.find((f) => f.id === editingId) || null : null

  function startCreate() {
    setEditingId(null)
    setCreating(true)
    setNewName('')
    setNewKind('manual')
    setNewMode('category')
  }

  function submitCreate() {
    if (!newName.trim()) return
    const folder = addFolder({
      name: newName.trim(),
      kind: newKind,
      displayMode: newMode,
      tagFilter: newKind === 'smart' ? [] : undefined,
    })
    setCreating(false)
    setEditingId(folder.id)
  }

  return (
    <Modal open onClose={onClose} title="Dossiers" width={480}>
      <div className="flex flex-col gap-1 mb-2">
        {folders.map((f, i) => (
          <div key={f.id} className={`flex items-center gap-2 py-2 ${i > 0 ? 'border-t border-border' : ''}`}>
            {f.kind === 'smart' ? (
              <SparklesIcon size={14} className="text-accent flex-shrink-0" />
            ) : (
              <FolderIcon size={14} className="text-text-faint flex-shrink-0" />
            )}
            <span className="flex-1 text-[13px] font-semibold text-text truncate">{f.name}</span>
            <span className="text-[10.5px] font-bold text-text-faint uppercase tracking-wide">
              {f.kind === 'smart' ? 'Smart' : 'Manuel'} · {DISPLAY_MODE_LABEL[f.displayMode]}
            </span>
            <IconButton
              title="Modifier"
              onClick={() => {
                setCreating(false)
                setEditingId((cur) => (cur === f.id ? null : f.id))
              }}
            >
              <PencilIcon size={13} />
            </IconButton>
            <IconButton
              title="Supprimer"
              className="text-danger!"
              onClick={() => {
                if (window.confirm(`Supprimer le dossier « ${f.name} » ?`)) {
                  removeFolder(f.id)
                  if (editingId === f.id) setEditingId(null)
                }
              }}
            >
              <TrashIcon size={13} />
            </IconButton>
          </div>
        ))}
        {folders.length === 0 && !creating && (
          <p className="text-[13px] text-text-faint py-2">Aucun dossier pour l’instant.</p>
        )}
      </div>

      {editingFolder && (
        <div className="mt-1 pt-3 border-t border-border">
          <FieldLabel>Nom</FieldLabel>
          <Input
            value={editingFolder.name}
            onChange={(e) => updateFolder(editingFolder.id, { name: e.target.value })}
            className="w-full mb-1"
          />

          <FieldLabel>Affichage</FieldLabel>
          <div className="flex gap-2 mb-1">
            <SecondaryButton
              className={editingFolder.displayMode === 'category' ? 'border-accent! text-accent!' : ''}
              onClick={() => updateFolder(editingFolder.id, { displayMode: 'category' })}
            >
              Catégorie
            </SecondaryButton>
            <SecondaryButton
              className={editingFolder.displayMode === 'group' ? 'border-accent! text-accent!' : ''}
              onClick={() => updateFolder(editingFolder.id, { displayMode: 'group' })}
            >
              Groupe
            </SecondaryButton>
          </div>
          <p className="text-[11.5px] text-text-faint mb-2">
            {editingFolder.displayMode === 'group'
              ? 'Affiché comme une carte sur la page Projets — cliquer dessus ouvre la page du dossier.'
              : 'Affiché comme une ligne directement sur la page Projets, avec ses projets.'}
          </p>

          {editingFolder.displayMode === 'group' && (
            <>
              <FieldLabel>Description (optionnel)</FieldLabel>
              <Textarea
                value={editingFolder.description || ''}
                onChange={(e) => updateFolder(editingFolder.id, { description: e.target.value })}
                placeholder="À propos de ce dossier…"
                className="w-full mb-1"
                style={{ minHeight: 60 }}
              />
            </>
          )}

          {editingFolder.kind === 'manual' ? (
            <>
              <FieldLabel>Projets dans ce dossier</FieldLabel>
              <div className="flex flex-col max-h-56 overflow-auto">
                {projects.map((p, i) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2.5 py-1.5 cursor-pointer ${i > 0 ? 'border-t border-border' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={p.folderId === editingFolder.id}
                      onChange={(e) =>
                        updateProject(p.id, { folderId: e.target.checked ? editingFolder.id : undefined })
                      }
                    />
                    <span className="flex-1 text-[13px] text-text truncate">{p.name}</span>
                    <StatusPill label={PROJECT_STATUS_LABEL[p.status]} tone={statusTone(p.status)} />
                  </label>
                ))}
                {projects.length === 0 && <p className="text-[13px] text-text-faint">Aucun projet.</p>}
              </div>
            </>
          ) : (
            <>
              <FieldLabel>Tags à faire correspondre (un seul suffit)</FieldLabel>
              <TagsInput
                tags={editingFolder.tagFilter || []}
                onChange={(tagFilter) => updateFolder(editingFolder.id, { tagFilter })}
                suggestions={allTags}
                placeholder="Ajouter un tag…"
              />
            </>
          )}
          <div className="flex justify-end mt-3">
            <GhostButton onClick={() => setEditingId(null)}>Terminé</GhostButton>
          </div>
        </div>
      )}

      {creating && (
        <div className="mt-1 pt-3 border-t border-border">
          <FieldLabel>Type de dossier</FieldLabel>
          <div className="flex gap-2 mb-2">
            <SecondaryButton
              className={newKind === 'manual' ? 'border-accent! text-accent!' : ''}
              onClick={() => setNewKind('manual')}
            >
              Manuel
            </SecondaryButton>
            <SecondaryButton
              className={newKind === 'smart' ? 'border-accent! text-accent!' : ''}
              onClick={() => setNewKind('smart')}
            >
              SmartFolder
            </SecondaryButton>
          </div>

          <FieldLabel>Affichage</FieldLabel>
          <div className="flex gap-2 mb-2">
            <SecondaryButton
              className={newMode === 'category' ? 'border-accent! text-accent!' : ''}
              onClick={() => setNewMode('category')}
            >
              Catégorie
            </SecondaryButton>
            <SecondaryButton
              className={newMode === 'group' ? 'border-accent! text-accent!' : ''}
              onClick={() => setNewMode('group')}
            >
              Groupe
            </SecondaryButton>
          </div>

          <FieldLabel>Nom</FieldLabel>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Client Dupont, Vidéos YouTube…"
            className="w-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
            }}
          />
          <div className="flex justify-end gap-2 mt-3">
            <GhostButton onClick={() => setCreating(false)}>Annuler</GhostButton>
            <PrimaryButton onClick={submitCreate} disabled={!newName.trim()}>
              Créer
            </PrimaryButton>
          </div>
        </div>
      )}

      {!creating && !editingFolder && (
        <GhostButton onClick={startCreate} className="mt-2">
          <PlusIcon size={12} /> Nouveau dossier
        </GhostButton>
      )}
    </Modal>
  )
}
