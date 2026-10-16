import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditableModuleTitle } from '../renderer/components/EditableModuleTitle'
import { TablePresetPicker } from '../renderer/components/TablePresetPicker'
import { createTableModule } from '../renderer/lib/tables'

function Title() {
  const [title, setTitle] = useState('Candidatures')
  return <EditableModuleTitle title={title} onChange={setTitle} />
}
describe('module customization', () => {
  it('edits on click, commits on Enter or blur and cancels on Escape', () => {
    render(<Title />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Candidatures'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Recherche emploi' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    fireEvent.click(screen.getByText('Recherche emploi'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Annuler' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    fireEvent.click(screen.getByText('Recherche emploi'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Emploi' } })
    fireEvent.blur(screen.getByRole('textbox'))
    expect(screen.getByText('Emploi')).toBeInTheDocument()
  })
  it('requires a preset choice and creates independent blank and application tables', () => {
    const select = vi.fn()
    render(<TablePresetPicker onSelect={select} />)
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Partir de zéro'))
    expect(select).toHaveBeenCalledWith('blank')
    expect(createTableModule('a', 'blank').table?.columns).toHaveLength(1)
    expect(createTableModule('b', 'applications').table?.columns).toHaveLength(6)
    expect(createTableModule('a', 'blank').customize_title).toBe(true)
  })
})
