import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TableModule } from '../renderer/components/TableModule'
import { createApplicationTable, safeTableUrl } from '../renderer/lib/tables'
import type { ProjectModule } from '../renderer/lib/types'

function Harness() {
  const [module, setModule] = useState<ProjectModule>({ id: 'table', type: 'table', title: 'Candidatures', table: createApplicationTable() })
  return <TableModule module={module} onChange={(patch) => setModule((prev) => ({ ...prev, ...patch }))} />
}

describe('table module', () => {
  it('edits applications, filters them and keeps status history and notes', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Ajouter une ligne'))
    fireEvent.change(screen.getByLabelText('Entreprise — ligne 1'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Statut — ligne 1'), { target: { value: 'Entretien' } })
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: 'Envoyée' } })
    expect(screen.queryByDisplayValue('Acme')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filtrer par statut'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Détails', exact: true }))
    expect(screen.getByText(/Statut : Entretien/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Préparer entretien' } })
    fireEvent.click(screen.getByLabelText('Fermer'))
    fireEvent.click(screen.getByRole('button', { name: 'Détails', exact: true }))
    expect(screen.getByLabelText('Notes')).toHaveValue('Préparer entretien')
  })

  it('adds custom columns and edits the same data in expanded view', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Colonnes'))
    fireEvent.change(screen.getByLabelText('Nouvelle colonne'), { target: { value: 'Salaire' } })
    fireEvent.click(screen.getByText('Ajouter la colonne'))
    fireEvent.click(screen.getByText('Pleine largeur'))
    fireEvent.click(screen.getByText('Ajouter une ligne'))
    fireEvent.change(screen.getByLabelText('Salaire — ligne 1'), { target: { value: '45000' } })
    fireEvent.click(screen.getByLabelText('Fermer'))
    expect(screen.getByLabelText('Salaire — ligne 1')).toHaveValue('45000')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Détails', exact: true }))
    fireEvent.click(screen.getByText('Supprimer la ligne'))
    expect(screen.queryByDisplayValue('45000')).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('allows web links and rejects executable schemes', () => {
    expect(safeTableUrl('example.com/jobs')).toBe('https://example.com/jobs')
    expect(safeTableUrl('https://example.com')).toBe('https://example.com/')
    expect(safeTableUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeTableUrl('file:///tmp/a')).toBeUndefined()
    expect(safeTableUrl('')).toBeUndefined()
  })
})
