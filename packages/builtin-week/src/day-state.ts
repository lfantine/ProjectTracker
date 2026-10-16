import { minutes, type WeekSlot } from '../../../shared/week'

// Local wall-clock time, like the planner's days (never UTC timestamps).
export function dayState(slot: WeekSlot, now: Date) {
  const current = now.getHours() * 60 + now.getMinutes()
  const start = minutes(slot.start), end = minutes(slot.end)
  return {
    label: current < start ? 'À venir' : current >= end ? 'Passé' : 'En cours',
    running: current >= start && current < end,
    progress: Math.max(0, Math.min(100, Math.round((current - start) / (end - start) * 100))),
    remaining: Math.max(0, end - current),
  }
}

export function daySlotStatus(slot: WeekSlot, now: Date): HTMLElement {
  const state = dayState(slot, now)
  const section = document.createElement('div'); section.className = 'day-event-status'
  const label = document.createElement('p'); label.textContent = state.label; section.append(label)
  if (state.running) {
    const progress = document.createElement('progress'); progress.max = 100; progress.value = state.progress
    progress.setAttribute('aria-label', `Avancement de ${slot.title}`)
    const remaining = document.createElement('p'); remaining.textContent = `${state.remaining} min restantes`
    section.append(progress, remaining)
  }
  return section
}
