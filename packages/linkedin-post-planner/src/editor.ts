import type { ProjectTrackerSdk } from '../../../sdk/src'
import { createImage, deleteImage, deletePost, readImage, savePost, saveSettings, type Entry, type Snapshot } from './client'
import { button, field, input, select, text } from './dom'
import { prepareImage, IMAGE_ACCEPT } from './image'
import {
  HOOK_PREVIEW, MAX_CONTENT, POST_STATUSES, POST_TYPES, httpUrl, isDate, isTime, linkedinUrlError, newPost, parseTags,
  withChanges, type Post, type PostStatus, type PostType, type StoredImage,
} from './model'

type Sdk = Pick<ProjectTrackerSdk, 'call' | 'storage'>
const conflict = (error: unknown) => (error as { code?: string } | null)?.code === 'CONFLICT'
const failure = (error: unknown, action: string) => conflict(error)
  ? `${action} impossible : ce post a été modifié ailleurs. Ta saisie est conservée ; ferme puis rouvre le post pour repartir des données à jour.`
  : `${action} impossible (connexion ou données refusées). Ta saisie est conservée.`

/** Edits one post without losing fields unknown to this version. The image
 * document is written before the post; a failed post save keeps the same image
 * identity for the retry, and the old image is removed only after success. */
export function postEditor(sdk: Sdk, snapshot: Snapshot, existing: Entry<Post> | undefined, template: Partial<Post>, knownTags: string[], done: () => void): HTMLElement {
  const now = () => new Date().toISOString()
  // `template` pre-fills a new post, or proposes changes (e.g. a date) to an existing one.
  const source = existing ? { ...existing.value, ...template } : newPost(crypto.randomUUID(), now(), template)
  const panel = document.createElement('section'); panel.className = 'editor'
  panel.setAttribute('aria-label', existing ? 'Modifier le post' : 'Nouveau post')
  const fields = document.createElement('fieldset')
  fields.append(text('legend', existing ? 'Modifier le post' : 'Nouveau post'))

  const title = input('title', source.title); title.maxLength = 160; title.placeholder = 'Sujet en quelques mots (visible seulement par toi)'
  const type = select('type', POST_TYPES, source.type)
  const status = select('status', POST_STATUSES, source.status)
  const date = input('date', source.date ?? '', 'date')
  const time = input('time', source.time ?? '', 'time'); time.step = '60'
  date.onchange = () => {
    if (date.value && !time.value) time.value = snapshot.settings.value.defaultTime
    if (date.value && status.value === 'idee') status.value = 'brouillon'
  }
  const content = document.createElement('textarea'); content.name = 'content'; content.value = source.content; content.rows = 10
  content.placeholder = 'Texte du post. Les premières lignes sont l’accroche visible avant « voir plus ».'
  const counter = text('p', '', 'counter')
  const hook = text('p', '', 'hook-preview')
  const refreshContent = () => {
    counter.textContent = `${content.value.length} / ${MAX_CONTENT} caractères`
    counter.classList.toggle('is-over', content.value.length > MAX_CONTENT)
    const visible = content.value.slice(0, HOOK_PREVIEW).trim()
    hook.textContent = visible ? `Avant « voir plus » : ${visible}${content.value.length > HOOK_PREVIEW ? '…' : ''}` : ''
  }
  content.oninput = refreshContent; refreshContent()

  const tags = input('tags', source.tags.join(', ')); tags.placeholder = 'typescript, nouvelle feature, salon 2026…'
  const list = document.createElement('datalist'); list.id = 'known-tags'
  for (const tag of knownTags) { const option = document.createElement('option'); option.value = tag; list.append(option) }
  tags.setAttribute('list', list.id)
  const tagPreview = document.createElement('p'); tagPreview.className = 'tag-row'
  const refreshTags = () => { tagPreview.replaceChildren(...parseTags(tags.value).map(tag => text('span', `#${tag}`, 'tag'))) }
  tags.oninput = refreshTags; refreshTags()

  // Image: file picker, drag & drop or paste. Kept as a draft until saved.
  let image: { id: string; stored: StoredImage; thumbnail: string; written: boolean } | undefined
  let removeImage = false
  const imageBox = document.createElement('div'); imageBox.className = 'image-box'; imageBox.tabIndex = 0
  imageBox.setAttribute('aria-label', 'Image du post : choisir, déposer ou coller une image')
  const preview = document.createElement('img'); preview.alt = ''
  const imageInfo = text('p', '')
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = IMAGE_ACCEPT; picker.hidden = true
  const choose = button('Choisir une image', () => picker.click())
  const clear = button('Retirer l’image', () => { image = undefined; removeImage = true; refreshImage() })
  const alt = input('imageAlt', source.imageAlt ?? ''); alt.maxLength = 300; alt.placeholder = 'Décris l’image pour l’accessibilité'
  const altField = field('Texte alternatif', alt, 'wide')
  function refreshImage() {
    const thumbnail = image?.thumbnail ?? (removeImage ? undefined : source.thumbnail)
    const name = image?.stored.name ?? (removeImage ? undefined : source.imageName)
    preview.hidden = !thumbnail; if (thumbnail) preview.src = thumbnail
    imageInfo.textContent = name ? `Fichier : ${name}` : 'Aucune image. Choisis un fichier, dépose-le ici ou colle-le (⌘/Ctrl V).'
    clear.hidden = !thumbnail && !name
    altField.hidden = !thumbnail && !name
  }
  async function accept(file: File | undefined | null) {
    if (!file) return
    imageInfo.textContent = 'Préparation de l’image…'
    try { const prepared = await prepareImage(file); image = { id: crypto.randomUUID(), stored: prepared.image, thumbnail: prepared.thumbnail, written: false }; removeImage = false; refreshImage() }
    catch (error) { refreshImage(); imageInfo.textContent = error instanceof Error ? error.message : 'Image refusée.' }
  }
  picker.onchange = () => { void accept(picker.files?.[0]); picker.value = '' }
  imageBox.ondragover = event => { event.preventDefault(); imageBox.classList.add('is-dropping') }
  imageBox.ondragleave = () => imageBox.classList.remove('is-dropping')
  imageBox.ondrop = event => { event.preventDefault(); imageBox.classList.remove('is-dropping'); void accept(event.dataTransfer?.files[0]) }
  panel.addEventListener('paste', event => {
    const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith('image/'))
    if (file) { event.preventDefault(); void accept(file) }
  })
  // Full resolution, for a larger preview of an already-saved image.
  if (source.imageId) void readImage(sdk, snapshot, source.imageId).then(stored => { if (stored && !image && !removeImage && panel.isConnected) preview.src = stored.dataUrl }).catch(() => {})
  imageBox.append(preview, imageInfo, choose, clear, picker)
  refreshImage()

  const published = input('publishedUrl', source.publishedUrl ?? '', 'url'); published.placeholder = 'https://www.linkedin.com/posts/…'
  const notes = document.createElement('textarea'); notes.name = 'notes'; notes.value = source.notes ?? ''; notes.rows = 3
  notes.placeholder = 'Sources, idées de visuel, personnes à mentionner, résultats…'

  fields.append(
    field('Sujet', title, 'wide'), field('Type', type), field('Statut', status), field('Date', date), field('Heure', time),
    field('Contenu', content, 'wide'), counter, hook, field('Tags (séparés par des virgules)', tags, 'wide'), tagPreview, list,
    imageBox, altField, field('Lien du post publié', published, 'wide'), field('Notes', notes, 'wide'),
  )
  const statusLine = text('p', ''); statusLine.setAttribute('role', 'status')
  const save = button('Enregistrer', () => submit(), { className: 'primary' })
  // An image written for a post save that then failed is not referenced: drop it.
  const cancel = button('Annuler', () => { if (image?.written) void deleteImage(sdk, snapshot, image.id).catch(() => {}); done() })
  const actions = document.createElement('div'); actions.className = 'dialog-actions'
  actions.append(save, cancel)
  if (existing) actions.append(button('Sélectionner le texte', () => {
    content.focus(); content.select()
    let copied = false
    try { copied = document.execCommand('copy') } catch { /* clipboard denied to plugin frames */ }
    statusLine.textContent = copied ? 'Texte copié.' : 'Texte sélectionné : ⌘/Ctrl C pour le copier.'
  }))
  panel.append(fields, actions, statusLine)

  let pending = false
  async function submit() {
    if (pending) return
    const error = !content.value.trim() && !title.value.trim() ? 'Indique au moins un sujet ou un contenu.'
      : content.value.length > MAX_CONTENT ? `Le contenu dépasse ${MAX_CONTENT} caractères (limite LinkedIn).`
      : date.value && !isDate(date.value) ? 'Date invalide.'
      : time.value && !isTime(time.value) ? 'Heure invalide.'
      : status.value === 'planifie' && (!date.value || !time.value) ? 'Un post planifié a besoin d’une date et d’une heure.'
      : published.value && !httpUrl(published.value) ? 'Le lien publié doit être une adresse http(s).'
      : null
    if (error) { statusLine.textContent = error; return }
    const post: Post = { ...source, title: title.value.trim(), content: content.value, type: type.value as PostType, status: status.value as PostStatus, tags: parseTags(tags.value) }
    const optional = { date: date.value, time: date.value ? time.value : '', publishedUrl: published.value.trim(), notes: notes.value.trim(), imageAlt: alt.value.trim() }
    for (const [key, value] of Object.entries(optional) as [keyof typeof optional, string][]) { if (value) post[key] = value; else delete post[key] }
    const previousImage = source.imageId
    if (image) Object.assign(post, { imageId: image.id, imageName: image.stored.name, thumbnail: image.thumbnail })
    else if (removeImage) { delete post.imageId; delete post.imageName; delete post.thumbnail; delete post.imageAlt }
    pending = true; fields.disabled = true; save.disabled = cancel.disabled = true; statusLine.textContent = 'Enregistrement…'
    try {
      if (image && !image.written) { await createImage(sdk, snapshot, image.id, image.stored); image.written = true }
      await savePost(sdk, snapshot, withChanges(existing?.value, post, now()), existing?.revision ?? null)
      if (previousImage && previousImage !== post.imageId && ![...snapshot.posts.values()].some(entry => entry.value.imageId === previousImage)) await deleteImage(sdk, snapshot, previousImage).catch(() => {})
      if (panel.isConnected) done()
    } catch (reason) {
      if (panel.isConnected) statusLine.textContent = failure(reason, 'Enregistrement')
    } finally { pending = false; fields.disabled = false; save.disabled = cancel.disabled = false }
  }
  panel.onkeydown = event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit() }
  }
  return panel
}

/** Quick status change from a card, same CAS rules as the editor. */
export async function changeStatus(sdk: Sdk, snapshot: Snapshot, entry: Entry<Post>, status: PostStatus): Promise<void> {
  await savePost(sdk, snapshot, withChanges(entry.value, { ...entry.value, status }, new Date().toISOString()), entry.revision)
}

export function deletion(sdk: Sdk, snapshot: Snapshot, entry: Entry<Post>, done: () => void): HTMLElement {
  const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Supprimer le post')
  const statusLine = text('p', ''); statusLine.setAttribute('role', 'status')
  const cancel = button('Annuler', done)
  const confirm = button('Confirmer la suppression', async () => {
    cancel.disabled = true; statusLine.textContent = 'Suppression…'
    try { await deletePost(sdk, snapshot, entry.value.id, entry.revision!); if (panel.isConnected) done() }
    catch (error) { if (panel.isConnected) statusLine.textContent = failure(error, 'Suppression') }
    finally { cancel.disabled = false }
  }, { className: 'danger' })
  const actions = document.createElement('div'); actions.className = 'dialog-actions'; actions.append(confirm, cancel)
  panel.append(text('h2', 'Supprimer ce post ?'), text('p', entry.value.title || entry.value.content.slice(0, 120) || 'Post sans titre'),
    text('p', 'Le post et son image sont supprimés de ce profil. Pour garder une trace, préfère le statut « Abandonné ».', 'muted'), actions, statusLine)
  return panel
}

export function settingsEditor(sdk: Sdk, snapshot: Snapshot, done: () => void, message = ''): HTMLElement {
  const panel = document.createElement('section'); panel.setAttribute('aria-label', 'Réglages du profil')
  const fields = document.createElement('fieldset'); fields.append(text('legend', 'Réglages du profil'))
  const url = input('linkedinUrl', snapshot.settings.value.linkedinUrl ?? '', 'url'); url.placeholder = 'https://www.linkedin.com/in/ton-profil/'
  const time = input('defaultTime', snapshot.settings.value.defaultTime, 'time'); time.step = '60'
  fields.append(field('Lien de ton profil LinkedIn', url, 'wide'), field('Heure de publication par défaut', time))
  const statusLine = text('p', message); statusLine.setAttribute('role', 'status')
  const cancel = button('Annuler', done)
  const save = button('Enregistrer', async () => {
    const link = url.value.trim()
    const error = link ? linkedinUrlError(link) : null
    if (error) { statusLine.textContent = error; return }
    if (!isTime(time.value)) { statusLine.textContent = 'Heure invalide.'; return }
    const settings = { ...snapshot.settings.value, defaultTime: time.value }
    if (link) settings.linkedinUrl = link; else delete settings.linkedinUrl
    fields.disabled = true; cancel.disabled = true; statusLine.textContent = 'Enregistrement…'
    try { await saveSettings(sdk, snapshot, settings); if (panel.isConnected) done() }
    catch (reason) { if (panel.isConnected) statusLine.textContent = failure(reason, 'Enregistrement').replace('ce post a', 'les réglages ont') }
    finally { fields.disabled = false; cancel.disabled = false }
  }, { className: 'primary' })
  const actions = document.createElement('div'); actions.className = 'dialog-actions'; actions.append(save, cancel)
  panel.append(fields, actions, statusLine)
  return panel
}
