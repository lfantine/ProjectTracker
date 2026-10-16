import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDraft } from '../renderer/lib/useDraft'

function Field({ id = 'a', value = '', revision, commit }: { id?: string; value?: string; revision?: number; commit: (value: string, expectedRevision?: number) => Promise<boolean> }) {
  const draft = useDraft(value, commit, { resetKey: id, delay: 60_000, revision })
  return <><input aria-label="Texte" value={draft.value} onChange={(event) => draft.change(event.target.value)} /><button onClick={() => void draft.flush()}>Enregistrer</button><output>{draft.state}</output></>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => { resolve = finish })
  return { promise, resolve }
}

const type = (value: string) => fireEvent.change(screen.getByRole('textbox'), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

describe('brouillons et écritures asynchrones', () => {
  it('garde la révision du début de saisie si une autre vue modifie la valeur', async () => {
    const commit = vi.fn().mockResolvedValue(false)
    const view = render(<Field value="Original" revision={4} commit={commit} />)
    type('Local')
    view.rerender(<Field value="Autre vue" revision={5} commit={commit} />)
    save()
    await waitFor(() => expect(commit).toHaveBeenCalledWith('Local', 4))
    expect(screen.getByRole('textbox')).toHaveValue('Local')
  })

  it('avance sa révision après son propre commit pour enregistrer la suite de la saisie', async () => {
    const first = deferred<boolean>()
    const commit = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true)
    render(<Field value="" revision={4} commit={commit} />)
    type('A'); save(); type('AB')
    await act(async () => { first.resolve(true) })
    expect(commit.mock.calls).toEqual([['A', 4], ['AB', 5]])
  })

  it('conserve le texte après une erreur, puis permet une nouvelle tentative', async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error('disque indisponible')).mockResolvedValue(true)
    render(<Field commit={commit} />)
    type('Texte à conserver'); save()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('error'))
    expect(screen.getByRole('textbox')).toHaveValue('Texte à conserver')
    save()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('idle'))
    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('enregistre les caractères saisis pendant une requête, y compris au démontage', async () => {
    const first = deferred<boolean>()
    const commit = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true)
    const view = render(<Field commit={commit} />)
    type('A'); save(); type('AB')
    view.unmount()
    await act(async () => { first.resolve(true) })
    expect(commit.mock.calls.map(([value]) => value)).toEqual(['A', 'AB'])
  })

  it('une ancienne écriture ne modifie pas le brouillon d’une autre entité', async () => {
    const old = deferred<boolean>()
    const commitA = vi.fn(() => old.promise)
    const commitB = vi.fn().mockResolvedValue(true)
    const view = render(<Field id="a" commit={commitA} />)
    type('Ancienne'); save()
    view.rerender(<Field id="b" value="B" commit={commitB} />)
    type('Nouvelle')
    await act(async () => { old.resolve(true) })
    expect(screen.getByRole('textbox')).toHaveValue('Nouvelle')
    save()
    await waitFor(() => expect(commitB).toHaveBeenCalledWith('Nouvelle', undefined))
    expect(commitA).toHaveBeenCalledTimes(1)
  })

  it('ne remplace pas une saisie locale par un changement confirmé ailleurs', () => {
    const commit = vi.fn().mockResolvedValue(false)
    const view = render(<Field value="Original" commit={commit} />)
    type('Local')
    view.rerender(<Field value="Autre fenêtre" commit={commit} />)
    expect(screen.getByRole('textbox')).toHaveValue('Local')
  })
})
