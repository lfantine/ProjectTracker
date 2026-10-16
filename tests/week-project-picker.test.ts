import { afterEach, expect, it, vi } from 'vitest'
import { projectPicker } from '../packages/builtin-week/src/project-picker'
import type { ProjectTrackerSdk } from '../sdk/src'
afterEach(() => document.body.replaceChildren())
it('loads all project pages and preserves orphan references without interpreting names', async () => {
  const list = vi.fn().mockResolvedValueOnce({ items: [{ id: 'one', name: '<b>Projet</b>' }], nextCursor: 'one' }).mockResolvedValueOnce({ items: [{ id: 'two', name: 'Deux' }], nextCursor: null })
  const wrapper = projectPicker({ list } as unknown as ProjectTrackerSdk['core'], 'orphan'); document.body.append(wrapper.element)
  await vi.waitFor(() => expect(wrapper.select.options).toHaveLength(4))
  expect(wrapper.select.value).toBe('orphan'); expect(wrapper.element.querySelector('b')).toBeNull()
  expect(list).toHaveBeenLastCalledWith({ resource: 'projects', limit: 200, cursor: 'one' })
})
it('retains the existing link when project reading is denied', async () => {
  const wrapper = projectPicker({ list: vi.fn(async () => { throw Error('private') }) } as unknown as ProjectTrackerSdk['core'], 'missing'); document.body.append(wrapper.element)
  await vi.waitFor(() => expect(wrapper.element.textContent).toContain('référence existante est conservée'))
  expect(wrapper.select.value).toBe('missing'); expect(wrapper.element.textContent).not.toContain('private')
})
