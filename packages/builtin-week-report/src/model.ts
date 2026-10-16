export interface PlannedSlot { day: number; start: string; end: string; projectId?: string }
export function plannedMinutes(slots: PlannedSlot[], projects: { id: string; name: string }[]) {
  const days = Array(7).fill(0) as number[], byProject = new Map<string, { label: string; minutes: number }>()
  for (const slot of slots) {
    if (!Number.isInteger(slot.day) || slot.day < 0 || slot.day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start) || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(slot.end)) throw Error('Créneau invalide.')
    const minutes = (time: string) => Number(time.slice(0,2)) * 60 + Number(time.slice(3))
    const duration = minutes(slot.end) - minutes(slot.start)
    if (duration <= 0) throw Error('Durée invalide.')
    days[slot.day] += duration
    const project = projects.find(item => item.id === slot.projectId)
    const key = slot.projectId ? `project:${slot.projectId}` : 'none', label = !slot.projectId ? 'Sans projet' : project?.name ?? `Projet manquant (${slot.projectId})`
    const group = byProject.get(key) ?? { label, minutes: 0 }; group.minutes += duration; byProject.set(key, group)
  }
  return { days, projects: [...byProject.entries()].map(([id, value]) => ({ id, ...value })), total: days.reduce((a,b) => a+b, 0) }
}
