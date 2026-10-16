import { useState } from 'react'
import type { ChecklistItem, ChecklistStatus, ChecklistType, Project } from '../lib/types'
import {
  CHK_GROUP_LABEL,
  CHK_STATUS_BY_TYPE,
  CHK_STATUS_LABEL,
  CHK_TYPE_LABEL,
  PROJECT_STATUS_LABEL,
  statusTone,
} from '../lib/constants'
import { fmtShort } from '../lib/helpers'
import { FieldLabel, Input, Modal, PrimaryButton, Select, StatusPill, Textarea } from './ui'
import { ExternalLinkIcon, NoteIcon, PencilIcon, PlusIcon, ShoppingBagIcon, TrashIcon } from './icons'

const GROUP_ORDER: ChecklistType[] = ['materiel', 'evenement', 'projet', 'generique']
const CARD_GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))' }

export function ChecklistList({
  items,
  projects,
  onAdd,
  onCycleStatus,
  onSetStatus,
  onUpdate,
  onRemove,
}: {
  items: ChecklistItem[]
  projects: Project[]
  onAdd: (input: {
    label: string
    type: ChecklistType
    link?: string
    projectRef?: string
    date?: string
    description?: string
  }) => void
  onCycleStatus: (id: string) => void
  onSetStatus: (id: string, status: ChecklistStatus) => void
  onUpdate: (id: string, patch: Partial<ChecklistItem>) => void
  onRemove: (id: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const selected = selectedId ? items.find((c) => c.id === selectedId) || null : null

  return (
    <div>
      {items.length === 0 && <p className="text-[13px] text-text-faint mb-2">Rien pour l&apos;instant.</p>}
      <div className="flex flex-col gap-5 mb-3">
        {GROUP_ORDER.map((groupType) => {
          const groupItems = items.filter((c) => c.type === groupType)
          if (groupItems.length === 0) return null
          return (
            <div key={groupType}>
              <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-2">
                {CHK_GROUP_LABEL[groupType]}
              </div>
              {groupType === 'materiel' && (
                <MaterielGroup items={groupItems} onOpen={setSelectedId} onCycleStatus={onCycleStatus} />
              )}
              {groupType === 'evenement' && (
                <EvenementGroup items={groupItems} onOpen={setSelectedId} onSetStatus={onSetStatus} />
              )}
              {groupType === 'projet' && (
                <ProjetGroup
                  items={groupItems}
                  projects={projects}
                  onOpen={setSelectedId}
                  onCycleStatus={onCycleStatus}
                  onRemove={onRemove}
                />
              )}
              {groupType === 'generique' && (
                <GeneriqueGroup items={groupItems} onOpen={setSelectedId} onCycleStatus={onCycleStatus} onRemove={onRemove} />
              )}
            </div>
          )
        })}
      </div>

      <PrimaryButton onClick={() => setAddOpen(true)}>
        <span className="flex items-center gap-1.5">
          <PlusIcon size={14} /> Ajouter un élément
        </span>
      </PrimaryButton>

      {selected && (
        <ChecklistItemModal
          item={selected}
          projects={projects}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => onUpdate(selected.id, patch)}
          onSetStatus={(status) => onSetStatus(selected.id, status)}
          onRemove={() => {
            onRemove(selected.id)
            setSelectedId(null)
          }}
        />
      )}

      {addOpen && (
        <ChecklistAddModal
          projects={projects}
          onClose={() => setAddOpen(false)}
          onAdd={(input) => {
            onAdd(input)
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ---- Matériel: shopping-basket style cards ----
function MaterielGroup({
  items,
  onOpen,
  onCycleStatus,
}: {
  items: ChecklistItem[]
  onOpen: (id: string) => void
  onCycleStatus: (id: string) => void
}) {
  return (
    <div className="grid gap-2.5" style={CARD_GRID_STYLE}>
      {items.map((c) => (
        <div
          key={c.id}
          onClick={() => onOpen(c.id)}
          className="bg-surface2 border border-border rounded-lg p-3 flex flex-col gap-2.5 cursor-pointer hover:bg-surface-hover transition"
        >
          <div className="flex items-center justify-between text-text-faint">
            <ShoppingBagIcon size={15} />
            <div className="flex items-center gap-1.5">
              {c.description && <NoteIcon size={12} />}
              {c.link && <ExternalLinkIcon size={12} />}
            </div>
          </div>
          <span className="text-[13px] font-semibold text-text leading-snug">{c.label}</span>
          <StatusPill
            label={CHK_STATUS_LABEL[c.status]}
            tone={statusTone(c.status)}
            onClick={(e) => {
              e.stopPropagation()
              onCycleStatus(c.id)
            }}
            className="self-start"
          />
        </div>
      ))}
    </div>
  )
}

// ---- Événements: boolean-ish cards, big cross once done ----
function EvenementGroup({
  items,
  onOpen,
  onSetStatus,
}: {
  items: ChecklistItem[]
  onOpen: (id: string) => void
  onSetStatus: (id: string, status: ChecklistStatus) => void
}) {
  return (
    <div className="grid gap-2.5" style={CARD_GRID_STYLE}>
      {items.map((c) => {
        const done = c.status === 'fait'
        return (
          <div
            key={c.id}
            onClick={() => onSetStatus(c.id, done ? 'a_venir' : 'fait')}
            className="relative overflow-hidden bg-surface2 border border-border rounded-lg p-3 flex flex-col gap-1.5 cursor-pointer hover:bg-surface-hover transition"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen(c.id)
              }}
              className="absolute top-1.5 right-1.5 border-none bg-transparent text-text-faint cursor-pointer p-1 rounded hover:bg-surface-hover" title="Modifier cet élément" aria-label="Modifier cet élément"
            >
              <PencilIcon size={12} />
            </button>
            <div className="flex items-center gap-1.5">
              {c.date && <span className="text-[11px] text-text-faint font-mono">{fmtShort(c.date)}</span>}
              {c.description && <NoteIcon size={11} className="text-text-faint" />}
            </div>
            <span className="text-[13px] font-semibold text-text leading-snug pr-4">{c.label}</span>
            {c.status === 'annule' && (
              <StatusPill label="Annulé" tone="danger" className="self-start" />
            )}
            {done && (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full text-text pointer-events-none"
              >
                <line x1="6" y1="6" x2="94" y2="94" stroke="currentColor" strokeWidth="5" opacity="0.55" />
                <line x1="94" y1="6" x2="6" y2="94" stroke="currentColor" strokeWidth="5" opacity="0.55" />
              </svg>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- Projet requis: vertical list, bigger rows + linked project status ----
function ProjetGroup({
  items,
  projects,
  onOpen,
  onCycleStatus,
  onRemove,
}: {
  items: ChecklistItem[]
  projects: Project[]
  onOpen: (id: string) => void
  onCycleStatus: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((c) => {
        const refProject = c.projectRef ? projects.find((p) => p.id === c.projectRef) : null
        return (
          <div
            key={c.id}
            onClick={() => onOpen(c.id)}
            className="flex items-center gap-3 px-4 py-3.5 rounded-lg bg-surface2 border border-border cursor-pointer hover:bg-surface-hover transition"
          >
            <StatusPill
              label={CHK_STATUS_LABEL[c.status]}
              tone={statusTone(c.status)}
              onClick={(e) => {
                e.stopPropagation()
                onCycleStatus(c.id)
              }}
            />
            <span className="text-[14.5px] font-semibold text-text flex-1 flex items-center gap-1.5">
              {c.label}
              {c.description && <NoteIcon size={12} className="text-text-faint flex-shrink-0" />}
            </span>
            {refProject && (
              <StatusPill
                label={`${refProject.name} · ${PROJECT_STATUS_LABEL[refProject.status]}`}
                tone={statusTone(refProject.status)}
              />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(c.id)
              }}
              className="border-none bg-transparent text-text-faint cursor-pointer" title="Supprimer cet élément" aria-label="Supprimer cet élément"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---- Générique: plain rows with an optional description preview ----
function GeneriqueGroup({
  items,
  onOpen,
  onCycleStatus,
  onRemove,
}: {
  items: ChecklistItem[]
  onOpen: (id: string) => void
  onCycleStatus: (id: string) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((c) => (
        <div
          key={c.id}
          onClick={() => onOpen(c.id)}
          className="flex flex-col gap-0.5 py-1.5 px-1 border-b border-border cursor-pointer hover:bg-surface-hover rounded"
        >
          <div className="flex items-center gap-2">
            <StatusPill
              label={CHK_STATUS_LABEL[c.status]}
              tone={statusTone(c.status)}
              onClick={(e) => {
                e.stopPropagation()
                onCycleStatus(c.id)
              }}
            />
            <span className="text-sm text-text flex-1">{c.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(c.id)
              }}
              className="border-none bg-transparent text-text-faint cursor-pointer" title="Supprimer cet élément" aria-label="Supprimer cet élément"
            >
              <TrashIcon size={14} />
            </button>
          </div>
          {c.description && (
            <p className="text-[12px] text-text-faint ml-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {c.description}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ChecklistAddModal({
  projects,
  onClose,
  onAdd,
}: {
  projects: Project[]
  onClose: () => void
  onAdd: (input: {
    label: string
    type: ChecklistType
    link?: string
    projectRef?: string
    date?: string
    description?: string
  }) => void
}) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<ChecklistType>('generique')
  const [link, setLink] = useState('')
  const [projectRef, setProjectRef] = useState('')
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')

  function submit() {
    if (!label.trim()) return
    onAdd({ label: label.trim(), type, link, projectRef, date, description })
  }

  return (
    <Modal open onClose={onClose} title="Nouvel élément" width={440}>
      <FieldLabel>Libellé</FieldLabel>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full" autoFocus />
      <FieldLabel>Type</FieldLabel>
      <Select value={type} onChange={(e) => setType(e.target.value as ChecklistType)} className="w-full">
        {Object.entries(CHK_TYPE_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
      {type === 'materiel' && (
        <>
          <FieldLabel>Lien (optionnel)</FieldLabel>
          <Input value={link} onChange={(e) => setLink(e.target.value)} className="w-full" />
        </>
      )}
      {type === 'projet' && (
        <>
          <FieldLabel>Projet</FieldLabel>
          <Select value={projectRef} onChange={(e) => setProjectRef(e.target.value)} className="w-full">
            <option value="">Choisir un projet…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </>
      )}
      {type === 'evenement' && (
        <>
          <FieldLabel>Date</FieldLabel>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
        </>
      )}
      <FieldLabel>Description (optionnel)</FieldLabel>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Infos supplémentaires à ne pas oublier…"
        className="w-full"
        style={{ minHeight: 70 }}
      />
      <div className="flex justify-end mt-4">
        <PrimaryButton onClick={submit} disabled={!label.trim()}>
          Ajouter
        </PrimaryButton>
      </div>
    </Modal>
  )
}

function ChecklistItemModal({
  item,
  projects,
  onClose,
  onUpdate,
  onSetStatus,
  onRemove,
}: {
  item: ChecklistItem
  projects: Project[]
  onClose: () => void
  onUpdate: (patch: Partial<ChecklistItem>) => void
  onSetStatus: (status: ChecklistStatus) => void
  onRemove: () => void
}) {
  const statusOptions = CHK_STATUS_BY_TYPE[item.type]
  return (
    <Modal open onClose={onClose} title={CHK_TYPE_LABEL[item.type]} width={440}>
      <input
        defaultValue={item.label}
        onBlur={(e) => onUpdate({ label: e.target.value })}
        className="text-[15px] font-bold bg-transparent border-none outline-none w-full mb-2 py-1"
      />
      <div className="flex gap-2 flex-wrap mb-3">
        {statusOptions.map((st) => (
          <StatusPill
            key={st}
            label={CHK_STATUS_LABEL[st]}
            tone={statusTone(st)}
            onClick={() => onSetStatus(st)}
            className={item.status === st ? 'ring-2 ring-accent' : ''}
          />
        ))}
      </div>

      {item.type === 'materiel' && (
        <Input
          defaultValue={item.link || ''}
          onBlur={(e) => onUpdate({ link: e.target.value })}
          placeholder="Lien (optionnel)"
          className="w-full"
        />
      )}
      {item.type === 'evenement' && (
        <Input
          type="date"
          defaultValue={item.date || ''}
          onChange={(e) => onUpdate({ date: e.target.value })}
          className="w-full"
        />
      )}
      {item.type === 'projet' && (
        <Select
          value={item.projectRef || ''}
          onChange={(e) => onUpdate({ projectRef: e.target.value })}
          className="w-full"
        >
          <option value="">Choisir un projet…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
      <FieldLabel>Description</FieldLabel>
      <Textarea
        defaultValue={item.description || ''}
        onBlur={(e) => onUpdate({ description: e.target.value })}
        placeholder="Infos supplémentaires à ne pas oublier…"
        className="w-full"
        style={{ minHeight: 70 }}
      />

      <button
        type="button"
        onClick={onRemove}
        className="flex items-center gap-1.5 border-none bg-transparent text-danger text-xs font-semibold cursor-pointer mt-4" title="Supprimer cet élément" aria-label="Supprimer cet élément"
      >
        <TrashIcon size={13} /> Supprimer cet élément
      </button>
    </Modal>
  )
}
