import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../../components/AppShell'
import { Markdown } from '../../components/Markdown'
import { Modal, PrimaryButton, SecondaryButton, Spinner, Textarea } from '../../components/ui'
import { TagsInput } from '../../components/TagsInput'
import { ArrowLeftIcon, SparklesIcon, TrashIcon } from '../../components/icons'
import { useData } from '../../lib/store'
import { useToast } from '../../components/Toast'

type Mode = 'edit' | 'preview'

export default function NoteDetailPage() {
  const router = useRouter()
  const id = typeof router.query.id === 'string' ? router.query.id : undefined
  const fromProjectId = typeof router.query.projectId === 'string' ? router.query.projectId : undefined
  const { data, findNote, updateNote, removeNote } = useData()
  const { showToast } = useToast()

  const note = id ? findNote(id) : undefined
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [content, setContent] = useState('')
  const [raw, setRaw] = useState(false)
  const [mode, setMode] = useState<Mode>('edit')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const loadedIdRef = useRef<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [editing, setEditing] = useState(false)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiRequestIdRef = useRef(0)

  const tagSuggestions = useMemo(
    () => Array.from(new Set(data.notes.flatMap((n) => n.tags))).sort(),
    [data.notes]
  )

  useEffect(() => {
    if (!note || loadedIdRef.current === note.id) return
    loadedIdRef.current = note.id
    setTitle(note.title)
    setTags(note.tags)
    setContent(note.content)
    setRaw(!!note.raw)
    setMode(note.content.trim() ? 'preview' : 'edit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note])

  function commit(patch: Partial<{ title: string; tags: string[]; content: string; raw: boolean }>) {
    if (!id) return
    updateNote(id, {
      title: patch.title ?? title,
      content: patch.content ?? content,
      tags: patch.tags ?? tags,
      raw: patch.raw ?? raw,
    })
    setSavedAt(new Date().toISOString())
  }

  function handleDelete() {
    if (!id || !note) return
    if (!window.confirm(`Supprimer « ${note.title || 'Sans titre'} » ?`)) return
    removeNote(id)
    router.push(fromProjectId ? `/project?id=${fromProjectId}` : '/notes')
  }

  const savedLabel = useMemo(
    () => (savedAt ? `Enregistré à ${new Date(savedAt).toLocaleTimeString('fr-FR')}` : ''),
    [savedAt]
  )

  function closeAiEditor() {
    // Ignore an answer that arrives after the user has discarded the request.
    aiRequestIdRef.current += 1
    setEditing(false)
    setPrompt('')
    setAiResponse(null)
    setAiError(null)
    setAiLoading(false)
  }

  async function editWithAI(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const instruction = prompt.trim()
    if (!instruction || aiLoading) return

    const requestId = aiRequestIdRef.current + 1
    aiRequestIdRef.current = requestId
    setAiLoading(true)
    setAiError(null)
    setAiResponse(null)

    const request = [
      'Modifie la note ci-dessous selon la demande de l’utilisateur.',
      'Réponds uniquement avec le contenu final de la note, sans explication ni introduction.',
      raw ? 'Conserve le contenu en texte brut.' : 'Conserve ou améliore la mise en forme Markdown.',
      '',
      `Demande : ${instruction}`,
      '',
      'Contenu actuel de la note :',
      '---',
      content,
      '---',
    ].join('\n')

    try {
      const answer = await window.api.groq.call(request)
      if (aiRequestIdRef.current !== requestId) return
      setAiResponse(answer.trim())
    } catch (error) {
      if (aiRequestIdRef.current !== requestId) return
      setAiError(error instanceof Error ? error.message : 'La génération a échoué. Réessaie.')
    } finally {
      if (aiRequestIdRef.current === requestId) setAiLoading(false)
    }
  }

  function acceptAiResponse() {
    if (aiResponse === null) return
    setContent(aiResponse)
    commit({ content: aiResponse })
    setMode('preview')
    closeAiEditor()
    showToast('La proposition de l’IA a été appliquée.')
  }

  return (
    <AppShell title={note ? title || 'Sans titre' : 'Note'}>
      <button
        type="button"
        onClick={() => router.push(fromProjectId ? `/project?id=${fromProjectId}` : '/notes')}
        className="flex items-center gap-1.5 border-none bg-transparent text-text-muted cursor-pointer text-[13px] mb-4 p-0"
      >
        <ArrowLeftIcon size={14} /> {fromProjectId ? 'Retour au projet' : 'Retour aux notes'}
      </button>

      {!note ? (
        <div className="flex items-center gap-2 text-sm text-text-faint">
          <Spinner size={16} /> Chargement…
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => commit({ title })}
              placeholder="Titre"
              className="flex-1 min-w-[200px] bg-transparent text-[26px] font-bold outline-none"
              />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 border border-accent bg-accent-soft text-accent-text font-bold text-[12.5px] px-3 py-1.5 rounded-lg cursor-pointer"
              >
                <SparklesIcon size={13} /> Éditer avec l&apos;IA
              </button>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <button
                  type="button"
                  role="switch"
                  aria-checked={raw}
                  onClick={() => {
                    const next = !raw
                    setRaw(next)
                    commit({ raw: next })
                  }}
                  title="Basculer entre Markdown et texte brut"
                  className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors border-none cursor-pointer ${
                    raw ? 'bg-accent' : 'bg-surface2'
                  }`}
                >
                  <span
                    className={`absolute w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${
                      raw ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
                <span className="text-[12.5px] text-text-muted font-semibold">Raw</span>
              </label>
              <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  className={`px-3.5 py-1.5 cursor-pointer border-none ${
                    mode === 'edit' ? 'bg-accent text-accent-text font-bold' : 'bg-transparent text-text-muted'
                  }`}
                >
                  Éditer
                </button>
                <button
                  type="button"
                  onClick={() => setMode('preview')}
                  className={`px-3.5 py-1.5 cursor-pointer border-none ${
                    mode === 'preview' ? 'bg-accent text-accent-text font-bold' : 'bg-transparent text-text-muted'
                  }`}
                >
                  Aperçu
                </button>
              </div>
              <button
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-1.5 border-none bg-transparent text-text-faint hover:text-danger text-[13px] font-semibold cursor-pointer"
              >
                <TrashIcon size={14} /> Supprimer
              </button>
            </div>
          </div>

          <TagsInput
            tags={tags}
            onChange={(next) => {
              setTags(next)
              commit({ tags: next })
            }}
            suggestions={tagSuggestions}
            placeholder="Ajouter un tag…"
            className="w-full max-w-sm mb-4"
          />

          {mode === 'edit' ? (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={() => commit({ content })}
              placeholder={raw ? 'Écris ta note en texte brut…' : 'Écris ta note en markdown…'}
              className="w-full font-mono"
              style={{ minHeight: '60vh' }}
              autoFocus
            />
          ) : (
            <div className="min-h-[60vh] rounded-lg border border-border bg-surface p-5">
              {content.trim() ? (
                raw ? (
                  <pre className="whitespace-pre-wrap font-mono text-[13.5px] text-text leading-relaxed">
                    {content}
                  </pre>
                ) : (
                  <Markdown text={content} />
                )
              ) : (
                <p className="text-text-faint text-sm">
                  Page vide — clique sur « Éditer » pour écrire.
                </p>
              )}
            </div>
          )}

          <div className="mt-2 h-4 text-xs text-text-faint">{savedLabel}</div>

          <Modal open={editing} onClose={closeAiEditor} title="Éditer avec l’IA" width={720} center>
            <form onSubmit={editWithAI} className="flex flex-col gap-3">
              <p className="text-[13.5px] text-text-muted leading-relaxed">
                Décris la modification souhaitée. La note actuelle est envoyée comme contexte et ne sera
                remplacée qu’après ton acceptation.
              </p>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ex. Rends cette note plus concise et corrige les fautes."
                disabled={aiLoading}
                required
                autoFocus
                className="w-full"
                style={{ minHeight: 100 }}
              />
              <div className="flex justify-end">
                <PrimaryButton type="submit" disabled={!prompt.trim() || aiLoading}>
                  <span className="flex items-center gap-1.5">
                    {aiLoading && <Spinner size={13} />}
                    <SparklesIcon size={13} /> {aiLoading ? 'Génération…' : 'Générer'}
                  </span>
                </PrimaryButton>
              </div>
            </form>

            {aiError && <p className="text-[13px] text-danger">{aiError}</p>}

            {aiResponse !== null && (
              <div className="flex flex-col gap-3 mt-2">
                <div>
                  <div className="text-[11px] font-bold text-text-faint uppercase tracking-wide mb-1.5">
                    Proposition de l&apos;IA
                  </div>
                  <div className="max-h-[38vh] overflow-auto rounded-lg border border-border bg-bg p-4">
                    {raw ? (
                      <pre className="whitespace-pre-wrap font-mono text-[13.5px] text-text leading-relaxed">
                        {aiResponse}
                      </pre>
                    ) : (
                      <Markdown text={aiResponse} />
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <SecondaryButton onClick={closeAiEditor}>Refuser</SecondaryButton>
                  <PrimaryButton onClick={acceptAiResponse}>Accepter la proposition</PrimaryButton>
                </div>
              </div>
            )}
          </Modal>
        </>
      )}
    </AppShell>
  )
}
