import React from 'react'
import { afterEach, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { ButtonHints } from '../renderer/components/ButtonHints'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('décrit le bouton après 2,2 secondes et masque l’infobulle en sortant', () => {
  vi.useFakeTimers()
  render(<><ButtonHints /><button title="Épingler cet onglet" aria-label="Épingler">◆</button></>)
  const button = screen.getByRole('button', { name: 'Épingler' })
  fireEvent.mouseOver(button)
  act(() => { vi.advanceTimersByTime(2100) })
  expect(screen.queryByRole('tooltip')).toBeNull()
  act(() => { vi.advanceTimersByTime(100) })
  expect(screen.getByRole('tooltip').textContent).toBe('Épingler cet onglet')
  expect(button.getAttribute('aria-describedby')).toBeTruthy()
  fireEvent.mouseOut(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(button.getAttribute('title')).toBe('Épingler cet onglet')
  expect(button.hasAttribute('aria-describedby')).toBe(false)
})

it('affiche aussi la description au focus clavier et se ferme avec Échap', () => {
  vi.useFakeTimers()
  render(<><ButtonHints /><button aria-label="Fermer le projet">×</button></>)
  fireEvent.focusIn(screen.getByRole('button'))
  act(() => { vi.advanceTimersByTime(2200) })
  expect(screen.getByRole('tooltip').textContent).toBe('Fermer le projet')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('annule le délai si le curseur quitte le bouton avant l’affichage', () => {
  vi.useFakeTimers()
  render(<><ButtonHints /><button title="Supprimer la note">Supprimer</button></>)
  const button = screen.getByRole('button')
  fireEvent.mouseOver(button)
  act(() => { vi.advanceTimersByTime(1000) })
  fireEvent.mouseOut(button)
  act(() => { vi.advanceTimersByTime(2200) })
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(button).toHaveAttribute('title', 'Supprimer la note')
})

it('garde l’infobulle lors du passage sur une icône et restaure la description existante', () => {
  vi.useFakeTimers()
  render(<><ButtonHints /><p id="help">Description existante</p><button aria-label="Fermer" aria-describedby="help"><span>×</span></button></>)
  const button = screen.getByRole('button')
  fireEvent.mouseOver(button)
  act(() => { vi.advanceTimersByTime(2200) })
  const tooltip = screen.getByRole('tooltip')
  expect(button.getAttribute('aria-describedby')?.split(' ')).toEqual(['help', tooltip.id])
  fireEvent.mouseOut(button, { relatedTarget: screen.getByText('×') })
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  fireEvent.pointerDown(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(button).toHaveAttribute('aria-describedby', 'help')
})

it('affiche l’aide ronde après 900 ms sans changer le délai des autres boutons', () => {
  vi.useFakeTimers()
  render(<><ButtonHints /><button className="help-button" data-hint-delay="900" title="Glisser pour déplacer" aria-label="Aide">?</button></>)
  fireEvent.mouseOver(screen.getByRole('button', { name: 'Aide' }))
  act(() => { vi.advanceTimersByTime(899) }); expect(screen.queryByRole('tooltip')).toBeNull()
  act(() => { vi.advanceTimersByTime(1) }); expect(screen.getByRole('tooltip')).toHaveTextContent('Glisser pour déplacer')
})
