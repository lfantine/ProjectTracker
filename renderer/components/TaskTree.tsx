import React, { useState } from 'react'
import type { TaskNode, TaskStatus } from '../lib/types'
import { TASK_STATUS_LABEL, statusTone } from '../lib/constants'
import { flattenTasks } from '../lib/helpers'
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
  const [newName, setNewName] = useState('')
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [subName, setSubName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: TaskDropPosition } | null>(null)
  const allFlat = flattenTasks(tasks)
  const flat = visibleStatuses ? allFlat.filter((f) => visibleStatuses.includes(f.node.status)) : allFlat

  function resetDrag() {
    setDragId(null)
    setDropTarget(null)
  }

  return (
    <div>
      {flat.length === 0 && (
        <p className="text-[13px] text-text-faint mb-2">
          {allFlat.length === 0 ? 'Aucune tâche.' : 'Aucune tâche ne correspond au filtre.'}
        </p>
      )}
      <div className="flex flex-col">
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
                style={{ marginLeft: depth * 22 }}
                className={`flex items-center gap-2 transition-colors ${
                  isCard
                    ? 'px-3 py-2.5 mb-1.5 bg-surface2 rounded-lg border border-border'
                    : 'px-2 py-1.5'
                } ${onOpenDetail ? 'cursor-pointer' : ''} ${isDragging ? 'opacity-40' : ''} ${dropClasses}`}
              >
                {onMove && (
                  <span
                    className="text-text-faint cursor-grab active:cursor-grabbing flex-shrink-0"
                    title="Glisser pour réorganiser"
                  >
                    <GripIcon size={13} />
                  </span>
                )}
                <span
                  className={`flex-1 ${isCard ? 'text-[13.5px] font-bold' : 'text-[12.5px] font-medium'} ${
                    depth >= 2 ? 'text-text-muted' : 'text-text'
                  }`}
                >
                  {node.name}
                </span>
                <StatusPill
                  label={TASK_STATUS_LABEL[node.status]}
                  tone={statusTone(node.status)}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCycleStatus(node.id)
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddingSubFor(node.id)
                    setSubName('')
                  }}
                  className="border-none bg-transparent text-text-faint text-[11.5px] cursor-pointer font-sans"
                >
                  + sous-tâche
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(node.id)
                  }}
                  className="border-none bg-transparent text-text-faint cursor-pointer"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
              {addingSubFor === node.id && (
                <div
                  style={{ marginLeft: (depth + 1) * 22 }}
                  className="flex gap-2 mb-2"
                >
                  <Input
                    autoFocus
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    placeholder="Nom de la sous-tâche"
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && subName.trim()) {
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
      <div className="flex gap-2 mt-3">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nouvelle tâche…"
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
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
          <span className="flex items-center gap-1">
            <PlusIcon size={14} /> Ajouter
          </span>
        </PrimaryButton>
      </div>
    </div>
  )
}
