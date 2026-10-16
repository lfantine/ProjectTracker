import type { ProjectTrackerSdk } from '../../../sdk/src'
import { WEEK_DAYS } from '../../../shared/week'
import { saveWeek, type WeekSnapshot } from './client'

/** Explicit confirmation of a captured target. No native dialogs/allow-modals. */
export function slotDeletion(sdk: Pick<ProjectTrackerSdk, 'call' | 'storage'>, snapshot: WeekSnapshot, slotId: string, done: () => void): HTMLElement {
  const target = snapshot.document.slots.find(slot => slot.id === slotId)
  if (!target) throw Error('Créneau indisponible.')
  const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Supprimer le créneau')
  const heading = document.createElement('h2'); heading.textContent = 'Supprimer ce créneau ?'
  const details = document.createElement('p'); details.textContent = `${WEEK_DAYS[target.day]} ${target.start}–${target.end} · ${target.title}`
  const explanation = document.createElement('p'); explanation.textContent = 'Cette action supprime uniquement ce créneau de la semaine consultée.'
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirmer la suppression'
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Annuler'; cancel.onclick = done
  const status = document.createElement('p'); status.setAttribute('role', 'status')
  panel.append(heading, details, explanation, confirm, cancel, status)
  let pending = false
  confirm.onclick = () => {
    if (pending) return
    pending = true; confirm.disabled = cancel.disabled = true; status.textContent = 'Suppression…'
    void saveWeek(sdk, snapshot, { ...snapshot.document, slots: snapshot.document.slots.filter(slot => slot.id !== slotId) }).then(() => {
      if (panel.isConnected) done()
    }).catch(() => {
      if (panel.isConnected) status.textContent = 'Suppression impossible (conflit ou connexion). Aucun écrasement forcé. Annulez pour recharger les données.'
    }).finally(() => { pending = false; confirm.disabled = cancel.disabled = false })
  }
  panel.onkeydown = event => {
    if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); cancel.click() }
  }
  return panel
}
