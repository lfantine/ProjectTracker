import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ProjectTabs } from '../renderer/components/ProjectTabs'

const { router, projects, store } = vi.hoisted(() => ({
  store: { preferences: { pinnedTabs: [] as { projectId: string; pinned: boolean }[], activeTabId: null as string | null }, listeners: new Set<() => void>(), update: vi.fn() },
  router: { pathname: '/project', query: { id: 'a' } as Record<string, string>, isReady: true, push: vi.fn(), replace: vi.fn() },
  projects: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }],
}))
vi.mock('next/router', () => ({ useRouter: () => router }))
vi.mock('../renderer/lib/store', () => ({ useData: () => {
  const preferences = React.useSyncExternalStore((listener) => { store.listeners.add(listener); return () => { store.listeners.delete(listener) } }, () => store.preferences)
  return { data: { projects }, loading: false, preferences, updatePreferences: store.update }
} }))
const storageKey = 'tracker_project_tabs_v1'

beforeEach(() => {
  localStorage.clear()
  store.preferences = { pinnedTabs: [], activeTabId: null }
  store.update.mockImplementation(async (patch) => {
    store.preferences = { ...store.preferences, ...patch }
    store.listeners.forEach((listener) => listener())
    return true
  })
  router.pathname = '/project'
  router.query = { id: 'a' }
  vi.clearAllMocks()
})

describe('Interface : onglets de projet', () => {
  it('attend la confirmation et garde un onglet temporaire si l’écriture échoue', async () => {
    let finish!: (ok: boolean) => void
    store.update.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve }))
    render(<ProjectTabs />)
    fireEvent.click(screen.getByRole('button', { name: 'Épingler Alpha' }))
    expect(screen.getByRole('button', { name: 'Épingler Alpha' })).toHaveAttribute('aria-pressed', 'false')
    await act(async () => { finish(false) })
    expect(screen.getByRole('button', { name: 'Fermer Alpha' })).toBeInTheDocument()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('remplace le projet temporaire et ne le sauvegarde pas', () => {
    const { rerender } = render(<ProjectTabs />)
    expect(screen.getByRole('button', { name: 'Fermer Alpha' })).toBeInTheDocument()
    router.query = { id: 'b' }
    rerender(<ProjectTabs />)
    expect(screen.queryByRole('button', { name: /Ouvrir Alpha/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Ouvrir Beta/ })).toHaveAttribute('aria-current', 'page')
    expect(store.preferences.pinnedTabs).toEqual([])
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('conserve les projets épinglés et ferme le projet désépinglé à la navigation', () => {
    const { rerender } = render(<ProjectTabs />)
    fireEvent.click(screen.getByRole('button', { name: 'Épingler Alpha' }))
    expect(screen.getByRole('button', { name: 'Désépingler Alpha' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Fermer Alpha' })).toBeNull()
    router.query = { id: 'b' }
    rerender(<ProjectTabs />)
    expect(screen.getByRole('button', { name: /Ouvrir Alpha/ })).not.toHaveAttribute('aria-current')
    expect(store.preferences.pinnedTabs).toEqual([{ projectId: 'a', pinned: true }])
    expect(localStorage.getItem(storageKey)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Désépingler Alpha' }))
    expect(screen.queryByRole('button', { name: /Ouvrir Alpha/ })).toBeNull()
    router.pathname = '/projects'
    router.query = {}
    rerender(<ProjectTabs />)
    expect(screen.queryByRole('navigation', { name: 'Projets ouverts' })).toBeNull()
  })

  it('ne vide pas la cible active pendant la navigation de restauration', () => {
    store.preferences = { pinnedTabs: [{ projectId: 'b', pinned: true }], activeTabId: 'b' }
    router.pathname = '/home'
    router.query = {}
    const view = render(<ProjectTabs />)
    expect(router.replace).toHaveBeenCalledWith('/project?id=b')
    expect(store.update).not.toHaveBeenCalled()
    router.pathname = '/project'
    router.query = { id: 'b' }
    view.rerender(<ProjectTabs />)
    expect(store.preferences.activeTabId).toBe('b')
  })

  it('restaure uniquement les épingles des anciennes sessions', () => {
    store.preferences = { pinnedTabs: [{ projectId: 'a', pinned: true }, { projectId: 'b', pinned: false }], activeTabId: 'b' }
    router.pathname = '/home'
    router.query = {}
    render(<ProjectTabs />)
    expect(screen.getByRole('button', { name: 'Désépingler Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ouvrir Beta/ })).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('ferme le projet courant vers le projet épinglé et respecte les raccourcis', () => {
    store.preferences = { pinnedTabs: [{ projectId: 'b', pinned: true }], activeTabId: null }
    render(<ProjectTabs />)
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    expect(router.push).toHaveBeenLastCalledWith('/project?id=b')
    fireEvent.click(screen.getByRole('button', { name: 'Fermer Alpha' }))
    expect(router.push).toHaveBeenLastCalledWith('/project?id=b')
    expect(screen.queryByRole('button', { name: /Ouvrir Alpha/ })).toBeNull()
  })
})
