import type { ProjectTrackerSdk } from '../../../sdk/src'
import { IMAGES, POSTS, SETTINGS, SETTINGS_ID, defaultSettings, validateImage, validatePost, validateSettings, type Post, type Settings, type StoredImage } from './model'

export const PACKAGE_ID = 'lfantine.linkedin-post-planner'
export const MAJOR_ID = 'planner'

export interface Entry<T> { value: T; revision: number | null }
export interface Snapshot {
  instanceId: string
  name: string
  settings: Entry<Settings>
  posts: Map<string, Entry<Post>>
  // Stored but unreadable by this version: shown, never overwritten.
  invalid: string[]
}
type PlannerSdk = Pick<ProjectTrackerSdk, 'call' | 'storage'>

async function instanceOf(sdk: PlannerSdk, write: boolean): Promise<{ instanceId: string; name: string } | null> {
  const context = await sdk.call('context.get', {})
  if (context.packageId !== PACKAGE_ID || (write && context.kind !== 'major')) throw Error('Contexte du planning indisponible.')
  return context.instance
}
const address = (instanceId: string, collection: string, id: string) => ({ collection, id, scope: 'instance' as const, instanceId })

/** Reads every page of the instance's posts. A read never creates a document. */
export async function loadPlanner(sdk: PlannerSdk): Promise<Snapshot | null> {
  const instance = await instanceOf(sdk, false)
  if (!instance) return null
  const stored = await sdk.storage.get(address(instance.instanceId, SETTINGS, SETTINGS_ID))
  if (stored && stored.instanceId !== instance.instanceId) throw Error('Le profil consulté a changé. Recharge la vue.')
  const snapshot: Snapshot = { ...instance, settings: { value: stored ? validateSettings(stored.value) : defaultSettings(), revision: stored?.revision ?? null }, posts: new Map(), invalid: [] }
  const seen = new Set<string>(); let cursor: string | undefined
  do {
    const page = await sdk.storage.list({ collection: POSTS, scope: 'instance', instanceId: instance.instanceId, limit: 200, ...(cursor ? { cursor } : {}) })
    for (const item of page.items) {
      if (item.instanceId !== instance.instanceId) throw Error('Le profil consulté a changé. Recharge la vue.')
      try { snapshot.posts.set(item.id, { value: validatePost(item.value, item.id), revision: item.revision }) } catch { snapshot.invalid.push(item.id) }
    }
    if (page.nextCursor && seen.has(page.nextCursor)) throw Error('Pagination invalide')
    if (page.nextCursor) seen.add(page.nextCursor)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return snapshot
}

async function writable(sdk: PlannerSdk, snapshot: Snapshot) {
  const instance = await instanceOf(sdk, true)
  if (instance?.instanceId !== snapshot.instanceId) throw Error('Le profil consulté a changé. Recharge la vue.')
}
/** CAS write of one post: `revision` null creates, otherwise the read revision. */
export async function savePost(sdk: PlannerSdk, snapshot: Snapshot, post: Post, revision: number | null): Promise<Entry<Post>> {
  const value = validatePost(post, post.id)
  await writable(sdk, snapshot)
  const result = await sdk.storage.put({ ...address(snapshot.instanceId, POSTS, post.id), value, expectedRevision: revision })
  snapshot.posts.set(post.id, { value, revision: result.revision })
  return { value, revision: result.revision }
}
export async function deletePost(sdk: PlannerSdk, snapshot: Snapshot, id: string, revision: number): Promise<void> {
  await writable(sdk, snapshot)
  const imageId = snapshot.posts.get(id)?.value.imageId
  await sdk.storage.delete({ ...address(snapshot.instanceId, POSTS, id), expectedRevision: revision })
  snapshot.posts.delete(id)
  // Duplicated posts share their image: keep it while another post uses it.
  if (imageId && ![...snapshot.posts.values()].some(entry => entry.value.imageId === imageId)) await deleteImage(sdk, snapshot, imageId).catch(() => {})
}
export async function saveSettings(sdk: PlannerSdk, snapshot: Snapshot, settings: Settings): Promise<void> {
  const value = validateSettings(settings)
  await writable(sdk, snapshot)
  const result = await sdk.storage.put({ ...address(snapshot.instanceId, SETTINGS, SETTINGS_ID), value, expectedRevision: snapshot.settings.revision })
  snapshot.settings = { value, revision: result.revision }
}

/** Images are immutable documents: a replaced image gets a new identity. */
export async function createImage(sdk: PlannerSdk, snapshot: Snapshot, id: string, image: StoredImage): Promise<void> {
  await writable(sdk, snapshot)
  await sdk.storage.put({ ...address(snapshot.instanceId, IMAGES, id), value: validateImage(image), expectedRevision: null })
}
export async function readImage(sdk: PlannerSdk, snapshot: Snapshot, id: string): Promise<StoredImage | null> {
  const stored = await sdk.storage.get(address(snapshot.instanceId, IMAGES, id))
  return stored ? validateImage(stored.value) : null
}
export async function deleteImage(sdk: PlannerSdk, snapshot: Snapshot, id: string): Promise<void> {
  const stored = await sdk.storage.get(address(snapshot.instanceId, IMAGES, id))
  if (stored) await sdk.storage.delete({ ...address(snapshot.instanceId, IMAGES, id), expectedRevision: stored.revision })
}
