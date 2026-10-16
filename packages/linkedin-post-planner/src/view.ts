import type { ProjectTrackerSdk } from '../../../sdk/src'
import { loadPlanner, savePost, type Entry, type Snapshot } from './client'
import { button, formatDay, select, text } from './dom'
import { changeStatus, deletion, postEditor, settingsEditor } from './editor'
import {
  POST_TYPES, addDays, duplicate, inTab, isOverdue, localDate, matches, newPost, parseTags, reschedules, sortPosts,
  statusLabel, tagCounts, typeInfo, typeMix, weekStart, withChanges, type Filter, type Post, type PostType, type Tab,
} from './model'
import { profileManager } from './profiles'

const COMPOSER_URL = 'https://www.linkedin.com/feed/?shareActive=true'
const TABS: { id: Tab; label: string }[] = [{ id: 'planning', label: 'Planning' }, { id: 'idees', label: 'Idées' }, { id: 'historique', label: 'Historique' }]

const root = document.getElementById('planner-root')!
root.tabIndex = -1
let sdk: ProjectTrackerSdk
let snapshot: Snapshot | null = null
let generation = 0
let stopped = false
let editing = false
let tab: Tab = 'planning'
const filter: Filter = { text: '', type: '', tag: '' }
const stops: (() => void)[] = []
let dialog: HTMLDialogElement | undefined
let returnFocus: string | null = null
let notice = ''

// Shows a message on the next repaint, after reloading the stored state.
const report = (message: string) => () => { notice = message; return refresh() }
function dismissDialog() { if (dialog) { if (typeof dialog.close === 'function' && dialog.open) dialog.close(); dialog.remove(); dialog = undefined } }
function closeDialog() {
  dismissDialog(); editing = false
  void refresh().then(() => {
    if (stopped || editing) return
    const target = returnFocus ? Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(node => node.getAttribute('aria-label') === returnFocus) : null
    ;(target ?? root).focus({ preventScroll: true })
  })
}
function openDialog(panel: HTMLElement) {
  returnFocus = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? null
  dismissDialog(); editing = true; generation++
  const modal = document.createElement('dialog'); dialog = modal; modal.className = 'planner-dialog'
  modal.setAttribute('aria-label', panel.getAttribute('aria-label') ?? 'Planning LinkedIn')
  const close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fermer le dialogue')
  // Never close while a save is in flight: its outcome must stay visible.
  const pending = () => !!panel.querySelector('fieldset:disabled') || Array.from(panel.querySelectorAll('button')).some(node => node.disabled && ['Annuler', 'Retour au planning'].includes(node.textContent ?? ''))
  close.onclick = () => { if (!pending()) closeDialog() }
  modal.oncancel = event => { event.preventDefault(); if (!pending()) closeDialog() }
  modal.append(close, panel); root.append(modal)
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open', '')
  panel.querySelector<HTMLElement>('input:not([type=file]),select,textarea,button')?.focus()
}
function openExternal(url: string) {
  return sdk.navigation.open({ kind: 'external', url }).catch(report('Ouverture du navigateur impossible.'))
}
const knownTags = () => tagCounts(posts()).map(([tag]) => tag)
const posts = () => snapshot ? [...snapshot.posts.values()].map(entry => entry.value) : []
const edit = (entry?: Entry<Post>, template: Partial<Post> = {}) => { if (snapshot) openDialog(postEditor(sdk, snapshot, entry, template, knownTags(), closeDialog)) }

/** First day from today without any dated open post, at the default time. */
function nextFreeSlot(now: Date): Partial<Post> {
  const time = snapshot!.settings.value.defaultTime
  const taken = new Set(posts().filter(post => post.date && post.status !== 'abandonne').map(post => post.date))
  let day = localDate(now)
  if (`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` >= time) day = addDays(day, 1)
  while (taken.has(day)) day = addDays(day, 1)
  return { date: day, time }
}

async function refresh(force = false): Promise<void> {
  if (stopped || (editing && !force)) return
  if (force) { dismissDialog(); editing = false }
  const request = ++generation
  try {
    const next = await loadPlanner(sdk)
    if (stopped || request !== generation) return
    snapshot = next
    paint()
  } catch {
    if (!stopped && request === generation) root.replaceChildren(text('p', 'Planning indisponible. Les données sont conservées.'), button('Réessayer', () => refresh()))
  }
}

function card(entry: Entry<Post>, now: Date): HTMLElement {
  const post = entry.value, info = typeInfo(post.type)
  const item = document.createElement('article'); item.className = 'post-card'; item.tabIndex = 0
  item.style.setProperty('--type-color', info.color)
  const label = post.title || post.content.slice(0, 60) || 'Post sans titre'
  item.setAttribute('aria-label', `${label}, ${info.label}${post.date ? `, ${formatDay(post.date)} ${post.time ?? ''}` : ''}`)
  const overdue = isOverdue(post, now)
  const meta = document.createElement('div'); meta.className = 'post-meta'
  if (post.date) meta.append(text('span', `${formatDay(post.date)}${post.time ? ` · ${post.time}` : ''}`, 'post-when'))
  meta.append(text('span', info.label, 'badge type'))
  const statusText = tab === 'historique' && post.status !== 'publie' && post.status !== 'abandonne' ? 'Non publié' : statusLabel(post.status)
  meta.append(text('span', overdue ? 'À confirmer' : statusText, `badge status is-${overdue ? 'overdue' : post.status}`))
  const moved = reschedules(post); if (moved) meta.append(text('span', `replanifié ${moved}×`, 'muted'))
  item.append(meta)
  const body = document.createElement('div'); body.className = 'post-body'
  const words = document.createElement('div')
  words.append(text('h3', label))
  if (post.content && post.title) words.append(text('p', post.content.slice(0, 220) + (post.content.length > 220 ? '…' : ''), 'post-excerpt'))
  body.append(words)
  if (post.thumbnail) { const image = document.createElement('img'); image.src = post.thumbnail; image.alt = post.imageAlt ?? ''; image.className = 'post-thumb'; body.append(image) }
  item.append(body)
  if (post.tags.length) {
    const tags = document.createElement('div'); tags.className = 'tag-row'
    for (const tag of post.tags) tags.append(button(`#${tag}`, () => { filter.tag = tag; paint() }, { className: `tag${filter.tag === tag ? ' is-active' : ''}`, ariaLabel: `Filtrer par le tag ${tag}` }))
    item.append(tags)
  }
  const actions = document.createElement('div'); actions.className = 'post-actions'
  const failed = report('Modification non enregistrée (conflit ou connexion). Les données ont été rechargées.')
  const status = (value: Post['status']) => () => changeStatus(sdk, snapshot!, entry, value).then(() => refresh(), failed)
  if (overdue) {
    actions.append(text('span', 'L’heure est passée : publié ?', 'overdue-question'),
      button('Oui, publié', status('publie'), { className: 'primary' }), button('Abandonner', status('abandonne')), button('Replanifier', () => edit(entry, nextFreeSlot(now))))
  } else if (tab === 'planning') {
    if (post.status !== 'planifie' && post.time) actions.append(button('Valider le planning', status('planifie')))
    actions.append(button('Marquer publié', status('publie')))
  } else if (tab === 'idees') actions.append(button('Planifier', () => edit(entry, { ...nextFreeSlot(now), status: 'planifie' }), { className: 'primary' }))
  const url = post.publishedUrl
  if (url) actions.append(button('Voir sur LinkedIn', () => openExternal(url)))
  actions.append(button('Modifier', () => edit(entry)), button(tab === 'historique' ? 'Réutiliser' : 'Dupliquer', async () => {
    const at = new Date().toISOString()
    await savePost(sdk, snapshot!, withChanges(undefined, duplicate(post, crypto.randomUUID(), at), at), null).then(() => { tab = 'idees'; return refresh() }, failed)
  }), button('Supprimer', () => openDialog(deletion(sdk, snapshot!, entry, closeDialog)), { className: 'subtle' }))
  item.append(actions)
  item.ondblclick = event => { if (!(event.target as HTMLElement).closest('button')) edit(entry) }
  item.onkeydown = event => {
    if (event.target !== item || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(entry) }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); openDialog(deletion(sdk, snapshot!, entry, closeDialog)) }
  }
  return item
}

function mixBar(mix: Record<PostType, number>, caption: string): HTMLElement {
  const total = Object.values(mix).reduce((sum, value) => sum + value, 0)
  const wrapper = document.createElement('div'); wrapper.className = 'mix'
  wrapper.append(text('span', `${caption} · ${total} post${total > 1 ? 's' : ''}`, 'mix-caption'))
  const bar = document.createElement('div'); bar.className = 'mix-bar'; bar.setAttribute('role', 'img')
  bar.setAttribute('aria-label', `${caption} : ${POST_TYPES.map(type => `${type.label} ${mix[type.id]}`).join(', ')}`)
  for (const type of POST_TYPES) if (mix[type.id]) { const part = document.createElement('span'); part.style.flex = String(mix[type.id]); part.style.background = type.color; part.title = `${type.label} : ${mix[type.id]}`; bar.append(part) }
  if (!total) bar.classList.add('is-empty')
  const legend = document.createElement('div'); legend.className = 'mix-legend'
  for (const type of POST_TYPES.filter(type => type.id !== 'autre' || mix.autre)) {
    const item = text('span', `${type.label} ${total ? Math.round(mix[type.id] * 100 / total) : 0} %`); item.style.setProperty('--type-color', type.color); legend.append(item)
  }
  wrapper.append(bar, legend); return wrapper
}

function quickIdea(): HTMLElement {
  const form = document.createElement('div'); form.className = 'quick-idea'
  const title = document.createElement('input'); title.setAttribute('aria-label', 'Nouvelle idée'); title.maxLength = 300
  title.placeholder = 'Nouvelle idée… (#tags acceptés : « Retour sur Bun 1.3 #javascript #outils »)'
  const type = select('quick-type', POST_TYPES, filter.type || 'decouverte'); type.setAttribute('aria-label', 'Type de l’idée')
  const status = text('span', '', 'muted'); status.setAttribute('role', 'status')
  const add = button('Ajouter l’idée', async () => {
    const raw = title.value.trim(); if (!raw || !snapshot) return
    const tags = parseTags((raw.match(/#[^\s#,;]+/g) ?? []).join(','))
    const at = new Date().toISOString()
    const post = newPost(crypto.randomUUID(), at, { title: raw.replace(/#[^\s#,;]+/g, '').replace(/\s+/g, ' ').trim() || raw, type: type.value as PostType, tags })
    try { await savePost(sdk, snapshot, withChanges(undefined, post, at), null); title.value = ''; await refresh(); root.querySelector<HTMLInputElement>('[aria-label="Nouvelle idée"]')?.focus() }
    catch { status.textContent = 'Idée non enregistrée. Ta saisie est conservée.' }
  }, { className: 'primary' })
  title.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); add.click() } }
  form.append(title, type, add, status); return form
}

function paint() {
  if (stopped || editing) return
  const fragment = document.createDocumentFragment()
  if (!snapshot) {
    const empty = document.createElement('div'); empty.className = 'empty-state'
    empty.append(text('h2', 'Planifie tes posts LinkedIn'), text('p', 'Crée un profil pour commencer : idées, planning, images et historique y seront rangés.'),
      button('Créer mon profil', () => openDialog(profileManager(sdk, null, closeDialog)), { className: 'primary' }))
    root.replaceChildren(empty); return
  }
  const now = new Date(), today = localDate(now)
  const all = [...snapshot.posts.values()]
  const settings = snapshot.settings.value

  const toolbar = document.createElement('div'); toolbar.className = 'toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Actions du planning')
  const profileUrl = settings.linkedinUrl
  toolbar.append(
    button('Nouveau post', () => edit(undefined, tab === 'idees' ? {} : { ...nextFreeSlot(now), status: 'planifie' }), { className: 'primary' }),
    button('Ouvrir mon LinkedIn', () => {
      if (profileUrl) { void openExternal(profileUrl); return }
      openDialog(settingsEditor(sdk, snapshot!, closeDialog, 'Ajoute d’abord le lien de ton profil LinkedIn.'))
    }),
    button('Écrire sur LinkedIn', () => openExternal(COMPOSER_URL)),
    text('span', snapshot.name, 'profile-name'),
    button('Profils', () => openDialog(profileManager(sdk, snapshot!.instanceId, closeDialog))),
    button('Réglages', () => openDialog(settingsEditor(sdk, snapshot!, closeDialog))),
  )
  fragment.append(toolbar)

  // Overview: next post, upcoming mix and the past 30 days.
  const upcoming = sortPosts(all.map(entry => entry.value).filter(post => inTab(post, 'planning', now) && !isOverdue(post, now)), 'planning')
  const overview = document.createElement('section'); overview.className = 'overview'; overview.setAttribute('aria-label', 'Vue d’ensemble')
  const next = upcoming[0]
  const thisWeek = upcoming.filter(post => post.date! < addDays(weekStart(today), 7)).length
  overview.append(text('p', next ? `Prochain post : ${formatDay(next.date!, { weekday: 'long', day: 'numeric', month: 'long' })} à ${next.time ?? '—'} · ${thisWeek} prévu${thisWeek > 1 ? 's' : ''} cette semaine` : 'Aucun post à venir.', 'next-post'),
    mixBar(typeMix(all.map(entry => entry.value), today, addDays(today, 29)), '30 prochains jours'),
    mixBar(typeMix(all.map(entry => entry.value).filter(post => post.status === 'publie'), addDays(today, -30), today), 'Publiés, 30 derniers jours'))
  fragment.append(overview)

  const tabs = document.createElement('div'); tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Vues')
  for (const item of TABS) {
    const count = all.filter(entry => inTab(entry.value, item.id, now)).length
    const node = button(`${item.label} (${count})`, () => { tab = item.id; paint() }, { ariaLabel: item.label })
    node.setAttribute('role', 'tab'); node.setAttribute('aria-selected', String(tab === item.id)); node.tabIndex = tab === item.id ? 0 : -1
    node.onkeydown = event => {
      const index = TABS.findIndex(candidate => candidate.id === tab)
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!delta) return
      event.preventDefault(); tab = TABS[(index + delta + TABS.length) % TABS.length].id; paint()
      root.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus()
    }
    tabs.append(node)
  }
  fragment.append(tabs)

  // Filters apply to the current tab; tag counts show the whole profile.
  const filters = document.createElement('div'); filters.className = 'filters'
  const search = document.createElement('input'); search.type = 'search'; search.value = filter.text ?? ''; search.placeholder = 'Rechercher dans les sujets, textes, notes…'; search.setAttribute('aria-label', 'Rechercher')
  search.oninput = () => { filter.text = search.value; paint() }
  const type = select('filter-type', [{ id: '', label: 'Tous les types' }, ...POST_TYPES], filter.type ?? ''); type.setAttribute('aria-label', 'Filtrer par type')
  type.onchange = () => { filter.type = type.value as PostType | ''; paint() }
  const counts = tagCounts(all.map(entry => entry.value))
  const tag = select('filter-tag', [{ id: '', label: 'Tous les tags' }, ...counts.map(([name, count]) => ({ id: name, label: `#${name} (${count})` }))], filter.tag ?? '')
  tag.setAttribute('aria-label', 'Filtrer par tag'); tag.onchange = () => { filter.tag = tag.value; paint() }
  filters.append(search, type, tag)
  if (filter.text || filter.type || filter.tag) filters.append(button('Effacer les filtres', () => { filter.text = ''; filter.type = ''; filter.tag = ''; paint() }, { className: 'subtle' }))
  fragment.append(filters)
  if (counts.length) {
    const cloud = document.createElement('div'); cloud.className = 'tag-row tag-cloud'; cloud.setAttribute('aria-label', 'Tags du profil')
    for (const [name, count] of counts.slice(0, 30)) cloud.append(button(`#${name} ${count}`, () => { filter.tag = filter.tag === name ? '' : name; paint() }, { className: `tag${filter.tag === name ? ' is-active' : ''}`, ariaLabel: `Tag ${name}, ${count} post${count > 1 ? 's' : ''}` }))
    fragment.append(cloud)
  }
  if (notice) { const line = text('p', notice, 'notice'); line.setAttribute('role', 'status'); fragment.append(line); notice = '' }
  if (snapshot.invalid.length) fragment.append(text('p', `${snapshot.invalid.length} post(s) illisible(s) par cette version : conservés sans modification.`, 'notice'))

  const panel = document.createElement('section'); panel.className = 'tab-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-label', TABS.find(item => item.id === tab)!.label)
  const visible = sortPosts(all.filter(entry => inTab(entry.value, tab, now) && matches(entry.value, filter)).map(entry => entry.value), tab).map(post => snapshot!.posts.get(post.id)!)
  const filtered = !!(filter.text || filter.type || filter.tag)
  if (tab === 'idees') {
    panel.append(quickIdea())
    for (const entry of visible) panel.append(card(entry, now))
    if (!visible.length) panel.append(text('p', filtered ? 'Aucune idée ne correspond aux filtres.' : 'Note ici tes idées au fil de l’eau, puis planifie-les.', 'empty'))
  } else if (tab === 'planning') {
    const overdue = visible.filter(entry => isOverdue(entry.value, now))
    if (overdue.length) { panel.append(text('h2', 'À confirmer', 'group-title')); for (const entry of overdue) panel.append(card(entry, now)) }
    const future = visible.filter(entry => !isOverdue(entry.value, now))
    // Show at least four weeks so an empty week stands out.
    const first = weekStart(today), lastPost = future.at(-1)?.value.date
    const last = [addDays(first, 21), lastPost ? weekStart(lastPost) : first].sort().at(-1)!
    for (let week = first; week <= last; week = addDays(week, 7)) {
      const items = future.filter(entry => weekStart(entry.value.date!) === week)
      if (!items.length && filtered) continue
      const heading = text('h2', week === first ? 'Cette semaine' : `Semaine du ${formatDay(week, { day: 'numeric', month: 'long' })}`, 'group-title')
      heading.append(text('span', ` · ${items.length} post${items.length > 1 ? 's' : ''}`, 'muted'))
      panel.append(heading)
      for (const entry of items) panel.append(card(entry, now))
      if (!items.length) panel.append(text('p', 'Rien de prévu.', 'empty compact'))
    }
    if (filtered && !visible.length) panel.append(text('p', 'Aucun post planifié ne correspond aux filtres.', 'empty'))
  } else {
    let month = ''
    for (const entry of visible) {
      const at = entry.value.date ?? entry.value.publishedAt?.slice(0, 10) ?? entry.value.updatedAt.slice(0, 10)
      const label = new Date(`${at.slice(0, 7)}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      if (label !== month) {
        month = label
        const inMonth = visible.filter(other => (other.value.date ?? other.value.publishedAt?.slice(0, 10) ?? other.value.updatedAt.slice(0, 10)).slice(0, 7) === at.slice(0, 7))
        const published = inMonth.filter(other => other.value.status === 'publie').length
        const heading = text('h2', label, 'group-title'); heading.append(text('span', ` · ${published} publié${published > 1 ? 's' : ''} sur ${inMonth.length}`, 'muted'))
        panel.append(heading)
      }
      panel.append(card(entry, now))
    }
    if (!visible.length) panel.append(text('p', filtered ? 'Aucun post de l’historique ne correspond aux filtres.' : 'Les posts publiés, abandonnés ou passés apparaîtront ici.', 'empty'))
  }
  fragment.append(panel)

  // Keep focus (and caret in the search field) across repaints.
  const focused = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null
  const focusLabel = focused?.getAttribute('aria-label'), focusTag = focused?.tagName
  const caret = focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] as const : null
  root.replaceChildren(fragment)
  if (focusLabel) {
    const target = Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(node => node.tagName === focusTag && node.getAttribute('aria-label') === focusLabel)
    target?.focus({ preventScroll: true })
    if (target instanceof HTMLInputElement && caret && target.type !== 'file') try { target.setSelectionRange(caret[0], caret[1]) } catch { /* type without selection */ }
  }
}

function stop() { if (stopped) return; dismissDialog(); stopped = true; generation++; for (const cleanup of stops.splice(0)) cleanup() }
async function main() {
  try {
    sdk = await ProjectTracker.ready
    if (stopped) return
    document.body.classList.toggle('is-major', sdk.context.kind === 'major')
    const theme = (mode: 'light' | 'dark') => { document.documentElement.style.colorScheme = mode }
    theme(sdk.context.theme.mode)
    await refresh()
    if (stopped) return
    stops.push(sdk.onContextChange(context => { theme(context.theme.mode); void refresh(true) }))
    try {
      const unsubscribe = await sdk.events.subscribe(['storage.changed', 'instances.changed'], () => { void refresh() })
      if (stopped) { void unsubscribe().catch(() => {}); return }
      stops.push(() => { void unsubscribe().catch(() => {}) })
    } catch { /* business subscriptions unavailable in disposable prevalidation */ }
    if (stopped) return
    // Planned posts become « à confirmer » when their time passes.
    const timer = setInterval(() => { if (sdk.revoked) { stop(); return } paint() }, 60_000)
    stops.push(() => clearInterval(timer))
    const resume = () => { if (!document.hidden && !stopped) void refresh() }
    document.addEventListener('visibilitychange', resume); window.addEventListener('focus', resume)
    stops.push(() => { document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume) })
  } catch { if (!stopped) root.replaceChildren(text('p', 'Connexion au SDK indisponible.')) }
}
window.addEventListener('pagehide', stop, { once: true })
void main()
