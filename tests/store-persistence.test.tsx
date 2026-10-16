import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider, useData } from '../renderer/lib/store'
import { ToastProvider } from '../renderer/components/Toast'
import { emptyAppData } from '../renderer/lib/types'
import { defaultPreferences, defaultSettings } from '../shared/models'
import type { AppSnapshot, DataChange } from '../shared/commands'

function snapshot(revision = 1): AppSnapshot {
  return { data: emptyAppData(), preferences: defaultPreferences(), settings: defaultSettings(), preferencesAdopted: true, revision }
}
const core = { status: vi.fn(), snapshot: vi.fn(), command: vi.fn(), retry: vi.fn(), onChanged: vi.fn() }
let changed: (event: { changes: DataChange[]; revision: number }) => void
function Probe() {
  const store = useData()
  return <><output data-testid="store">{JSON.stringify({ loading: store.loading, status: store.status, prefs: store.preferences, notes: store.data.notes, error: store.lastError })}</output><button onClick={() => void store.updatePreferences({ sidebarCollapsed: true })}>Réduire</button></>
}
const state = () => JSON.parse(screen.getByTestId('store').textContent!)
const mount = () => render(<ToastProvider><DataProvider><Probe /></DataProvider></ToastProvider>)

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  Object.defineProperty(window, 'api', { configurable: true, value: { core } })
  core.status.mockResolvedValue({ mode: 'ready', migratedThisLaunch: false, reportId: null })
  core.snapshot.mockResolvedValue({ ok: true, value: snapshot() })
  core.onChanged.mockImplementation((listener) => { changed = listener; return () => {} })
})

describe('cache confirmé et initialisation', () => {
  it('attend l’adoption avant de rendre les préférences utilisables', async () => {
    let finish!: (value: unknown) => void
    const initial = { ...snapshot(), preferencesAdopted: false }
    core.snapshot.mockResolvedValueOnce({ ok: true, value: initial }).mockResolvedValueOnce({ ok: true, value: { ...snapshot(2), preferences: { ...defaultPreferences(), themeMode: 'dark' } } })
    core.command.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    localStorage.setItem('tracker_theme_mode', 'dark')
    mount()
    await waitFor(() => expect(core.command).toHaveBeenCalledWith('preferences.adoptLegacy', expect.objectContaining({ values: expect.objectContaining({ tracker_theme_mode: 'dark' }) })))
    expect(state().loading).toBe(true)
    await act(async () => { finish({ ok: true, value: {}, changes: [], revision: 2 }) })
    await waitFor(() => expect(state().loading).toBe(false))
    expect(state().prefs.themeMode).toBe('dark')
    expect(localStorage.getItem('tracker_theme_mode')).toBe('dark')
  })

  it('rejoue un changement reçu pendant la lecture initiale', async () => {
    let finish!: (value: unknown) => void
    core.snapshot.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    mount()
    await waitFor(() => expect(core.snapshot).toHaveBeenCalled())
    const prefs = { ...defaultPreferences(), sidebarCollapsed: true }
    await act(async () => {
      changed({ changes: [{ entity: 'preferences', value: prefs }], revision: 2 })
      finish({ ok: true, value: snapshot(1) })
    })
    await waitFor(() => expect(state().loading).toBe(false))
    expect(state().prefs.sidebarCollapsed).toBe(true)
  })

  it('n’affiche pas une préférence comme enregistrée après un refus', async () => {
    core.command.mockResolvedValue({ ok: false, error: { code: 'STORAGE', message: 'Disque indisponible' } })
    mount()
    await waitFor(() => expect(state().loading).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Réduire' }))
    await waitFor(() => expect(state().error?.code).toBe('STORAGE'))
    expect(state().prefs.sidebarCollapsed).toBe(false)
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('termine le chargement en récupération si le pont natif échoue', async () => {
    core.status.mockRejectedValue(new Error('IPC indisponible'))
    mount()
    await waitFor(() => expect(state().loading).toBe(false))
    expect(state().status).toMatchObject({ mode: 'recovery', message: 'IPC indisponible' })
  })
})
