import React, { useState } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from '../../components/AppShell'
import { Chip, Input, PrimaryButton, SecondaryButton, Textarea } from '../../components/ui'
import { TagsInput } from '../../components/TagsInput'
import { TaskTree } from '../../components/TaskTree'
import { ChecklistList } from '../../components/ChecklistList'
import { DeadlineList } from '../../components/DeadlineList'
import { useData } from '../../lib/store'
import { addTaskNode, removeTaskNode, todayISO, uid, updateTaskNode } from '../../lib/helpers'
import {
  PROJECT_TYPE_LABEL,
  PROJECT_TYPE_ORDER,
  TASK_STATUS_ORDER,
  defaultChecklistStatus,
  nextChecklistStatus,
} from '../../lib/constants'
import { CodeIcon, VideoIcon } from '../../components/icons'
import type { ChecklistItem, ChecklistType, Deadline, ProjectType, TaskNode } from '../../lib/types'

const STEPS = ['Type', 'Catégorie', 'Nom', 'Plateformes', 'Notes', 'Éléments', 'Tâches', 'Échéances', 'Erreurs']

const PROJECT_TYPE_ICON: Record<ProjectType, React.ComponentType<{ size?: number; className?: string }>> = {
  dev: CodeIcon,
  video: VideoIcon,
}

export default function NewProjectPage() {
  const { data, addProject, addCategory, addPlatform, addNote } = useData()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [type, setType] = useState<ProjectType>('dev')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [errorIds, setErrorIds] = useState<string[]>([])
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [tasks, setTasks] = useState<TaskNode[]>([])
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [newPlatform, setNewPlatform] = useState('')
  const [nameError, setNameError] = useState(false)

  const [quickNoteTitle, setQuickNoteTitle] = useState('')
  const [quickNoteTags, setQuickNoteTags] = useState('')
  const [quickNoteContent, setQuickNoteContent] = useState('')

  async function finish() {
    if (!name.trim()) {
      setNameError(true)
      setStep(2)
      return
    }
    const project = await addProject({
      name: name.trim(),
      type,
      category: category || data.categories[0] || 'Software',
      platforms,
      tags,
      noteIds,
      errorIds,
      checklist,
      tasks,
      deadlines,
    })
    if (project) router.push(`/project?id=${project.id}`)
  }

  return (
    <AppShell title="Nouveau projet">
      <div style={{ maxWidth: 820 }}>
        <div className="flex mb-8 relative">
          <div
            className="absolute h-0.5 bg-border"
            style={{ top: 15, left: '6%', right: '6%', zIndex: 0 }}
          />
          {STEPS.map((label, i) => {
            const isDone = i < step
            const isActive = i === step
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(i)}
                className="relative z-10 flex-1 flex flex-col items-center gap-1.5 cursor-pointer bg-transparent border-none"
              >
                <span
                  className={`w-[30px] h-[30px] rounded-full flex items-center justify-center text-xs font-bold font-mono ${
                    isActive
                      ? 'bg-accent text-accent-text'
                      : isDone
                        ? 'bg-accent-soft text-accent border border-accent'
                        : 'bg-surface2 text-text-faint border border-border'
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`text-[11px] whitespace-nowrap ${
                    isActive ? 'font-bold text-text' : 'font-medium text-text-faint'
                  }`}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        <div className="bg-surface border border-border rounded-2xl p-7" style={{ minHeight: 320 }}>
          {step === 0 && (
            <StepBlock title="Type de projet" subtitle="Détermine par exemple les plateformes proposées à l'étape suivante.">
              <div className="flex gap-3 flex-wrap">
                {PROJECT_TYPE_ORDER.map((t) => {
                  const Icon = PROJECT_TYPE_ICON[t]
                  const active = type === t
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`flex items-center gap-2.5 px-5 py-4 rounded-xl border cursor-pointer transition-colors ${
                        active
                          ? 'border-accent bg-accent-soft text-accent-soft-text'
                          : 'border-border bg-transparent text-text hover:bg-surface-hover'
                      }`}
                    >
                      <Icon size={20} />
                      <span className="text-sm font-bold">{PROJECT_TYPE_LABEL[t]}</span>
                    </button>
                  )
                })}
              </div>
            </StepBlock>
          )}

          {step === 1 && (
            <StepBlock title="Catégorie">
              <div className="flex gap-2 flex-wrap">
                {data.categories.map((cat) => (
                  <Chip key={cat} label={cat} active={category === cat} onClick={() => setCategory(cat)} />
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Autre catégorie…"
                  className="flex-1"
                />
                <SecondaryButton
                  onClick={() => {
                    if (!newCategory.trim()) return
                    addCategory(newCategory.trim())
                    setCategory(newCategory.trim())
                    setNewCategory('')
                  }}
                >
                  Ajouter
                </SecondaryButton>
              </div>
            </StepBlock>
          )}

          {step === 2 && (
            <StepBlock title="Comment s'appelle ce projet ?">
              <Input
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(false)
                }}
                placeholder="Nom du projet"
                className="w-full text-lg py-3"
              />
              {nameError && <p className="text-xs text-danger mt-2">Le nom est obligatoire.</p>}
            </StepBlock>
          )}

          {step === 3 && (
            <StepBlock title="Sur quelles plateformes ?">
              <div className="flex gap-2 flex-wrap">
                {data.platforms[type].map((pl) => (
                  <Chip
                    key={pl}
                    label={pl}
                    active={platforms.includes(pl)}
                    onClick={() =>
                      setPlatforms((prev) =>
                        prev.includes(pl) ? prev.filter((x) => x !== pl) : prev.concat([pl])
                      )
                    }
                  />
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <Input
                  value={newPlatform}
                  onChange={(e) => setNewPlatform(e.target.value)}
                  placeholder="Autre plateforme…"
                  className="flex-1"
                />
                <SecondaryButton
                  onClick={() => {
                    if (!newPlatform.trim()) return
                    addPlatform(type, newPlatform.trim())
                    setPlatforms((prev) => prev.concat([newPlatform.trim()]))
                    setNewPlatform('')
                  }}
                >
                  Ajouter
                </SecondaryButton>
              </div>
              <div className="mt-5 pt-4 border-t border-dashed border-border">
                <p className="text-[12.5px] text-text-faint mb-2">
                  Tags (optionnel) — permettent de retrouver ce projet dans des SmartFolders.
                </p>
                <TagsInput tags={tags} onChange={setTags} placeholder="Ajouter un tag…" />
              </div>
            </StepBlock>
          )}

          {step === 4 && (
            <StepBlock title="Notes liées" subtitle="Rattache des notes existantes ou crées-en une nouvelle.">
              <div className="flex gap-2 flex-wrap mb-4">
                {data.notes.map((n) => (
                  <Chip
                    key={n.id}
                    label={n.title}
                    active={noteIds.includes(n.id)}
                    onClick={() =>
                      setNoteIds((prev) =>
                        prev.includes(n.id) ? prev.filter((x) => x !== n.id) : prev.concat([n.id])
                      )
                    }
                  />
                ))}
                {data.notes.length === 0 && (
                  <p className="text-[13px] text-text-faint">Pas encore de notes.</p>
                )}
              </div>
              <div className="pt-4 border-t border-dashed border-border flex flex-col gap-2">
                <Input
                  value={quickNoteTitle}
                  onChange={(e) => setQuickNoteTitle(e.target.value)}
                  placeholder="Titre de la nouvelle note"
                />
                <Input
                  value={quickNoteTags}
                  onChange={(e) => setQuickNoteTags(e.target.value)}
                  placeholder="Tags séparés par des virgules"
                />
                <Textarea
                  value={quickNoteContent}
                  onChange={(e) => setQuickNoteContent(e.target.value)}
                  placeholder="Contenu (markdown simple : #, ##, -, **gras**)"
                  rows={3}
                />
                <SecondaryButton
                  className="self-start"
                  onClick={async () => {
                    if (!quickNoteTitle.trim()) return
                    const note = await addNote({
                      title: quickNoteTitle.trim(),
                      content: quickNoteContent,
                      tags: quickNoteTags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                    if (!note) return
                    setNoteIds((prev) => prev.concat([note.id]))
                    setQuickNoteTitle('')
                    setQuickNoteTags('')
                    setQuickNoteContent('')
                  }}
                >
                  Créer et lier cette note
                </SecondaryButton>
              </div>
            </StepBlock>
          )}

          {step === 5 && (
            <StepBlock title="Éléments à suivre" subtitle="Matériel à acheter, dépendances, événements…">
              <ChecklistList
                items={checklist}
                projects={data.projects}
                onAdd={(input) =>
                  setChecklist((prev) =>
                    prev.concat([
                      {
                        id: uid('c'),
                        ...input,
                        type: input.type as ChecklistType,
                        status: defaultChecklistStatus(input.type),
                      },
                    ])
                  )
                }
                onCycleStatus={(id) =>
                  setChecklist((prev) =>
                    prev.map((c) => (c.id === id ? { ...c, status: nextChecklistStatus(c) } : c))
                  )
                }
                onSetStatus={(id, status) =>
                  setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
                }
                onUpdate={(id, patch) =>
                  setChecklist((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
                }
                onRemove={(id) => setChecklist((prev) => prev.filter((c) => c.id !== id))}
              />
            </StepBlock>
          )}

          {step === 6 && (
            <StepBlock title="Tâches">
              <TaskTree
                tasks={tasks}
                onAddTop={(taskName) =>
                  setTasks((prev) =>
                    prev.concat([{ id: uid('t'), name: taskName, content: '', status: 'a_faire', children: [] }])
                  )
                }
                onAddSub={(parentId, subName) =>
                  setTasks((prev) =>
                    addTaskNode(prev, parentId, {
                      id: uid('t'),
                      name: subName,
                      content: '',
                      status: 'a_faire',
                      children: [],
                    })
                  )
                }
                onCycleStatus={(id) =>
                  setTasks((prev) =>
                    updateTaskNode(prev, id, (t) => ({
                      ...t,
                      status: TASK_STATUS_ORDER[(TASK_STATUS_ORDER.indexOf(t.status) + 1) % TASK_STATUS_ORDER.length],
                    }))
                  )
                }
                onRemove={(id) => setTasks((prev) => removeTaskNode(prev, id))}
              />
            </StepBlock>
          )}

          {step === 7 && (
            <StepBlock title="Échéances">
              <DeadlineList
                deadlines={deadlines}
                onAdd={(label, date) =>
                  setDeadlines((prev) =>
                    prev.concat([
                      { id: uid('d'), label, date, status: date < todayISO() ? 'depasse' : 'a_venir' },
                    ])
                  )
                }
                onToggle={(id) =>
                  setDeadlines((prev) =>
                    prev.map((d) => (d.id === id ? { ...d, status: d.status === 'fait' ? 'a_venir' : 'fait' } : d))
                  )
                }
                onRemove={(id) => setDeadlines((prev) => prev.filter((d) => d.id !== id))}
              />
            </StepBlock>
          )}

          {step === 8 && (
            <StepBlock title="Erreurs liées" subtitle="Si ce projet est déjà lié à des erreurs connues.">
              <div className="flex gap-2 flex-wrap">
                {data.errors.map((er) => (
                  <Chip
                    key={er.id}
                    label={er.title}
                    active={errorIds.includes(er.id)}
                    onClick={() =>
                      setErrorIds((prev) =>
                        prev.includes(er.id) ? prev.filter((x) => x !== er.id) : prev.concat([er.id])
                      )
                    }
                  />
                ))}
                {data.errors.length === 0 && (
                  <p className="text-[13px] text-text-faint">
                    Pas encore d&apos;erreurs enregistrées. Tu pourras en ajouter depuis la page du projet.
                  </p>
                )}
              </div>
            </StepBlock>
          )}

          <div className="flex justify-between mt-6">
            {step > 0 ? (
              <SecondaryButton onClick={() => setStep((s) => s - 1)}>Précédent</SecondaryButton>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <PrimaryButton onClick={() => setStep((s) => s + 1)}>Suivant</PrimaryButton>
            ) : (
              <PrimaryButton onClick={finish}>Créer le projet</PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

function StepBlock({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-[18px] font-bold mb-1">{title}</h2>
      {subtitle && <p className="text-[12.5px] text-text-faint mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  )
}
