import type { TaskNode, TaskStatus } from './types'

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
