import type { ProjectTrackerSdk } from '../../../sdk/src'
import type { CoreProjectView } from '../../../shared/sdk'
import { WEEK_DAYS, slotColor, slotError, type WeekSlot } from '../../../shared/week'
import { loadWeek, saveWeek } from './client'
import { localDay, visibleSlots } from './model'
import { wakeEditor } from './wake-editor'
import { slotEditor } from './slot-editor'
import { slotDeletion } from './slot-deletion'
import { pasteDraft } from './clipboard'
import { instanceManager } from './instance-manager'
import { calendarHelp } from './help'
import { weekGrid } from './grid'
import { daySlotStatus, dayState } from './day-state'

const root = document.getElementById('week-root')!
root.tabIndex = -1
let sdk: ProjectTrackerSdk
let generation = 0
let stopped = false
let editing = false
let gesturing = false
let copied: WeekSlot | undefined
const stops: (() => void)[] = []
let dialog: HTMLDialogElement | undefined
let returnFocus: HTMLElement | null = null
function dismissDialog() { if (dialog) { if (typeof dialog.close === 'function' && dialog.open) dialog.close(); dialog.remove(); dialog = undefined } }
function text(tag: string, content: string): HTMLElement {
  const node = document.createElement(tag); node.textContent = content; return node
}
function button(label: string, action: () => Promise<unknown>): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label
  node.onclick = () => { node.disabled = true; void action().catch(() => { root.append(text('p', 'Ouverture indisponible.')) }).finally(() => { node.disabled = false }) }
  return node
}
function closeEditor() {
  dismissDialog(); editing = false
  const label = returnFocus?.getAttribute('aria-label')
  void render().then(() => {
    if (stopped || editing) return
    const target = label ? Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(node => node.getAttribute('aria-label') === label) : null
    ;(target ?? root).focus({ preventScroll: true })
  })
}
function openEditor(panel: HTMLElement) {
  returnFocus = document.activeElement as HTMLElement
  dismissDialog(); editing = true; generation++
  const modal = document.createElement('dialog'); dialog = modal; modal.className = 'week-dialog'
  modal.setAttribute('aria-label', panel.getAttribute('aria-label') ?? 'Options du planning')
  const close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fermer le dialogue')
  const pending = () => !!panel.querySelector('fieldset:disabled') || Array.from(panel.querySelectorAll('button')).some(button => button.disabled && ['Annuler', 'Retour au planning'].includes(button.textContent ?? ''))
  close.onclick = () => { if (!pending()) closeEditor() }
  modal.oncancel = event => { event.preventDefault(); if (!pending()) closeEditor() }
  modal.append(close, panel); root.append(modal)
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '')
  panel.querySelector<HTMLElement>('input,select,textarea,button')?.focus()
}
async function render(force = false): Promise<void> {
  if (stopped || ((editing || gesturing) && !force)) return
  if (force) { dismissDialog(); editing = false; gesturing = false; copied = undefined; root.onkeydown = null }
  const request = ++generation
  try {
    const [snapshot, context] = await Promise.all([loadWeek(sdk), sdk.call('context.get', {})])
    if (stopped || request !== generation) return
    const heading = context.kind === 'major' ? (document.documentElement.dataset.weekTitle ?? 'Semaine type') : context.kind === 'minor' ? 'Créneaux du projet' : 'Planning du jour'
    const fragment = document.createDocumentFragment()
    if (context.kind !== 'major') { const title = text('h1', heading); title.className = 'planning-title'; fragment.append(title) }
    if (!snapshot) {
      fragment.append(text('p', 'Aucune semaine disponible.'))
      if (context.kind === 'major') fragment.append(button('Gérer les semaines', async () => { openEditor(instanceManager(sdk, null, closeEditor)) }))
      const focused = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    const focusLabel = focused?.getAttribute('aria-label'), focusTag = focused?.tagName
    const detailsOpen = !!root.querySelector<HTMLDetailsElement>('.week-details')?.open
    root.replaceChildren(fragment)
    const details = root.querySelector<HTMLDetailsElement>('.week-details'); if (details) details.open = detailsOpen
    if (focusLabel) Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(node => node.tagName === focusTag && node.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true }); return
    }
    if (context.instance?.instanceId !== snapshot.instanceId) throw Error('Contexte modifié')
    document.body.classList.toggle('is-major', context.kind === 'major')
    const instanceName = text('p', snapshot.name); instanceName.className = 'instance-name'; fragment.append(instanceName)
    const now = new Date()
    const day = localDay(now)
    if (context.kind === 'widget') {
      fragment.append(text('p', `${WEEK_DAYS[day]} · Réveil : ${snapshot.document.wakeTimes[day]}`))
      const clock = text('p', `Heure actuelle : ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`)
      clock.className = 'planning-clock'; clock.setAttribute('role', 'img'); clock.setAttribute('aria-label', clock.textContent!)
      fragment.append(clock)
    }
    if (context.kind === 'minor' && context.owner.kind !== 'project') throw Error('Projet indisponible')
    const slots = visibleSlots(snapshot.document, context.kind === 'widget' ? { day } : context.kind === 'minor' && context.owner.kind === 'project' ? { projectId: context.owner.projectId } : {})
    const projects = new Map<string, string>()
    // Only names of referenced projects; no private native paths or full AppData.
    for (const id of new Set(slots.map(slot => slot.projectId).filter((id): id is string => !!id))) {
      try { const project = await sdk.core.get({ resource: 'projects', id }) as CoreProjectView | null; if (project) projects.set(id, project.name) } catch { /* deleted/missing project remains visible below */ }
    }
    if (stopped || request !== generation) return
    let destination: { day: number; minute: number } | undefined
    const notice = text('p', copied ? 'Créneau copié. Coller ouvre un brouillon à confirmer.' : 'Copier un créneau pour le dupliquer.')
    notice.setAttribute('role', 'status')
    const paste = button('Coller le créneau', async () => {
      if (!copied) return
      const draft = pasteDraft(copied, snapshot.document.slots, destination)
      if (!draft) { notice.textContent = 'Aucune place disponible pour cette durée.'; return }
      openEditor(slotEditor(sdk, snapshot, undefined, closeEditor, draft))
    })
    paste.disabled = !copied
    function copy(slot: WeekSlot) {
      copied = structuredClone(slot); destination = undefined; paste.disabled = false
      notice.textContent = 'Créneau copié. Coller ouvre un brouillon à confirmer.'
    }
    root.onkeydown = context.kind === 'major' ? event => {
      if (editing || event.repeat || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'v' && copied) { event.preventDefault(); paste.click() }
    } : null
    async function commitSlot(slot: WeekSlot) {
      const error = slotError(slot, snapshot!.document.slots, slot.id)
      if (error) { notice.textContent = error; return }
      editing = true; generation++
      try { await saveWeek(sdk, snapshot!, { ...snapshot!.document, slots: snapshot!.document.slots.map(item => item.id === slot.id ? slot : item) }); editing = false; await render() }
      catch { editing = false; notice.textContent = 'Déplacement non enregistré (conflit ou connexion). Rechargez avant de réessayer.' }
    }
    if (context.kind === 'major') fragment.append(weekGrid(snapshot.document, {
      gesture: active => { if (active) generation++; gesturing = active },
      create: draft => openEditor(slotEditor(sdk, snapshot, undefined, closeEditor, draft)),
      move: slot => { void commitSlot(slot) },
      wakeMove: (day, value) => {
        editing = true; generation++
        void saveWeek(sdk, snapshot, { ...snapshot.document, wakeTimes: snapshot.document.wakeTimes.map((current, index) => index === day ? value : current) }).then(() => { editing = false; return render() }).catch(() => { editing = false; notice.textContent = 'Réveil non enregistré (conflit ou connexion). Rechargez avant de réessayer.' })
      },
      edit: slot => openEditor(slotEditor(sdk, snapshot, slot, closeEditor)),
      remove: slot => openEditor(slotDeletion(sdk, snapshot, slot.id, closeEditor)),
      copy,
      destination: (day, minute) => { destination = { day, minute }; notice.textContent = 'Destination de collage choisie. ⌘/Ctrl V ou Coller pour préparer la copie.' },
      wake: (day, value) => openEditor(wakeEditor(sdk, { ...snapshot, document: { ...snapshot.document, wakeTimes: snapshot.document.wakeTimes.map((current, index) => index === day ? value : current) } }, closeEditor)),
    }, now))
    const list = document.createElement('ul'); list.className = context.kind === 'widget' ? 'day-timeline' : 'slot-list'
    let markedNow = false
    const nowMarker = () => { const marker = text('li', `Maintenant · ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`); marker.className = 'planning-now-marker'; marker.setAttribute('aria-label', 'Position de l’heure actuelle'); return marker }
    for (const slot of slots) {
      if (context.kind === 'widget' && !markedNow && dayState(slot, now).label !== 'Passé') { list.append(nowMarker()); markedNow = true }
      const item = document.createElement('li')
      item.style.setProperty('--slot-color', slotColor(slot.color))
      const state = dayState(slot, now); item.className = `day-event ${state.running && context.kind === 'widget' ? 'is-running' : ''} ${state.label === 'Passé' && context.kind === 'widget' ? 'is-past' : ''}`
      const range = text('span', `${context.kind === 'widget' ? '' : WEEK_DAYS[slot.day] + ' · '}${slot.start}–${slot.end}`); range.className = 'event-time'
      item.append(range, text('strong', slot.title))
      if (context.kind === 'widget') item.append(daySlotStatus(slot, now))
      if (slot.description) item.append(text('p', slot.description))
      if (slot.location) item.append(text('p', `Lieu : ${slot.location}`))
      if (slot.people?.length) item.append(text('p', `Personnes : ${slot.people.join(', ')}`))
      if (slot.link) {
        item.append(text('p', `Lien : ${slot.link}`))
        try {
          const url = new URL(slot.link)
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) item.append(button('Ouvrir le lien', () => sdk.navigation.open({ kind: 'external', url: slot.link! })))
        } catch { /* legacy text/unsafe URL retained but never executed */ }
      }
      if (slot.projectId) {
        const name = projects.get(slot.projectId)
        item.append(text('p', name ?? 'Projet indisponible'))
        if (name) item.append(button('Ouvrir le projet', () => sdk.navigation.open({ kind: 'project', projectId: slot.projectId! })))
      }
      if (context.kind === 'major') {
        item.tabIndex = 0
        item.setAttribute('aria-label', `${slot.title}, ${WEEK_DAYS[slot.day]}, ${slot.start} à ${slot.end}`)
        item.onkeydown = event => {
          if (event.target !== item || event.repeat || event.isComposing || event.altKey) return
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(slot); return }
          if (event.metaKey || event.ctrlKey) return
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault(); openEditor(slotEditor(sdk, snapshot, slot, closeEditor))
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault(); openEditor(slotDeletion(sdk, snapshot, slot.id, closeEditor))
          }
        }
        item.append(button('Copier le créneau', async () => { copy(slot) }))
      }
      if (context.kind === 'major') item.append(button('Modifier le créneau', async () => {
        openEditor(slotEditor(sdk, snapshot, slot, closeEditor))
      }))
      if (context.kind === 'major') item.append(button('Supprimer le créneau', async () => {
        openEditor(slotDeletion(sdk, snapshot, slot.id, closeEditor))
      }))
      list.append(item)
    }
    if (context.kind === 'widget' && slots.length && !markedNow) list.append(nowMarker())
    if (context.kind === 'major') { const details = document.createElement('details'); details.className = 'week-details'; const summary = text('summary', 'Liste détaillée des créneaux'); details.append(summary, slots.length ? list : text('p', 'Aucun créneau.')); fragment.append(details) }
    else { if (slots.length) fragment.append(list); else { const empty = text('p', 'Aucun créneau.'); empty.className = 'planning-empty'; fragment.append(empty) } }
    if (context.kind !== 'major') {
      const open = button('Ouvrir le planning', () => sdk.navigation.open({ kind: 'major', instanceId: snapshot.instanceId }))
      if (context.kind === 'widget') { const header = document.createElement('div'); header.className = 'planning-header'; const title = fragment.querySelector('h1'); if (title) header.append(title); header.append(open); fragment.prepend(header) }
      else fragment.append(open)
    }
    else {
      const edit = button('Modifier les réveils', async () => {
        openEditor(wakeEditor(sdk, snapshot, closeEditor))
      })
      const toolbar = document.createElement('div'); toolbar.className = 'week-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Actions du planning')
      const help = calendarHelp()
      toolbar.append(button('Gérer les semaines', async () => { openEditor(instanceManager(sdk, snapshot.instanceId, closeEditor)) }), button('Ajouter un créneau', async () => { openEditor(slotEditor(sdk, snapshot, undefined, closeEditor)) }), paste, edit, help)
      notice.className = 'week-notice'; fragment.prepend(toolbar); fragment.append(notice)

    }
    const focused = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    const focusLabel = focused?.getAttribute('aria-label'), focusTag = focused?.tagName
    const detailsOpen = !!root.querySelector<HTMLDetailsElement>('.week-details')?.open
    root.replaceChildren(fragment)
    const details = root.querySelector<HTMLDetailsElement>('.week-details'); if (details) details.open = detailsOpen
    if (focusLabel) Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(node => node.tagName === focusTag && node.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true })
  } catch {
    if (!stopped && request === generation) root.replaceChildren(text('p', 'Planning indisponible. Les données sont conservées.'), button('Réessayer', () => render()))
  }
}
function stop() { if (stopped) return; dismissDialog(); stopped = true; copied = undefined; root.onkeydown = null; generation++; for (const cleanup of stops.splice(0)) cleanup() }
async function main() {
  try {
    sdk = await ProjectTracker.ready
    if (stopped) return
    await render()
    if (stopped) return
    stops.push(sdk.onContextChange(() => { void render(true) }))
    try {
      const unsubscribe = await sdk.events.subscribe(['storage.changed', 'core.projects.changed', 'instances.changed'], () => { void render() })
      if (stopped) { void unsubscribe().catch(() => {}); return }
      else stops.push(() => { void unsubscribe().catch(() => {}) })
    } catch { /* business subscriptions unavailable in disposable prevalidation */ }
    if (stopped) return
    const timer = setInterval(() => { if (sdk.revoked) { stop(); return }; void render() }, 60_000)
    stops.push(() => clearInterval(timer))
    const resume = () => { if (!document.hidden && !stopped) void render() }
    document.addEventListener('visibilitychange', resume); window.addEventListener('focus', resume)
    stops.push(() => { document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume) })
  } catch { if (!stopped) root.replaceChildren(text('p', 'Connexion au SDK indisponible.')) }
}
window.addEventListener('pagehide', stop, { once: true })
void main()
