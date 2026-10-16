import { useState } from 'react'
import type { TaskNode } from './types'
import { flattenTasks } from './helpers'

export function useTaskCollapse(tasks: TaskNode[]) {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())
  const collapsed = new Set<string>()
  function visit(nodes: TaskNode[]): boolean {
    let hasActiveTask = false
    for (const node of nodes) {
      const hasActiveChild = visit(node.children)
      if (node.children.length && (overrides.get(node.id) ?? !hasActiveChild)) collapsed.add(node.id)
      hasActiveTask ||= node.status === 'en_cours' || hasActiveChild
    }
    return hasActiveTask
  }
  visit(tasks)
  function setCollapsed(update: (previous: Set<string>) => Set<string>) {
    const next = update(collapsed)
    setOverrides((previous) => {
      const result = new Map(previous)
      for (const { node } of flattenTasks(tasks)) {
        if (next.has(node.id) !== collapsed.has(node.id)) result.set(node.id, next.has(node.id))
      }
      return result
    })
  }
  return [collapsed, setCollapsed] as const
}
