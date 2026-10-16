import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { TestPanel } from '../renderer/components/TestPanel'
it('Interface : lance les vérifications et affiche le résultat', async () => {
  render(<TestPanel />)
  await userEvent.click(screen.getByRole('button', { name: 'Lancer les tests' }))
  expect(screen.getByText('6 / 6 tests réussis')).toBeInTheDocument()
  expect(screen.getByText('Un nouveau projet remplace l’onglet temporaire')).toBeInTheDocument()
  expect(screen.getByText('La navigation conserve les épingles')).toBeInTheDocument()
})
