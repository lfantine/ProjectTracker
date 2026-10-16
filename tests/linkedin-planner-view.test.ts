import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { newPost, type Post } from '../packages/linkedin-post-planner/src/model'
import { fakePlannerSdk } from './linkedin-planner-fake'

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 16, 10, 0))
  document.body.innerHTML = '<main id="planner-root"></main>'
})
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })

async function setup(posts: Partial<Post>[] = [], options: Parameters<typeof fakePlannerSdk>[0] = {}) {
  const f = fakePlannerSdk(options)
  for (const [index, overrides] of posts.entries()) {
    const id = overrides.id ?? `seed-${index}`
    await f.client.storage.put({ collection: 'posts', id, scope: 'instance', instanceId: 'profile-one', value: newPost(id, '2026-10-01T08:00:00.000Z', overrides), expectedRevision: null })
  }
  f.sdk.storage.put.mockClear()
  vi.stubGlobal('ProjectTracker', { ready: Promise.resolve(f.sdk) })
  await import('../packages/linkedin-post-planner/src/view')
  await vi.waitFor(() => expect(document.querySelector('.toolbar, .empty-state')).not.toBeNull())
  const button = (name: string) => Array.from(document.querySelectorAll('button')).find(node => node.textContent === name || node.getAttribute('aria-label') === name)!
  const stored = (id: string) => f.documents.get(f.key('posts', id))?.value as Post
  const storedPosts = () => [...f.documents].filter(([key]) => key.includes('/posts/')).map(([, item]) => item.value as Post)
  return { ...f, button, stored, storedPosts }
}
const fill = (name: string, value: string) => {
  const control = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`dialog [name="${name}"]`)!
  control.value = value; control.dispatchEvent(new Event('input')); control.dispatchEvent(new Event('change'))
}

it('offers to create a first profile when the major has no instance', async () => {
  const { button } = await setup([], { instance: null })
  expect(document.querySelector('.empty-state')?.textContent).toContain('Planifie tes posts LinkedIn')
  button('Créer mon profil').click()
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[aria-label="Nom du nouveau profil"]')?.value).toBe('Mon profil LinkedIn'))
})
it('adds a quick idea with type and #tags, without date', async () => {
  const { button, storedPosts } = await setup()
  button('Idées').click()
  const input = document.querySelector<HTMLInputElement>('[aria-label="Nouvelle idée"]')!
  input.value = 'Retour sur Bun 1.3 #JavaScript #outils'
  document.querySelector<HTMLSelectElement>('[aria-label="Type de l’idée"]')!.value = 'expertise'
  button('Ajouter l’idée').click()
  await vi.waitFor(() => expect(storedPosts()).toHaveLength(1))
  expect(storedPosts()[0]).toMatchObject({ title: 'Retour sur Bun 1.3', type: 'expertise', status: 'idee', tags: ['javascript', 'outils'] })
  expect(storedPosts()[0]).not.toHaveProperty('date')
  await vi.waitFor(() => expect(document.querySelector('.post-card h3')?.textContent).toBe('Retour sur Bun 1.3'))
})
it('plans an idea on the next free day at the default time', async () => {
  const { button, stored } = await setup([{ id: 'idea', title: 'Idée' }, { id: 'today', title: 'Déjà prévu', status: 'planifie', date: '2026-10-17', time: '08:30' }])
  button('Idées').click()
  button('Planifier').click()
  expect(document.querySelector<HTMLInputElement>('dialog [name="date"]')!.value).toBe('2026-10-18')
  expect(document.querySelector<HTMLInputElement>('dialog [name="time"]')!.value).toBe('08:30')
  fill('content', 'Le texte du post')
  button('Enregistrer').click()
  await vi.waitFor(() => expect(stored('idea')).toMatchObject({ status: 'planifie', date: '2026-10-18', time: '08:30', content: 'Le texte du post' }))
  expect(stored('idea').history.at(-1)).toMatchObject({ status: 'planifie', date: '2026-10-18' })
  await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull())
  expect(button('Planning').textContent).toBe('Planning (2)')
})
it('asks to confirm a planned post whose time passed, then moves it to history', async () => {
  const { button, stored } = await setup([{ id: 'late', title: 'En retard', status: 'planifie', date: '2026-10-16', time: '08:00' }])
  expect(document.querySelector('.overdue-question')).not.toBeNull()
  button('Oui, publié').click()
  await vi.waitFor(() => expect(stored('late').status).toBe('publie'))
  expect(stored('late').publishedAt).toBeDefined()
  await vi.waitFor(() => expect(button('Historique').textContent).toBe('Historique (1)'))
})
it('filters by tag from a card and clears the filter', async () => {
  const { button } = await setup([{ id: 'a', title: 'TS', tags: ['typescript'] }, { id: 'b', title: 'Rust', tags: ['rust'] }])
  button('Idées').click()
  expect(document.querySelectorAll('.post-card')).toHaveLength(2)
  button('Filtrer par le tag rust').click()
  expect(Array.from(document.querySelectorAll('.post-card h3'), node => node.textContent)).toEqual(['Rust'])
  button('Effacer les filtres').click()
  expect(document.querySelectorAll('.post-card')).toHaveLength(2)
})
it('opens the LinkedIn profile through native navigation, or the settings when no link is set', async () => {
  const { button, sdk, documents, key } = await setup()
  button('Ouvrir mon LinkedIn').click()
  expect(document.querySelector('dialog')?.textContent).toContain('Ajoute d’abord le lien')
  fill('linkedinUrl', 'https://www.linkedin.com/in/loan/')
  button('Enregistrer').click()
  await vi.waitFor(() => expect(documents.get(key('settings', 'profile'))?.value).toMatchObject({ linkedinUrl: 'https://www.linkedin.com/in/loan/' }))
  await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull())
  button('Ouvrir mon LinkedIn').click()
  expect(sdk.navigation.open).toHaveBeenCalledWith({ kind: 'external', url: 'https://www.linkedin.com/in/loan/' })
})
it('keeps the draft and explains a conflict instead of overwriting', async () => {
  const { button, client, stored } = await setup([{ id: 'p', title: 'Original' }])
  button('Idées').click()
  button('Modifier').click()
  fill('title', 'Ma version')
  await client.storage.put({ collection: 'posts', id: 'p', scope: 'instance', instanceId: 'profile-one', value: { ...stored('p'), title: 'Autre appareil' }, expectedRevision: 1 })
  button('Enregistrer').click()
  await vi.waitFor(() => expect(document.querySelector('dialog [role=status]')?.textContent).toContain('modifié ailleurs'))
  expect(document.querySelector<HTMLInputElement>('dialog [name="title"]')!.value).toBe('Ma version')
  expect(stored('p').title).toBe('Autre appareil')
})
it('Delete on a card only opens a confirmation', async () => {
  const { button, sdk } = await setup([{ id: 'p', title: 'À garder' }])
  button('Idées').click()
  document.querySelector<HTMLElement>('.post-card')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
  expect(button('Confirmer la suppression')).toBeDefined()
  expect(sdk.storage.delete).not.toHaveBeenCalled()
})
