export const DEFAULT_SLOT_COLOR = '#d1d5db'
export function slotColor(color?: string): string {
  if (typeof color !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color.trim())) return DEFAULT_SLOT_COLOR
  const hex = color.trim().toLowerCase()
  return hex.length === 4 ? '#' + hex.slice(1).split('').map((digit) => digit + digit).join('') : hex
}
export function slotTextColor(color?: string): string {
  const hex = slotColor(color).slice(1)
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#111111' : '#ffffff'
}
export const WEEK_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
export interface WeekSlot { id: string; title: string; day: number; start: string; end: string; description?: string; projectId?: string; location?: string; people?: string[]; link?: string; color?: string }
export function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}
export function slotError(slot: Omit<WeekSlot, 'id'>, slots: WeekSlot[], excludeId?: string): string | undefined {
  if (slot.color !== undefined && !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(slot.color.trim())) return 'Renseigne une couleur hexadécimale valide (ex. #d1d5db).'
  if (!slot.title.trim()) return 'Renseigne un objectif.'
  if (!Number.isInteger(slot.day) || slot.day < 0 || slot.day > 6 || !Number.isFinite(minutes(slot.start)) || !Number.isFinite(minutes(slot.end))) return 'Renseigne des horaires valides.'
  if (minutes(slot.end) <= minutes(slot.start)) return 'La fin doit être après le début (sur la même journée).'
  if (slots.some((other) => other.id !== excludeId && other.day === slot.day && minutes(slot.start) < minutes(other.end) && minutes(slot.end) > minutes(other.start))) return 'Ce créneau chevauche un autre objectif.'
  return undefined
}
export function normalizeWeekSlots(raw: unknown): WeekSlot[] {
  if (!Array.isArray(raw)) return []
  const slots: WeekSlot[] = []
  for (const entry of raw) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.title !== 'string' || typeof entry.start !== 'string' || typeof entry.end !== 'string') continue
    if (!slots.some((s) => s.id === entry.id) && !slotError({ ...entry, color: undefined }, slots)) slots.push({ id: entry.id, title: entry.title, day: entry.day, start: entry.start, end: entry.end,
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      ...(typeof entry.projectId === 'string' ? { projectId: entry.projectId } : {}),
      ...(typeof entry.location === 'string' ? { location: entry.location } : {}),
      ...(Array.isArray(entry.people) ? { people: entry.people.filter((person: unknown) => typeof person === 'string') } : {}),
      ...(entry.color !== undefined ? { color: slotColor(entry.color) } : {}),
      ...(typeof entry.link === 'string' ? { link: entry.link } : {}),
    })
  }
  return slots
}

export function normalizeWakeTimes(raw: unknown): string[] {
  return WEEK_DAYS.map((_, day) => Array.isArray(raw) && typeof raw[day] === 'string' && Number.isFinite(minutes(raw[day])) ? raw[day] : '07:00')
}
