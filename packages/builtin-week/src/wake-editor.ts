import type { ProjectTrackerSdk } from '../../../sdk/src'
import { WEEK_DAYS } from '../../../shared/week'
import { saveWeek, type WeekSnapshot } from './client'

/** A detached draft: never mutate the captured document or retry a failed CAS. */
export function wakeEditor(sdk: Pick<ProjectTrackerSdk, 'call' | 'storage'>, snapshot: WeekSnapshot, done: () => void): HTMLFormElement {
  const form = document.createElement('form')
  form.setAttribute('aria-label', 'Heures de réveil')
  const fields = document.createElement('fieldset')
  const legend = document.createElement('legend'); legend.textContent = 'Heures de réveil'; fields.append(legend)
  const inputs = WEEK_DAYS.map((day, index) => {
    const label = document.createElement('label'); label.textContent = day
    const input = document.createElement('input'); input.type = 'time'; input.required = true; input.step = '60'; input.value = snapshot.document.wakeTimes[index]
    label.append(input); fields.append(label); return input
  })
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Enregistrer'
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Annuler'; cancel.onclick = done
  const status = document.createElement('p'); status.setAttribute('role', 'status')
  fields.append(save, cancel); form.append(fields, status)
  let pending = false
  const submit = (event: Event) => {
    event.preventDefault()
    if (pending || !form.reportValidity()) return
    pending = true; fields.disabled = true; status.textContent = 'Enregistrement…'
    void saveWeek(sdk, snapshot, { ...snapshot.document, wakeTimes: inputs.map(input => input.value) }).then(() => {
      if (form.isConnected) done()
    }).catch(() => {
      // Retain the draft, but do not offer an unsafe overwrite of newer data.
      if (form.isConnected) status.textContent = 'Enregistrement impossible (conflit ou connexion). Votre saisie est conservée. Annulez pour recharger les données avant de réessayer.'
    }).finally(() => { pending = false; fields.disabled = false })
  }
  // The host deliberately omits allow-forms. Use explicit SDK actions instead
  // of browser submission; never weaken the sandbox to save a document.
  form.onsubmit = submit
  save.onclick = submit
  form.onkeydown = event => {
    if (event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) {
      event.preventDefault(); save.click()
    }
  }
  return form
}
