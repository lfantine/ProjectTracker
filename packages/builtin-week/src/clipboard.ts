import { minutes, slotError, type WeekSlot } from '../../../shared/week'

function time(value: number): string { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` }
/** Same quarter-hour search as the native planner. The returned detached draft
 * is not saved, and its old id is replaced by the creation editor. */
export function pasteDraft(source: WeekSlot, slots: WeekSlot[], destination?: { day: number; minute: number }): WeekSlot | null {
  if (slotError(source, [])) return null
  const duration = minutes(source.end) - minutes(source.start)
  if (destination) {
    if (!Number.isInteger(destination.minute) || destination.minute < 0 || destination.minute + duration > 1439) return null
    const candidate = { ...structuredClone(source), day: destination.day, start: time(destination.minute), end: time(destination.minute + duration) }
    return slotError(candidate, slots) ? null : candidate
  }
  const first = Math.ceil((source.day * 1440 + minutes(source.end)) / 15) * 15
  for (let offset = 0; offset < 7 * 1440; offset += 15) {
    const absolute = (first + offset) % (7 * 1440)
    const day = Math.floor(absolute / 1440), start = absolute % 1440
    if (start + duration > 1439) continue
    const candidate = { ...structuredClone(source), day, start: time(start), end: time(start + duration) }
    if (!slotError(candidate, slots)) return candidate
  }
  return null
}
