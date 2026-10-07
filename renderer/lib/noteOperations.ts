import type { AppData } from './types'

export function removeNoteFromData(data: AppData, id: string): AppData {
  const note = data.notes.find((note) => note.id === id)
  if (!note) return data
  const links = data.projects.flatMap((project) => {
    const modules = (project.layout || []).filter((module) => module.type === 'note' && module.refId === id)
    return (project.noteIds || []).includes(id) || modules.length
      ? [{ projectId: project.id, modules }]
      : []
  })
  return {
    ...data,
    trashedNotes: [...(data.trashedNotes || []).filter((entry) => entry.note.id !== id), { note, links, deletedAt: new Date().toISOString() }],
    notes: data.notes.filter((note) => note.id !== id),
    projects: data.projects.map((project) => ({
      ...project,
      noteIds: (project.noteIds || []).filter((noteId) => noteId !== id),
      layout: (project.layout || []).filter((module) => module.type !== 'note' || module.refId !== id),
    })),
  }
}

export function restoreNoteFromData(data: AppData, id: string): AppData {
  const entry = data.trashedNotes?.find((entry) => entry.note.id === id)
  if (!entry || data.notes.some((note) => note.id === id)) return data
  return {
    ...data,
    notes: [...data.notes, entry.note],
    trashedNotes: (data.trashedNotes || []).filter((item) => item.note.id !== id),
    projects: data.projects.map((project) => {
      const link = entry.links.find((link) => link.projectId === project.id)
      if (!link) return project
      const layout = project.layout || []
      return {
        ...project,
        noteIds: [...new Set([...(project.noteIds || []), id])],
        layout: [...layout, ...link.modules.filter((module) => !layout.some((existing) => existing.id === module.id || existing.type === 'note' && existing.refId === id))],
      }
    }),
  }
}
