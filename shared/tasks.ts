import type { TaskNode, TaskStatus } from './domain'

// Pure task-tree operations shared by the renderer and the main-process
// commands. Identifiers are only unique within one project.

export const TASK_STATUS_ORDER: TaskStatus[] = ['a_faire', 'en_cours', 'fait']

export function flattenTasks(
  list: TaskNode[] | undefined,
  depth = 0,
  out: { node: TaskNode; depth: number }[] = []
): { node: TaskNode; depth: number }[] {
  ;(list || []).forEach((t) => {
    out.push({ node: t, depth })
    if (t.children && t.children.length) flattenTasks(t.children, depth + 1, out)
  })
  return out
}

export function addTaskNode(
  list: TaskNode[] | undefined,
  parentId: string | null,
  node: TaskNode
): TaskNode[] {
  if (!parentId) return (list || []).concat([node])
  return (list || []).map((t) => {
    if (t.id === parentId) return { ...t, children: (t.children || []).concat([node]) }
    if (t.children) return { ...t, children: addTaskNode(t.children, parentId, node) }
    return t
  })
}

export function updateTaskNode(
  list: TaskNode[] | undefined,
  id: string,
  fn: (t: TaskNode) => TaskNode
): TaskNode[] {
  return (list || []).map((t) => {
    if (t.id === id) return fn(t)
    if (t.children) return { ...t, children: updateTaskNode(t.children, id, fn) }
    return t
  })
}

export function findTaskNode(list: TaskNode[] | undefined, id: string): TaskNode | null {
  for (const t of list || []) {
    if (t.id === id) return t
    if (t.children) {
      const f = findTaskNode(t.children, id)
      if (f) return f
    }
  }
  return null
}

export function removeTaskNode(list: TaskNode[] | undefined, id: string): TaskNode[] {
  return (list || [])
    .filter((t) => t.id !== id)
    .map((t) => (t.children ? { ...t, children: removeTaskNode(t.children, id) } : t))
}

export type TaskDropPosition = 'before' | 'after' | 'inside'

export function extractTaskNode(
  list: TaskNode[] | undefined,
  id: string
): { node: TaskNode | null; rest: TaskNode[] } {
  const rest: TaskNode[] = []
  let found: TaskNode | null = null
  for (const t of list || []) {
    if (!found && t.id === id) {
      found = t
      continue
    }
    if (!found && t.children && t.children.length) {
      const res = extractTaskNode(t.children, id)
      if (res.node) {
        found = res.node
        rest.push({ ...t, children: res.rest })
        continue
      }
    }
    rest.push(t)
  }
  return { node: found, rest }
}

export function insertTaskNode(
  list: TaskNode[],
  targetId: string,
  node: TaskNode,
  position: TaskDropPosition
): TaskNode[] {
  const result: TaskNode[] = []
  for (const t of list) {
    if (t.id === targetId) {
      if (position === 'before') result.push(node, t)
      else if (position === 'after') result.push(t, node)
      else result.push({ ...t, children: (t.children || []).concat([node]) })
      continue
    }
    result.push(t.children && t.children.length ? { ...t, children: insertTaskNode(t.children, targetId, node, position) } : t)
  }
  return result
}

export function isTaskDescendant(node: TaskNode, id: string): boolean {
  return (node.children || []).some((c) => c.id === id || isTaskDescendant(c, id))
}

/** Derive parents bottom-up; leaf tasks keep their manually chosen status. */
export function syncTaskStatuses(tasks: TaskNode[] = []): TaskNode[] {
  let changed = false
  const result = tasks.map((task) => {
    const children = syncTaskStatuses(task.children || [])
    let status: TaskStatus = task.status
    if (children.length) {
      status = children.every((child) => child.status === 'fait')
        ? 'fait'
        : children.every((child) => child.status === 'a_faire')
          ? 'a_faire'
          : 'en_cours'
    }
    if (status === task.status && children === task.children) return task
    changed = true
    return { ...task, status, children }
  })
  return changed ? result : tasks
}
