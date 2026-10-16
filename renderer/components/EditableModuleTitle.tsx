import { useState } from 'react'

export function EditableModuleTitle({ title, onChange }: { title: string; onChange?: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  function commit() {
    if (draft === null) return
    const value = draft.trim()
    if (value && value !== title) onChange?.(value)
    setDraft(null)
  }
  return <h3 className="text-[15px] font-bold flex-1 min-w-0 truncate">
    {draft !== null ? <input autoFocus aria-label="Modifier le titre du module" className="w-full bg-transparent border-none outline-none font-inherit" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null) } }} />
      : onChange ? <button type="button" title="Modifier le titre" className="block max-w-full truncate text-left cursor-text" onClick={() => setDraft(title)}>{title}</button> : title}
  </h3>
}
