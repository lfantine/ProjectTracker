import { useState } from 'react'
import type { TaskNode, TaskStatus } from '../lib/types'
import { TASK_STATUS_LABEL } from '../lib/constants'
import { flattenTasks } from '../lib/helpers'

export function TaskKanban({
  tasks,
  visibleStatuses,
  onSetStatus,
  onOpenDetail,
}: {
  tasks: TaskNode[]
  visibleStatuses: TaskStatus[]
  onSetStatus: (id: string, status: TaskStatus) => void
  onOpenDetail?: (id: string) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null)
  const flat = flattenTasks(tasks)

  if (visibleStatuses.length === 0) {
    return <p className="text-[13px] text-text-faint">Aucun statut sélectionné.</p>
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(0,1fr))` }}>
      {visibleStatuses.map((status) => {
        const items = flat.filter((f) => f.node.status === status)
        const isOver = overStatus === status && dragId
        return (
          <div
            key={status}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              setOverStatus(status)
            }}
            onDragLeave={() => setOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId) onSetStatus(dragId, status)
              setDragId(null)
              setOverStatus(null)
            }}
            className={`flex flex-col gap-2 rounded-xl p-2.5 min-h-24 border transition-colors ${
              isOver ? 'border-accent bg-accent-soft!' : 'border-border bg-bg'
            }`}
          >
            <div className="flex items-center justify-between px-1 mb-0.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-text-faint">
                {TASK_STATUS_LABEL[status]}
              </span>
              <span className="text-[11px] text-text-faint font-semibold">{items.length}</span>
            </div>
            {items.map(({ node, depth }) => (
              <div
                key={node.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDragId(node.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverStatus(null)
                }}
                onClick={() => onOpenDetail?.(node.id)}
                className={`bg-surface border border-border rounded-lg px-2.5 py-2 cursor-pointer hover:border-accent transition-colors ${
                  dragId === node.id ? 'opacity-40' : ''
                }`}
              >
                <div className="text-[12.5px] font-medium text-text leading-snug">
                  {depth > 0 && <span className="text-text-faint">↳ </span>}
                  {node.name}
                </div>
              </div>
            ))}
            {items.length === 0 && <p className="text-[11.5px] text-text-faint px-1">Aucune tâche.</p>}
          </div>
        )
      })}
    </div>
  )
}
