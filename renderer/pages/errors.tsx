import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { Markdown } from '../components/Markdown'
import { parseAiErrorDraft, requestAiJson } from '../lib/aiCreation'
import { daysAgo, timeAgo } from '../lib/helpers'

type DateFilter = '7' | '30' | 'older' | null

export default function ErrorsPage() {
  const { data, loading, addError, updateError, removeError, linkError, unlinkError } = useData()
  const router = useRouter()

  const [filterProjectIds, setFilterProjectIds] = useState<string[]>([])
  const [filterUnlinked, setFilterUnlinked] = useState(false)
  const [filterDate, setFilterDate] = useState<DateFilter>(null)

  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const aiRequest = useRef(0)
  const [viewId, setViewId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingRevision, setEditingRevision] = useState<number | undefined>()
  const [saving, setSaving] = useState(false)
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

  function closeEditor() {
    aiRequest.current += 1
    setAiLoading(false)
    setEditorOpen(false)
  }

  async function generateError() {
    if (!aiPrompt.trim() || aiLoading) return
    const requestId = ++aiRequest.current
    setAiLoading(true)
    setAiError('')
    try {
      const draft = await requestAiJson(
        ['Rédige une fiche erreur à partir de la demande. Réponds uniquement en JSON avec title, content, causes, solution (chaînes de caractères en Markdown). Distingue les causes possibles des faits établis, ne prétends pas avoir testé la solution. Ne répète pas le titre dans le contenu.',
          `Demande : ${aiPrompt}`, `Fiche actuelle : ${JSON.stringify({ title, content, causes, solution })}`].join('\n'),
        (request) => window.api.ai.call(request),
        parseAiErrorDraft, () => {},
      )
      if (aiRequest.current !== requestId) return
      setTitle(draft.title); setContent(draft.content); setCauses(draft.causes); setSolution(draft.solution)
      setTab('manuel')
    } catch (reason) {
      if (aiRequest.current === requestId) setAiError(reason instanceof Error ? reason.message : 'La génération a échoué.')
    } finally {
      if (aiRequest.current === requestId) setAiLoading(false)
    }
  }

  function openNew(projectIds: string[] = []) {
    aiRequest.current += 1
    setAiPrompt('')
    setAiError('')
    setAiLoading(false)
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
    aiRequest.current += 1
    setAiLoading(false)
    setAiPrompt('')
    setAiError('')
    setEditingId(e.id)
    setEditingRevision(e.revision)
    setTab('manuel')
    setTitle(e.title)
    setContent(e.content)
    setCauses(e.causes)
    setSolution(e.solution)
    setLinkedProjectIds(e.projectIds)
    setEditorOpen(true)
    setViewId(null)
  }

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      if (editingId) {
        if (!await updateError(editingId, { title: title.trim(), content, causes, solution }, editingRevision)) return
        if (editingRevision !== undefined) setEditingRevision(editingRevision + 1)
        const previous = data.errors.find((error) => error.id === editingId)?.projectIds || []
        for (const id of linkedProjectIds) if (!previous.includes(id) && !await linkError(id, editingId)) return
        for (const id of previous) if (!linkedProjectIds.includes(id) && !await unlinkError(id, editingId)) return
      } else {
        if (!await addError({ title: title.trim(), content, causes, solution, projectIds: linkedProjectIds })) return
      }
      closeEditor()
    } finally { setSaving(false) }
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
            <Markdown text={viewError.content} />
            <FieldLabel>Cause</FieldLabel>
            <Markdown text={viewError.causes} />
            <FieldLabel>Solution</FieldLabel>
            <Markdown text={viewError.solution} />
            <div className="flex gap-2 mt-4">
              <SecondaryButton onClick={() => openEdit(viewError)}>Modifier</SecondaryButton>
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm(`Supprimer l'erreur « ${viewError.title} » ?`)) {
                    if (await removeError(viewError.id)) setViewId(null)
                  }
                }}
                className="flex items-center gap-1.5 border-none bg-transparent text-danger text-[13.5px] font-semibold cursor-pointer" title="Supprimer cet élément" aria-label="Supprimer cet élément"
              >
                <TrashIcon size={14} /> Supprimer
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={editorOpen}
        onClose={closeEditor}
        title={editingId ? "Modifier l'erreur" : 'Nouvelle erreur'}
        width={560}
      >
        <div className="flex gap-2 mb-3">
          <Chip label="Manuel" active={tab === 'manuel'} onClick={() => { aiRequest.current += 1; setAiLoading(false); setTab('manuel') }} />
          <Chip label="✨ IA" active={tab === 'ia'} onClick={() => setTab('ia')} />
        </div>
        {tab === 'ia' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">Décris le problème ou colle les logs. L’IA prépare les détails ; tu peux les modifier avant d’enregistrer.</p>
            <Textarea aria-label="Demande à l’IA" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Contexte, comportement attendu, message d’erreur…" className="w-full min-h-48" disabled={aiLoading} />
            {aiError && <p role="alert" className="text-sm text-danger">{aiError}</p>}
            <PrimaryButton onClick={generateError} disabled={aiLoading || !aiPrompt.trim()}><span className="flex items-center gap-2"><SparklesIcon size={16} />{aiLoading ? 'Génération…' : 'Préparer la fiche erreur'}</span></PrimaryButton>
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
              <PrimaryButton onClick={save} disabled={!title.trim() || saving}>Enregistrer</PrimaryButton>
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
        active ? 'border-accent bg-accent-soft text-accent-soft-text' : 'border-border bg-transparent text-text'
      }`}
    >
      {label}
    </button>
  )
}
