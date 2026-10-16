import type { ModuleType, Project, ProjectFolder, ProjectModule } from './types'
import { MODULE_MAX_INSTANCES } from './constants'

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseD(s: string): Date {
  return new Date(`${s}T00:00:00`)
}

export function fmtDate(s: string): string {
  try {
    return parseD(s).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return s
  }
}

export function fmtShort(s: string): string {
  try {
    return parseD(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  } catch {
    return s
  }
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  const h = Math.floor(min / 60)
  const d = Math.floor(h / 24)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  if (h < 24) return `il y a ${h}h`
  if (d === 1) return 'hier'
  if (d < 30) return `il y a ${d}j`
  const m = Math.floor(d / 30)
  return `il y a ${m} mois`
}

export function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export function daysUntil(dateStr: string): number {
  return Math.round((parseD(dateStr).getTime() - parseD(todayISO()).getTime()) / 86400000)
}

export {
  flattenTasks,
  addTaskNode,
  updateTaskNode,
  findTaskNode,
  removeTaskNode,
  extractTaskNode,
  insertTaskNode,
  isTaskDescendant,
  type TaskDropPosition,
} from '../../shared/tasks'

export function reorderById<T extends { id: string }>(
  list: T[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after'
): T[] {
  if (draggedId === targetId) return list
  const dragged = list.find((x) => x.id === draggedId)
  if (!dragged) return list
  const rest = list.filter((x) => x.id !== draggedId)
  const idx = rest.findIndex((x) => x.id === targetId)
  if (idx === -1) return list
  const insertAt = position === 'before' ? idx : idx + 1
  return [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)]
}

// null = unlimited, otherwise how many more of this module type can still be added.
export function remainingInstances(layout: ProjectModule[], type: ModuleType): number | null {
  const max = MODULE_MAX_INSTANCES[type]
  if (max === undefined) return null
  return Math.max(0, max - layout.filter((m) => m.type === type).length)
}

export function canAddModule(layout: ProjectModule[], type: ModuleType): boolean {
  const remaining = remainingInstances(layout, type)
  return remaining === null || remaining > 0
}

export function projectsInFolder(folder: ProjectFolder, projects: Project[]): Project[] {
  if (folder.kind === 'smart') {
    const tags = folder.tagFilter || []
    return projects.filter((p) => (p.tags || []).some((t) => tags.includes(t)))
  }
  return projects.filter((p) => p.folderId === folder.id)
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
