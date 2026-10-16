import type { ReactNode } from 'react'
import type { CoreWidgetId } from '../../shared/core'
import { resolveCoreContribution } from '../../shared/contributionRegistry'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { ProjectCard } from './ProjectCard'
import { StatusPill } from './ui'
import { useData } from '../lib/store'
import { daysUntil, flattenTasks, fmtShort, timeAgo, todayISO } from '../lib/helpers'
import { generateDailyTips, type DailyTip } from '../lib/tips'
import { CalendarIcon, SparklesIcon } from './icons'

const DEADLINES_SHOWN = 8

export function useCoreWidgets() {
  const { data, loading } = useData()
  const router = useRouter()
  const [tips, setTips] = useState<DailyTip[]>([])

  useEffect(() => {
    if (loading) return
    try {
      const raw = window.localStorage.getItem('tracker_daily_tips')
      const today = todayISO()
      const stored = raw ? (JSON.parse(raw) as { date: string; tips: DailyTip[] }) : null
      if (stored && stored.date === today) {
        setTips(stored.tips)
      } else {
        const generated = generateDailyTips(data)
        window.localStorage.setItem(
          'tracker_daily_tips',
          JSON.stringify({ date: today, tips: generated })
        )
        setTips(generated)
      }
    } catch {
      setTips(generateDailyTips(data))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const projectsSorted = useMemo(
    () =>
      data.projects
        .slice()
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [data.projects]
  )
  const recentProjects = projectsSorted.slice(0, 3)

  const activeCount = data.projects.filter((p) => p.status === 'actif').length
  const openTasksCount = data.projects.reduce(
    (acc, p) => acc + flattenTasks(p.tasks).filter((r) => r.node.status !== 'fait').length,
    0
  )
  const stalest =
    projectsSorted.filter((p) => p.status !== 'termine' && p.status !== 'aborted').slice(-1)[0] ||
    projectsSorted[projectsSorted.length - 1]

  const stats = [
    { value: String(activeCount), label: 'Projets actifs' },
    { value: String(data.projects.length), label: 'Projets au total' },
    { value: String(openTasksCount), label: 'Tâches ouvertes' },
    {
      value: stalest ? timeAgo(stalest.updatedAt) : '—',
      label: stalest ? `Sans activité : ${stalest.name}` : 'Sans activité',
    },
  ]

  const upcomingDeadlines = useMemo(() => {
    return data.projects
      .flatMap((p) =>
        (p.deadlines || [])
          .filter((d) => d.status !== 'fait')
          .map((d) => ({ ...d, projectId: p.id, projectName: p.name, days: daysUntil(d.date) }))
      )
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data.projects])

  const activity = useMemo(() => {
    const raw = data.notes
      .map((n) => ({ t: n.updatedAt, text: `Note « ${n.title} » modifiée` }))
      .concat(data.errors.map((e) => ({ t: e.createdAt, text: `Erreur « ${e.title} » enregistrée` })))
      .concat(data.projects.map((p) => ({ t: p.updatedAt, text: `Projet « ${p.name} » mis à jour` })))
    return raw.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime()).slice(0, 6)
  }, [data])

  const stat = (index: number) => {
    const value = stats[index]
    return <div className="h-full min-h-0 flex flex-col justify-center bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-2xl font-bold font-mono">{value.value}</div>
      <div className="text-xs text-text-muted mt-1 truncate" title={value.label}>{value.label}</div>
    </div>
  }
  const widgets: Record<CoreWidgetId, () => ReactNode> = {
    'stat-active-projects': () => stat(0),
    'stat-total-projects': () => stat(1),
    'stat-open-tasks': () => stat(2),
    'stat-stalest-project': () => stat(3),
    'tips': () => tips.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-1.5 mb-3.5">
            <SparklesIcon size={15} />
            <h2 className="text-[16px] font-bold">Conseils du jour</h2>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))' }}>
            {tips.map((t, i) => (
              <div
                key={i}
                className="bg-accent-soft border border-accent rounded-xl p-4 flex flex-col gap-2"
              >
                <p className="text-[13px] text-text leading-relaxed">{t.text}</p>
                {t.projectId && (
                  <button
                    type="button"
                    onClick={() => router.push(`/project?id=${t.projectId}`)}
                    className="border-none bg-transparent text-accent font-bold text-xs cursor-pointer underline self-start p-0"
                  >
                    Voir le projet →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ),
    'deadlines': () => upcomingDeadlines.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-1.5 mb-3.5">
            <CalendarIcon size={15} />
            <h2 className="text-[16px] font-bold">Échéances</h2>
          </div>
          <div className="flex flex-col gap-0.5 bg-surface border border-border rounded-xl p-1.5">
            {upcomingDeadlines.slice(0, DEADLINES_SHOWN).map((d) => {
              const overdue = d.days < 0
              const label = overdue ? `En retard de ${-d.days}j` : d.days === 0 ? "Aujourd'hui" : `Dans ${d.days}j`
              return (
                <div
                  key={d.id}
                  onClick={() => router.push(`/project?id=${d.projectId}`)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-surface-hover transition-colors"
                >
                  <StatusPill label={label} tone={overdue ? 'danger' : d.days === 0 ? 'warning' : 'neutral'} />
                  <span className="text-sm text-text flex-1 truncate">{d.label}</span>
                  <span className="text-[11.5px] text-text-faint">{d.projectName}</span>
                  <span className="text-[11.5px] text-text-faint font-mono">{fmtShort(d.date)}</span>
                </div>
              )
            })}
            {upcomingDeadlines.length > DEADLINES_SHOWN && (
              <p className="text-[11.5px] text-text-faint px-2.5 py-1.5">
                + {upcomingDeadlines.length - DEADLINES_SHOWN} autre
                {upcomingDeadlines.length - DEADLINES_SHOWN > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      ),
    'recent-projects': () => (<div className="mb-8">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-[16px] font-bold">Projets récents</h2>
          {data.projects.length > 0 && (
            <button
              type="button"
              onClick={() => router.push('/projects')}
              className="border-none bg-transparent text-accent font-semibold text-[13px] cursor-pointer"
            >
              Voir tout →
            </button>
          )}
        </div>
        {recentProjects.length === 0 ? (
          <EmptyHomeState onCreate={() => router.push('/projects/new')} />
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))' }}>
            {recentProjects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>),
    'activity': () => activity.length > 0 && (
        <div>
          <h2 className="text-[16px] font-bold mb-3.5">Activité récente</h2>
          <div className="flex flex-col gap-0.5 bg-surface border border-border rounded-xl p-1.5">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                <span className="text-sm text-text flex-1">{a.text}</span>
                <span className="text-[11.5px] text-text-faint font-mono">{timeAgo(a.t)}</span>
              </div>
            ))}
          </div>
        </div>
      ),
  }
  const renderWidget = (id: CoreWidgetId) => {
    const contribution = resolveCoreContribution({ packageId: 'core', contributionId: id }, 'widget')
    return contribution?.type === 'widget' ? widgets[contribution.adapter]() : <p>Widget indisponible.</p>
  }

  return { loading, render: (id: CoreWidgetId) => {
    const result = renderWidget(id)
    return result === null || result === false || result === undefined ? <p role="status">Aucune donnée pour ce widget.</p> : result
  } }
}

function EmptyHomeState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-surface border border-dashed border-border rounded-xl p-8 text-center flex flex-col items-center gap-3">
      <p className="text-sm text-text-muted">Aucun projet pour l&apos;instant.</p>
      <button
        type="button"
        onClick={onCreate}
        className="border-none bg-accent text-accent-text font-bold text-[13.5px] px-4 py-2.5 rounded-lg cursor-pointer"
      >
        Créer mon premier projet
      </button>
    </div>
  )
}
