import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateWithAiModal } from '../renderer/components/CreateWithAiModal'

const { applyBatch, router, close } = vi.hoisted(() => ({ applyBatch: vi.fn(), router: { push: vi.fn() }, close: vi.fn() }))
vi.mock('next/router', () => ({ useRouter: () => router }))
vi.mock('../renderer/lib/store', async (original) => ({ ...await original<typeof import('../renderer/lib/store')>(), useData: () => ({ data: { projects: [], notes: [], errors: [], folders: [], categories: ['Software'] }, applyBatch }) }))

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', { configurable: true, value: { ai: { call: vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ needsClarification: false, action: 'create', type: 'note', title: 'Synthèse', description: 'Créer une note de synthèse.' }))
    .mockResolvedValueOnce(JSON.stringify({ type: 'note', title: 'Synthèse', content: 'Texte de validation', tags: [], raw: true })) } } })
})

async function proposal() {
  render(<CreateWithAiModal open onClose={close} initialPrompt="Crée une note de synthèse" />)
  fireEvent.click(screen.getByRole('button', { name: 'Générer la proposition' }))
  await screen.findByRole('button', { name: 'Approuver la création' })
}

describe('validation des propositions IA', () => {
  it('attend le commit de toutes les étapes avant de fermer et de naviguer', async () => {
    let finish!: (value: unknown) => void
    applyBatch.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    await proposal()
    fireEvent.click(screen.getByRole('button', { name: 'Approuver la création' }))
    await waitFor(() => expect(applyBatch).toHaveBeenCalledOnce())
    expect(close).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    expect(applyBatch.mock.calls[0][0].map((step: { name: string }) => step.name)).toEqual(['notes.create', 'notes.update'])
    await act(async () => { finish([{ id: 'n_confirmed' }, { id: 'n_confirmed', raw: true }]) })
    expect(close).toHaveBeenCalledOnce()
    expect(router.push).toHaveBeenCalledWith('/notes/detail?id=n_confirmed')
  })

  it('garde la proposition après un échec et réutilise son identifiant pour la reprise', async () => {
    applyBatch.mockResolvedValueOnce(null).mockResolvedValueOnce([{ id: 'n_retry' }, { id: 'n_retry' }])
    await proposal()
    fireEvent.click(screen.getByRole('button', { name: 'Approuver la création' }))
    await screen.findByText('L’enregistrement a échoué. Aucune modification de la proposition n’a été appliquée.')
    expect(close).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approuver la création' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/notes/detail?id=n_retry'))
    expect(applyBatch.mock.calls[0][1]).toBe(applyBatch.mock.calls[1][1])
  })
})
