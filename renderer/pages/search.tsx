import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../components/AppShell'
import { Chip, Input } from '../components/ui'
import { useData } from '../lib/store'

type Scope = 'tout' | 'projets' | 'notes' | 'erreurs'

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

export default function SearchPage() {
  const { data } = useData()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('tout')
  const [tag, setTag] = useState<string | null>(null)

  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          data.notes
            .reduce<string[]>((a, n) => a.concat(n.tags), [])
            .concat(data.categories)
            .concat(Object.values(data.platforms).flat())
        )
      ).slice(0, 12),
    [data]
  )

  const results = useMemo<ResultRow[]>(() => {
    const q = query.toLowerCase().trim()
    const matches = (hay: string) => !q || hay.toLowerCase().includes(q)
    const out: ResultRow[] = []
    if (scope === 'tout' || scope === 'projets') {
      data.projects.forEach((p) => {
        if (
          matches(`${p.name} ${p.category} ${p.platforms.join(' ')}`) &&
          (!tag || p.category === tag || p.platforms.includes(tag))
        ) {
          out.push({
            type: 'projets',
            typeLabel: 'Projet',
            title: p.name,
            subtitle: `${p.category} · ${p.platforms.join(', ')}`,
            onClick: () => router.push(`/project?id=${p.id}`),
          })
        }
      })
    }
    if (scope === 'tout' || scope === 'notes') {
      data.notes.forEach((n) => {
        if (matches(`${n.title} ${n.content} ${n.tags.join(' ')}`) && (!tag || n.tags.includes(tag))) {
          out.push({
            type: 'notes',
            typeLabel: 'Note',
            title: n.title,
            subtitle: n.tags.map((t) => `#${t}`).join(' '),
            onClick: () => router.push(`/notes/detail?id=${n.id}`),
          })
        }
      })
    }
    if (scope === 'tout' || scope === 'erreurs') {
      data.errors.forEach((e) => {
        if (matches(`${e.title} ${e.content}`) && !tag) {
          out.push({
            type: 'erreurs',
            typeLabel: 'Erreur',
            title: e.title,
            subtitle: e.content.slice(0, 60),
            onClick: () => router.push(`/errors?open=${e.id}`),
          })
        }
      })
    }
    return out.slice(0, 40)
  }, [query, scope, tag, data, router])

  return (
    <AppShell title="Recherche">
      <div className="mb-3.5">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="w-full text-[15px] py-3"
        />
      </div>
      <div className="flex gap-2 mb-2.5">
        {(
          [
            ['tout', 'Tout'],
            ['projets', 'Projets'],
            ['notes', 'Notes'],
            ['erreurs', 'Erreurs'],
          ] as [Scope, string][]
        ).map(([k, l]) => (
          <Chip key={k} label={l} active={scope === k} onClick={() => setScope(k)} />
        ))}
      </div>
      <div className="flex gap-1.5 flex-wrap mb-5">
        {allTags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTag((prev) => (prev === t ? null : t))}
            className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ${
              tag === t ? 'border-accent bg-accent-soft text-accent-text' : 'border-border bg-transparent text-text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-0.5 bg-surface border border-border rounded-xl p-1.5">
        {results.length === 0 && <p className="text-[13px] text-text-faint px-3 py-4">Aucun résultat.</p>}
        {results.map((r, i) => (
          <div
            key={i}
            onClick={r.onClick}
            className="flex gap-2.5 items-center px-2.5 py-2.5 rounded-lg cursor-pointer hover:bg-surface-hover"
          >
            <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 flex-shrink-0 ${TYPE_COLOR_CLASS[r.type]}`}>
              {r.typeLabel}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold text-text truncate">{r.title}</div>
              <div className="text-[11.5px] text-text-faint truncate">{r.subtitle}</div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
