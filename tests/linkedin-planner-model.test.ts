import { expect, it } from 'vitest'
import {
  addDays, duplicate, inTab, isOverdue, linkedinUrlError, newPost, normalizeTags, parseTags, reschedules, sortPosts, tagCounts,
  typeMix, validatePost, validateSettings, weekStart, withChanges, type Post,
} from '../packages/linkedin-post-planner/src/model'
import { createImage, deletePost, loadPlanner, savePost, saveSettings } from '../packages/linkedin-post-planner/src/client'
import { fakePlannerSdk } from './linkedin-planner-fake'

const now = new Date(2026, 9, 16, 10, 0)
const post = (overrides: Partial<Post> = {}): Post => newPost(overrides.id ?? 'p1', '2026-10-01T08:00:00.000Z', { title: 'Sujet', ...overrides })
const image = { dataUrl: 'data:image/jpeg;base64,AAAA', name: 'visuel.png', width: 10, height: 10 }

it('normalises tags: lowercase, no leading #, no duplicates, comma/semicolon/newline separated', () => {
  expect(parseTags('#TypeScript, typescript ; Nouvelle  feature\n\n#2026')).toEqual(['typescript', 'nouvelle feature', '2026'])
  expect(normalizeTags(Array.from({ length: 30 }, (_, index) => `t${index}`))).toHaveLength(20)
})
it('validates posts strictly, keeps unknown fields and refuses a planned post without date/time', () => {
  const stored = { ...post({ status: 'planifie', date: '2026-10-20', time: '08:30' }), future: { kept: true } }
  expect(validatePost(stored, 'p1')).toMatchObject({ future: { kept: true } })
  for (const invalid of [
    { ...post(), status: 'planifie' }, { ...post(), type: 'promo' }, { ...post(), date: '2026-02-30' }, { ...post(), time: '25:00' },
    { ...post(), tags: [1] }, { ...post(), id: 'other' }, { ...post(), thumbnail: 'https://example.com/x.png' },
  ]) expect(() => validatePost(invalid, 'p1')).toThrow('invalide')
})
it('accepts only https linkedin.com profile links in settings', () => {
  expect(linkedinUrlError('https://www.linkedin.com/in/loan/')).toBeNull()
  expect(linkedinUrlError('http://www.linkedin.com/in/loan/')).not.toBeNull()
  expect(linkedinUrlError('https://linkedin.com.evil.test/in/loan')).not.toBeNull()
  expect(linkedinUrlError('https://user:pass@www.linkedin.com/')).not.toBeNull()
  expect(() => validateSettings({ defaultTime: '08:30', linkedinUrl: 'javascript:alert(1)' })).toThrow()
})
it('puts every post in exactly one tab, planned posts whose time passed stay in planning to confirm', () => {
  const cases: [Partial<Post>, string][] = [
    [{ status: 'idee' }, 'idees'],
    [{ status: 'brouillon', date: '2026-10-20', time: '08:30' }, 'planning'],
    [{ status: 'planifie', date: '2026-10-20', time: '08:30' }, 'planning'],
    [{ status: 'planifie', date: '2026-10-16', time: '08:30' }, 'planning'],
    [{ status: 'brouillon', date: '2026-10-10', time: '08:30' }, 'historique'],
    [{ status: 'publie', date: '2026-10-10', time: '08:30' }, 'historique'],
    [{ status: 'abandonne' }, 'historique'],
  ]
  for (const [overrides, expected] of cases) {
    const tabs = (['planning', 'idees', 'historique'] as const).filter(tab => inTab(post(overrides), tab, now))
    expect(tabs).toEqual([expected])
  }
  expect(isOverdue(post({ status: 'planifie', date: '2026-10-16', time: '08:30' }), now)).toBe(true)
  expect(isOverdue(post({ status: 'planifie', date: '2026-10-16', time: '10:30' }), now)).toBe(false)
})
it('sorts planning chronologically and history newest first, groups weeks from Monday', () => {
  const a = post({ id: 'a', date: '2026-10-21', time: '09:00' }), b = post({ id: 'b', date: '2026-10-19', time: '12:00' })
  expect(sortPosts([a, b], 'planning').map(item => item.id)).toEqual(['b', 'a'])
  expect(sortPosts([a, b], 'historique').map(item => item.id)).toEqual(['a', 'b'])
  expect(weekStart('2026-10-18')).toBe('2026-10-12')
  expect(weekStart('2026-10-19')).toBe('2026-10-19')
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
})
it('counts tags and the type mix, ignoring abandoned posts', () => {
  const posts = [post({ id: 'a', tags: ['ts', 'ia'], date: '2026-10-20', type: 'expertise' }), post({ id: 'b', tags: ['ts'], date: '2026-10-21', type: 'vente', status: 'abandonne' })]
  expect(tagCounts(posts)).toEqual([['ts', 2], ['ia', 1]])
  expect(typeMix(posts, '2026-10-16', '2026-11-14')).toEqual({ decouverte: 0, expertise: 1, vente: 0, autre: 0 })
})
it('logs status/schedule changes, counts reschedules and stamps publication', () => {
  let current = withChanges(undefined, post(), 't1')
  current = withChanges(current, { ...current, status: 'planifie', date: '2026-10-20', time: '08:30' }, 't2')
  current = withChanges(current, { ...current, title: 'Autre titre' }, 't3')
  current = withChanges(current, { ...current, date: '2026-10-22' }, 't4')
  expect(current.history.map(event => event.at)).toEqual(['t1', 't2', 't4'])
  expect(reschedules(current)).toBe(1)
  const published = withChanges(current, { ...current, status: 'publie' }, 't5')
  expect(published.publishedAt).toBe('t5')
  expect(withChanges(published, { ...published, status: 'brouillon' }, 't6').publishedAt).toBeUndefined()
})
it('duplicates as a new undated draft that shares the image reference', () => {
  const copy = duplicate(post({ status: 'publie', date: '2026-10-01', time: '09:00', publishedUrl: 'https://www.linkedin.com/posts/x', imageId: 'img' }), 'p2', 'now')
  expect(copy).toMatchObject({ id: 'p2', status: 'brouillon', imageId: 'img', history: [] })
  expect(copy).not.toHaveProperty('date'); expect(copy).not.toHaveProperty('publishedUrl')
})

it('loads every page, reports unreadable posts without touching them, and never writes on read', async () => {
  const f = fakePlannerSdk({ pageSize: 2 })
  for (const id of ['a', 'b', 'c']) await f.client.storage.put({ collection: 'posts', id, scope: 'instance', instanceId: 'profile-one', value: post({ id }), expectedRevision: null })
  await f.client.storage.put({ collection: 'posts', id: 'broken', scope: 'instance', instanceId: 'profile-one', value: { id: 'broken' }, expectedRevision: null })
  f.sdk.storage.put.mockClear()
  const snapshot = (await loadPlanner(f.client))!
  expect([...snapshot.posts.keys()].sort()).toEqual(['a', 'b', 'c'])
  expect(snapshot.invalid).toEqual(['broken'])
  expect(snapshot.settings).toEqual({ value: { defaultTime: '08:30' }, revision: null })
  expect(f.sdk.storage.list).toHaveBeenCalledTimes(2)
  expect(f.sdk.storage.put).not.toHaveBeenCalled()
})
it('returns null without instance so the page can offer a creation', async () => {
  expect(await loadPlanner(fakePlannerSdk({ instance: null }).client)).toBeNull()
})
it('writes with the read revision; a concurrent change is a conflict, not an overwrite', async () => {
  const f = fakePlannerSdk()
  const snapshot = (await loadPlanner(f.client))!
  const saved = await savePost(f.client, snapshot, post(), null)
  expect(saved.revision).toBe(1)
  await f.client.storage.put({ collection: 'posts', id: 'p1', scope: 'instance', instanceId: 'profile-one', value: post({ title: 'Ailleurs' }), expectedRevision: 1 })
  await expect(savePost(f.client, snapshot, post({ title: 'Ici' }), 1)).rejects.toMatchObject({ code: 'CONFLICT' })
  expect((f.documents.get(f.key('posts', 'p1'))!.value as Post).title).toBe('Ailleurs')
  await saveSettings(f.client, snapshot, { defaultTime: '09:00', linkedinUrl: 'https://www.linkedin.com/in/loan' })
  expect(f.documents.get(f.key('settings', 'profile'))!.value).toEqual({ defaultTime: '09:00', linkedinUrl: 'https://www.linkedin.com/in/loan' })
})
it('refuses writes from a non-major context or after the consulted profile changed', async () => {
  const widget = fakePlannerSdk({ kind: 'widget' })
  await expect(savePost(widget.client, (await loadPlanner(widget.client))!, post(), null)).rejects.toThrow()
  const f = fakePlannerSdk(), snapshot = (await loadPlanner(f.client))!
  f.sdk.context.instance = { instanceId: 'other', name: 'Autre' }
  await expect(savePost(f.client, snapshot, post(), null)).rejects.toThrow('a changé')
  expect(f.documents.size).toBe(0)
})
it('deletes an image only when no remaining post references it', async () => {
  const f = fakePlannerSdk(), snapshot = (await loadPlanner(f.client))!
  await createImage(f.client, snapshot, 'img', image)
  await savePost(f.client, snapshot, post({ id: 'a', imageId: 'img' }), null)
  await savePost(f.client, snapshot, post({ id: 'b', imageId: 'img' }), null)
  await deletePost(f.client, snapshot, 'a', 1)
  expect(f.documents.has(f.key('images', 'img'))).toBe(true)
  await deletePost(f.client, snapshot, 'b', 1)
  expect(f.documents.has(f.key('images', 'img'))).toBe(false)
})
