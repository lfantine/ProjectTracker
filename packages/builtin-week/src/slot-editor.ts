import type { ProjectTrackerSdk } from '../../../sdk/src'
import { WEEK_DAYS, slotError, type WeekSlot } from '../../../shared/week'
import { saveWeek, type WeekSnapshot } from './client'
import { projectPicker } from './project-picker'

/** Edit one slot without losing fields unknown to this version of the UI. */
export function slotEditor(sdk: Pick<ProjectTrackerSdk, 'call' | 'storage'> & Partial<Pick<ProjectTrackerSdk, 'core'>>, snapshot: WeekSnapshot, existing: WeekSlot | undefined, done: () => void, template?: WeekSlot): HTMLFormElement {
  const source = existing ?? template
  const form = document.createElement('form'); form.setAttribute('aria-label', existing ? 'Modifier le créneau' : 'Ajouter un créneau')
  const fields = document.createElement('fieldset')
  const legend = document.createElement('legend'); legend.textContent = form.getAttribute('aria-label'); fields.append(legend)
  function field(name: string, labelText: string, value: string, type = 'text') {
    const label = document.createElement('label'); label.textContent = labelText
    const input = document.createElement('input'); input.name = name; input.type = type; input.value = value
    label.append(input); fields.append(label); return input
  }
  const title = field('title', 'Objectif', source?.title ?? ''); title.required = true
  const dayLabel = document.createElement('label'); dayLabel.textContent = 'Jour'
  const day = document.createElement('select'); day.name = 'day'; day.setAttribute('aria-label', 'Jour')
  WEEK_DAYS.forEach((name, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = name; day.append(option) })
  day.value = String(source?.day ?? 0); dayLabel.append(day); fields.append(dayLabel)
  const start = field('start', 'Début', source?.start ?? '09:00', 'time')
  const end = field('end', 'Fin', source?.end ?? '10:00', 'time')
  start.required = end.required = true; start.step = end.step = '60'
  const descriptionLabel = document.createElement('label'); descriptionLabel.textContent = 'Description'
  const description = document.createElement('textarea'); description.name = 'description'; description.value = source?.description ?? ''
  descriptionLabel.append(description); fields.append(descriptionLabel)
  // Keep arbitrary legacy colour spelling unless the user changes it.
  const color = field('color', 'Couleur hexadécimale (facultative)', source?.color ?? '')
  const location = field('location', 'Lieu', source?.location ?? '')
  const link = field('link', 'Lien (texte, non exécuté)', source?.link ?? '')
  const projects = projectPicker(sdk.core, source?.projectId); fields.append(projects.element)
  const project = projects.select
  const peopleLabel = document.createElement('label'); peopleLabel.textContent = 'Personnes (une par ligne)'
  const people = document.createElement('textarea'); people.name = 'people'; people.value = source?.people?.join('\n') ?? ''
  peopleLabel.append(people); fields.append(peopleLabel)
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Enregistrer'
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Annuler'; cancel.onclick = done
  const status = document.createElement('p'); status.setAttribute('role', 'status')
  fields.append(save, cancel); form.append(fields, status)
  const initialTitle = title.value
  const optional = [['description', description], ['color', color], ['location', location], ['link', link], ['projectId', project]] as const
  const initialValues = new Map(optional.map(([, input]) => [input, input.value] as const))
  const initialPeople = people.value
  let pending = false
  // A stable identifier for the draft, not regenerated after a failed save.
  const id = existing?.id ?? crypto.randomUUID()
  const submit = (event: Event) => {
    event.preventDefault()
    if (pending || !form.reportValidity()) return
    const slot: WeekSlot = { ...source, id, title: source && title.value === initialTitle ? source.title : title.value, day: Number(day.value), start: start.value, end: end.value }
    for (const [key, input] of optional) {
      if (source && input.value === initialValues.get(input)) continue
      if (input.value) slot[key] = input.value
      else delete slot[key]
    }
    // Preserve the original array (including legacy empty entries/newlines) if untouched.
    if (people.value !== initialPeople) {
      if (people.value) slot.people = people.value.split('\n')
      else delete slot.people
    }
    const error = slotError(slot, snapshot.document.slots, existing?.id)
    if (error) { status.textContent = error; return }
    const slots = existing ? snapshot.document.slots.map(item => item.id === existing.id ? slot : item) : [...snapshot.document.slots, slot]
    pending = true; fields.disabled = true; status.textContent = 'Enregistrement…'
    void saveWeek(sdk, snapshot, { ...snapshot.document, slots }).then(() => {
      if (form.isConnected) done()
    }).catch(() => {
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
