import type { ProjectTrackerSdk } from '../../../sdk/src'
import { plannedMinutes, type PlannedSlot } from './model'
let generation = 0
const root = document.getElementById('report')!
function line(text: string) { const node = document.createElement('p'); node.textContent = text; return node }
async function render(sdk: ProjectTrackerSdk) {
  const request = ++generation
  try {
    const context = await sdk.call('context.get', {})
    if (!context.instance || context.kind !== 'feature') { root.replaceChildren(line('Aucune semaine consultée.')); return }
    const exported = await sdk.packages.readExport({ package: 'builtin.week', export: 'week-slots', instanceId: context.instance.instanceId })
    if (exported.instance?.instanceId !== context.instance.instanceId) throw Error('Instance modifiée.')
    const projects: { id: string; name: string }[] = []
    let cursor: string | undefined
    do { const page = await sdk.call('core.list', { resource: 'projects', ...(cursor ? { cursor } : {}) }); projects.push(...page.items as { id: string; name: string }[]); cursor = page.nextCursor ?? undefined } while (cursor)
    const document = exported.documents.find(item => item.collection === 'week' && item.id === 'schedule')?.value as { slots?: PlannedSlot[] } | undefined
    const report = plannedMinutes(document?.slots ?? [], projects)
    if (request !== generation) return
    const title = documentTitle(context.instance.name)
    root.replaceChildren(title, line(`Total planifié : ${report.total} minutes`), ...report.days.map((minutes, day) => line(`${['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][day]} : ${minutes} minutes`)), ...report.projects.map(item => line(`${item.label} : ${item.minutes} minutes`)))
  } catch (error) { console.warn('Bilan indisponible', error); if (request === generation) root.replaceChildren(line('Bilan indisponible. Les données sont conservées.')) }
}
function documentTitle(name: string) { const title = document.createElement('h2'); title.textContent = `Bilan de la semaine — ${name}`; return title }
void ProjectTracker.ready.then(sdk => { void render(sdk); void sdk.events.subscribe(['exports.changed', 'core.projects.changed'], () => { void render(sdk) }).catch(() => {}) })
