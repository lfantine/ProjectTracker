import { useState } from 'react'
import type { Deadline } from '../lib/types'
import { statusTone } from '../lib/constants'
import { fmtDate } from '../lib/helpers'
import { Input, PrimaryButton, StatusPill } from './ui'
import { TrashIcon } from './icons'

const LABEL: Record<Deadline['status'], string> = {
  a_venir: 'À venir',
  fait: 'Fait',
  depasse: 'Dépassé',
}

export function DeadlineList({
  deadlines,
  onAdd,
  onToggle,
  onRemove,
  editing = true,
}: {
  deadlines: Deadline[]
  onAdd: (label: string, date: string) => void
  onToggle: (id: string) => void
  onRemove?: (id: string) => void
  editing?: boolean
}) {
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const sorted = deadlines.slice().sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div>
      {sorted.length === 0 && <p className="text-[13px] text-text-faint mb-2">Aucune échéance.</p>}
      <div className="flex flex-col gap-1.5 mb-3">
        {sorted.map((d) => (
          <div key={d.id} className="flex items-center gap-2.5 py-1.5 px-1 border-b border-border">
            <StatusPill label={LABEL[d.status]} tone={statusTone(d.status)} onClick={() => onToggle(d.id)} />
            <span className="text-sm text-text flex-1">{d.label}</span>
            <span className="text-[11.5px] text-text-faint font-mono">{fmtDate(d.date)}</span>
            {editing && onRemove && (
              <button
                type="button"
                onClick={() => onRemove(d.id)}
                className="border-none bg-transparent text-text-faint hover:text-danger cursor-pointer p-1 flex-shrink-0" title="Supprimer cette échéance" aria-label={`Supprimer l’échéance ${d.label}`}
              >
                <TrashIcon size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="flex gap-2 flex-wrap">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Libellé de l'échéance…"
            className="flex-1 min-w-[160px]"
          />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <PrimaryButton
            onClick={() => {
              if (!label.trim() || !date) return
              onAdd(label.trim(), date)
              setLabel('')
              setDate('')
            }}
          >
            Ajouter
          </PrimaryButton>
        </div>
      )}
    </div>
  )
}
