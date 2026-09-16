import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../components/AppShell'
import {
  Card,
  Chip,
  FieldLabel,
  Input,
  Modal,
  PrimaryButton,
  SecondaryButton,
  TagChip,
  Textarea,
} from '../components/ui'
import { PlusIcon, SparklesIcon, TrashIcon } from '../components/icons'
import { useData } from '../lib/store'
import { daysAgo, timeAgo } from '../lib/helpers'

type DateFilter = '7' | '30' | 'older' | null

export default function ErrorsPage() {
  const { data, loading, addError, updateError, removeError } = useData()
  const router = useRouter()

  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([])
  const [filterUnlinked, setFilterUnlinked] = useState(false)
  const [filterDate, setFilterDate] = useState<DateFilter>(null)

  const [viewId, setViewId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tab, setTab] = useState<'manuel' | 'ia'>('manuel')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [causes, setCauses] = useState('')
  const [solution, setSolution] = useState('')
  const [linkedProjectIds, setLinkedProjectIds] = useState<string[]>([])

  useEffect(() => {
    if (typeof router.query.open === 'string') setViewId(router.query.open)
    if (typeof router.query.newForProject === 'string') {
      openNew([router.query.newForProject])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.open, router.query.newForProject])

  const errorsSorted = useMemo(() => {
    return data.errors
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((e) => {
        if (filterProjectIds.length || filterUnlinked) {
          const linked = (e.projectIds || []).length > 0
          const passProj = (filterUnlinked && !linked) || (e.projectIds || []).some((pid) => filterProjectIds.includes(pid))
          if (!passProj) return false
        }
        if (filterDate) {
          const age = daysAgo(e.createdAt)
          if (filterDate === '7' && age > 7) return false
          if (filterDate === '30' && age > 30) return false
          if (filterDate === 'older' && age <= 30) return false
        }
        return true
      })
  }, [data.errors, filterProjectIds, filterUnlinked, filterDate])

  const viewError = viewId ? data.errors.find((e) => e.id === viewId) : null

  function openNew(projectIds: string[] = []) {
    setEditingId(null)
    setTab('manuel')
    setTitle('')
    setContent('')
    setCauses('')
    setSolution('')
    setLinkedProjectIds(projectIds)
    setEditorOpen(true)
  }

  function openEdit(e: NonNullable<typeof viewError>) {
    setEditingId(e.id)
    setTab('manuel')
    setTitle(e.title)
    setContent(e.content)
    setCauses(e.causes)
    setSolution(e.solution)
    setLinkedProjectIds(e.projectIds)
    setEditorOpen(true)
    setViewId(null)
  }

  function save() {
    if (!title.trim()) return
    if (editingId) {
      updateError(editingId, { title: title.trim(), content, causes, solution })
    } else {
      addError({ title: title.trim(), content, causes, solution, projectIds: linkedProjectIds })
    }
    setEditorOpen(false)
  }

  return (
    <AppShell title="Erreurs">
      <div className="flex justify-end mb-5">
        <PrimaryButton onClick={() => openNew()}>
          <span className="flex items-center gap-1.5">
            <PlusIcon size={14} /> Nouvelle erreur
          </span>
        </PrimaryButton>
      </div>

      <div className="grid gap-5 items-start" style={{ gridTemplateColumns: '1fr 300px' }}>
        <div>
          {!loading && errorsSorted.length === 0 && (
            <div className="bg-surface border border-dashed border-border rounded-xl p-10 text-center">
              <p className="text-sm text-text-muted">Aucune erreur ici.</p>
            </div>
          )}
          <div className="grid gap-4.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
            {errorsSorted.map((e) => (
              <Card key={e.id} onClick={() => setViewId(e.id)}>
                <div className="text-[14px] font-bold">{e.title}</div>
                <p className="text-[12.5px] text-text-muted">{e.content.slice(0, 100)}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {(e.projectIds || []).map((pid) => {
                    const p = data.projects.find((x) => x.id === pid)
                    return <TagChip key={pid} label={p ? p.name : '?'} />
                  })}
                </div>
                <div className="text-[11px] text-text-faint font-mono">{timeAgo(e.createdAt)}</div>
              </Card>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4.5 sticky top-0">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[14px] font-bold">Filtres</span>
              {(filterProjectIds.length > 0 || filterUnlinked || filterDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterProjectIds([])
                    setFilterUnlinked(false)
                    setFilterDate(null)
                  }}
                  className="border-none bg-transparent text-accent text-xs font-semibold cursor-pointer"
                >
                  Réinitialiser
                </button>
              )}
            </div>
          </div>
          <FilterGroup title="Projet">
            <div className="flex flex-col gap-1.5">
              {data.projects.map((p) => (
                <FilterRow
                  key={p.id}
                  label={p.name}
                  active={filterProjectIds.includes(p.id)}
                  onClick={() =>
                    setFilterProjectIds((prev) =>
                      prev.includes(p.id) ? prev.filter((x) => x !== p.id) : prev.concat([p.id])
                    )
                  }
                />
              ))}
              <FilterRow
                label="Sans projet lié"
                active={filterUnlinked}
                onClick={() => setFilterUnlinked((v) => !v)}
              />
            </div>
          </FilterGroup>
          <FilterGroup title="Période">
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ['7', '7 derniers jours'],
                  ['30', '30 derniers jours'],
                  ['older', 'Plus ancien'],
                ] as [DateFilter, string][]
              ).map(([k, l]) => (
                <FilterRow
                  key={k}
                  label={l}
                  active={filterDate === k}
                  onClick={() => setFilterDate((prev) => (prev === k ? null : k))}
                />
              ))}
            </div>
          </FilterGroup>
        </div>
      </div>

      <Modal open={!!viewError} onClose={() => setViewId(null)} title={viewError?.title || ''} width={560}>
        {viewError && (
          <>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {(viewError.projectIds || []).map((pid) => {
                const p = data.projects.find((x) => x.id === pid)
                return <TagChip key={pid} label={p ? p.name : '?'} />
              })}
            </div>
            <FieldLabel>Description</FieldLabel>
            <p className="text-[13.5px] text-text leading-relaxed">{viewError.content}</p>
            <FieldLabel>Cause</FieldLabel>
            <p className="text-[13.5px] text-text leading-relaxed">{viewError.causes}</p>
            <FieldLabel>Solution</FieldLabel>
            <p className="text-[13.5px] text-text leading-relaxed">{viewError.solution}</p>
            <div className="flex gap-2 mt-4">
              <SecondaryButton onClick={() => openEdit(viewError)}>Modifier</SecondaryButton>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Supprimer l'erreur « ${viewError.title} » ?`)) {
                    removeError(viewError.id)
                    setViewId(null)
                  }
                }}
                className="flex items-center gap-1.5 border-none bg-transparent text-danger text-[13.5px] font-semibold cursor-pointer"
              >
                <TrashIcon size={14} /> Supprimer
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? "Modifier l'erreur" : 'Nouvelle erreur'}
        width={560}
      >
        <div className="flex gap-2 mb-3">
          <Chip label="Manuel" active={tab === 'manuel'} onClick={() => setTab('manuel')} />
          <Chip label="✨ IA" active={tab === 'ia'} onClick={() => setTab('ia')} />
        </div>
        {tab === 'ia' ? (
          <div className="bg-accent-soft border border-accent rounded-lg p-4 flex items-center gap-2.5">
            <SparklesIcon size={16} className="text-accent-text flex-shrink-0" />
            <p className="text-[13px] text-accent-text">
              La génération assistée par IA arrive bientôt. Utilise l&apos;onglet Manuel pour
              l&apos;instant.
            </p>
          </div>
        ) : (
          <>
            <FieldLabel>Titre</FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" autoFocus />
            <FieldLabel>Description du problème</FieldLabel>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="w-full" style={{ minHeight: 70 }} />
            <FieldLabel>Cause</FieldLabel>
            <Textarea value={causes} onChange={(e) => setCauses(e.target.value)} className="w-full" style={{ minHeight: 60 }} />
            <FieldLabel>Solution</FieldLabel>
            <Textarea value={solution} onChange={(e) => setSolution(e.target.value)} className="w-full" style={{ minHeight: 60 }} />
            <FieldLabel>Projets liés</FieldLabel>
            <div className="flex gap-2 flex-wrap">
              {data.projects.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  active={linkedProjectIds.includes(p.id)}
                  onClick={() =>
                    setLinkedProjectIds((prev) =>
                      prev.includes(p.id) ? prev.filter((x) => x !== p.id) : prev.concat([p.id])
                    )
                  }
                />
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <PrimaryButton onClick={save}>Enregistrer</PrimaryButton>
            </div>
          </>
        )}
      </Modal>
    </AppShell>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  )
}

function FilterRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left text-[12.5px] font-semibold px-2.5 py-1.5 rounded-md border cursor-pointer ${
        active ? 'border-accent bg-accent-soft text-accent-text' : 'border-border bg-transparent text-text'
      }`}
    >
      {label}
    </button>
  )
}
