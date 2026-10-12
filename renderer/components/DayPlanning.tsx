import { minutes, slotColor, WEEK_DAYS, type WeekSlot } from '../lib/weekSchedule'

export function DayPlanning({ slots, now, projects, onOpenAgenda, onOpenProject }: {
  slots: WeekSlot[]
  now: Date | null
  projects: { id: string; name: string }[]
  onOpenAgenda: () => void
  onOpenProject: (id: string) => void
}) {
  if (!now) return null
  const today = (now.getDay() + 6) % 7
  const events = slots.filter((slot) => slot.day === today).sort((a, b) => minutes(a.start) - minutes(b.start))
  if (!events.length) return null
  const current = now.getHours() * 60 + now.getMinutes()
  return <aside aria-label="Planning du jour" className="bg-surface border border-border rounded-xl p-4 self-start">
    <div className="flex items-center justify-between gap-2 mb-1">
      <h2 className="text-[16px] font-bold">Planning du jour</h2>
      <button type="button" onClick={onOpenAgenda} className="text-accent text-xs font-semibold cursor-pointer">Agenda →</button>
    </div>
    <p className="text-xs text-text-muted mb-4">{WEEK_DAYS[today]} · {now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</p>
    <ol className="flex flex-col gap-3">
      {events.map((slot) => {
        const running = current >= minutes(slot.start) && current < minutes(slot.end)
        const finished = current >= minutes(slot.end)
        const project = projects.find((p) => p.id === slot.projectId)
        return <li key={slot.id} className={`border border-border rounded-lg p-3 ${finished ? 'opacity-60' : ''}`} style={{ borderLeft: `4px solid ${slotColor(slot.color)}`, backgroundColor: running ? `${slotColor(slot.color)}26` : undefined }}>
          <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
            <span className="font-mono text-text-muted">{slot.start} – {slot.end}</span>
            <span className={running ? 'text-accent font-bold' : 'text-text-faint'}>{running ? 'En cours' : finished ? 'Passé' : 'À venir'}</span>
          </div>
          <button type="button" onClick={onOpenAgenda} className="block text-left text-sm font-bold cursor-pointer break-words">{slot.title}</button>
          {slot.description && <p className="text-xs text-text-muted mt-1 line-clamp-3 whitespace-pre-wrap">{slot.description}</p>}
          {slot.location && <p className="text-xs text-text-muted mt-1 break-words">{slot.location}</p>}
          {project && <button type="button" onClick={() => onOpenProject(project.id)} className="block text-xs text-accent font-semibold cursor-pointer mt-2 text-left">{project.name} →</button>}
        </li>
      })}
    </ol>
  </aside>
}
