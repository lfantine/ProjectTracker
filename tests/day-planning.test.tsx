import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { DayPlanning } from '../renderer/components/DayPlanning'
import type { WeekSlot } from '../renderer/lib/weekSchedule'
const now = new Date(2026, 9, 12, 10, 30)
const slots: WeekSlot[] = [
  { id: 'later', title: 'Sport', day: 0, start: '18:00', end: '19:00' },
  { id: 'running', title: 'Travail', day: 0, start: '10:00', end: '12:00', projectId: 'p1', location: 'Bureau', description: 'Préparer la livraison' },
  { id: 'other-day', title: 'Demain', day: 1, start: '09:00', end: '10:00' },
  { id: 'past', title: 'Lecture', day: 0, start: '08:00', end: '09:00' },
]
it('Dashboard : affiche uniquement les objectifs du jour dans l’ordre et leur état', async () => {
  const onOpenAgenda = vi.fn(), onOpenProject = vi.fn()
  render(<DayPlanning slots={slots} now={now} projects={[{ id: 'p1', name: 'Tracker' }]} onOpenAgenda={onOpenAgenda} onOpenProject={onOpenProject} />)
  const entries = screen.getAllByRole('listitem')
  expect(entries).toHaveLength(3)
  expect(within(entries[0]).getByText('Lecture')).toBeInTheDocument()
  expect(within(entries[0]).getByText('Passé')).toBeInTheDocument()
  expect(within(entries[1]).getByText('Travail')).toBeInTheDocument()
  expect(within(entries[1]).getByText('En cours')).toBeInTheDocument()
  expect(within(entries[2]).getByText('À venir')).toBeInTheDocument()
  expect(screen.queryByText('Demain')).not.toBeInTheDocument()
  expect(screen.getByText('Bureau')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Tracker →' }))
  expect(onOpenProject).toHaveBeenCalledWith('p1')
  await userEvent.click(screen.getByRole('button', { name: 'Agenda →' }))
  expect(onOpenAgenda).toHaveBeenCalledOnce()
})
it('Dashboard : masque la colonne les jours sans objectif', () => {
  const { rerender } = render(<DayPlanning slots={slots} now={new Date(2026, 9, 18, 10)} projects={[]} onOpenAgenda={() => {}} onOpenProject={() => {}} />)
  expect(screen.queryByRole('complementary', { name: 'Planning du jour' })).not.toBeInTheDocument()
  rerender(<DayPlanning slots={slots} now={null} projects={[]} onOpenAgenda={() => {}} onOpenProject={() => {}} />)
  expect(screen.queryByText('Planning du jour')).not.toBeInTheDocument()
})

it('Dashboard : place le repère dans le créneau actuel puis dans les intervalles libres', () => {
  const props = { slots, projects: [], onOpenAgenda: () => {}, onOpenProject: () => {} }
  const view = render(<DayPlanning {...props} now={now} />)
  const running = screen.getByRole('button', { name: 'Travail' }).closest('li')!
  expect(within(running).getByRole('img', { name: 'Heure actuelle : 10:30' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  expect(screen.getByText('90 min restantes')).toBeInTheDocument()
  view.rerender(<DayPlanning {...props} now={new Date(2026, 9, 12, 15, 0)} />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  const marker = screen.getByRole('img', { name: 'Heure actuelle : 15:00' })
  expect(marker.compareDocumentPosition(screen.getByRole('button', { name: 'Sport' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(marker.compareDocumentPosition(screen.getByRole('button', { name: 'Travail' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  view.rerender(<DayPlanning {...props} now={new Date(2026, 9, 12, 7, 0)} />)
  expect(screen.getByRole('img', { name: 'Heure actuelle : 07:00' }).compareDocumentPosition(screen.getByRole('button', { name: 'Lecture' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  view.rerender(<DayPlanning {...props} now={new Date(2026, 9, 12, 20, 0)} />)
  expect(screen.getByRole('img', { name: 'Heure actuelle : 20:00' }).compareDocumentPosition(screen.getByRole('button', { name: 'Sport' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
})
