import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AppShell } from '../renderer/components/AppShell'

const { router, data } = vi.hoisted(() => ({
  router: { pathname: '/home', query: {} as Record<string, string>, push: vi.fn() },
  data: { projects: [{ id: 'p1', name: 'Mon projet', category: 'Software', platforms: ['Web'] }], notes: [{ id: 'n1', title: 'Ma note', content: 'Texte', tags: [] }], errors: [{ id: 'e1', title: 'Erreur test', content: 'Erreur' }], categories: ['Software'], folders: [] },
}))
vi.mock('next/router', () => ({ useRouter: () => router }))
vi.mock('next/head', () => ({ default: () => null }))
vi.mock('../renderer/lib/store', () => ({ useData: () => ({ data }) }))
beforeEach(() => { vi.clearAllMocks(); router.pathname = '/home'; router.query = {} })
afterEach(() => vi.unstubAllGlobals())

function openSearch() {
  render(<AppShell title="Accueil">Contenu</AppShell>)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  return screen.getByRole('textbox', { name: 'Rechercher ou saisir une demande pour l’IA' })
}

it('transforme le dialogue et conserve un seul champ de saisie sans perdre le focus', () => {
  const input = openSearch()
  const dialog = screen.getByRole('dialog', { name: 'Rechercher ou demander à l’IA' })
  expect(dialog).toHaveAttribute('data-mode', 'search')
  expect(screen.getByRole('button', { name: 'Créer ou modifier avec l’IA' })).toHaveTextContent('')
  fireEvent.change(input, { target: { value: 'Crée une note pour organiser mes idées' } })
  expect(screen.queryByRole('button', { name: /Demander à l’IA/ })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Rechercher ou demander à l’IA' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Créer ou modifier avec l’IA' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Demande pour l’IA' })).toHaveValue('Crée une note pour organiser mes idées')
  expect(screen.getByRole('textbox', { name: 'Demande pour l’IA' })).toBe(input)
  expect(input).toHaveFocus()
  expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
  expect(dialog).toHaveAttribute('data-mode', 'ai')
  expect(dialog).toHaveStyle({ width: '680px' })
  expect(within(dialog).queryByText('Créer ou modifier avec l’IA')).toBeNull()
  expect(screen.getByRole('button', { name: 'Générer la proposition' })).toBeEnabled()
  expect(router.push).not.toHaveBeenCalled()
})

it('ouvre un résultat existant et ne propose pas l’IA pour une recherche vide', () => {
  const input = openSearch()
  expect(screen.queryByRole('button', { name: /Demander à l’IA/ })).toBeNull()
  fireEvent.change(input, { target: { value: 'Mon projet' } })
  expect(screen.queryByRole('button', { name: /Demander à l’IA/ })).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(router.push).toHaveBeenCalledWith('/project?id=p1')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('synchronise le prompt et revient aux résultats quand la recherche correspond', () => {
  const input = openSearch()
  fireEvent.change(input, { target: { value: 'Prépare mon planning' } })
  expect(screen.getByRole('textbox', { name: 'Demande pour l’IA' })).toHaveValue('Prépare mon planning')
  fireEvent.change(screen.getByRole('textbox', { name: 'Demande pour l’IA' }), { target: { value: 'Ajoute des tâches' } })
  expect(input).toHaveValue('Ajoute des tâches')
  fireEvent.change(input, { target: { value: 'Mon projet' } })
  expect(screen.queryByRole('region', { name: 'Créer ou modifier avec l’IA' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Rechercher ou saisir une demande pour l’IA' })).toBe(input)
  expect(screen.getByRole('dialog')).toHaveAttribute('data-mode', 'search')
  expect(screen.getByRole('button', { name: /Mon projet/ })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  expect(screen.getByRole('textbox', { name: 'Rechercher ou saisir une demande pour l’IA' })).toHaveValue('')
})

it('ouvre une nouvelle demande vide depuis le bouton IA compact après un prompt précédent', () => {
  const input = openSearch()
  fireEvent.change(input, { target: { value: 'Prépare mon planning' } })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Créer ou modifier avec l’IA' }))
  expect(screen.getByRole('dialog', { name: 'Créer ou modifier avec l’IA' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Demande pour l’IA' })).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Générer la proposition' })).toBeDisabled()
})

for (const [pathname, query, targetId] of [
  ['/project', { id: 'p1' }, 'p1'],
  ['/notes/detail', { id: 'n1' }, 'n1'],
  ['/errors', { open: 'e1' }, 'e1'],
] as const) {
  it(`inclut l’objet courant dans l’interface IA de ${pathname}`, () => {
    router.pathname = pathname
    router.query = { ...query }
    const input = openSearch()
    fireEvent.change(input, { target: { value: 'Ajoute des détails et améliore la description' } })
    expect(screen.getByRole('combobox')).toHaveValue(targetId)
    expect(screen.getByRole('textbox', { name: 'Demande pour l’IA' })).toHaveValue('Ajoute des détails et améliore la description')
  })
}

it('lance la génération dans le panneau compact avec le projet courant comme cible', () => {
  const call = vi.fn((_request: string) => new Promise(() => {}))
  vi.stubGlobal('api', { ai: { call } })
  router.pathname = '/project'
  router.query = { id: 'p1' }
  const input = openSearch()
  fireEvent.change(input, { target: { value: 'Ajoute des tâches de test' } })
  expect(call).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Générer la proposition' }))
  expect(call).toHaveBeenCalledOnce()
  expect(call.mock.calls[0][0]).toContain('Choix utilisateur : p1')
  expect(call.mock.calls[0][0]).toContain('Demande utilisateur : Ajoute des tâches de test')
  expect(screen.getByRole('region', { name: 'Créer ou modifier avec l’IA' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Créer ou modifier avec l’IA' })).toBeNull()
  expect(input).toBeDisabled()
})
