import { useState } from 'react'
import { CollapsedTaskStack } from './CollapsedTaskStack'
import type { TaskNode, TaskStatus } from '../lib/types'
import { TASK_STATUS_LABEL } from '../lib/constants'
import { flattenTasks } from '../lib/helpers'
import { useTaskCollapse } from '../lib/useTaskCollapse'

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
  const [collapsed, setCollapsed] = useTaskCollapse(tasks)
  const flat = flattenTasks(tasks)
  const ancestors = new Map<string, TaskNode[]>()
  const parents = new Map<string, string>()
  function visit(nodes: TaskNode[], path: TaskNode[]) {
    for (const node of nodes) {
      ancestors.set(node.id, path)
      if (path.length) parents.set(node.id, path.map((parent) => parent.name).join(' / '))
      visit(node.children, [...path, node])
    }
  }
  visit(tasks, [])

  if (visibleStatuses.length === 0) {
    return <p className="text-[13px] text-text-faint">Aucun statut sélectionné.</p>
  }

  return (
    <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(220px,1fr))` }}>
      {visibleStatuses.map((status) => {
        const items = flat.filter(({ node }) => node.status === status && !(ancestors.get(node.id) || []).some((parent) => collapsed.has(parent.id) && visibleStatuses.includes(parent.status)))
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
            className={`isolate flex flex-col gap-2 rounded-xl p-2.5 min-h-24 border transition-colors ${
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
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenDetail?.(node.id) } }}
                style={depth > 0 ? { marginLeft: Math.min(depth, 3) * 12 } : undefined}
                className={`relative bg-surface ${collapsed.has(node.id) && node.children.length ? 'mb-3' : ''} border rounded-lg px-3 cursor-pointer hover:border-accent transition-colors ${
                  depth > 0 ? 'border-border border-l-2 border-l-accent/50 py-2.5' : 'border-border py-3'
                } ${
                  dragId === node.id ? 'opacity-40' : ''
                }`}
              >
                {collapsed.has(node.id) && node.children.length > 0 && <CollapsedTaskStack count={node.children.length} />}
                {depth > 0 && (
                  <>
                    <span aria-hidden="true" className="absolute -left-3 top-4 h-3 w-2 border-b border-l border-accent/40 rounded-bl-sm" />
                    <div className="mb-2 flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-soft-text">Sous-tâche</span>
                      <span className="min-w-0 truncate text-[11px] text-text-muted" title={parents.get(node.id)}>
                        {parents.get(node.id)}
                      </span>
                    </div>
                  </>
                )}
                <div className="text-[13px] font-medium text-text leading-snug">
                  {node.name}
                </div>
                {node.content && <p className="text-xs text-text-faint mt-2 line-clamp-2 break-words">{node.content.replace(/[#*`]/g, '')}</p>}
                {node.children.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-text-faint">{flattenTasks(node.children).filter(({ node }) => node.status === 'fait').length}/{flattenTasks(node.children).length} sous-tâches terminées</p>
                    <button type="button" aria-expanded={!collapsed.has(node.id)} aria-label={`${collapsed.has(node.id) ? 'Déplier' : 'Replier'} ${node.name}`}
                      onClick={(e) => { e.stopPropagation(); setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next }) }}
                      className="rounded px-2 py-1 text-[11px] font-semibold text-text-muted hover:bg-accent-soft hover:text-accent-soft-text cursor-pointer">
                      {collapsed.has(node.id) ? '▸ Déplier' : '▾ Replier'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {items.length === 0 && <p className="text-[11.5px] text-text-faint px-1">Aucune tâche.</p>}
          </div>
        )
      })}
    </div>
  )
}
