import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useRouter } from 'next/router'
import { AppShell } from './AppShell'
import { Modal } from './ui'
import { PlusIcon, SettingsIcon } from './icons'
import { PlacementEditor } from './PlacementEditor'
import { useCoreWidgets } from './CoreWidgets'
import { useComposition } from '../lib/composition'
import { dashboardHref } from '../../shared/navigation'
const Grid = dynamic(() => import('./DashboardGrid'), { ssr: false, loading: () => <p>Chargement de la grille…</p> })

export function DashboardPage({ dashboardId }: { dashboardId?: string }) {
  const { snapshot, error, pending, refresh, mutate } = useComposition()
  const { loading, render } = useCoreWidgets()
  const router = useRouter()
  const [editing, setEditing] = useState(false), [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [name, setName] = useState(''), [replacement, setReplacement] = useState(''), [deleting, setDeleting] = useState(false)
  const dashboard = dashboardId ? snapshot?.dashboards.find(item => item.id === dashboardId) : snapshot?.dashboards.find(item => item.isDefault)
  async function create(copy = false) {
    if (!name.trim() || !dashboard) return
    const result = await mutate(copy ? { kind: 'dashboard.duplicate', id: dashboard.id, name } : { kind: 'dashboard.create', name })
    if (result?.id) { setName(''); await router.push(dashboardHref(result.id)) }
  }
  return <AppShell title={dashboard?.name ?? 'Dashboard'}>
    {error && <p role="alert">{error} <button onClick={() => void refresh()}>Recharger</button></p>}
    {!snapshot || loading ? <p>Chargement du dashboard…</p> : !dashboard ? <p role="status">Dashboard introuvable. Le raccourci est conservé ; choisissez un dashboard dans la personnalisation.</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <label className="text-sm text-text-muted flex items-center gap-2">Dashboard<select className="dashboard-selector" aria-label="Dashboard" value={dashboard.id} onChange={event => { setDeleting(false); void router.push(dashboardHref(event.target.value)) }}>
          {snapshot.dashboards.map(item => <option key={item.id} value={item.id}>{item.name}{item.isDefault ? ' · par défaut' : ''}</option>)}
        </select></label>
        <button className={`ux-button ${editing ? 'is-primary' : ''}`} aria-pressed={editing} onClick={() => { setEditing(value => !value); setDeleting(false) }}>{editing ? 'Terminer la personnalisation' : 'Personnaliser le dashboard'}</button>
      </div>
      {editing && <div className="dashboard-edit-bar" role="toolbar" aria-label="Édition du dashboard">
        <div className="flex items-center gap-3"><span className="edit-mode-dot" /><div><strong className="text-sm block">Mode édition</strong><span className="text-xs text-text-muted">Composez votre espace</span></div></div>
        <div className="flex items-center gap-2 ml-auto"><button className="ux-button is-primary" disabled={pending} onClick={() => setAdding(true)}><PlusIcon size={16} />Ajouter un widget</button><button className="ux-button" onClick={() => setManaging(true)}><SettingsIcon size={16} />Dashboard</button><button className="help-button" data-hint-delay="900" aria-label="Aide à la personnalisation" title="Glissez la poignée pour déplacer un widget, un coin pour le redimensionner. Déposez-le dans la corbeille pour le retirer. Clavier : flèches sur la poignée, Maj + flèches pour la taille, Suppr pour retirer.">?</button></div>
      </div>}
      {managing && <Modal open title="Options du dashboard" onClose={() => setManaging(false)}><div className="ux-form">
        <label>Nom du dashboard<input aria-label="Nom du dashboard" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={dashboard.name} /></label>
        <div className="flex flex-wrap gap-3">
          <button disabled={pending || !name.trim()} onClick={() => void create()}>Créer un dashboard</button>
          <button disabled={pending || !name.trim()} onClick={() => void create(true)}>Dupliquer ce dashboard</button>
          <button disabled={pending || !name.trim()} onClick={async () => { if (await mutate({ kind: 'dashboard.rename', id: dashboard.id, name })) setName('') }}>Renommer</button>
          <button disabled={pending || dashboard.isDefault} onClick={() => void mutate({ kind: 'dashboard.default', id: dashboard.id })}>Définir par défaut</button>

          <button disabled={pending || snapshot.dashboards.length <= 1} onClick={() => setDeleting(true)}>Supprimer ce dashboard</button>
        </div>
        {deleting && <section aria-label="Confirmer la suppression du dashboard">
          <p>Supprimer « {dashboard.name} » et ses emplacements ? Les instances métier ne seront pas supprimées.</p>
          {dashboard.isDefault && <label>Nouveau dashboard par défaut<select value={replacement} onChange={event => setReplacement(event.target.value)}><option value="">Choisir</option>{snapshot.dashboards.filter(item => item.id !== dashboard.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <button disabled={pending || dashboard.isDefault && !replacement} onClick={async () => {
            if (await mutate({ kind: 'dashboard.delete', id: dashboard.id, ...(dashboard.isDefault ? { replacementId: replacement } : {}) })) { setDeleting(false); await router.push('/home') }
          }}>Confirmer la suppression</button><button disabled={pending} onClick={() => setDeleting(false)}>Annuler</button>
        </section>}
      </div></Modal>}
      <Grid key={dashboard.id} dashboard={dashboard} editing={editing} renderCore={render} />
      {adding && <PlacementEditor title="Ajouter un widget" contributions={snapshot.contributions.filter(item => item.type === 'widget')} onSave={async (definition, binding, config) => !!await mutate({ kind: 'widget.add', dashboardId: dashboard.id, contribution: definition.ref, binding, config })} onClose={() => setAdding(false)} />}
    </>}
  </AppShell>
}
