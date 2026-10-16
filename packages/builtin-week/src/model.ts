import { normalizeWakeTimes, slotError, type WeekSlot } from '../../../shared/week'

export interface WeekDocument { slots: WeekSlot[]; wakeTimes: string[] }
export class WeekDataError extends Error {
  constructor() { super('Les données de cette semaine sont invalides. Elles ne seront pas remplacées.'); this.name = 'WeekDataError' }
}
export function emptyWeek(): WeekDocument { return { slots: [], wakeTimes: normalizeWakeTimes(undefined) } }

/** Strict reads/writes, not a lossy legacy normalizer. Invalid data stays stored
 * unchanged and can be diagnosed instead of silently becoming an empty week. */
export function validateWeek(value: unknown): WeekDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WeekDataError()
  const doc = value as Record<string, unknown>
  if (!Array.isArray(doc.slots) || !Array.isArray(doc.wakeTimes) || doc.wakeTimes.length !== 7 ||
    doc.wakeTimes.some((time, day) => typeof time !== 'string' || normalizeWakeTimes(doc.wakeTimes)[day] !== time)) throw new WeekDataError()
  const accepted: WeekSlot[] = []
  for (const candidate of doc.slots) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new WeekDataError()
    const slot = candidate as WeekSlot
    if (typeof slot.id !== 'string' || !slot.id || accepted.some(other => other.id === slot.id) ||
      typeof slot.title !== 'string' || typeof slot.start !== 'string' || typeof slot.end !== 'string' ||
      ['description', 'projectId', 'location', 'link', 'color'].some(key => (candidate as Record<string, unknown>)[key] !== undefined && typeof (candidate as Record<string, unknown>)[key] !== 'string') ||
      (slot.people !== undefined && (!Array.isArray(slot.people) || slot.people.some(person => typeof person !== 'string'))) || slotError(slot, accepted)) throw new WeekDataError()
    accepted.push(structuredClone(slot))
  }
  return { ...structuredClone(doc), slots: accepted, wakeTimes: [...doc.wakeTimes] } as WeekDocument
}
export function localDay(now: Date): number { return (now.getDay() + 6) % 7 }
export function visibleSlots(document: WeekDocument, filter: { day?: number; projectId?: string } = {}): WeekSlot[] {
  return document.slots.filter(slot => (filter.day === undefined || slot.day === filter.day) &&
    (filter.projectId === undefined || slot.projectId === filter.projectId))
    .map(slot => structuredClone(slot)).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}
