import type { ProjectTrackerSdk } from '../../../sdk/src'
import type { InstanceSummary } from '../../../shared/sdk'
import { button, input, text } from './dom'

/** LinkedIn profiles (personal page, company page…) are the major's instances.
 * Mutations are native/CAS; deletion confirmation belongs to the host. */
export function profileManager(sdk: ProjectTrackerSdk, currentId: string | null, done: () => void): HTMLElement {
  const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Gérer les profils')
  const status = text('p', 'Chargement des profils…'); status.setAttribute('role', 'status')
  const content = document.createElement('div')
  const close = button('Retour au planning', done)
  panel.append(text('h2', 'Profils LinkedIn'), text('p', 'Un profil = un compte ou une page entreprise, avec ses propres posts et réglages.', 'muted'), content, status, close)
  let busy = false, generation = 0
  const operations = new Map<string, string>()
  function action(label: string, run: () => Promise<unknown>) {
    return button(label, async () => {
      if (busy) return
      busy = true; close.disabled = true; status.textContent = 'Opération en cours…'
      content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(node => { node.disabled = true })
      try { await run(); if (panel.isConnected && !sdk.revoked) await load() }
      catch { if (panel.isConnected) status.textContent = 'Opération impossible (nom déjà utilisé, conflit ou refus). Les données sont conservées.' }
      finally {
        busy = false; close.disabled = false
        content.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(node => { node.disabled = node.dataset.locked === 'true' })
      }
    })
  }
  async function load() {
    const request = ++generation
    const items: InstanceSummary[] = [], seen = new Set<string>(); let cursor: string | undefined
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
    const name = input('name', items.length ? '' : 'Mon profil LinkedIn'); name.maxLength = 80; name.setAttribute('aria-label', 'Nom du nouveau profil')
    name.placeholder = 'Nom du nouveau profil'
    const create = action('Créer le profil', () => {
      const trimmed = name.value.trim()
      if (!trimmed || items.some(item => item.name.toLocaleLowerCase('fr-FR') === trimmed.toLocaleLowerCase('fr-FR'))) return Promise.reject(Error('Nom invalide'))
      // Same operation id for a retry of the same request (lost acknowledgement).
      if (!operations.has(trimmed)) operations.set(trimmed, crypto.randomUUID())
      return sdk.instances.create({ name: trimmed, operationId: operations.get(trimmed)! })
    })
    const row = document.createElement('div'); row.className = 'inline-form'; row.append(name, create); fragment.append(row)
    const list = document.createElement('ul'); list.className = 'profile-list'
    for (const item of items) {
      const entry = document.createElement('li')
      entry.append(text('strong', `${item.name}${item.instanceId === currentId ? ' · consulté' : ''}${item.active ? ' · actif' : ''}`))
      const rename = input('rename', item.name); rename.maxLength = 80; rename.setAttribute('aria-label', `Nouveau nom de ${item.name}`)
      entry.append(rename, action('Renommer', () => sdk.instances.rename(item.instanceId, rename.value.trim(), item.revision)))
      if (item.instanceId !== currentId) entry.append(action('Consulter', () => sdk.instances.select(item.instanceId)))
      if (!item.active) entry.append(action('Rendre actif', () => sdk.instances.setActive(item.instanceId, active)))
      const remove = action('Supprimer', () => sdk.instances.delete(item.instanceId, item.revision))
      if (items.length <= 1) { remove.disabled = true; remove.dataset.locked = 'true'; remove.title = 'Le dernier profil est conservé.' }
      entry.append(remove); list.append(entry)
    }
    fragment.append(list); content.replaceChildren(fragment)
    status.textContent = items.length ? 'Consulter ne change pas le profil actif. amber confirme toute suppression.' : 'Crée ton premier profil pour commencer.'
  }
  void load().catch(() => { if (panel.isConnected) status.textContent = 'Profils indisponibles. Reviens au planning pour réessayer.' })
  return panel
}
