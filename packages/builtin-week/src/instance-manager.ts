import type { ProjectTrackerSdk } from '../../../sdk/src'
import type { InstanceSummary } from '../../../shared/sdk'

/** Full instance list, not a snapshot of the first SDK page. Mutations remain
 * native/CAS; deletion confirmation and usage counts belong to the host. */
export function instanceManager(sdk: ProjectTrackerSdk, currentId: string | null, done: () => void): HTMLElement {
  const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Gérer les semaines')
  let busy = false
  let generation = 0
  const heading = document.createElement('h2'); heading.textContent = 'Gérer les semaines'
  const status = document.createElement('p'); status.setAttribute('role', 'status')
  const content = document.createElement('div')
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Retour au planning'; close.onclick = done
  panel.append(heading, status, content, close)
  function button(label: string, action: () => Promise<unknown>) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label
    node.onclick = () => {
      if (busy) return
      busy = true; close.disabled = true
      content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(element => { element.disabled = true })
      status.textContent = 'Opération en cours…'
      void action().then(async () => { if (panel.isConnected && !sdk.revoked) await load() }).catch(() => {
        if (panel.isConnected) status.textContent = 'Opération impossible (nom déjà utilisé, conflit ou refus). Les données sont conservées. Rechargez avant de réessayer.'
      }).finally(() => {
        busy = false; close.disabled = false
        content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(element => { element.disabled = element.dataset.locked === 'true' })
      })
    }
    return node
  }
  async function load() {
    const request = ++generation
    const items: InstanceSummary[] = []; let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await sdk.instances.list({ limit: 200, ...(cursor ? { cursor } : {}) })
      items.push(...page.items)
      if (page.nextCursor && seen.has(page.nextCursor)) throw Error('Pagination invalide')
      if (page.nextCursor) seen.add(page.nextCursor)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (!panel.isConnected || request !== generation) return
    const active = items.find(item => item.active)?.instanceId ?? null
    const fragment = document.createDocumentFragment()
    const createLabel = document.createElement('label'); createLabel.textContent = 'Nom de la nouvelle semaine'
    const name = document.createElement('input'); name.maxLength = 80; createLabel.append(name); fragment.append(createLabel)
    // A stable operation id per draft request handles lost acknowledgements.
    const operations = new Map<string, string>()
    function create(copyFrom?: string) {
      const trimmed = name.value.trim()
      if (!trimmed || items.some(item => item.name.toLocaleLowerCase('fr-FR') === trimmed.toLocaleLowerCase('fr-FR'))) return Promise.reject(Error('Nom invalide'))
      const key = JSON.stringify([trimmed, copyFrom]); if (!operations.has(key)) operations.set(key, crypto.randomUUID())
      return sdk.instances.create({ name: trimmed, ...(copyFrom ? { copyFrom } : {}), operationId: operations.get(key)! })
    }
    fragment.append(button('Créer une semaine vide', () => create()))
    if (currentId && items.some(item => item.instanceId === currentId)) fragment.append(button('Dupliquer la semaine consultée', () => create(currentId)))
    const list = document.createElement('ul')
    for (const item of items) {
      const row = document.createElement('li')
      const title = document.createElement('strong'); title.textContent = `${item.name}${item.instanceId === currentId ? ' · consultée' : ''}${item.active ? ' · active' : ''}`
      row.append(title)
      const renameLabel = document.createElement('label'); renameLabel.textContent = `Nouveau nom de ${item.name}`
      const rename = document.createElement('input'); rename.value = item.name; rename.maxLength = 80; renameLabel.append(rename); row.append(renameLabel)
      row.append(button('Renommer', () => sdk.instances.rename(item.instanceId, rename.value.trim(), item.revision)))
      row.append(button('Consulter', () => sdk.instances.select(item.instanceId)))
      row.append(button('Rendre active', () => sdk.instances.setActive(item.instanceId, active)))
      const remove = button('Supprimer la semaine', () => sdk.instances.delete(item.instanceId, item.revision))
      if (items.length <= 1) { remove.disabled = true; remove.dataset.locked = 'true'; remove.title = 'La dernière semaine doit être conservée.' }
      row.append(remove); list.append(row)
    }
    fragment.append(list); content.replaceChildren(fragment)
    status.textContent = 'Consulter ne change pas la semaine active. La suppression est confirmée par amber avec les usages concernés.'
  }
  status.textContent = 'Chargement des semaines…'
  void load().catch(() => { if (panel.isConnected) status.textContent = 'Semaines indisponibles. Retournez au planning pour réessayer.' })
  return panel
}
