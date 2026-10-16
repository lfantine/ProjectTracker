import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DropTrash, isOverTrash } from '../renderer/components/DropTrash'
it('shows trash only during a gesture and routes an explicit drop', () => {
  const drop = vi.fn(), ui = render(<DropTrash active={false} onDrop={drop} />)
  expect(screen.queryByRole('region')).toBeNull()
  ui.rerender(<DropTrash active onDrop={drop} />)
  fireEvent.drop(screen.getByRole('region', { name: 'Zone de suppression' }))
  expect(drop).toHaveBeenCalledOnce()
  ui.rerender(<DropTrash active={false} />)
  expect(screen.queryByRole('region')).toBeNull()
})
it('accepts a pointer only within the actual trash rectangle', () => {
  const zone = document.createElement('div')
  zone.getBoundingClientRect = () => ({ left: 20, right: 120, top: 30, bottom: 70 } as DOMRect)
  expect(isOverTrash(new MouseEvent('mouseup', { clientX: 50, clientY: 50 }), zone)).toBe(true)
  expect(isOverTrash(new MouseEvent('mouseup', { clientX: 15, clientY: 50 }), zone)).toBe(false)
  expect(isOverTrash(new MouseEvent('mouseup'), null)).toBe(false)
})
