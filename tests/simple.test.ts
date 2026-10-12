import { describe, expect, it } from 'vitest'
import { closeProjectTab, openProjectTab, readProjectTabSession } from '../renderer/lib/projectTabs'
import { syncTaskStatuses } from '../renderer/lib/taskStatus'
import { normalizeAppData } from '../renderer/lib/types'
import { normalizeWeekSlots, slotError } from '../renderer/lib/weekSchedule'
describe('Logique : onglets', () => {
  it('ouvre sans dupliquer', () => { const tabs = openProjectTab([], 'a'); expect(openProjectTab(tabs, 'a')).toBe(tabs) })
  it('conserve un onglet épinglé lors de la fermeture', () => { expect(closeProjectTab([{ projectId: 'a', pinned: true }], 'a')).toHaveLength(1); expect(closeProjectTab([{ projectId: 'a', pinned: false }], 'a')).toHaveLength(0) })
  it('retire les projets inexistants et doublons', () => { expect(readProjectTabSession({ tabs: [{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }] }, ['a']).tabs).toEqual([{ projectId: 'a', pinned: false }]) })
})
describe('Logique : tâches', () => {
  it('termine le parent lorsque ses enfants sont terminés sans modifier la source', () => {
    const child = { id: 'b', name: 'B', content: '', status: 'fait' as const, children: [] }
    const task = { ...child, id: 'a', status: 'a_faire' as const, children: [child] }
    expect(syncTaskStatuses([task])[0].status).toBe('fait'); expect(task.status).toBe('a_faire')
  })
})
describe('Données : semaine type', () => {
  const slot = { id: 'a', title: 'Lecture', day: 0, start: '09:00', end: '10:00' }
  it('charge les anciennes données avec un agenda vide', () => expect(normalizeAppData({}).weekSlots).toEqual([]))
  it('conserve les créneaux après sérialisation', () => expect(normalizeAppData(JSON.parse(JSON.stringify({ weekSlots: [slot] }))).weekSlots).toEqual([slot]))
  it('conserve les détails optionnels après sauvegarde et relecture', () => {
    const detailed = { ...slot, color: '#123abc', description: 'Préparation', projectId: 'p1', location: 'Paris', people: ['Alice', 'Bob'], link: 'https://example.com' }
    expect(normalizeAppData(JSON.parse(JSON.stringify({ weekSlots: [detailed] }))).weekSlots).toEqual([detailed])
  })
  it('rejette les heures invalides et chevauchements, accepte les créneaux adjacents', () => {
    expect(slotError({ ...slot, end: '08:00' }, [])).toBeTruthy()
    expect(slotError({ ...slot, start: '09:30' }, [slot])).toBeTruthy()
    expect(slotError({ ...slot, start: '10:00', end: '11:00' }, [slot])).toBeUndefined()
    expect(normalizeWeekSlots([{ ...slot, start: '25:00' }])).toEqual([])
  })
})
it('Données : initialise et sauvegarde les heures de réveil sans perdre le planning', () => {
  expect(normalizeAppData({}).wakeTimes).toEqual(Array(7).fill('07:00'))
  const saved = normalizeAppData(JSON.parse(JSON.stringify({ wakeTimes: ['08:00', '09:15', 'incorrect'] })))
  expect(saved.wakeTimes).toEqual(['08:00', '09:15', '07:00', '07:00', '07:00', '07:00', '07:00'])
})
