import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SLOT_COLOR, slotColor, minutes, slotError, WEEK_DAYS, type WeekSlot } from '../lib/weekSchedule'
import { uid } from '../lib/helpers'
import { useLocalNow } from '../lib/useLocalNow'
import { Modal, PrimaryButton, SecondaryButton } from './ui'

const SCALE = .8
const HEIGHT = 1440 * SCALE
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
type Selection = { day: number; anchor: number; current: number; pointer: number; originY: number; active: boolean }
function range(selection: Selection) {
  const start = Math.min(selection.anchor, selection.current)
  return { start, end: Math.min(1439, Math.max(start + 15, selection.anchor, selection.current)) }
}
export function WeekSchedule({ slots, onChange, projects = [] }: { slots: WeekSlot[]; onChange: (slots: WeekSlot[]) => void; projects?: { id: string; name: string }[] }) {
  const now = useLocalNow()
  const today = now ? (now.getDay() + 6) % 7 : -1
  const currentMinute = now ? now.getHours() * 60 + now.getMinutes() : 0
  const currentTime = time(currentMinute)
  const [selected, setSelected] = useState<string>()
  const [draft, setDraft] = useState<WeekSlot | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Selection | null>(null)
  const drag = useRef<Selection | null>(null)
  const copied = useRef<WeekSlot | null>(null)
  const moving = useRef<{ slot: WeekSlot; offset: number } | null>(null)
  const [movePreview, setMovePreview] = useState<WeekSlot | null>(null)
  const destination = useRef<{ day: number; minute: number } | null>(null)
  const [notice, setNotice] = useState('')
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const agenda = grid.current
    if (!agenda) return
    let frame = 0
    function updateLabels() {
      frame = 0
      if (!agenda) return
      // The horizontal agenda scroller prevents CSS sticky from following the page scroller.
      let viewportTop = 0
      for (let parent = agenda.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
          viewportTop = Math.max(viewportTop, parent.getBoundingClientRect().top + parent.clientTop)
        }
      }
      for (const label of agenda.querySelectorAll<HTMLElement>('[data-week-slot-label]')) {
        const slot = label.parentElement
        if (!slot) continue
        const bounds = slot.getBoundingClientRect()
        const maxOffset = Math.max(0, bounds.height - label.getBoundingClientRect().height - 4)
        const offset = Math.min(maxOffset, Math.max(0, viewportTop - bounds.top))
        label.style.transform = `translateY(${offset}px)`
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(updateLabels)
    }
    updateLabels()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    observer?.observe(agenda)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [slots])
  const total = slots.reduce((sum, slot) => sum + minutes(slot.end) - minutes(slot.start), 0)
  const field = 'bg-bg border border-border rounded-lg px-3 py-2 text-sm'
  function point(event: { clientY: number; currentTarget: HTMLElement }) {
    return Math.max(0, Math.min(1425, Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top) / SCALE / 15) * 15))
  }
  function movedSlot(event: { clientY: number; currentTarget: HTMLElement }, day: number): WeekSlot | null {
    const source = moving.current
    if (!source) return null
    const duration = minutes(source.slot.end) - minutes(source.slot.start)
    const start = Math.max(0, Math.min(Math.floor((1439 - duration) / 15) * 15, point(event) - source.offset))
    return { ...source.slot, day, start: time(start), end: time(start + duration) }
  }
  function paste() {
    if (!copied.current) return
    const source = copied.current
    const duration = minutes(source.end) - minutes(source.start)
    let next: WeekSlot | undefined
    if (destination.current) {
      const { day, minute } = destination.current
      if (minute + duration <= 1439) next = { ...source, id: uid('week'), day, start: time(minute), end: time(minute + duration) }
    } else {
      // Without a chosen destination, find the next available quarter-hour after the source.
      const first = source.day * 1440 + minutes(source.end)
      for (let offset = 0; offset < 7 * 1440; offset += 15) {
        const absolute = (Math.ceil(first / 15) * 15 + offset) % (7 * 1440)
        const day = Math.floor(absolute / 1440), start = absolute % 1440
        if (start + duration > 1439) continue
        const candidate = { ...source, id: uid('week'), day, start: time(start), end: time(start + duration) }
        if (!slotError(candidate, slots)) { next = candidate; break }
      }
    }
    if (!next) { setNotice('Aucune place disponible pour cette durée.'); return }
    const problem = slotError(next, slots)
    if (problem) { setNotice(problem); return }
    onChange([...slots, { ...next, people: next.people ? [...next.people] : undefined }]); setSelected(next.id)
    destination.current = null
    setNotice(`Créneau dupliqué : ${WEEK_DAYS[next.day]}, ${next.start} – ${next.end}.`)
  }
  function edit(slot: WeekSlot) { setDraft({ ...slot }); setCreating(false); setError('') }
  function close() { setDraft(null); setError(''); requestAnimationFrame(() => grid.current?.focus()) }
  function cancelDrag() { drag.current = null; setPreview(null) }
  return <div>
    <p className="text-text-muted mb-2">Tes objectifs se répètent chaque semaine. {Math.floor(total / 60)} h {total % 60 ? `${total % 60} min` : ''} planifiées.</p>
    <p className="text-xs text-text-faint mb-4" id="week-help">Clique et glisse pour créer un créneau. Clique pour sélectionner · Espace pour modifier · Suppr pour supprimer · Échap pour désélectionner · ⌘C / ⌘V pour copier-coller (Ctrl sur Windows) · Glisse un créneau pour le déplacer.</p>
    {notice && <p role="status" className="text-sm text-text-muted mb-3">{notice}</p>}
    <div ref={grid} tabIndex={0} role="region" aria-label="Agenda de semaine" aria-describedby="week-help" className="overflow-x-auto border border-border rounded-xl bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent" onKeyDown={(event) => {
      if (draft || event.altKey || event.repeat) return
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'c') {
          const slot = slots.find((s) => s.id === selected)
          if (slot) { event.preventDefault(); copied.current = { ...slot, people: slot.people ? [...slot.people] : undefined }; destination.current = null; setNotice('Créneau copié. Clique dans le vide pour choisir une destination, puis colle.') }
        }
        if (event.key.toLowerCase() === 'v' && copied.current) { event.preventDefault(); paste() }
        return
      }
      if (event.key === 'Escape') { moving.current = null; setMovePreview(null); destination.current = null; cancelDrag(); setSelected(undefined); return }
      const slot = slots.find((s) => s.id === selected)
      if (!slot) return
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); edit(slot) }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onChange(slots.filter((s) => s.id !== selected)); setSelected(undefined); grid.current?.focus() }
    }}>
      <div style={{ minWidth: 950 }}>
        <div className="grid border-b border-border" style={{ gridTemplateColumns: '55px repeat(7, 1fr)' }}><span />{WEEK_DAYS.map((name, index) => <div key={name} aria-current={today === index ? 'date' : undefined} className={`p-3 text-sm font-bold border-l border-border ${today === index ? 'bg-accent-soft text-accent-soft-text' : ''}`}>{name}{today === index && <span className="block text-[10px] font-semibold">Aujourd’hui</span>}<span className="block text-xs text-text-muted font-normal">{(slots.filter((s) => s.day === index).reduce((sum, s) => sum + minutes(s.end) - minutes(s.start), 0) / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h</span></div>)}</div>
        <div className="grid" style={{ gridTemplateColumns: '55px repeat(7, 1fr)' }}>
          <div className="relative text-xs text-text-muted" style={{ height: HEIGHT }}>{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute pl-2" style={{ top: hour * 48 }}>{String(hour).padStart(2, '0')} h</span>)}</div>
          {WEEK_DAYS.map((name, index) => <div key={name} aria-label={`Créneaux du ${name}`} className={`relative border-l border-border cursor-default select-none ${today === index ? 'bg-accent-soft/20' : ''}`} style={{ height: HEIGHT, touchAction: 'none', backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 47px, var(--color-border, #8883) 47px, var(--color-border, #8883) 48px)' }}
            onPointerDown={(event) => {
              if (event.button !== 0 || draft) return
              event.preventDefault(); grid.current?.focus(); setSelected(undefined)
              const minute = point(event)
              destination.current = { day: index, minute }; setNotice('')
              drag.current = { day: index, anchor: minute, current: minute, pointer: event.pointerId, originY: event.clientY, active: false }
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!drag.current || drag.current.pointer !== event.pointerId) return
              drag.current = { ...drag.current, current: point(event), active: drag.current.active || Math.abs(event.clientY - drag.current.originY) > 5 }
              if (drag.current.active) setPreview(drag.current)
            }}
            onPointerUp={(event) => {
              if (!drag.current || drag.current.pointer !== event.pointerId) return
              const selection = { ...drag.current, current: point(event) }
              const bounds = range(selection)
              cancelDrag()
              event.currentTarget.releasePointerCapture?.(event.pointerId)
              if (!selection.active) return
              setDraft({ id: uid('week'), title: '', day: selection.day, start: time(bounds.start), end: time(bounds.end), description: '', projectId: '', location: '', people: [], link: '', color: DEFAULT_SLOT_COLOR }); setCreating(true); setError('')
            }}
            onDragOver={(event) => {
              if (!moving.current) return
              event.preventDefault(); event.dataTransfer.dropEffect = 'move'
              setMovePreview(movedSlot(event, index))
            }}
            onDrop={(event) => {
              if (!moving.current) return
              event.preventDefault()
              const next = movedSlot(event, index)
              moving.current = null; setMovePreview(null)
              if (!next) return
              const problem = slotError(next, slots, next.id)
              if (problem) { setNotice(problem); return }
              onChange(slots.map((slot) => slot.id === next.id ? next : slot)); setSelected(next.id)
              setNotice(`Créneau déplacé : ${WEEK_DAYS[next.day]}, ${next.start} – ${next.end}.`)
              grid.current?.focus()
            }}
            onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
            {slots.filter((slot) => slot.day === index).map((slot) => <button key={slot.id} type="button" aria-label={`${slot.title}, ${name}, ${slot.start} à ${slot.end}`} aria-pressed={selected === slot.id} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelected(slot.id); destination.current = null }} draggable onDragStart={(event) => {
              setSelected(slot.id); setNotice(''); cancelDrag()
              const offset = Math.max(0, Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top) / SCALE / 15) * 15)
              moving.current = { slot, offset }
              event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', slot.id)
            }} onDragEnd={() => { moving.current = null; setMovePreview(null) }} onDoubleClick={() => { setSelected(slot.id); edit(slot) }} className={`absolute inset-x-1 rounded-md flex flex-col items-start justify-start text-left text-xs border overflow-hidden px-1 pt-1 cursor-pointer outline-none ${selected === slot.id ? 'text-white dark:text-black border-transparent' : 'text-text border-transparent'}`} style={{ backgroundColor: selected === slot.id ? slotColor(slot.color) : `${slotColor(slot.color)}99`, top: minutes(slot.start) * SCALE, height: (minutes(slot.end) - minutes(slot.start)) * SCALE }}>
              <span data-week-slot-label className="block w-full shrink-0 will-change-transform">
                <strong className="block w-full truncate">{slot.title}</strong><span className="block">{slot.start} – {slot.end}</span>
              </span>
            </button>)}
            {movePreview?.day === index && <div aria-label="Aperçu du déplacement" className="absolute inset-x-1 rounded-md border-2 border-dashed border-accent pointer-events-none text-xs text-text px-1 z-20" style={{ backgroundColor: `${slotColor(movePreview.color)}99`, top: minutes(movePreview.start) * SCALE, height: (minutes(movePreview.end) - minutes(movePreview.start)) * SCALE }}>{movePreview.title}<br />{movePreview.start} – {movePreview.end}</div>}
            {today === index && <div role="img" aria-label={`Heure actuelle : ${name} ${currentTime}`} className="absolute inset-x-0 z-10 pointer-events-none border-t-2 border-danger" style={{ top: currentMinute * SCALE }}>
              <span className="absolute -left-1 -top-1.5 w-2.5 h-2.5 rounded-full bg-danger" />
              <span className="absolute right-1 bottom-1 rounded px-1 text-[10px] font-bold bg-surface text-danger">{currentTime}</span>
            </div>}
            {preview?.day === index && <div className="absolute inset-x-1 bg-accent-soft border-2 border-accent rounded-md text-xs text-accent-soft-text pointer-events-none px-1" style={{ top: range(preview).start * SCALE, height: (range(preview).end - range(preview).start) * SCALE }}>{time(range(preview).start)} – {time(range(preview).end)}</div>}
          </div>)}
        </div>
      </div>
    </div>
    {draft && <Modal open onClose={close} title={creating ? 'Nouvel objectif récurrent' : 'Modifier l’objectif'} compact center width={440}>
      <form className="flex flex-col gap-3 mt-3" onSubmit={(event) => {
        event.preventDefault()
        const next = { ...draft, title: draft.title.trim(), description: draft.description || '', projectId: draft.projectId || '', location: draft.location || '', people: (draft.people || []).map((person) => person.trim()).filter(Boolean), link: (draft.link || '').trim() }
        const problem = slotError(next, slots, creating ? undefined : draft.id)
        if (problem) { setError(problem); return }
        next.color = slotColor(next.color)
        onChange(creating ? [...slots, next] : slots.map((slot) => slot.id === next.id ? next : slot)); setSelected(next.id); close()
      }}>
        <label className="flex flex-col gap-1 text-sm">Objectif<input autoFocus className={field} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Travail, sport, lecture…" required /></label>
        <label className="flex flex-col gap-1 text-sm">Jour<select className={field} value={draft.day} onChange={(e) => setDraft({ ...draft, day: Number(e.target.value) })}>{WEEK_DAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        <div className="flex gap-3"><label className="flex flex-col gap-1 text-sm flex-1">Début<input className={field} type="time" required value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label><label className="flex flex-col gap-1 text-sm flex-1">Fin<input className={field} type="time" required value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></label></div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">Couleur<input type="color" className="w-12 h-10 rounded cursor-pointer" value={slotColor(draft.color)} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm flex-1">Code couleur<input className={field} placeholder="#d1d5db" value={draft.color ?? DEFAULT_SLOT_COLOR} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
        </div>
        <label className="flex flex-col gap-1 text-sm">Description<textarea className={field} rows={3} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm">Projet lié<select className={field} value={draft.projectId || ''} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}><option value="">Aucun projet</option>{draft.projectId && !projects.some((project) => project.id === draft.projectId) && <option value={draft.projectId}>Projet indisponible</option>}{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-sm">Lieu / adresse<input className={field} value={draft.location || ''} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm">Personnes<textarea className={field} rows={2} placeholder="Une personne par ligne" value={(draft.people || []).join('\n')} onChange={(e) => setDraft({ ...draft, people: e.target.value.split('\n') })} /></label>
        <label className="flex flex-col gap-1 text-sm">Lien<input className={field} type="url" placeholder="https://…" value={draft.link || ''} onChange={(e) => setDraft({ ...draft, link: e.target.value })} /></label>
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2 mt-2"><SecondaryButton onClick={close}>Annuler</SecondaryButton><PrimaryButton type="submit">{creating ? 'Ajouter' : 'Enregistrer'}</PrimaryButton></div>
      </form>
    </Modal>}
  </div>
}
