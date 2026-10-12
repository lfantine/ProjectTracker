import { closeProjectTab, openProjectTab } from './projectTabs'
import { slotError } from './weekSchedule'
export interface CheckResult { name: string; category: string; passed: boolean; detail: string }
export function runSimpleChecks(): CheckResult[] {
  const checks = [
    { name: 'Un onglet ne peut pas être ouvert deux fois', category: 'Logique', run: () => openProjectTab(openProjectTab([], 'test'), 'test').length === 1 },
    { name: 'Un onglet épinglé reste ouvert', category: 'Logique', run: () => closeProjectTab([{ projectId: 'test', pinned: true }], 'test').length === 1 },
    { name: 'Un onglet libre peut être fermé', category: 'Logique', run: () => closeProjectTab([{ projectId: 'test', pinned: false }], 'test').length === 0 },
    { name: 'Un horaire inversé est refusé', category: 'Agenda', run: () => !!slotError({ title: 'Test', day: 0, start: '10:00', end: '09:00' }, []) },
  ]
  return checks.map((check) => {
    try { const passed = check.run(); return { name: check.name, category: check.category, passed, detail: passed ? 'Comportement attendu vérifié.' : 'Le résultat ne correspond pas au comportement attendu.' } }
    catch (error) { return { name: check.name, category: check.category, passed: false, detail: error instanceof Error ? error.message : String(error) } }
  })
}
