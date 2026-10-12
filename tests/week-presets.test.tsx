import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { normalizeAppData } from '../renderer/lib/types'
import { createWeekPreset, renameWeekPreset, selectWeekPreset, updateActiveWeek } from '../renderer/lib/weekPresets'
import { WeekPresetPicker } from '../renderer/components/WeekPresetPicker'
const slot = { id: 'a', title: 'Lecture', day: 0, start: '09:00', end: '10:00', people: ['Alice'], color: '#336699' }
it('Presets : migre la semaine existante et retrouve le preset actif après sauvegarde', () => {
  const initial = normalizeAppData({ weekSlots: [slot], wakeTimes: ['08:00'] })
  expect(initial.weekPresets?.[0]).toMatchObject({ name: 'Ma semaine', slots: [slot] })
  let data = createWeekPreset(initial, 'holiday', 'Vacances', false)
  expect(data.weekSlots).toEqual([])
  data = updateActiveWeek(data, { wakeTimes: Array(7).fill('09:00') })
  data = selectWeekPreset(data, 'week-default')
  expect(data.weekSlots).toEqual([slot]); expect(data.wakeTimes?.[0]).toBe('08:00')
  data = normalizeAppData(JSON.parse(JSON.stringify(selectWeekPreset(data, 'holiday'))))
  expect(data.activeWeekPresetId).toBe('holiday'); expect(data.wakeTimes).toEqual(Array(7).fill('09:00'))
  expect(data.weekSlots).toEqual([])
})
it('Presets : duplique les détails sans partager les données et garde les modifications séparées', () => {
  const initial = normalizeAppData({ weekSlots: [slot], wakeTimes: ['08:00'] })
  let data = createWeekPreset(initial, 'copy', 'Travail', true)
  expect(data.weekSlots).toEqual([slot]); expect(data.weekSlots?.[0].people).not.toBe(initial.weekSlots?.[0].people)
  data = updateActiveWeek(data, { slots: [{ ...slot, title: 'Sport', start: '10:00', end: '11:00' }] })
  expect(selectWeekPreset(data, 'week-default').weekSlots?.[0].title).toBe('Lecture')
  expect(selectWeekPreset(data, 'copy').weekSlots?.[0].title).toBe('Sport')
  expect(createWeekPreset(data, 'duplicate-name', ' travail ', false)).toBe(data)
  expect(selectWeekPreset(data, 'missing')).toBe(data)
  expect(renameWeekPreset(data, 'Ma semaine')).toBe(data)
  expect(renameWeekPreset(data, 'Bureau').weekPresets?.find((p) => p.id === 'copy')?.name).toBe('Bureau')
})
function Picker() {
  const [data, setData] = useState(() => normalizeAppData({ weekSlots: [slot] }))
  return <><WeekPresetPicker presets={data.weekPresets || []} activeId={data.activeWeekPresetId} onSelect={(id) => setData((s) => selectWeekPreset(s, id))} onCreate={(name, copy) => setData((s) => createWeekPreset(s, `preset-${s.weekPresets?.length}`, name, copy))} onRename={(name) => setData((s) => renameWeekPreset(s, name))} /><p>Créneaux : {data.weekSlots?.length}</p></>
}
it('Presets : crée, sélectionne, duplique et renomme depuis le dropdown', async () => {
  const user = userEvent.setup(); render(<Picker />)
  await user.click(screen.getByRole('button', { name: 'Gérer les semaines types' }))
  await user.click(screen.getByRole('menuitem', { name: 'Nouvelle semaine' }))
  await user.type(screen.getByLabelText('Nom de la semaine'), 'Vacances')
  await user.click(screen.getByRole('button', { name: 'Créer' }))
  expect(screen.getByText('Créneaux : 0')).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Semaine active'), 'week-default')
  expect(screen.getByText('Créneaux : 1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Gérer les semaines types' }))
  await user.click(screen.getByRole('menuitem', { name: 'Dupliquer' }))
  await user.type(screen.getByLabelText('Nom de la semaine'), 'Vacances')
  await user.click(screen.getByRole('button', { name: 'Créer' }))
  expect(screen.getByRole('alert')).toHaveTextContent('déjà utilisé')
  await user.clear(screen.getByLabelText('Nom de la semaine')); await user.type(screen.getByLabelText('Nom de la semaine'), 'Bureau')
  await user.click(screen.getByRole('button', { name: 'Créer' }))
  expect(screen.getByText('Créneaux : 1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Gérer les semaines types' }))
  await user.click(screen.getByRole('menuitem', { name: 'Renommer' }))
  await user.clear(screen.getByLabelText('Nom de la semaine')); await user.type(screen.getByLabelText('Nom de la semaine'), 'Travail')
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
  expect(screen.getByRole('option', { name: 'Travail' })).toBeInTheDocument()
})

it('Presets : masque les commandes et ferme le menu avec Échap ou un clic extérieur', async () => {
  const user = userEvent.setup(); render(<Picker />)
  const trigger = screen.getByRole('button', { name: 'Gérer les semaines types' })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('menuitem', { name: 'Nouvelle semaine' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Dupliquer' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  await user.click(screen.getByText('Créneaux : 1'))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
