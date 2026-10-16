// Business model of the LinkedIn planner. One document per post (CAS per post,
// no global 1 MiB document), one settings document and one document per image.

export const POSTS = 'posts'
export const IMAGES = 'images'
export const SETTINGS = 'settings'
export const SETTINGS_ID = 'profile'

export const POST_TYPES = [
  { id: 'decouverte', label: 'Découverte', color: '#2f80c9' },
  { id: 'expertise', label: 'Expertise', color: '#7a4fc4' },
  { id: 'vente', label: 'Vente', color: '#c96a1b' },
  { id: 'autre', label: 'Autre', color: '#7d7468' },
] as const
export type PostType = (typeof POST_TYPES)[number]['id']

export const POST_STATUSES = [
  { id: 'idee', label: 'Idée' },
  { id: 'brouillon', label: 'Brouillon' },
  { id: 'planifie', label: 'Planifié' },
  { id: 'publie', label: 'Publié' },
  { id: 'abandonne', label: 'Abandonné' },
] as const
export type PostStatus = (typeof POST_STATUSES)[number]['id']

export const MAX_CONTENT = 3000
// LinkedIn cuts the feed preview around this length behind « voir plus ».
export const HOOK_PREVIEW = 210
export const MAX_TAGS = 20
export const MAX_HISTORY = 50

export interface PostEvent { at: string; status: PostStatus; date?: string; time?: string }
export interface Post {
  id: string
  title: string
  content: string
  type: PostType
  status: PostStatus
  tags: string[]
  date?: string
  time?: string
  imageId?: string
  imageName?: string
  imageAlt?: string
  thumbnail?: string
  publishedUrl?: string
  notes?: string
  createdAt: string
  updatedAt: string
  publishedAt?: string
  history: PostEvent[]
}
export interface Settings { linkedinUrl?: string; defaultTime: string }
export interface StoredImage { dataUrl: string; name: string; width: number; height: number }

export class PlannerDataError extends Error {
  constructor(what = 'Ce document') { super(`${what} est invalide. Il ne sera pas remplacé.`); this.name = 'PlannerDataError' }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const IMAGE_DATA = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/
const isType = (value: unknown): value is PostType => POST_TYPES.some(type => type.id === value)
const isStatus = (value: unknown): value is PostStatus => POST_STATUSES.some(status => status.id === value)
export const isTime = (value: unknown): value is string => typeof value === 'string' && TIME.test(value)
export const isDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime()) && localDate(new Date(`${value}T00:00:00`)) === value
export const typeInfo = (type: PostType) => POST_TYPES.find(item => item.id === type)!
export const statusLabel = (status: PostStatus) => POST_STATUSES.find(item => item.id === status)!.label

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return localDate(value)
}
/** Monday of the local week containing `date`. */
export function weekStart(date: string): string {
  const value = new Date(`${date}T12:00:00`); return addDays(date, -((value.getDay() + 6) % 7))
}

/** Lowercase, trimmed, without leading « # », duplicates removed in order. */
export function normalizeTags(values: string[]): string[] {
  const seen = new Set<string>(), result: string[] = []
  for (const raw of values) {
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR').slice(0, 40)
    if (tag && !seen.has(tag)) { seen.add(tag); result.push(tag) }
  }
  return result.slice(0, MAX_TAGS)
}
export function parseTags(input: string): string[] { return normalizeTags(input.split(/[,;\n]/)) }

/** Strict read. Unknown fields are kept so a newer version's data survives an
 * edit by this one; invalid documents are reported, never normalised silently. */
export function validatePost(value: unknown, id: string): Post {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlannerDataError('Ce post')
  const post = value as Record<string, unknown>
  const optional = ['date', 'time', 'imageId', 'imageName', 'imageAlt', 'thumbnail', 'publishedUrl', 'notes', 'publishedAt']
  if (post.id !== id || typeof post.title !== 'string' || typeof post.content !== 'string' || post.content.length > MAX_CONTENT * 2 ||
    !isType(post.type) || !isStatus(post.status) || typeof post.createdAt !== 'string' || typeof post.updatedAt !== 'string' ||
    !Array.isArray(post.tags) || post.tags.some(tag => typeof tag !== 'string') ||
    !Array.isArray(post.history) || optional.some(key => post[key] !== undefined && typeof post[key] !== 'string') ||
    (post.date !== undefined && !isDate(post.date)) || (post.time !== undefined && !isTime(post.time)) ||
    (post.thumbnail !== undefined && !IMAGE_DATA.test(post.thumbnail as string)) ||
    (post.status === 'planifie' && (post.date === undefined || post.time === undefined)) ||
    post.history.some(event => !event || typeof event !== 'object' || typeof event.at !== 'string' || !isStatus(event.status))) throw new PlannerDataError('Ce post')
  return structuredClone(post) as unknown as Post
}
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlannerDataError('Les réglages')
  const settings = value as Record<string, unknown>
  if (!isTime(settings.defaultTime) || (settings.linkedinUrl !== undefined && linkedinUrlError(settings.linkedinUrl as string) !== null)) throw new PlannerDataError('Les réglages')
  return structuredClone(settings) as unknown as Settings
}
export function validateImage(value: unknown): StoredImage {
  const image = value as Record<string, unknown> | null
  if (!image || typeof image !== 'object' || typeof image.dataUrl !== 'string' || !IMAGE_DATA.test(image.dataUrl) || typeof image.name !== 'string' ||
    !Number.isInteger(image.width) || !Number.isInteger(image.height)) throw new PlannerDataError('Cette image')
  return image as unknown as StoredImage
}
export const defaultSettings = (): Settings => ({ defaultTime: '08:30' })

/** Only an https link to linkedin.com (or a subdomain), without credentials. */
export function linkedinUrlError(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return 'Le lien doit commencer par https://.'
    if (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com')) return 'Le lien doit pointer vers linkedin.com.'
    return null
  } catch { return 'Lien invalide.' }
}
export function httpUrl(value: string | undefined): string | null {
  if (!value) return null
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}

export function scheduledAt(post: Post): string | null { return post.date ? `${post.date}T${post.time ?? '23:59'}` : null }
export function isPast(post: Post, now: Date): boolean {
  const at = scheduledAt(post); return !!at && at < `${localDate(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}
/** Planned in the past without publication confirmed: needs a decision. */
export function isOverdue(post: Post, now: Date): boolean { return post.status === 'planifie' && isPast(post, now) }

export type Tab = 'planning' | 'idees' | 'historique'
/** Each post belongs to exactly one tab. Ideas: no date yet. Planning: dated and
 * still to publish, including planned posts whose time passed (to confirm).
 * History: published, abandoned, or an unplanned draft whose date passed. */
export function inTab(post: Post, tab: Tab, now: Date): boolean {
  const open = post.status === 'idee' || post.status === 'brouillon' || post.status === 'planifie'
  if (tab === 'idees') return !post.date && open && post.status !== 'planifie'
  if (tab === 'planning') return !!post.date && open && (!isPast(post, now) || post.status === 'planifie')
  return !open || (!!post.date && isPast(post, now) && post.status !== 'planifie')
}

export interface Filter { text?: string; type?: PostType | ''; tag?: string }
export function matches(post: Post, filter: Filter): boolean {
  if (filter.type && post.type !== filter.type) return false
  if (filter.tag && !post.tags.includes(filter.tag)) return false
  const text = filter.text?.trim().toLocaleLowerCase('fr-FR')
  if (text && ![post.title, post.content, post.notes ?? '', ...post.tags].some(value => value.toLocaleLowerCase('fr-FR').includes(text))) return false
  return true
}
export function sortPosts(posts: Post[], tab: Tab): Post[] {
  const copy = [...posts]
  if (tab === 'idees') return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const key = (post: Post) => scheduledAt(post) ?? post.publishedAt ?? post.updatedAt
  return copy.sort((a, b) => tab === 'planning' ? key(a).localeCompare(key(b)) || a.id.localeCompare(b.id) : key(b).localeCompare(key(a)) || a.id.localeCompare(b.id))
}

export function tagCounts(posts: Post[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const post of posts) for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
}
/** Type mix of posts dated in [from, to] (inclusive), excluding abandoned ones. */
export function typeMix(posts: Post[], from: string, to: string): Record<PostType, number> {
  const mix = Object.fromEntries(POST_TYPES.map(type => [type.id, 0])) as Record<PostType, number>
  for (const post of posts) if (post.date && post.date >= from && post.date <= to && post.status !== 'abandonne') mix[post.type]++
  return mix
}

/** Applies an edit and records status/schedule changes in a bounded log. */
export function withChanges(previous: Post | undefined, next: Post, now: string): Post {
  const result: Post = { ...next, updatedAt: now, history: [...(previous?.history ?? next.history ?? [])] }
  const changed = !previous || previous.status !== next.status || previous.date !== next.date || previous.time !== next.time
  if (changed) result.history.push({ at: now, status: next.status, ...(next.date ? { date: next.date } : {}), ...(next.time ? { time: next.time } : {}) })
  if (result.history.length > MAX_HISTORY) result.history = result.history.slice(-MAX_HISTORY)
  if (next.status === 'publie' && !next.publishedAt) result.publishedAt = now
  if (next.status !== 'publie') delete result.publishedAt
  return result
}
export function reschedules(post: Post): number {
  let count = 0, last: string | undefined
  for (const event of post.history) { const at = event.date ? `${event.date}T${event.time ?? ''}` : undefined; if (at && last && at !== last) count++; if (at) last = at }
  return count
}
export function newPost(id: string, now: string, overrides: Partial<Post> = {}): Post {
  return { id, title: '', content: '', type: 'decouverte', status: 'idee', tags: [], createdAt: now, updatedAt: now, history: [], ...overrides }
}
/** Copy for reuse: new identity, back to draft, no date/publication link. */
export function duplicate(post: Post, id: string, now: string): Post {
  const copy: Post = { ...structuredClone(post), id, title: post.title ? `${post.title} (copie)` : '', status: 'brouillon', createdAt: now, updatedAt: now, history: [] }
  for (const key of ['date', 'time', 'publishedUrl', 'publishedAt'] as const) delete copy[key]
  return copy
}
