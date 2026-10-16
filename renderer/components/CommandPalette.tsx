import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { useData } from '../lib/store'
import { SearchIcon, SparklesIcon } from './icons'
import { CreateWithAiModal } from './CreateWithAiModal'

interface ResultRow {
  type: 'projets' | 'notes' | 'erreurs'
  typeLabel: string
  title: string
  subtitle: string
  onClick: () => void
}

const TYPE_COLOR_CLASS: Record<ResultRow['type'], string> = {
  projets: 'text-accent border-accent',
  notes: 'text-success border-success',
  erreurs: 'text-danger border-danger',
}

export function CommandPalette({
  open,
  onClose,
  initialTargetId,
}: {
  open: boolean
  onClose: () => void
  initialTargetId?: string
}) {
  const { data } = useData()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  }, [query, open])
  useEffect(() => { if (open) setQuery('') }, [open])

  const results = useMemo<ResultRow[]>(() => {
    const q = query.toLowerCase().trim()
    const matches = (hay: string) => !q || hay.toLowerCase().includes(q)
    const out: ResultRow[] = []
    data.projects.forEach((p) => {
      if (matches(`${p.name} ${p.category} ${p.platforms.join(' ')}`)) {
        out.push({
          type: 'projets',
          typeLabel: 'Projet',
          title: p.name,
          subtitle: `${p.category} · ${p.platforms.join(', ')}`,
          onClick: () => router.push(`/project?id=${p.id}`),
        })
      }
    })
    data.notes.forEach((n) => {
      if (matches(`${n.title} ${n.content} ${n.tags.join(' ')}`)) {
        out.push({
          type: 'notes',
          typeLabel: 'Note',
          title: n.title,
          subtitle: n.tags.map((t) => `#${t}`).join(' '),
          onClick: () => router.push(`/notes/detail?id=${n.id}`),
        })
      }
    })
    data.errors.forEach((e) => {
      if (matches(`${e.title} ${e.content}`)) {
        out.push({
          type: 'erreurs',
          typeLabel: 'Erreur',
          title: e.title,
          subtitle: e.content.slice(0, 60),
          onClick: () => router.push(`/errors?open=${e.id}`),
        })
      }
    })
    return out.slice(0, 8)
  }, [query, data, router])

  if (!open) return null
  const canAskAi = query.trim().length > 0 && results.length === 0

  return (
    <div
      className="fixed inset-0 bg-overlay flex items-start justify-center z-50"
      style={{ paddingTop: '12vh' }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Rechercher ou demander à l’IA"
        onClick={(e) => e.stopPropagation()}
        data-mode={canAskAi ? 'ai' : 'search'}
        style={{ width: canAskAi ? 680 : 560, maxWidth: 'calc(100vw - 32px)', maxHeight: '75vh' }}
        className={`bg-surface border rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-[width,border-color,box-shadow] duration-200 ${canAskAi ? 'border-accent/30 shadow-[0_20px_80px_-20px_var(--color-accent)]' : 'border-border'}`}
      >
        {canAskAi && <div className="flex items-center justify-between px-5 pt-4 text-[10px] font-bold uppercase tracking-wider text-text-faint"><span>Assistant IA</span><span>Entrée pour générer · Maj + Entrée pour une nouvelle ligne</span></div>}
        <div className={`flex items-start gap-3 ${canAskAi ? 'px-5 pt-3 pb-5' : 'px-5 py-4'}`}>
          {canAskAi ? <SparklesIcon size={18} className="mt-1.5 shrink-0 text-text-muted" /> : <SearchIcon size={18} className="mt-1.5 shrink-0 text-text-faint" />}
          <textarea
            ref={inputRef}
            rows={1}
            autoFocus
            value={query}
            disabled={aiBusy}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              e.preventDefault()
              if (canAskAi) e.currentTarget.closest('[role="dialog"]')?.querySelector<HTMLFormElement>('form')?.requestSubmit()
              else if (results[0]) { results[0].onClick(); onClose() }
            }}
            aria-label={canAskAi ? 'Demande pour l’IA' : 'Rechercher ou saisir une demande pour l’IA'}
            placeholder="Rechercher ou décrire ce que l’IA doit faire…"
            className="min-w-0 flex-1 resize-none bg-transparent outline-none text-[16px] leading-relaxed text-text placeholder:text-text-faint py-0.5"
          />
        </div>
        <div className={`overflow-auto flex flex-col gap-0.5 ${canAskAi ? "border-t border-border pt-4" : "px-3 pb-3"}`}>
          {canAskAi ? (
            <CreateWithAiModal open embedded initialPrompt={query} initialTargetId={initialTargetId} onPromptChange={setQuery} onBusyChange={setAiBusy} onClose={onClose} />
          ) : results.length === 0 && (
            <p className="text-[13px] text-text-faint px-2 py-3">Aucun résultat</p>
          )}
          {results.map((r, i) => (
            <button type="button"
              key={i}
              onClick={() => {
                r.onClick()
                onClose()
              }}
              className="flex gap-2.5 items-center px-2.5 py-2 rounded-lg cursor-pointer text-left hover:bg-surface-hover"
            >
              <span
                className={`text-[10px] font-bold border rounded px-1.5 py-0.5 flex-shrink-0 ${TYPE_COLOR_CLASS[r.type]}`}
              >
                {r.typeLabel}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-text truncate">{r.title}</div>
                <div className="text-[11.5px] text-text-faint truncate">{r.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
