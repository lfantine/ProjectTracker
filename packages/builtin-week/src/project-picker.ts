import type { ProjectTrackerSdk } from '../../../sdk/src'
import type { CoreProjectView } from '../../../shared/sdk'

/** Preserve orphaned references; loading projects must never reset a draft. */
export function projectPicker(core: ProjectTrackerSdk['core'] | undefined, projectId?: string): { element: HTMLElement; select: HTMLSelectElement } {
  const wrapper = document.createElement('div')
  const label = document.createElement('label'); label.textContent = 'Projet'
  const select = document.createElement('select'); select.name = 'projectId'; select.setAttribute('aria-label', 'Projet')
  const none = document.createElement('option'); none.value = ''; none.textContent = 'Sans projet'; select.append(none)
  if (projectId) { const orphan = document.createElement('option'); orphan.value = projectId; orphan.textContent = 'Projet indisponible (référence conservée)'; select.append(orphan); select.value = projectId }
  label.append(select); wrapper.append(label); const result = { element: wrapper, select }
  const status = document.createElement('p'); status.setAttribute('role', 'status'); wrapper.append(status)
  if (!core) { status.textContent = 'Liste des projets indisponible.'; return result }
  select.disabled = true
  void (async () => {
    const projects: CoreProjectView[] = []; const seen = new Set<string>(); let cursor: string | undefined
    do {
      const page = await core.list({ resource: 'projects', limit: 200, ...(cursor ? { cursor } : {}) })
      projects.push(...page.items as CoreProjectView[])
      if (page.nextCursor && seen.has(page.nextCursor)) throw Error('Pagination invalide')
      if (page.nextCursor) seen.add(page.nextCursor)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (!wrapper.isConnected) return
    const selected = select.value
    for (const project of projects) {
      let option = Array.from(select.options).find(item => item.value === project.id)
      if (!option) { option = document.createElement('option'); option.value = project.id; select.append(option) }
      option.textContent = project.name
    }
    select.value = selected
  })().catch(() => { if (wrapper.isConnected) status.textContent = 'Liste des projets indisponible. La référence existante est conservée.' }).finally(() => { select.disabled = false })
  return result
}
