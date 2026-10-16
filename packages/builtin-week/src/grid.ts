import { DEFAULT_SLOT_COLOR, WEEK_DAYS, minutes, slotColor, slotTextColor, type WeekSlot } from '../../../shared/week'
import type { WeekDocument } from './model'
const SCALE = .8
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
export interface GridActions {
  gesture(active: boolean): void
  create(draft: WeekSlot): void
  edit(slot: WeekSlot): void
  move?(slot: WeekSlot): void
  wakeMove?(day: number, value: string): void
  remove(slot: WeekSlot): void
  copy(slot: WeekSlot): void
  destination(day: number, minute: number): void
  wake(day: number, value: string): void
}
/** Browser-only planner: gestures produce detached values; writes remain SDK/CAS. */
export function weekGrid(documentValue: WeekDocument, actions: GridActions, now = new Date()): HTMLElement {
  const region = document.createElement('section'); region.className = 'week-grid'; region.setAttribute('aria-label', 'Agenda de semaine')
  const table = document.createElement('div'); table.className = 'week-columns'; region.append(table)
  const hours = document.createElement('div'); hours.className = 'week-hours'
  for (let hour = 0; hour < 24; hour++) { const label = document.createElement('span'); label.textContent = `${String(hour).padStart(2, '0')} h`; label.style.top = `${hour * 60 * SCALE + 32}px`; hours.append(label) }
  table.append(hours)
  const deselect = () => region.querySelectorAll('.week-slot').forEach(node => node.setAttribute('aria-pressed', 'false'))
  let moving: { slot: WeekSlot; offset: number } | undefined
  let selection: { pointer: number; start: number; origin: number; active: boolean; wake: boolean } | undefined
  const today = (now.getDay() + 6) % 7
  for (let day = 0; day < 7; day++) {
    const column = document.createElement('div'); column.className = 'week-column'
    const heading = document.createElement('h3'); heading.textContent = WEEK_DAYS[day]; column.append(heading)
    if (day === today) heading.setAttribute('aria-current', 'date')
    const canvas = document.createElement('div'); canvas.className = 'week-canvas'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', `Créneaux du ${WEEK_DAYS[day]}`)
    column.append(canvas); table.append(column)
    const point = (clientY: number) => Math.max(0, Math.min(1425, Math.floor((clientY - canvas.getBoundingClientRect().top) / SCALE / 15) * 15))
    const template = (start: number, end: number): WeekSlot => ({ id: '', title: '', day, start: time(start), end: time(end), color: DEFAULT_SLOT_COLOR })
    const preview = document.createElement('div'); preview.className = 'week-preview'; preview.hidden = true; preview.setAttribute('aria-label', 'Aperçu du geste')
    const show = (start: number, end: number) => {
      preview.hidden = false; preview.style.top = `${start * SCALE}px`; preview.style.height = `${(end - start) * SCALE}px`; preview.textContent = `${time(start)} – ${time(end)}`
    }
    const clear = () => { selection = undefined; preview.hidden = true; actions.gesture(false) }
    canvas.onpointerdown = event => {
      if (event.button !== 0 || event.target !== canvas) return
      event.preventDefault(); deselect(); canvas.focus({ preventScroll: true })
      const start = point(event.clientY); actions.destination(day, start)
      selection = { pointer: event.pointerId, start, origin: event.clientY, active: false, wake: false }
      actions.gesture(true)
      canvas.setPointerCapture?.(event.pointerId)
    }
    canvas.onpointermove = event => {
      if (!selection || selection.pointer !== event.pointerId) return
      const current = selection.wake ? Math.max(0, Math.min(1425, selection.start + Math.round((event.clientY - selection.origin) / SCALE / 15) * 15)) : point(event.clientY)
      selection.active ||= Math.abs(event.clientY - selection.origin) > 5
      if (selection.active) show(Math.min(selection.start, current), Math.min(1439, Math.max(selection.start, current) + (selection.wake ? 15 : 0)))
    }
    canvas.onpointerup = event => {
      const selected = selection
      if (!selected || selected.pointer !== event.pointerId) return
      const end = selected.wake ? Math.max(0, Math.min(1425, selected.start + Math.round((event.clientY - selected.origin) / SCALE / 15) * 15)) : point(event.clientY); clear(); canvas.releasePointerCapture?.(event.pointerId)
      if (!selected.active) { if (selected.wake) actions.wake(day, documentValue.wakeTimes[day]); return }
      if (selected.wake) (actions.wakeMove ?? actions.wake)(day, time(end))
      else actions.create(template(Math.min(selected.start, end), Math.min(1439, Math.max(Math.min(selected.start, end) + 15, selected.start, end))))
    }
    canvas.onpointercancel = clear; canvas.onlostpointercapture = clear
    canvas.onkeydown = event => {
      if (event.target !== canvas || event.repeat || event.isComposing) return
      if (event.key === 'Escape') { clear(); moving = undefined; deselect() }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); actions.create(template(540, 600)) }
    }
    canvas.ondragover = event => {
      if (!moving) return
      event.preventDefault(); event.dataTransfer!.dropEffect = 'move'
      const duration = minutes(moving.slot.end) - minutes(moving.slot.start)
      const start = Math.max(0, Math.min(Math.floor((1439 - duration) / 15) * 15, point(event.clientY) - moving.offset))
      show(start, start + duration)
    }
    canvas.ondrop = event => {
      if (!moving) return
      event.preventDefault()
      const { slot, offset } = moving; moving = undefined; preview.hidden = true; actions.gesture(false)
      const duration = minutes(slot.end) - minutes(slot.start)
      const start = Math.max(0, Math.min(Math.floor((1439 - duration) / 15) * 15, point(event.clientY) - offset))
      ;(actions.move ?? actions.edit)({ ...structuredClone(slot), day, start: time(start), end: time(start + duration) })
    }
    const wake = document.createElement('button'); wake.type = 'button'; wake.className = 'week-wake'
    wake.textContent = '▸'; wake.dataset.time = documentValue.wakeTimes[day]; wake.setAttribute('aria-label', `Réveil ${WEEK_DAYS[day]} ${documentValue.wakeTimes[day]}`)
    wake.style.top = `${minutes(documentValue.wakeTimes[day]) * SCALE}px`
    wake.onclick = () => actions.wake(day, documentValue.wakeTimes[day])
    wake.onpointerdown = event => {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation()
      selection = { pointer: event.pointerId, start: minutes(documentValue.wakeTimes[day]), origin: event.clientY, active: false, wake: true }
      actions.gesture(true)
      canvas.setPointerCapture?.(event.pointerId)
    }
    canvas.append(wake)
    for (const slot of documentValue.slots.filter(item => item.day === day)) {
      const node = document.createElement('button'); node.type = 'button'; node.draggable = true; node.className = 'week-slot'
      const title = document.createElement('strong'); title.className = 'week-slot-title'; title.textContent = slot.title
      const hours = document.createElement('span'); hours.className = 'week-slot-hours'; hours.textContent = `${slot.start} – ${slot.end}`
      const caption = document.createElement('span'); caption.className = 'week-slot-caption'; caption.append(title, hours); node.append(caption); node.setAttribute('aria-label', `${slot.title}, ${WEEK_DAYS[day]}, ${slot.start} à ${slot.end}`)
      node.style.top = `${minutes(slot.start) * SCALE}px`; node.style.height = `${(minutes(slot.end) - minutes(slot.start)) * SCALE}px`
      node.style.setProperty('--slot-color', slotColor(slot.color)); node.style.setProperty('--slot-selected-text', slotTextColor(slot.color)); node.setAttribute('aria-pressed', 'false')
      function select() { region.querySelectorAll('.week-slot').forEach(other => other.setAttribute('aria-pressed', String(other === node))) }
      node.onpointerdown = event => { event.stopPropagation() }
      node.onclick = () => { select(); node.focus({ preventScroll: true }) }; node.onfocus = select; node.ondblclick = () => actions.edit(slot)
      node.ondragstart = event => {
        select(); clear(); moving = { slot, offset: Math.max(0, Math.floor((event.clientY - node.getBoundingClientRect().top) / SCALE / 15) * 15) }
        actions.gesture(true)
        event.dataTransfer!.effectAllowed = 'move'; event.dataTransfer!.setData('text/plain', slot.id)
      }
      node.ondragend = () => { moving = undefined; actions.gesture(false); region.querySelectorAll<HTMLElement>('.week-preview').forEach(element => { element.hidden = true }) }
      node.onkeydown = event => {
        if (event.repeat || event.isComposing || event.altKey) return
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); actions.copy(slot); return }
        if (event.ctrlKey || event.metaKey) return
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); actions.edit(slot) }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); actions.remove(slot) }
      }
      const resize = document.createElement('span'); resize.className = 'week-slot-resize'; resize.setAttribute('aria-hidden', 'true'); node.append(resize)
      let resizing = false
      resize.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); select(); resizing = true; node.draggable = false; actions.gesture(true); resize.setPointerCapture?.(event.pointerId) }
      resize.onpointermove = event => { if (!resizing) return; const end = Math.min(1439, Math.max(minutes(slot.start) + 15, point(event.clientY))); node.style.height = `${(end - minutes(slot.start)) * SCALE}px` }
      resize.onpointerup = event => {
        if (!resizing) return
        event.preventDefault(); event.stopPropagation(); resizing = false; node.draggable = true; actions.gesture(false); resize.releasePointerCapture?.(event.pointerId)
        const end = Math.min(1439, Math.max(minutes(slot.start) + 15, point(event.clientY)))
        node.style.height = `${(minutes(slot.end) - minutes(slot.start)) * SCALE}px`
        if (end !== minutes(slot.end)) (actions.move ?? actions.edit)({ ...structuredClone(slot), end: time(end) })
      }
      resize.onpointercancel = () => { resizing = false; node.draggable = true; node.style.height = `${(minutes(slot.end) - minutes(slot.start)) * SCALE}px`; actions.gesture(false) }
      canvas.append(node)
    }
    if (day === today) {
      const marker = document.createElement('div'); marker.className = 'week-now'; marker.setAttribute('role', 'img')
      const current = now.getHours() * 60 + now.getMinutes(); marker.style.top = `${current * SCALE}px`
      marker.setAttribute('aria-label', `Heure actuelle : ${WEEK_DAYS[day]} ${time(current)}`); marker.textContent = time(current); canvas.append(marker)
    }
    canvas.append(preview)
  }
  return region
}
