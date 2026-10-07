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
  const parents = new Map<string, string>()
  function visit(nodes: TaskNode[], path: string[]) {
    for (const node of nodes) {
      if (path.length) parents.set(node.id, path.join(' / '))
      visit(node.children, [...path, node.name])
    }
  }
  visit(tasks, [])

  if (visibleStatuses.length === 0) {
    return <p className="text-[13px] text-text-faint">Aucun statut sélectionné.</p>
  }

  return (
    <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(220px,1fr))` }}>
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
                draggable={node.children.length === 0}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDragId(node.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverStatus(null)
                }}
                onClick={() => onOpenDetail?.(node.id)}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail?.(node.id) } }}
                className={`bg-surface border border-border rounded-lg px-3 py-3 cursor-pointer hover:border-accent transition-colors ${
                  dragId === node.id ? 'opacity-40' : ''
                }`}
              >
                {depth > 0 && <p className="text-[11px] text-text-faint mb-1 truncate" title={parents.get(node.id)}>{parents.get(node.id)}</p>}
                <div className="text-[13px] font-medium text-text leading-snug">
                  {node.name}
                </div>
                {node.content && <p className="text-xs text-text-faint mt-2 line-clamp-2 break-words">{node.content.replace(/[#*`]/g, '')}</p>}
                {node.children.length > 0 && <p className="text-[11px] text-text-faint mt-2">{flattenTasks(node.children).filter(({ node }) => node.status === 'fait').length}/{flattenTasks(node.children).length} sous-tâches terminées</p>}
              </div>
            ))}
            {items.length === 0 && <p className="text-[11.5px] text-text-faint px-1">Aucune tâche.</p>}
          </div>
        )
      })}
    </div>
  )
}
