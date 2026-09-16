import React, { useMemo, useState } from 'react'
import type { ModuleCatalogEntry, ModuleCategory } from '../lib/moduleCatalog'
import { MODULE_CATALOG, MODULE_CATEGORY_COUNTS, MODULE_CATEGORY_LABEL, MODULE_CATEGORY_ORDER } from '../lib/moduleCatalog'
import { SearchIcon } from './icons'

export function useModuleCatalogFilter() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ModuleCategory | 'tous'>('tous')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return MODULE_CATALOG.filter((entry) => {
      if (category !== 'tous' && entry.category !== category) return false
      if (!q) return true
      return entry.title.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)
    })
  }, [query, category])

  return { query, setQuery, category, setCategory, filtered }
}

export function ModuleSearchInput({
  value,
  onChange,
  placeholder = 'Rechercher un module…',
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full font-sans text-sm pl-9 pr-3.5 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-faint outline-none focus:border-accent transition"
      />
    </div>
  )
}

export function ModuleCategorySidebar({
  category,
  onChange,
}: {
  category: ModuleCategory | 'tous'
  onChange: (category: ModuleCategory | 'tous') => void
}) {
  return (
    <div className="flex flex-col gap-0.5 w-[152px] flex-shrink-0">
      <CategoryButton active={category === 'tous'} label="Tous" count={MODULE_CATALOG.length} onClick={() => onChange('tous')} />
      {MODULE_CATEGORY_ORDER.map((cat) => (
        <CategoryButton
          key={cat}
          active={category === cat}
          label={MODULE_CATEGORY_LABEL[cat]}
          count={MODULE_CATEGORY_COUNTS[cat] || 0}
          onClick={() => onChange(cat)}
        />
      ))}
    </div>
  )
}

function CategoryButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] font-semibold text-left transition-colors border-none cursor-pointer ${
        active ? 'bg-accent-soft text-accent-text' : 'bg-transparent text-text-muted hover:bg-surface-hover'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`text-[10.5px] font-bold flex-shrink-0 ${active ? 'text-accent-text' : 'text-text-faint'}`}>
        {count}
      </span>
    </button>
  )
}

export function ModuleCatalogCard({
  entry,
  badge,
  disabled,
  active,
  onClick,
}: {
  entry: ModuleCatalogEntry
  badge: React.ReactNode
  disabled?: boolean
  active?: boolean
  onClick: () => void
}) {
  const Icon = entry.icon
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col gap-2.5 p-4 rounded-xl border text-left transition-colors ${
        disabled
          ? 'border-border bg-surface2 opacity-50 cursor-not-allowed'
          : active
            ? 'border-accent bg-accent-soft cursor-pointer'
            : 'border-border bg-surface hover:border-accent hover:bg-surface-hover cursor-pointer'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="w-9 h-9 rounded-lg bg-accent-soft text-accent-text flex items-center justify-center flex-shrink-0">
          <Icon size={17} />
        </span>
        {badge}
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold text-text">{entry.title}</div>
        <p className="text-[12px] text-text-faint leading-snug mt-0.5">{entry.description}</p>
      </div>
    </button>
  )
}

export function ModuleRemainingBadge({ remaining }: { remaining: number | null }) {
  if (remaining === null) {
    return (
      <span className="text-[13px] font-bold text-text-faint" title="Illimité">
        ∞
      </span>
    )
  }
  return (
    <span
      className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap ${
        remaining === 0 ? 'bg-surface2 text-text-faint' : 'bg-accent-soft text-accent-text'
      }`}
    >
      {remaining === 0 ? 'Complet' : `${remaining} dispo`}
    </span>
  )
}

export function ModuleCatalogGrid({
  entries,
  renderBadge,
  isDisabled,
  isActive,
  onSelect,
  emptyMessage = 'Aucun module ne correspond à ta recherche.',
}: {
  entries: ModuleCatalogEntry[]
  renderBadge: (entry: ModuleCatalogEntry) => React.ReactNode
  isDisabled?: (entry: ModuleCatalogEntry) => boolean
  isActive?: (entry: ModuleCatalogEntry) => boolean
  onSelect: (entry: ModuleCatalogEntry) => void
  emptyMessage?: string
}) {
  if (entries.length === 0) {
    return <p className="text-[13px] text-text-faint py-6 text-center">{emptyMessage}</p>
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))' }}>
      {entries.map((entry) => (
        <ModuleCatalogCard
          key={entry.type}
          entry={entry}
          badge={renderBadge(entry)}
          disabled={isDisabled?.(entry)}
          active={isActive?.(entry)}
          onClick={() => onSelect(entry)}
        />
      ))}
    </div>
  )
}
