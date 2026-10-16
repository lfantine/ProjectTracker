import { useEffect, useId, useRef, useState } from 'react'
import type { WeekPreset } from '../lib/weekPresets'
import { PencilIcon, PlusIcon } from './icons'
import { Modal, PrimaryButton, SecondaryButton } from './ui'

export function WeekPresetPicker({ presets, activeId, onSelect, onCreate, onRename }: {
  presets: WeekPreset[]; activeId?: string
  onSelect: (id: string) => void
  onCreate: (name: string, copy: boolean) => void
  onRename: (name: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const controls = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !controls.current?.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menuOpen])
  const [mode, setMode] = useState<'new' | 'copy' | 'rename' | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const active = presets.find((preset) => preset.id === activeId)
  function open(next: 'new' | 'copy' | 'rename') {
    setMenuOpen(false); trigger.current?.focus(); setMode(next); setName(next === 'rename' ? active?.name || '' : ''); setError('')
  }
  return <div className="mb-5">
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-text-muted font-semibold">Semaine active<select value={activeId || ''} onChange={(event) => onSelect(event.target.value)} className="bg-surface text-text border border-border rounded-lg px-3 py-2 min-w-52 max-w-[min(70vw,320px)] text-sm font-semibold">{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      <div ref={controls} className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false) }}>
        <button ref={trigger} type="button" aria-label="Gérer les semaines types" title="Gérer les semaines types" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} onClick={() => setMenuOpen((open) => !open)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenuOpen(true) } }} className={`w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer text-xl font-bold transition-colors focus-visible:outline-2 focus-visible:outline-accent ${menuOpen ? 'bg-surface2 text-text' : 'text-text-muted hover:text-text hover:bg-surface2'}`}><span aria-hidden="true">···</span></button>
        {menuOpen && <div ref={menu} id={menuId} role="menu" aria-label="Actions sur les semaines types" className="absolute left-0 top-full mt-2 z-40 w-56 bg-surface border border-border rounded-xl p-1.5 shadow-xl" onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); trigger.current?.focus(); return }
          const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') || [])
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
          if (next !== null) { event.preventDefault(); buttons[next]?.focus() }
        }}>
          <button type="button" role="menuitem" onClick={() => open('new')} className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm rounded-lg cursor-pointer text-text hover:bg-surface2 focus:bg-surface2 outline-none"><PlusIcon size={15} className="text-text-muted" />Nouvelle semaine</button>
          <button type="button" role="menuitem" onClick={() => open('copy')} className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm rounded-lg cursor-pointer text-text hover:bg-surface2 focus:bg-surface2 outline-none"><span aria-hidden="true" className="w-[15px] text-text-muted text-lg leading-none">⧉</span>Dupliquer</button>
          <div className="h-px bg-border my-1" role="separator" />
          <button type="button" role="menuitem" onClick={() => open('rename')} className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm rounded-lg cursor-pointer text-text hover:bg-surface2 focus:bg-surface2 outline-none" title="Renommer la semaine type" aria-label="Renommer"><PencilIcon size={15} className="text-text-muted" />Renommer</button>
        </div>}
      </div>
    </div>
    {mode && <Modal open compact center width={420} onClose={() => setMode(null)} title={mode === 'rename' ? 'Renommer la semaine' : mode === 'copy' ? 'Dupliquer la semaine' : 'Nouvelle semaine type'}>
      <form className="flex flex-col gap-3 mt-3" onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) { setError('Renseigne un nom.'); return }
        if (presets.some((preset) => (mode !== 'rename' || preset.id !== activeId) && preset.name.toLowerCase() === trimmed.toLowerCase())) { setError('Ce nom est déjà utilisé.'); return }
        if (mode === 'rename') onRename(trimmed)
        else onCreate(trimmed, mode === 'copy')
        setMode(null)
      }}>
        <label className="flex flex-col gap-1 text-sm">Nom de la semaine<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="bg-bg border border-border rounded-lg px-3 py-2" required /></label>
        {mode !== 'rename' && <p className="text-xs text-text-muted">{mode === 'copy' ? 'Copie les créneaux, leurs détails et les heures de réveil.' : 'Crée une semaine vide avec les repères de réveil à 07:00.'}</p>}
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2"><SecondaryButton onClick={() => setMode(null)}>Annuler</SecondaryButton><PrimaryButton type="submit">{mode === 'rename' ? 'Enregistrer' : 'Créer'}</PrimaryButton></div>
      </form>
    </Modal>}
  </div>
}
