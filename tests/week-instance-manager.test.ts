import { afterEach, expect, it, vi } from 'vitest'
import { instanceManager } from '../packages/builtin-week/src/instance-manager'
import type { ProjectTrackerSdk } from '../sdk/src'
const first = { instanceId: 'one', name: 'Première', active: true, revision: 3, position: 0 }
const second = { instanceId: 'two', name: 'Seconde', active: false, revision: 5, position: 1 }
async function setup(items = [first, second]) {
  const instances = { list: vi.fn(async () => ({ items, nextCursor: null })), create: vi.fn(async () => second), rename: vi.fn(async () => second), delete: vi.fn(async () => ({ deleted: true })), setActive: vi.fn(async () => second), select: vi.fn(async () => second) }
  const done = vi.fn(); const panel = instanceManager({ instances } as unknown as ProjectTrackerSdk, 'two', done); document.body.append(panel)
  await vi.waitFor(() => expect(panel.querySelectorAll('li')).toHaveLength(items.length))
  const button = (name: string, container: ParentNode = panel) => Array.from(container.querySelectorAll('button')).find(node => node.textContent === name)!
  const name = panel.querySelector('input')!
  return { panel, instances, done, button, name }
}
afterEach(() => document.body.replaceChildren())
it('distinguishes consulted/active and passes CAS to active changes and rename', async () => {
  const { panel, instances, button } = await setup()
  const row = panel.querySelectorAll('li')[1]
  expect(row.textContent).toContain('consultée'); expect(row.textContent).not.toContain('· active')
  button('Rendre active', row).click()
  await vi.waitFor(() => expect(instances.setActive).toHaveBeenCalledWith('two', 'one'))
  await vi.waitFor(() => expect(button('Renommer').disabled).toBe(false))
  const refreshed = panel.querySelectorAll('li')[1]; refreshed.querySelector('input')!.value = ' Renommée '
  button('Renommer', refreshed).click()
  await vi.waitFor(() => expect(instances.rename).toHaveBeenCalledWith('two', 'Renommée', 5))
})
it('creates empty and duplicates the consulted instance, not the active one', async () => {
  const { instances, button, name } = await setup(); name.value = ' Copie '
  button('Dupliquer la semaine consultée').click()
  await vi.waitFor(() => expect(instances.create).toHaveBeenCalledWith({ name: 'Copie', copyFrom: 'two', operationId: expect.any(String) }))
})
it('refuses blank/duplicate names and leaves last-week deletion disabled', async () => {
  const { instances, button, name, panel } = await setup([first])
  name.value = ' première '; button('Créer une semaine vide').click()
  await vi.waitFor(() => expect(panel.textContent).toContain('Opération impossible'))
  expect(instances.create).not.toHaveBeenCalled()
  expect(button('Supprimer la semaine').disabled).toBe(true)
})
it('requests native deletion with the captured revision and never impersonates consent', async () => {
  const { instances, button } = await setup(); button('Supprimer la semaine').click()
  await vi.waitFor(() => expect(instances.delete).toHaveBeenCalledWith('one', 3))
})
it('selects without setting active and can return without mutation', async () => {
  const { instances, done, button } = await setup(); button('Consulter').click()
  await vi.waitFor(() => expect(instances.select).toHaveBeenCalledWith('one'))
  expect(instances.setActive).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(button('Retour au planning').disabled).toBe(false))
  button('Retour au planning').click(); expect(done).toHaveBeenCalled()
})
it('lists every page before evaluating the last-instance rule', async () => {
  const list = vi.fn().mockResolvedValueOnce({ items: [first], nextCursor: 'one' }).mockResolvedValueOnce({ items: [second], nextCursor: null })
  const panel = instanceManager({ instances: { list } } as unknown as ProjectTrackerSdk, 'one', () => {}); document.body.append(panel)
  await vi.waitFor(() => expect(panel.querySelectorAll('li')).toHaveLength(2))
  expect(list).toHaveBeenLastCalledWith({ limit: 200, cursor: 'one' })
  expect(Array.from(panel.querySelectorAll('button')).find(node => node.textContent === 'Supprimer la semaine')!.disabled).toBe(false)
})
