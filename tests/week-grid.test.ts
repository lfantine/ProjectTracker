import { afterEach, expect, it, vi } from 'vitest'
import { weekGrid } from '../packages/builtin-week/src/grid'
import { emptyWeek } from '../packages/builtin-week/src/model'
function setup() {
  const slot = { id: 's', title: 'Lecture', day: 0, start: '09:00', end: '10:00' }
  const actions = { gesture: vi.fn(), create: vi.fn(), edit: vi.fn(), remove: vi.fn(), copy: vi.fn(), destination: vi.fn(), wake: vi.fn() }
  const grid = weekGrid({ ...emptyWeek(), slots: [slot] }, actions, new Date(2026, 9, 19, 12, 30)); document.body.append(grid)
  return { slot, actions, grid, canvas: grid.querySelector<HTMLElement>('.week-canvas')! }
}
afterEach(() => { document.body.replaceChildren() })
it('renders seven local days, current time, wake markers and a readable coloured slot', () => {
  const { grid } = setup()
  expect(grid.querySelectorAll('.week-canvas')).toHaveLength(7)
  expect(grid.querySelectorAll('.week-wake')).toHaveLength(7)
  expect(grid.querySelector('.week-now')!.getAttribute('aria-label')).toContain('Lundi 12:30')
  const slot = grid.querySelector<HTMLElement>('.week-slot')!
  expect(slot.style.top).toBe('432px'); expect(slot.style.height).toBe('48px')
})
it('provides keyboard alternatives for creation, edition, copy and confirmed deletion', () => {
  const { canvas, grid, slot, actions } = setup()
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ day: 0, start: '09:00', end: '10:00' }))
  const node = grid.querySelector<HTMLElement>('.week-slot')!
  for (const options of [{ key: 'c', ctrlKey: true }, { key: ' ', }, { key: 'Delete' }]) node.dispatchEvent(new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true }))
  expect(actions.copy).toHaveBeenCalledWith(slot); expect(actions.edit).toHaveBeenCalledWith(slot); expect(actions.remove).toHaveBeenCalledWith(slot)
})
it('opens wake editing on keyboard activation and ignores modified canvas commands', () => {
  const { grid, canvas, actions } = setup()
  grid.querySelector<HTMLButtonElement>('.week-wake')!.click()
  expect(actions.wake).toHaveBeenCalledWith(0, '07:00')
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
  expect(actions.create).not.toHaveBeenCalled()
})
it('creates a bounded detached draft from pointer selection in either direction', () => {
  const { canvas, actions } = setup()
  const pointer = (name: string, y: number) => canvas.dispatchEvent(new MouseEvent(name, { button: 0, clientY: y, bubbles: true, cancelable: true }))
  pointer('pointerdown', 480); pointer('pointermove', 432); pointer('pointerup', 432)
  expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ day: 0, start: '09:00', end: '10:00' }))
  expect(actions.destination).toHaveBeenCalledWith(0, 600)
})
it('cancels pointer selection without creating or writing', () => {
  const { canvas, actions } = setup()
  canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 432, bubbles: true }))
  canvas.dispatchEvent(new Event('pointercancel'))
  canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientY: 480, bubbles: true }))
  expect(actions.create).not.toHaveBeenCalled()
})
it('moves a slot through an edit draft retaining identity, duration and metadata', () => {
  const { grid, actions, slot } = setup()
  const node = grid.querySelector<HTMLElement>('.week-slot')!
  const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
  const event = (name: string, y: number) => {
    const value = new MouseEvent(name, { clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(value, 'dataTransfer', { value: transfer }); return value
  }
  node.dispatchEvent(event('dragstart', 0))
  const target = grid.querySelectorAll('.week-canvas')[1]; target.dispatchEvent(event('dragover', 672)); target.dispatchEvent(event('drop', 672))
  expect(actions.edit).toHaveBeenCalledWith({ ...slot, day: 1, start: '14:00', end: '15:00' })
})
it('selects a tinted event and keeps selection separate from editing', () => {
  const { grid, actions } = setup()
  const node = grid.querySelector<HTMLButtonElement>('.week-slot')!
  expect(node.getAttribute('aria-pressed')).toBe('false')
  node.click()
  expect(node.getAttribute('aria-pressed')).toBe('true')
  expect(actions.edit).not.toHaveBeenCalled()
  expect(node.style.getPropertyValue('--slot-color')).not.toBe('')
  node.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
  expect(actions.edit).toHaveBeenCalledOnce()
})
it('commits a resized duration only at pointer release, retaining its identity', () => {
  const actions = { gesture: vi.fn(), create: vi.fn(), edit: vi.fn(), move: vi.fn(), remove: vi.fn(), copy: vi.fn(), destination: vi.fn(), wake: vi.fn() }
  const slot = { id: 'resize', title: 'Test', day: 0, start: '09:00', end: '10:00', description: 'Preserved' }
  const grid = weekGrid({ ...emptyWeek(), slots: [slot] }, actions); document.body.append(grid)
  const grip = grid.querySelector('.week-slot-resize')!
  for (const [type, clientY] of [['pointerdown', 480], ['pointermove', 528]] as const) grip.dispatchEvent(new MouseEvent(type, { button: 0, clientY, bubbles: true, cancelable: true }))
  expect(actions.move).not.toHaveBeenCalled()
  grip.dispatchEvent(new MouseEvent('pointerup', { clientY: 528, bubbles: true, cancelable: true }))
  expect(actions.move).toHaveBeenCalledWith({ ...slot, end: '11:00' })
  expect(actions.edit).not.toHaveBeenCalled()
})
it('deselects a selected event by clicking empty calendar space without editing', () => {
  const { grid, canvas, actions } = setup()
  const node = grid.querySelector<HTMLButtonElement>('.week-slot')!
  node.click(); expect(node).toHaveAttribute('aria-pressed', 'true')
  canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 600, bubbles: true }))
  canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientY: 600, bubbles: true }))
  expect(node).toHaveAttribute('aria-pressed', 'false')
  expect(actions.edit).not.toHaveBeenCalled(); expect(actions.create).not.toHaveBeenCalled()
})
it('moves wake markers by the gesture delta, independent of pointer offset or subpixels', () => {
  const { grid, canvas, actions } = setup()
  const wake = grid.querySelector('.week-wake')!
  wake.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 335.8, bubbles: true }))
  canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, clientY: 383.8, bubbles: true }))
  canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientY: 383.8, bubbles: true }))
  expect(actions.wake).toHaveBeenCalledWith(0, '08:00')
})
