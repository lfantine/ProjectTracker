import { useMemo, useState } from 'react'
import type { ProjectModule, TableColumn, TableConfig, TableRow } from '../lib/types'
import { useDraft } from '../lib/useDraft'
import { uid } from '../lib/helpers'
import { EditableModuleTitle } from './EditableModuleTitle'
import { createApplicationTable, safeTableUrl } from '../lib/tables'
import { GhostButton, Input, Modal, PrimaryButton, Textarea } from './ui'

const fieldClass = 'bg-transparent border border-border rounded-md px-2 py-1.5 text-sm text-text min-w-0'

export function TableModule({ module, onChange, revision }: { module: ProjectModule; revision?: number; onChange: (patch: Partial<ProjectModule>, expectedRevision?: number) => void | Promise<boolean> }) {
  const storedTable = useMemo(() => module.table || createApplicationTable(), [module.table])
  const draft = useDraft(storedTable, async (table, expectedRevision) => (await onChange({ table }, expectedRevision)) !== false, { resetKey: module.id, revision })
  const table = draft.value
  const [expanded, setExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState({ id: '', descending: false })
  const [configure, setConfigure] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState<TableColumn['type']>('text')
  const [newOptions, setNewOptions] = useState('')
  const selected = table.rows.find((row) => row.id === selectedId)
  const status = table.columns.find((column) => column.type === 'select')
  function save(next: TableConfig) { draft.change(next) }
  function updateRow(id: string, patch: Partial<TableRow>) {
    save({ ...table, rows: table.rows.map((row) => row.id === id ? { ...row, ...patch } : row) })
  }
  function updateCell(row: TableRow, column: TableColumn, value: string) {
    const history = column.type === 'select' && row.cells[column.id] !== value
      ? [...(row.history || []), { date: new Date().toISOString(), text: `${column.label} : ${value || '—'}` }]
      : row.history
    updateRow(row.id, { cells: { ...row.cells, [column.id]: value }, history })
  }
  function addRow() {
    save({ ...table, rows: [...table.rows, { id: uid('row'), cells: Object.fromEntries(table.columns.map((c) => [c.id, c.type === 'select' ? c.options?.[0] || '' : ''])), history: [{ date: new Date().toISOString(), text: 'Création' }] }] })
  }
  const rows = table.rows.filter((row) =>
    (!filter || (status && row.cells[status.id] === filter)) &&
    (!query || Object.values(row.cells).some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
  ).sort((a, b) => sort.id ? (a.cells[sort.id] || '').localeCompare(b.cells[sort.id] || '', 'fr', { numeric: true }) * (sort.descending ? -1 : 1) : 0)

  function cell(row: TableRow, column: TableColumn) {
    const value = row.cells[column.id] || ''
    const label = `${column.label} — ligne ${table.rows.indexOf(row) + 1}`
    if (column.type === 'select') return <select className={fieldClass} aria-label={label} value={value} onChange={(e) => updateCell(row, column, e.target.value)}><option value="">—</option>{column.options?.map((option) => <option key={option}>{option}</option>)}</select>
    return <div className="flex items-center gap-1"><input className={`${fieldClass} w-full`} aria-label={label} type={column.type === 'date' ? 'date' : 'text'} value={value} onChange={(e) => updateCell(row, column, e.target.value)} />{column.type === 'url' && safeTableUrl(value) && <GhostButton onClick={async () => { const error = await window.api.openExternal(safeTableUrl(value)!); if (error) window.alert(error) }}>Ouvrir</GhostButton>}</div>
  }

  function content() {
    return <div className="min-w-0 flex flex-col gap-3" onBlur={() => void draft.flush()}>
      <div className="flex flex-wrap items-center gap-2">
        {expanded && <EditableModuleTitle title={module.title || 'Table'} onChange={(title) => onChange({ title })} />}
        <GhostButton onClick={() => setConfigure(!configure)}>Colonnes</GhostButton>
        {!expanded && <GhostButton onClick={() => setExpanded(true)}>Pleine largeur</GhostButton>}
        <div className="ml-auto min-w-0 w-52 max-w-full">
        <Input aria-label="Rechercher dans la table" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full" />
        </div>
      </div>
      {configure && <div className="border border-border rounded-lg p-3 flex flex-col gap-2">
        {table.columns.map((column) => <div key={column.id} className="flex flex-wrap gap-2 items-center">
          <Input aria-label={`Nom de colonne ${column.label}`} value={column.label} onChange={(e) => save({ ...table, columns: table.columns.map((c) => c.id === column.id ? { ...c, label: e.target.value } : c) })} />
          <span className="text-xs text-text-muted">{column.type}</span>
          <PrimaryButton disabled={table.columns.length <= 1} onClick={() => { if (window.confirm(`Supprimer la colonne « ${column.label} » et son contenu ?`)) save({ columns: table.columns.filter((c) => c.id !== column.id), rows: table.rows.map((row) => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).filter(([id]) => id !== column.id)) })) }) }}>Supprimer</PrimaryButton>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Nouvelle colonne" placeholder="Nom de la colonne" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <select aria-label="Type de colonne" className={fieldClass} value={newType} onChange={(e) => setNewType(e.target.value as TableColumn['type'])}><option value="text">Texte</option><option value="date">Date</option><option value="url">Lien</option><option value="select">Choix</option></select>
          {newType === 'select' && <Input aria-label="Choix de la colonne" placeholder="Choix séparés par des virgules" value={newOptions} onChange={(e) => setNewOptions(e.target.value)} />}
          <PrimaryButton disabled={!newLabel.trim() || (newType === 'select' && !newOptions.trim())} onClick={() => { save({ ...table, columns: [...table.columns, { id: uid('col'), label: newLabel.trim(), type: newType, ...(newType === 'select' ? { options: [...new Set(newOptions.split(',').map((s) => s.trim()).filter(Boolean))] } : {}) }] }); setNewLabel(''); setNewOptions('') }}>Ajouter la colonne</PrimaryButton>
        </div>
        {table.rows.length === 0 && <GhostButton onClick={() => { save({ columns: [{ id: uid('col'), label: 'Nom', type: 'text' }], rows: [] }); setFilter(''); setSort({ id: '', descending: false }) }}>Table vierge</GhostButton>}
      </div>}
      <div className="flex flex-wrap gap-2 items-center">
        {status && <select aria-label="Filtrer par statut" className={fieldClass} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Tous les statuts</option>{status.options?.map((option) => <option key={option}>{option}</option>)}</select>}
        <span className="text-xs text-text-muted">{rows.length} / {table.rows.length} lignes</span>
        <button type="button" onClick={addRow} className={`${fieldClass} ml-auto bg-accent text-accent-text cursor-pointer hover:brightness-105`}>Ajouter une ligne</button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse"><thead><tr>{table.columns.map((column) => <th key={column.id} className="text-left p-2 bg-surface2 border-b border-border min-w-44"><button type="button" className="cursor-pointer text-left" onClick={() => setSort({ id: column.id, descending: sort.id === column.id && !sort.descending })}>{column.label}{sort.id === column.id ? sort.descending ? ' ↓' : ' ↑' : ''}</button></th>)}<th className="p-2 border-b border-border">Détails</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>{table.columns.map((column) => <td className="p-2 border-b border-border" key={column.id}>{cell(row, column)}</td>)}<td className="p-2 border-b border-border"><GhostButton onClick={() => setSelectedId(row.id)}>Détails</GhostButton></td></tr>)}</tbody></table>
        {!rows.length && <p className="p-4 text-sm text-text-muted">{table.rows.length ? 'Aucun résultat pour ces filtres.' : 'Ajoute une première ligne pour commencer ton suivi.'}</p>}
      </div>
      <p className="text-xs text-text-faint" role="status">{draft.state === 'saving' ? 'Enregistrement…' : draft.state === 'error' ? 'Non enregistré. Le brouillon est conservé.' : 'Les modifications sont enregistrées après la saisie.'}</p>
      {draft.state === 'error' && <GhostButton onClick={() => void draft.flush()}>Réessayer l’enregistrement</GhostButton>}
    </div>
  }
  // One dialog at a time keeps focus and Escape handling within the active view.
  return <>
    {expanded || selected ? <GhostButton onClick={() => { setExpanded(true); setSelectedId(null) }}>Ouvrir la table</GhostButton> : content()}
    {expanded && !selected && <Modal open title={module.title || 'Table'} onClose={() => setExpanded(false)} center>{content()}</Modal>}
    {selected && <Modal open title="Détail de la ligne" onClose={() => setSelectedId(null)} center>
      <div className="flex flex-col gap-3">{table.columns.map((column) => <label key={column.id} className="flex flex-col gap-1 text-sm">{column.label}{cell(selected, column)}</label>)}
      <label className="flex flex-col gap-1 text-sm">Contact<Input aria-label="Contact" value={selected.contact || ''} onChange={(e) => updateRow(selected.id, { contact: e.target.value })} /></label>
      <label className="flex flex-col gap-1 text-sm">Notes<Textarea aria-label="Notes" value={selected.notes || ''} onChange={(e) => updateRow(selected.id, { notes: e.target.value })} /></label>
      <h3 className="font-semibold text-sm">Historique</h3>{selected.history?.map((entry, i) => <p key={i} className="text-xs text-text-muted">{new Date(entry.date).toLocaleString('fr-FR')} · {entry.text}</p>)}
      <GhostButton onClick={() => { if (window.confirm('Supprimer cette ligne ?')) { save({ ...table, rows: table.rows.filter((r) => r.id !== selected.id) }); setSelectedId(null) } }}>Supprimer la ligne</GhostButton></div>
    </Modal>}
  </>
}
