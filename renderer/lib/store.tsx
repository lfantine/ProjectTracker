import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  AppData,
  ChecklistItem,
  ChecklistStatus,
  ChecklistType,
  Deadline,
  ErrorEntry,
  FolderDisplayMode,
  FolderKind,
  Note,
  Project,
  ProjectFolder,
  ProjectModule,
  ProjectStatus,
  ProjectType,
  TaskNode,
} from './types'
import { defaultProjectLayout, emptyAppData, normalizeAppData } from './types'
import {
  addTaskNode,
  extractTaskNode,
  insertTaskNode,
  isTaskDescendant,
  removeTaskNode,
  todayISO,
  uid,
  updateTaskNode,
  type TaskDropPosition,
} from './helpers'
import type { WeekSlot } from './weekSchedule'
import { removeNoteFromData, restoreNoteFromData } from './noteOperations'
import { syncTaskStatuses } from './taskStatus'
import { TASK_STATUS_ORDER, defaultChecklistStatus, nextChecklistStatus } from './constants'

interface DataContextValue {
  data: AppData
  setWeekSlots: (slots: WeekSlot[]) => void
  setWakeTimes: (times: string[]) => void
  loading: boolean
  findProject: (id: string | null | undefined) => Project | undefined
  findNote: (id: string | null | undefined) => Note | undefined
  findError: (id: string | null | undefined) => ErrorEntry | undefined

  addProject: (input: {
    name: string
    type: ProjectType
    category: string
    platforms: string[]
    tags?: string[]
    noteIds?: string[]
    errorIds?: string[]
    checklist?: ChecklistItem[]
    tasks?: TaskNode[]
    deadlines?: Deadline[]
  }) => Project
  updateProject: (id: string, patch: Partial<Project>) => void
  removeProject: (id: string) => void
  touchProjectOpened: (id: string) => void

  addFolder: (input: {
    name: string
    kind: FolderKind
    displayMode: FolderDisplayMode
    description?: string
    tagFilter?: string[]
  }) => ProjectFolder
  updateFolder: (
    id: string,
    patch: Partial<Pick<ProjectFolder, 'name' | 'description' | 'displayMode' | 'tagFilter'>>
  ) => void
  removeFolder: (id: string) => void

  addNote: (input: { title: string; content: string; tags: string[] }) => Note
  updateNote: (
    id: string,
    patch: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'raw'>>
  ) => void
  removeNote: (id: string) => void
  restoreNote: (id: string) => void

  addError: (input: {
    title: string
    content: string
    causes: string
    solution: string
    projectIds: string[]
  }) => ErrorEntry
  updateError: (
    id: string,
    patch: Partial<Pick<ErrorEntry, 'title' | 'content' | 'causes' | 'solution'>>
  ) => void
  removeError: (id: string) => void

  linkNote: (projectId: string, noteId: string) => void
  unlinkNote: (projectId: string, noteId: string) => void
  linkError: (projectId: string, errorId: string) => void
  unlinkError: (projectId: string, errorId: string) => void

  addChecklistItem: (
    projectId: string,
    item: {
      label: string
      type: ChecklistType
      link?: string
      projectRef?: string
      date?: string
      description?: string
    }
  ) => void
  updateChecklistItem: (
    projectId: string,
    itemId: string,
    patch: Partial<ChecklistItem>
  ) => void
  cycleChecklistStatus: (projectId: string, itemId: string) => void
  setChecklistStatus: (
    projectId: string,
    itemId: string,
    status: ChecklistStatus
  ) => void
  removeChecklistItem: (projectId: string, itemId: string) => void

  addTask: (projectId: string, name: string) => void
  addSubtask: (projectId: string, parentId: string, name: string) => void
  updateTask: (
    projectId: string,
    taskId: string,
    patch: Partial<TaskNode>
  ) => void
  cycleTaskStatus: (projectId: string, taskId: string) => void
  removeTask: (projectId: string, taskId: string) => void
  moveTask: (
    projectId: string,
    draggedId: string,
    targetId: string,
    position: TaskDropPosition
  ) => void

  addDeadline: (projectId: string, label: string, date: string) => void
  toggleDeadlineDone: (projectId: string, deadlineId: string) => void

  addLink: (projectId: string, input: { title: string; url: string }) => void
  updateLink: (projectId: string, linkId: string, patch: { title?: string; url?: string }) => void
  removeLink: (projectId: string, linkId: string) => void

  setLayout: (projectId: string, layout: ProjectModule[]) => void
  addModule: (projectId: string, module: ProjectModule) => void
  removeModule: (projectId: string, moduleId: string) => void
  updateModule: (projectId: string, moduleId: string, patch: Partial<ProjectModule>) => void
  toggleNoteModule: (projectId: string, noteId: string) => void

  addCategory: (name: string) => void
  addPlatform: (type: ProjectType, name: string) => void
}

const DataContext = createContext<DataContextValue | null>(null)

function newProjectShell(input: {
  name: string
  type: ProjectType
  category: string
  platforms: string[]
  tags?: string[]
  noteIds?: string[]
  errorIds?: string[]
  checklist?: ChecklistItem[]
  tasks?: TaskNode[]
  deadlines?: Deadline[]
}): Project {
  const now = new Date().toISOString()
  return {
    id: uid('p'),
    name: input.name,
    type: input.type,
    category: input.category,
    platforms: input.platforms,
    tags: input.tags || [],
    status: 'actif' as ProjectStatus,
    createdAt: now,
    updatedAt: now,
    description: '',
    stack: [],
    path: '',
    noteIds: input.noteIds || [],
    errorIds: input.errorIds || [],
    checklist: input.checklist || [],
    tasks: syncTaskStatuses(input.tasks),
    deadlines: input.deadlines || [],
    links: [],
    layout: defaultProjectLayout(),
  }
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(emptyAppData())
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoaded = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.api.loadData().then((loaded) => {
      if (cancelled) return
      setData(normalizeAppData(loaded))
      setLoading(false)
      hasLoaded.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasLoaded.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.api.saveData(data)
    }, 350)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [data])

  const mutateProject = useCallback(
    (id: string, fn: (p: Project) => Project) => {
      setData((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id ? (() => {
            const updated = fn(p)
            return { ...updated, tasks: syncTaskStatuses(updated.tasks), updatedAt: new Date().toISOString() }
          })() : p
        ),
      }))
    },
    []
  )

  const findProject = useCallback(
    (id: string | null | undefined) => data.projects.find((p) => p.id === id),
    [data.projects]
  )
  const findNote = useCallback(
    (id: string | null | undefined) => data.notes.find((n) => n.id === id),
    [data.notes]
  )
  const findError = useCallback(
    (id: string | null | undefined) => data.errors.find((e) => e.id === id),
    [data.errors]
  )

  const addProject: DataContextValue['addProject'] = useCallback((input) => {
    const project = newProjectShell(input)
    setData((s) => ({ ...s, projects: s.projects.concat([project]) }))
    return project
  }, [])

  const updateProject = useCallback(
    (id: string, patch: Partial<Project>) => mutateProject(id, (p) => ({ ...p, ...patch })),
    [mutateProject]
  )

  const removeProject = useCallback((id: string) => {
    setData((s) => ({ ...s, projects: s.projects.filter((p) => p.id !== id) }))
  }, [])

  const touchProjectOpened = useCallback(
    (id: string) =>
      setData((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id ? { ...p, lastOpenedAt: new Date().toISOString() } : p
        ),
      })),
    []
  )

  const addNote: DataContextValue['addNote'] = useCallback((input) => {
    const now = new Date().toISOString()
    const note: Note = { id: uid('n'), ...input, createdAt: now, updatedAt: now }
    setData((s) => ({ ...s, notes: s.notes.concat([note]) }))
    return note
  }, [])

  const updateNote = useCallback((id: string, patch: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'raw'>>) => {
    setData((s) => ({
      ...s,
      notes: s.notes.map((n) =>
        n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n
      ),
    }))
  }, [])

  const removeNote = useCallback((id: string) => {
    setData((s) => removeNoteFromData(s, id))
  }, [])

  const restoreNote = useCallback((id: string) => {
    setData((s) => restoreNoteFromData(s, id))
  }, [])

  const addError: DataContextValue['addError'] = useCallback((input) => {
    const err: ErrorEntry = {
      id: uid('e'),
      title: input.title,
      content: input.content,
      causes: input.causes,
      solution: input.solution,
      createdAt: new Date().toISOString(),
      projectIds: input.projectIds,
    }
    setData((s) => ({
      ...s,
      errors: s.errors.concat([err]),
      projects: s.projects.map((p) =>
        input.projectIds.includes(p.id)
          ? { ...p, errorIds: (p.errorIds || []).concat([err.id]) }
          : p
      ),
    }))
    return err
  }, [])

  const updateError = useCallback(
    (id: string, patch: Partial<Pick<ErrorEntry, 'title' | 'content' | 'causes' | 'solution'>>) => {
      setData((s) => ({ ...s, errors: s.errors.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
    },
    []
  )

  const removeError = useCallback((id: string) => {
    setData((s) => ({
      ...s,
      errors: s.errors.filter((e) => e.id !== id),
      projects: s.projects.map((p) => ({
        ...p,
        errorIds: (p.errorIds || []).filter((x) => x !== id),
      })),
    }))
  }, [])

  const linkNote = useCallback(
    (projectId: string, noteId: string) =>
      mutateProject(projectId, (p) =>
        (p.noteIds || []).includes(noteId)
          ? p
          : { ...p, noteIds: (p.noteIds || []).concat([noteId]) }
      ),
    [mutateProject]
  )
  const unlinkNote = useCallback(
    (projectId: string, noteId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        noteIds: (p.noteIds || []).filter((x) => x !== noteId),
      })),
    [mutateProject]
  )
  const linkError = useCallback(
    (projectId: string, errorId: string) => {
      mutateProject(projectId, (p) =>
        (p.errorIds || []).includes(errorId)
          ? p
          : { ...p, errorIds: (p.errorIds || []).concat([errorId]) }
      )
      setData((s) => ({
        ...s,
        errors: s.errors.map((e) =>
          e.id === errorId && !e.projectIds.includes(projectId)
            ? { ...e, projectIds: e.projectIds.concat([projectId]) }
            : e
        ),
      }))
    },
    [mutateProject]
  )
  const unlinkError = useCallback(
    (projectId: string, errorId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        errorIds: (p.errorIds || []).filter((x) => x !== errorId),
      })),
    [mutateProject]
  )

  const addChecklistItem: DataContextValue['addChecklistItem'] = useCallback(
    (projectId, item) => {
      const entry: ChecklistItem = {
        id: uid('c'),
        label: item.label,
        type: item.type,
        status: defaultChecklistStatus(item.type),
        link: item.link,
        projectRef: item.projectRef,
        date: item.date,
        description: item.description,
      }
      mutateProject(projectId, (p) => ({
        ...p,
        checklist: (p.checklist || []).concat([entry]),
      }))
    },
    [mutateProject]
  )

  const updateChecklistItem = useCallback(
    (projectId: string, itemId: string, patch: Partial<ChecklistItem>) =>
      mutateProject(projectId, (p) => ({
        ...p,
        checklist: (p.checklist || []).map((c) => (c.id === itemId ? { ...c, ...patch } : c)),
      })),
    [mutateProject]
  )

  const cycleChecklistStatus = useCallback(
    (projectId: string, itemId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        checklist: (p.checklist || []).map((c) =>
          c.id === itemId ? { ...c, status: nextChecklistStatus(c) } : c
        ),
      })),
    [mutateProject]
  )

  const setChecklistStatus = useCallback(
    (projectId: string, itemId: string, status: ChecklistStatus) =>
      mutateProject(projectId, (p) => ({
        ...p,
        checklist: (p.checklist || []).map((c) => (c.id === itemId ? { ...c, status } : c)),
      })),
    [mutateProject]
  )

  const removeChecklistItem = useCallback(
    (projectId: string, itemId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        checklist: (p.checklist || []).filter((c) => c.id !== itemId),
      })),
    [mutateProject]
  )

  const addTask = useCallback(
    (projectId: string, name: string) => {
      const task: TaskNode = { id: uid('t'), name, content: '', status: 'a_faire', children: [] }
      mutateProject(projectId, (p) => ({ ...p, tasks: (p.tasks || []).concat([task]) }))
    },
    [mutateProject]
  )

  const addSubtask = useCallback(
    (projectId: string, parentId: string, name: string) => {
      const task: TaskNode = { id: uid('t'), name, content: '', status: 'a_faire', children: [] }
      mutateProject(projectId, (p) => ({ ...p, tasks: addTaskNode(p.tasks, parentId, task) }))
    },
    [mutateProject]
  )

  const updateTask = useCallback(
    (projectId: string, taskId: string, patch: Partial<TaskNode>) =>
      mutateProject(projectId, (p) => ({
        ...p,
        tasks: updateTaskNode(p.tasks, taskId, (t) => ({ ...t, ...patch })),
      })),
    [mutateProject]
  )

  const cycleTaskStatus = useCallback(
    (projectId: string, taskId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        tasks: updateTaskNode(p.tasks, taskId, (t) => ({
          ...t,
          status:
            TASK_STATUS_ORDER[
              (TASK_STATUS_ORDER.indexOf(t.status) + 1) % TASK_STATUS_ORDER.length
            ],
        })),
      })),
    [mutateProject]
  )

  const removeTask = useCallback(
    (projectId: string, taskId: string) =>
      mutateProject(projectId, (p) => ({ ...p, tasks: removeTaskNode(p.tasks, taskId) })),
    [mutateProject]
  )

  const moveTask = useCallback(
    (projectId: string, draggedId: string, targetId: string, position: TaskDropPosition) => {
      if (draggedId === targetId) return
      mutateProject(projectId, (p) => {
        const { node, rest } = extractTaskNode(p.tasks, draggedId)
        if (!node) return p
        if (node.id === targetId || isTaskDescendant(node, targetId)) return p
        return { ...p, tasks: insertTaskNode(rest, targetId, node, position) }
      })
    },
    [mutateProject]
  )

  const addLink = useCallback(
    (projectId: string, input: { title: string; url: string }) => {
      const link = { id: uid('l'), title: input.title, url: input.url }
      mutateProject(projectId, (p) => ({ ...p, links: (p.links || []).concat([link]) }))
    },
    [mutateProject]
  )

  const removeLink = useCallback(
    (projectId: string, linkId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        links: (p.links || []).filter((l) => l.id !== linkId),
      })),
    [mutateProject]
  )

  const updateLink = useCallback(
    (projectId: string, linkId: string, patch: { title?: string; url?: string }) =>
      mutateProject(projectId, (p) => ({
        ...p,
        links: (p.links || []).map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
      })),
    [mutateProject]
  )

  const setLayout = useCallback(
    (projectId: string, layout: ProjectModule[]) => mutateProject(projectId, (p) => ({ ...p, layout })),
    [mutateProject]
  )

  const addModule = useCallback(
    (projectId: string, module: ProjectModule) =>
      mutateProject(projectId, (p) => ({
        ...p,
        layout: (p.layout && p.layout.length ? p.layout : defaultProjectLayout()).concat([module]),
      })),
    [mutateProject]
  )

  const removeModule = useCallback(
    (projectId: string, moduleId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        layout: (p.layout && p.layout.length ? p.layout : defaultProjectLayout()).filter(
          (m) => m.id !== moduleId
        ),
      })),
    [mutateProject]
  )

  const updateModule = useCallback(
    (projectId: string, moduleId: string, patch: Partial<ProjectModule>) =>
      mutateProject(projectId, (p) => ({
        ...p,
        layout: (p.layout && p.layout.length ? p.layout : defaultProjectLayout()).map((m) =>
          m.id === moduleId ? { ...m, ...patch } : m
        ),
      })),
    [mutateProject]
  )

  const toggleNoteModule = useCallback(
    (projectId: string, noteId: string) =>
      mutateProject(projectId, (p) => {
        const layout = p.layout && p.layout.length ? p.layout : defaultProjectLayout()
        const existing = layout.find((m) => m.type === 'note' && m.refId === noteId)
        if (existing) return { ...p, layout: layout.filter((m) => m.id !== existing.id) }
        return { ...p, layout: layout.concat([{ id: uid('mod'), type: 'note', refId: noteId }]) }
      }),
    [mutateProject]
  )

  const addDeadline = useCallback(
    (projectId: string, label: string, date: string) => {
      const deadline: Deadline = {
        id: uid('d'),
        label,
        date,
        status: date < todayISO() ? 'depasse' : 'a_venir',
      }
      mutateProject(projectId, (p) => ({ ...p, deadlines: (p.deadlines || []).concat([deadline]) }))
    },
    [mutateProject]
  )

  const toggleDeadlineDone = useCallback(
    (projectId: string, deadlineId: string) =>
      mutateProject(projectId, (p) => ({
        ...p,
        deadlines: (p.deadlines || []).map((d) =>
          d.id === deadlineId
            ? {
                ...d,
                status:
                  d.status === 'fait' ? (d.date < todayISO() ? 'depasse' : 'a_venir') : 'fait',
              }
            : d
        ),
      })),
    [mutateProject]
  )

  const addCategory = useCallback((name: string) => {
    setData((s) => (s.categories.includes(name) ? s : { ...s, categories: s.categories.concat([name]) }))
  }, [])

  const addPlatform = useCallback((type: ProjectType, name: string) => {
    setData((s) =>
      s.platforms[type].includes(name)
        ? s
        : { ...s, platforms: { ...s.platforms, [type]: s.platforms[type].concat([name]) } }
    )
  }, [])

  const addFolder: DataContextValue['addFolder'] = useCallback((input) => {
    const folder: ProjectFolder = {
      id: uid('f'),
      name: input.name,
      kind: input.kind,
      displayMode: input.displayMode,
      description: input.description,
      tagFilter: input.kind === 'smart' ? input.tagFilter || [] : undefined,
    }
    setData((s) => ({ ...s, folders: s.folders.concat([folder]) }))
    return folder
  }, [])

  const updateFolder = useCallback((
    id: string,
    patch: Partial<Pick<ProjectFolder, 'name' | 'description' | 'displayMode' | 'tagFilter'>>
  ) => {
    setData((s) => ({
      ...s,
      folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
  }, [])

  const removeFolder = useCallback((id: string) => {
    setData((s) => ({
      ...s,
      folders: s.folders.filter((f) => f.id !== id),
      projects: s.projects.map((p) => (p.folderId === id ? { ...p, folderId: undefined } : p)),
    }))
  }, [])

  const setWakeTimes = useCallback((wakeTimes: string[]) => setData((s) => ({ ...s, wakeTimes })), [])
  const setWeekSlots = useCallback((weekSlots: WeekSlot[]) => setData((s) => ({ ...s, weekSlots })), [])

  const value = useMemo<DataContextValue>(
    () => ({
      data,
      setWeekSlots,
      setWakeTimes,
      loading,
      findProject,
      findNote,
      findError,
      addProject,
      updateProject,
      removeProject,
      touchProjectOpened,
      addFolder,
      updateFolder,
      removeFolder,
      addNote,
      updateNote,
      removeNote,
      restoreNote,
      addError,
      updateError,
      removeError,
      linkNote,
      unlinkNote,
      linkError,
      unlinkError,
      addChecklistItem,
      updateChecklistItem,
      cycleChecklistStatus,
      setChecklistStatus,
      removeChecklistItem,
      addTask,
      addSubtask,
      updateTask,
      cycleTaskStatus,
      removeTask,
      moveTask,
      addDeadline,
      toggleDeadlineDone,
      addLink,
      updateLink,
      removeLink,
      setLayout,
      addModule,
      removeModule,
      updateModule,
      toggleNoteModule,
      addCategory,
      addPlatform,
    }),
    [
      data,
      setWeekSlots,
      setWakeTimes,
      loading,
      findProject,
      findNote,
      findError,
      addProject,
      updateProject,
      removeProject,
      touchProjectOpened,
      addFolder,
      updateFolder,
      removeFolder,
      addNote,
      updateNote,
      removeNote,
      restoreNote,
      addError,
      updateError,
      removeError,
      linkNote,
      unlinkNote,
      linkError,
      unlinkError,
      addChecklistItem,
      updateChecklistItem,
      cycleChecklistStatus,
      setChecklistStatus,
      removeChecklistItem,
      addTask,
      addSubtask,
      updateTask,
      cycleTaskStatus,
      removeTask,
      moveTask,
      addDeadline,
      toggleDeadlineDone,
      addLink,
      updateLink,
      removeLink,
      setLayout,
      addModule,
      removeModule,
      updateModule,
      toggleNoteModule,
      addCategory,
      addPlatform,
    ]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
