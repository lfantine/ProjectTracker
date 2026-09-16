import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useData } from '../lib/store'
import { SearchIcon } from './icons'

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
}: {
  open: boolean
  onClose: () => void
}) {
  const { data } = useData()
  const router = useRouter()
  const [query, setQuery] = useState('')

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

  return (
    <div
      className="fixed inset-0 bg-overlay flex items-start justify-center z-50"
      style={{ paddingTop: '12vh' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxHeight: '60vh' }}
        className="bg-surface border border-border rounded-xl p-3 shadow-2xl flex flex-col"
      >
        <div className="flex items-center gap-2 mb-2 px-2">
          <SearchIcon size={16} className="text-text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un projet, une note, une erreur…"
            className="flex-1 bg-transparent outline-none text-[15px] text-text placeholder:text-text-faint py-1"
          />
        </div>
        <div className="overflow-auto flex flex-col gap-0.5">
          {results.length === 0 && (
            <p className="text-[13px] text-text-faint px-2 py-3">Aucun résultat</p>
          )}
          {results.map((r, i) => (
            <div
              key={i}
              onClick={() => {
                r.onClick()
                onClose()
              }}
              className="flex gap-2.5 items-center px-2.5 py-2 rounded-lg cursor-pointer hover:bg-surface-hover"
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
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
