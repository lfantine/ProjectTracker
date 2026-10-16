import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ShortcutEditor } from '../renderer/components/ShortcutEditor'
import { HOST_ICONS } from '../shared/version'
const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('../renderer/lib/composition', () => ({ useComposition: () => ({ snapshot: { dashboards: [], instances: [], contributions: [] }, mutate, pending: false, error: '' }) }))
beforeEach(() => { vi.clearAllMocks(); mutate.mockResolvedValue({ id: 'new' }) })
it('lets the user see and pick every icon with a live preview before saving', async () => {
  const close = vi.fn(); render(<ShortcutEditor onClose={close} />)
  expect(screen.queryByRole('combobox', { name: 'Icône' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Icône Calendrier' }).querySelector('svg')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Icône Calendrier' }))
  expect(screen.getByRole('button', { name: 'Icône Calendrier' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), { target: { value: 'Planning' } })
  expect(screen.getByLabelText('Aperçu du shortcut')).toHaveTextContent('Planning')
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter le shortcut' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(mutate).toHaveBeenCalledWith({ kind: 'sidebar.add', label: 'Planning', icon: 'calendar', target: { kind: 'native', page: 'projects' } })
})
it('shows the usual icons first and the others behind « Voir plus », all drawable and savable', async () => {
  const close = vi.fn(); render(<ShortcutEditor onClose={close} />)
  const grid = screen.getByRole('group', { name: 'Choisir une icône' })
  expect(grid.querySelectorAll('button')).toHaveLength(18)
  expect(screen.queryByRole('button', { name: 'Icône LinkedIn' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Voir plus/ }))
  expect(grid.querySelectorAll('button')).toHaveLength(HOST_ICONS.length)
  for (const button of grid.querySelectorAll('button')) expect(button.querySelector('svg')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Icône LinkedIn' }))
  fireEvent.click(screen.getByRole('button', { name: 'Voir moins' }))
  expect(grid.querySelectorAll('button')).toHaveLength(18)
  fireEvent.change(screen.getByRole('textbox', { name: 'Nom' }), { target: { value: 'Posts' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter le shortcut' }))
  await waitFor(() => expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ icon: 'linkedin' })))
})
