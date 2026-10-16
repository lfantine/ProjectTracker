import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskTree } from '../renderer/components/TaskTree'
import { TaskKanban } from '../renderer/components/TaskKanban'
import type { TaskNode } from '../renderer/lib/types'

const tasks: TaskNode[] = [{ id: 'parent', name: 'Parent', content: '', status: 'a_faire', children: [
  { id: 'child', name: 'Enfant', content: '', status: 'en_cours', children: [] },
] }]

describe('Repli des sous-tâches', () => {
  for (const view of ['liste', 'kanban']) {
    it(`déplie les ancêtres d’une sous-tâche imbriquée en cours en ${view}`, () => {
      const nested: TaskNode[] = [{ ...tasks[0], children: [{ ...tasks[0].children[0], status: 'a_faire', children: [
        { id: 'nested', name: 'Petite sous-tâche', content: '', status: 'en_cours', children: [] },
      ] }] }]
      render(view === 'liste'
        ? <TaskTree tasks={nested} onAddTop={vi.fn()} onAddSub={vi.fn()} onCycleStatus={vi.fn()} onRemove={vi.fn()} />
        : <TaskKanban tasks={nested} visibleStatuses={['a_faire', 'en_cours']} onSetStatus={vi.fn()} />)
      expect(screen.getByText('Petite sous-tâche')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Replier Parent' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'Replier Enfant' })).toHaveAttribute('aria-expanded', 'true')
    })
    it(`réagit au statut et conserve le choix manuel en ${view}`, () => {
      const inactive: TaskNode[] = [{ ...tasks[0], children: [{ ...tasks[0].children[0], status: 'fait' }] }]
      const viewFor = (nodes: TaskNode[]) => view === 'liste'
        ? <TaskTree tasks={nodes} onAddTop={vi.fn()} onAddSub={vi.fn()} onCycleStatus={vi.fn()} onRemove={vi.fn()} />
        : <TaskKanban tasks={nodes} visibleStatuses={['a_faire', 'en_cours', 'fait']} onSetStatus={vi.fn()} />
      const { rerender } = render(viewFor(inactive))
      expect(screen.queryByText('Enfant')).toBeNull()
      rerender(viewFor(tasks))
      expect(screen.getByText('Enfant')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Replier Parent' }))
      rerender(viewFor(inactive))
      rerender(viewFor(tasks))
      expect(screen.queryByText('Enfant')).toBeNull()
      expect(screen.getByRole('button', { name: 'Déplier Parent' })).toHaveAttribute('aria-expanded', 'false')
    })
    it(`replie par défaut les sous-tâches inactives en ${view}`, () => {
      const inactive: TaskNode[] = [{ ...tasks[0], children: [{ ...tasks[0].children[0], status: 'a_faire' }] }]
      render(view === 'liste'
        ? <TaskTree tasks={inactive} onAddTop={vi.fn()} onAddSub={vi.fn()} onCycleStatus={vi.fn()} onRemove={vi.fn()} />
        : <TaskKanban tasks={inactive} visibleStatuses={['a_faire', 'en_cours']} onSetStatus={vi.fn()} />)
      expect(screen.queryByText('Enfant')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Déplier Parent' }))
      expect(screen.getByText('Enfant')).toBeTruthy()
    })
    it(`replie et déplie en ${view} sans ouvrir le détail`, () => {
      const open = vi.fn()
      render(view === 'liste'
        ? <TaskTree tasks={tasks} onAddTop={vi.fn()} onAddSub={vi.fn()} onCycleStatus={vi.fn()} onRemove={vi.fn()} onOpenDetail={open} />
        : <TaskKanban tasks={tasks} visibleStatuses={['a_faire', 'en_cours']} onSetStatus={vi.fn()} onOpenDetail={open} />)
      fireEvent.click(screen.getByRole('button', { name: 'Replier Parent' }))
      expect(screen.queryByText('Enfant')).toBeNull()
      expect(screen.getByRole('button', { name: 'Déplier Parent' }).getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(screen.getByRole('button', { name: 'Déplier Parent' }))
      expect(screen.getByText('Enfant')).toBeTruthy()
      expect(open).not.toHaveBeenCalled()
    })
  }
})
