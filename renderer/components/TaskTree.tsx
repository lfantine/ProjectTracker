import React, { useState } from 'react'
import { CollapsedTaskStack } from './CollapsedTaskStack'
import type { TaskNode, TaskStatus } from '../lib/types'
import { TASK_STATUS_LABEL, statusTone } from '../lib/constants'
import { flattenTasks } from '../lib/helpers'
import { useTaskCollapse } from '../lib/useTaskCollapse'
import type { TaskDropPosition } from '../lib/helpers'
import { Input, PrimaryButton, StatusPill } from './ui'
import { GripIcon, PlusIcon, TrashIcon } from './icons'

export function TaskTree({
  tasks,
  onAddTop,
  onAddSub,
  onCycleStatus,
  onRemove,
  onOpenDetail,
  onMove,
  visibleStatuses,
}: {
  tasks: TaskNode[]
  onAddTop: (name: string) => void
  onAddSub: (parentId: string, name: string) => void
  onCycleStatus: (id: string) => void
  onRemove: (id: string) => void
  onOpenDetail?: (id: string) => void
  onMove?: (draggedId: string, targetId: string, position: TaskDropPosition) => void
  visibleStatuses?: TaskStatus[]
}) {
  const [collapsed, setCollapsed] = useTaskCollapse(tasks)
  const [newName, setNewName] = useState('')
  const [addingTop, setAddingTop] = useState(false)
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [subName, setSubName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: TaskDropPosition } | null>(null)
  const allFlat = flattenTasks(tasks)
  const ancestors = new Map<string, TaskNode[]>()
  function visit(nodes: TaskNode[], path: TaskNode[]) {
    for (const node of nodes) {
      ancestors.set(node.id, path)
      visit(node.children, [...path, node])
    }
  }
  visit(tasks, [])
  const matching = visibleStatuses ? allFlat.filter((f) => visibleStatuses.includes(f.node.status)) : allFlat
  const flat = matching.filter(({ node }) => !(ancestors.get(node.id) || []).some((parent) => collapsed.has(parent.id) && (!visibleStatuses || visibleStatuses.includes(parent.status))))

  function resetDrag() {
    setDragId(null)
    setDropTarget(null)
  }

  return (
    <div className="flex flex-col gap-3">
      {flat.length === 0 && allFlat.length > 0 && (
        <p className="text-[13px] text-text-faint py-4 text-center">
          Aucune tâche ne correspond au filtre.
        </p>
      )}
      <div className="isolate flex flex-col">
        {flat.map(({ node, depth }) => {
          const isCard = depth === 0
          const isDragging = dragId === node.id
          const isDropTarget = dropTarget?.id === node.id
          const dropClasses = isDropTarget
            ? dropTarget!.position === 'before'
              ? 'border-t-2 border-t-accent'
              : dropTarget!.position === 'after'
                ? 'border-b-2 border-b-accent'
                : 'ring-2 ring-accent bg-accent-soft!'
            : ''
          return (
            <React.Fragment key={node.id}>
              <div
                onClick={() => onOpenDetail?.(node.id)}
                role={onOpenDetail ? 'button' : undefined}
                tabIndex={onOpenDetail ? 0 : undefined}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenDetail?.(node.id) } }}
                draggable={!!onMove}
                onDragStart={(e) => {
                  e.stopPropagation()
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', node.id)
                  setDragId(node.id)
                }}
                onDragOver={(e) => {
                  if (!onMove || !dragId || dragId === node.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const rect = e.currentTarget.getBoundingClientRect()
                  const fraction = (e.clientY - rect.top) / rect.height
                  const position: TaskDropPosition =
                    fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'inside'
                  setDropTarget((prev) =>
                    prev && prev.id === node.id && prev.position === position
                      ? prev
                      : { id: node.id, position }
                  )
                }}
                onDrop={(e) => {
                  if (!onMove || !dragId || dragId === node.id) return
                  e.preventDefault()
                  e.stopPropagation()
                  const position = dropTarget?.id === node.id ? dropTarget.position : 'after'
                  onMove(dragId, node.id, position)
                  resetDrag()
                }}
                onDragEnd={resetDrag}
                style={{ marginLeft: Math.min(depth, 6) * 18 }}
                className={`relative group flex items-center ${collapsed.has(node.id) && node.children.length ? 'mb-4! bg-surface border border-border rounded-xl' : ''}  gap-3 transition-all ${
                  isCard
                    ? 'px-4 py-3 mb-2 bg-surface rounded-xl border border-border hover:border-accent-soft hover:shadow-sm'
                    : 'px-3 py-2 mb-1 border-l-2 border-border rounded-r-lg hover:bg-surface-hover'
                } ${onOpenDetail ? 'cursor-pointer' : ''} ${isDragging ? 'opacity-40' : ''} ${dropClasses}`}
              >
                {collapsed.has(node.id) && node.children.length > 0 && <CollapsedTaskStack count={node.children.length} />}
                {node.children.length > 0 ? (
                  <button
                    type="button"
                    aria-label={`${collapsed.has(node.id) ? 'Déplier' : 'Replier'} ${node.name}`}
                    aria-expanded={!collapsed.has(node.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })
                    }}
                    className="text-[11px] font-semibold text-text-muted rounded px-1.5 py-1 flex-shrink-0 cursor-pointer hover:bg-accent-soft hover:text-accent-soft-text"
                  >
                    {collapsed.has(node.id) ? '▸ Déplier' : '▾ Replier'}
                  </button>
                ) : (
                  <span className="w-4 flex-shrink-0 text-text-faint" aria-hidden="true">{depth > 0 ? '↳' : '·'}</span>
                )}
                {onMove && (
                  <span
                    className="text-text-faint cursor-grab active:cursor-grabbing flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Glisser pour réorganiser"
                  >
                    <GripIcon size={13} />
                  </span>
                )}
                <span
                  className={`flex-1 min-w-0 ${isCard ? 'text-[14px] font-semibold' : 'text-[13px] font-medium'} ${
                    depth >= 2 ? 'text-text-muted' : 'text-text'
                  }`}
                >
                  {depth > 0 && visibleStatuses && (ancestors.get(node.id) || []).some((parent) => !visibleStatuses.includes(parent.status)) && (
                    <span className="block text-[10px] text-text-faint font-normal mb-1 uppercase tracking-wide">
                      {(ancestors.get(node.id) || []).map((parent) => parent.name).join(' / ')}
                    </span>
                  )}
                  <span className={`block break-words ${node.status === 'fait' ? 'line-through text-text-faint' : ''}`}>{node.name}</span>
                  {node.children.length > 0 && (
                    <span className="block text-[11px] text-text-faint font-normal mt-1">
                      {flattenTasks(node.children).filter(({ node }) => node.status === 'fait').length}/{flattenTasks(node.children).length} sous-tâches terminées
                    </span>
                  )}
                </span>
                <StatusPill
                    label={TASK_STATUS_LABEL[node.status]}
                    tone={statusTone(node.status)}
                    onClick={node.children.length ? undefined : (e) => {
                      e.stopPropagation()
                      onCycleStatus(node.id)
                    }}
                  />
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAddingSubFor(addingSubFor === node.id ? null : node.id)
                      setSubName('')
                    }}
                    className="p-1.5 border-none bg-transparent text-text-faint hover:text-accent cursor-pointer rounded-md transition-colors"
                    title="Ajouter une sous-tâche" aria-label="Ajouter une sous-tâche"
                  >
                    <PlusIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(node.id)
                    }}
                    aria-label={`Supprimer ${node.name}`}
                    className="p-1.5 border-none bg-transparent text-text-faint hover:text-danger cursor-pointer rounded-md transition-colors"
                    title="Supprimer"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
              {addingSubFor === node.id && (
                <div
                  style={{ marginLeft: (depth + 1) * 22 }}
                  className="flex gap-2 mb-3 mt-1"
                >
                  <Input
                    autoFocus
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    placeholder="Nom de la sous-tâche"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setAddingSubFor(null)
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && subName.trim()) {
                        onAddSub(node.id, subName.trim())
                        setAddingSubFor(null)
                      }
                    }}
                  />
                  <PrimaryButton
                    onClick={() => {
                      if (!subName.trim()) return
                      onAddSub(node.id, subName.trim())
                      setAddingSubFor(null)
                    }}
                  >
                    Ajouter
                  </PrimaryButton>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
      {addingTop ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-accent-soft bg-surface">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nom de la tâche — Entrée pour ajouter, Échap pour fermer"
            className="flex-1 bg-transparent border-none focus:ring-0 py-1.5"
            onBlur={() => {
              if (!newName.trim()) setAddingTop(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNewName('')
                setAddingTop(false)
              }
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && newName.trim()) {
                onAddTop(newName.trim())
                setNewName('')
              }
            }}
          />
          <PrimaryButton
            onClick={() => {
              if (!newName.trim()) return
              onAddTop(newName.trim())
              setNewName('')
            }}
          >
            Ajouter
          </PrimaryButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingTop(true)}
          className={`flex items-center justify-center gap-1.5 w-full rounded-xl border border-dashed border-border bg-transparent text-[13px] font-medium text-text-faint hover:text-accent hover:border-accent-soft cursor-pointer transition-colors ${
            allFlat.length === 0 ? 'py-5' : 'py-2'
          }`}
        >
          <PlusIcon size={14} /> {allFlat.length === 0 ? 'Créer la première tâche' : 'Ajouter une tâche'}
        </button>
      )}
    </div>
  )
}
