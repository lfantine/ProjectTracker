import { useRef, useState, type PointerEvent } from 'react'
import { minutes } from '../lib/weekSchedule'

const SCALE = .8
const format = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const clamp = (minute: number) => Math.max(0, Math.min(1425, minute))
export function WakeMarker({ day, value, onChange }: { day: string; value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState<number | null>(null)
  const drag = useRef<{ y: number; minute: number; pointer: number } | null>(null)
  const minute = preview ?? minutes(value)
  function position(event: PointerEvent<HTMLElement>) {
    const origin = drag.current!
    return clamp(origin.minute + Math.round((event.clientY - origin.y) / SCALE / 15) * 15)
  }
  function cancel() { drag.current = null; setPreview(null) }
  return <button type="button" role="slider" aria-label={`Heure de réveil du ${day}`} aria-valuemin={0} aria-valuemax={1425} aria-valuenow={minute} aria-valuetext={format(minute)} title={`Réveil : ${format(minute)} · Glisser pour déplacer`} className="absolute left-0 z-30 -translate-y-1/2 flex items-center gap-1 text-text-muted cursor-ns-resize touch-none select-none rounded-r bg-surface px-1 py-0.5 shadow-sm focus-visible:outline-2 focus-visible:outline-accent" style={{ top: minute * SCALE }}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => {
      event.stopPropagation()
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus()
      drag.current = { y: event.clientY, minute: minutes(value), pointer: event.pointerId }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }}
    onPointerMove={(event) => { event.stopPropagation(); if (drag.current?.pointer === event.pointerId && drag.current) setPreview(position(event)) }}
    onPointerUp={(event) => {
      event.stopPropagation()
      if (!drag.current || drag.current.pointer !== event.pointerId) return
      const next = position(event)
      cancel(); event.currentTarget.releasePointerCapture?.(event.pointerId); onChange(format(next))
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Escape') { cancel(); return }
      const next = event.key === 'ArrowUp' ? minute - 15 : event.key === 'ArrowDown' ? minute + 15 : event.key === 'Home' ? 0 : event.key === 'End' ? 1425 : null
      if (next !== null) { event.preventDefault(); onChange(format(clamp(next))) }
    }}>
    <span aria-hidden="true">▸</span><span className="text-[10px] font-mono">{format(minute)}</span>
  </button>
}
