import type { RefObject } from 'react'
import { TrashIcon } from './icons'
export function DropTrash({ active, hot = false, zoneRef, onDrop }: { active: boolean; hot?: boolean; zoneRef?: RefObject<HTMLDivElement | null>; onDrop?: () => void }) {
  if (!active || typeof document === 'undefined') return null
  return <div ref={zoneRef} data-drop-trash role="region" aria-label="Zone de suppression" className={`drop-trash ${hot ? 'is-over' : ''}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={event => { event.preventDefault(); onDrop?.() }}>
    <span aria-hidden="true"><TrashIcon size={26} /></span><div><strong>Déposer ici pour retirer</strong><p className="text-xs opacity-80">Les données du package sont conservées</p></div>
  </div>
}
export function isOverTrash(event: Event, zone: HTMLElement | null): boolean {
  const pointer = event as MouseEvent
  if (!zone || !Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY)) return false
  const rect = zone.getBoundingClientRect()
  return pointer.clientX >= rect.left && pointer.clientX <= rect.right && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom
}
