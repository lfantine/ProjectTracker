import { useState } from 'react'
import { useComposition } from '../lib/composition'
import { HOST_ICONS, type HostIcon } from '../../shared/version'
import { NATIVE_PAGES, type NativePage, type SidebarTarget } from '../../shared/navigation'
import { SHORTCUT_ICONS, SHORTCUT_ICONS_SHORTLIST, ShortcutIcon } from './ShortcutIcon'
import { ChevronDownIcon, FolderIcon, LinkIcon } from './icons'
import { Modal, PrimaryButton } from './ui'
export function ShortcutEditor({ onClose }: { onClose(): void }) {
  const { snapshot, mutate, pending, error } = useComposition()
  const [group, setGroup] = useState(false), [name, setName] = useState(''), [icon, setIcon] = useState<HostIcon>('home')
  const [destination, setDestination] = useState('native:projects'), [instance, setInstance] = useState(''), [allIcons, setAllIcons] = useState(false)
  const majors = snapshot?.contributions.filter(item => item.type === 'major') ?? []
  const major = majors.find(item => destination === `major:${item.ref.packageId}/${item.ref.contributionId}`)
  async function submit() {
    if (!name.trim() || pending) return
    if (group) { if (await mutate({ kind: 'sidebar.group.add', name })) onClose(); return }
    let target: SidebarTarget = { kind: 'native', page: destination.slice(7) as NativePage }
    if (destination.startsWith('dashboard:')) target = { kind: 'dashboard', dashboardId: destination.slice(10) }
    if (major) target = { kind: 'major', major: major.ref, binding: instance ? { mode: 'fixed', major: major.ref, instanceId: instance } : { mode: 'active', major: major.ref } }
    if (await mutate({ kind: 'sidebar.add', label: name, icon, target })) onClose()
  }
  const destinationLabel = major?.name ?? (destination.startsWith('dashboard:') ? snapshot?.dashboards.find(item => `dashboard:${item.id}` === destination)?.name : NATIVE_PAGES[destination.slice(7) as NativePage]?.label)
  return <Modal open compact center width={560} title="Ajouter à la sidebar" onClose={onClose}>
    <div className="shortcut-kind"><button type="button" aria-pressed={!group} onClick={() => setGroup(false)}><LinkIcon size={16} />Shortcut</button><button type="button" aria-pressed={group} onClick={() => setGroup(true)}><FolderIcon size={16} />Groupe</button></div>
    <form className="ux-form shortcut-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="shortcut-preview" aria-label="Aperçu du shortcut"><span className="shortcut-preview-icon">{group ? <FolderIcon size={22} /> : <ShortcutIcon name={icon} size={22} />}</span><div><strong>{name.trim() || (group ? 'Nouveau groupe' : 'Nouveau shortcut')}</strong><small>{group ? 'Une catégorie repliable pour vos shortcuts' : destinationLabel}</small></div></div>
      <section className="shortcut-fields">
        {!group && <label>Destination<select value={destination} onChange={event => { setDestination(event.target.value); setInstance('') }}>
          <optgroup label="CORE">{Object.entries(NATIVE_PAGES).map(([id, item]) => <option key={id} value={`native:${id}`}>{item.label}</option>)}</optgroup>
          <optgroup label="Dashboards">{snapshot?.dashboards.map(item => <option key={item.id} value={`dashboard:${item.id}`}>{item.name}</option>)}</optgroup>
          <optgroup label="Modules">{majors.map(item => <option key={item.ref.packageId + item.ref.contributionId} value={`major:${item.ref.packageId}/${item.ref.contributionId}`}>{item.name}</option>)}</optgroup>
        </select></label>}
        <label>Nom<input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder={group ? 'Travail, Personnel…' : 'Mon planning…'} /></label>
        {major && !group && <label className="shortcut-instance">Instance<select value={instance} onChange={event => setInstance(event.target.value)}><option value="">Suivre l’instance active</option>{snapshot?.instances.filter(item => item.packageId === major.ref.packageId && item.majorId === major.ref.contributionId).map(item => <option key={item.instanceId} value={item.instanceId}>{item.name}</option>)}</select></label>}
      </section>
      {!group && <fieldset className="shortcut-icon-picker"><legend>Icône <span>{SHORTCUT_ICONS[icon].label}</span></legend>
        <div className="shortcut-icon-grid" role="group" aria-label="Choisir une icône">{(allIcons ? HOST_ICONS : HOST_ICONS.slice(0, SHORTCUT_ICONS_SHORTLIST)).map(value => <button type="button" key={value} aria-label={`Icône ${SHORTCUT_ICONS[value].label}`} title={SHORTCUT_ICONS[value].label} aria-pressed={icon === value} onClick={() => setIcon(value)}><ShortcutIcon name={value} size={21} /></button>)}</div>
        <button type="button" className="shortcut-icon-more" aria-expanded={allIcons} onClick={() => setAllIcons(value => !value)}>{allIcons ? 'Voir moins' : `Voir plus (${HOST_ICONS.length - SHORTCUT_ICONS_SHORTLIST})`}<ChevronDownIcon size={13} /></button>
      </fieldset>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="shortcut-actions"><button type="button" className="ux-button" onClick={onClose}>Annuler</button><PrimaryButton type="submit" disabled={pending || !name.trim()}>{group ? 'Créer le groupe' : 'Ajouter le shortcut'}</PrimaryButton></div>
    </form>
  </Modal>
}
