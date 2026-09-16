import type { AppData } from './types'
import { daysAgo, flattenTasks, timeAgo } from './helpers'

export interface DailyTip {
  text: string
  projectId: string | null
}

export function generateDailyTips(d: AppData): DailyTip[] {
  const tips: DailyTip[] = []
  const active = d.projects.filter((p) => p.status === 'actif')
  const stalest = active.slice().sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0]
  if (stalest && daysAgo(stalest.updatedAt) >= 3) {
    tips.push({
      text: `Vous n'avez pas touché à « ${stalest.name} » depuis ${timeAgo(stalest.updatedAt)}. C'est peut-être le moment d'y revenir.`,
      projectId: stalest.id,
    })
  }

  const upcoming: { p: (typeof d.projects)[number]; dl: (typeof d.projects)[number]['deadlines'][number] }[] = []
  d.projects.forEach((p) => {
    ;(p.deadlines || []).forEach((dl) => {
      if (dl.status !== 'fait' && daysAgo(dl.date) >= -7 && daysAgo(dl.date) <= 0) {
        upcoming.push({ p, dl })
      }
    })
  })
  upcoming.sort((a, b) => new Date(a.dl.date).getTime() - new Date(b.dl.date).getTime())
  if (upcoming[0]) {
    const u = upcoming[0]
    const days = -daysAgo(u.dl.date)
    tips.push({
      text: `Échéance « ${u.dl.label} » dans ${days} jour${days > 1 ? 's' : ''} sur « ${u.p.name} ».`,
      projectId: u.p.id,
    })
  }

  const openErrCount = d.errors.filter((e) => daysAgo(e.createdAt) <= 14).length
  if (openErrCount > 0) {
    tips.push({
      text: `${openErrCount} erreur${openErrCount > 1 ? 's ont' : ' a'} été enregistrée${openErrCount > 1 ? 's' : ''} ces 2 dernières semaines. Un coup d'œil pour repérer un pattern ?`,
      projectId: null,
    })
  }

  let inProgressTasks = 0
  d.projects.forEach((p) =>
    flattenTasks(p.tasks).forEach((r) => {
      if (r.node.status === 'en_cours' && r.depth === 0) inProgressTasks++
    })
  )
  if (tips.length < 2 && inProgressTasks > 0) {
    tips.push({
      text: `${inProgressTasks} tâche${inProgressTasks > 1 ? 's' : ''} en cours à travers vos projets actifs. Petit à petit.`,
      projectId: null,
    })
  }

  if (!tips.length) {
    tips.push({ text: "Aucun projet en souffrance aujourd'hui, tout roule.", projectId: null })
  }

  return tips.slice(0, 3)
}
