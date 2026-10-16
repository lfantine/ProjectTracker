import Link from 'next/link'
import { useEffect, useState } from 'react'
import { PackageLogo } from '../components/PackageLogo'
import { AppShell } from '../components/AppShell'
import { useComposition } from '../lib/composition'
import { useTheme } from '../lib/theme'
import { PlacementEditor } from '../components/PlacementEditor'
import { moduleHref, dashboardHref } from '../../shared/navigation'
import type { PackageShellSnapshot } from '../../shared/packageShell'
import type { DashboardWidgetPlacement } from '../../shared/models'

export default function CustomizePage() {
  const { snapshot, error, pending, mutate } = useComposition()
  const { themeLabel, cycleTheme } = useTheme()
  const [packages, setPackages] = useState<PackageShellSnapshot | null>(null), [packageError, setPackageError] = useState('')
  const [selected, setSelected] = useState<string | null>(null), [configuring, setConfiguring] = useState<DashboardWidgetPlacement | null>(null)
  useEffect(() => {
    let alive = true
    async function refresh() {
      try { const value = await window.api?.packages?.snapshot(); if (!alive) return; if (value?.ok) { setPackages(value.value); setPackageError('') } else setPackageError('Les options des packages ne sont pas disponibles dans ce mode.') }
      catch { if (alive) setPackageError('Les options des packages ne sont pas disponibles dans ce mode.') }
    }
    void refresh(); const stop = window.api?.packages?.onChanged(() => { void refresh() })
    return () => { alive = false; stop?.() }
  }, [])
  const installed = packages?.packages.filter(item => item.state !== 'uninstalled') ?? []
  const current = installed.find(item => item.id === selected)
  const contributions = snapshot?.contributions.filter(item => item.ref.packageId === selected) ?? []
  const placements = snapshot?.dashboards.flatMap(dash => dash.widgets.filter(widget => widget.contribution.packageId === selected).map(widget => ({ dash, widget }))) ?? []
  return <AppShell title="Personnalisation">
    <div className="max-w-5xl mx-auto">
      {!selected ? <>
        <h2 className="text-2xl font-bold tracking-tight">Votre espace, vos packages</h2>
        <p className="text-sm text-text-muted mt-2 mb-7">Choisissez un package pour retrouver ses options. Les shortcuts se rangent directement dans la sidebar.</p>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <button className="package-settings-card" onClick={() => setSelected('core')}><img src="/images/logo.png" alt="" width={48} height={48} /><strong>CORE</strong><span>Apparence et préférences d’amber</span><small>Intégré à amber</small></button>
          {installed.map(item => <button key={item.id} className="package-settings-card" onClick={() => setSelected(item.id)}><PackageLogo name={item.name} logoDataUrl={(packages?.details?.find(detail => detail.manifest.id === item.id && detail.manifest.version === item.activeVersion) ?? packages?.details?.find(detail => detail.manifest.id === item.id))?.logoDataUrl} /><strong>{item.name}</strong><span>{item.state === 'active' ? 'Options, instances et intégrations' : 'Package inactif · données conservées'}</span><small>{item.activeVersion ?? 'Installé'} · {item.state === 'active' ? 'Actif' : 'Inactif'}</small></button>)}
        </div>
        {packageError && <p role="status" className="text-sm text-text-muted mt-4">{packageError}</p>}
        <Link href="/marketplace" className="ux-button inline-flex mt-6">＋ Découvrir des packages</Link>
      </> : <>
        <button className="text-sm text-text-muted mb-5 hover:text-text" onClick={() => setSelected(null)}>← Tous les packages</button>
        <h2 className="text-2xl font-bold">{selected === 'core' ? 'CORE' : current?.name ?? 'Package indisponible'}</h2>
        {selected === 'core' ? <div className="flex flex-col gap-6 mt-6">
          <section className="settings-section"><div><h3>Apparence</h3><p>Le thème est partagé avec les modules compatibles.</p></div><button className="ux-button" onClick={cycleTheme}>Thème : {themeLabel}</button></section>
          <section className="settings-section"><div><h3>Préférences de l’application</h3><p>Données, sauvegardes, diagnostic et services locaux.</p></div><Link className="ux-button" href="/settings">Ouvrir les réglages</Link></section>
          <section className="settings-section"><div><h3>Dashboards</h3><p>Personnalisez chaque dashboard directement dans sa vue.</p></div><Link className="ux-button" href="/home">Ouvrir le dashboard</Link></section>
          <section className="settings-section"><div><h3>Navigation par défaut</h3><p>Rétablit les shortcuts intégrés sans effacer vos raccourcis personnalisés.</p></div><button className="ux-button" disabled={pending} onClick={() => void mutate({ kind: 'sidebar.restore' })}>Restaurer la navigation par défaut</button></section>
        </div> : <div className="flex flex-col gap-6 mt-6">
          {current?.state !== 'active' && <p role="status">Ce package est inactif. Ses données et emplacements sont conservés. Réactivez-le depuis le marketplace pour modifier ses options.</p>}
          {contributions.filter(item => item.type === 'major').map(item => <section key={item.ref.contributionId} className="settings-section"><div><h3>{item.name}</h3><p>{snapshot?.instances.filter(value => value.packageId === selected && value.majorId === item.ref.contributionId).length ?? 0} instance(s) · préférences du module dans sa vue</p></div><Link href={moduleHref(item.ref)} className="ux-button">Ouvrir le module ↗</Link></section>)}
          <section><h3 className="font-bold mb-3">Widgets installés dans vos dashboards</h3>{placements.length ? placements.map(({ dash, widget }) => <div key={widget.placementId} className="settings-section"><div><h4 className="font-semibold">{contributions.find(item => item.ref.contributionId === widget.contribution.contributionId)?.name ?? widget.contribution.contributionId}</h4><Link className="text-sm text-text-muted underline" href={dashboardHref(dash.id)}>{dash.name}</Link></div><button className="ux-button" disabled={pending || current?.state !== 'active'} onClick={() => setConfiguring(widget)}>Configurer</button></div>) : <p className="text-sm text-text-muted">Aucun widget de ce package placé pour le moment. Ajoutez-en depuis le mode édition d’un dashboard.</p>}</section>
          {!contributions.length && current?.state === 'active' && <p className="text-text-muted text-sm">Ce package ne déclare pas d’options de contribution. Les thèmes et extensions se gèrent dans le marketplace.</p>}
          <Link href="/marketplace" className="ux-button self-start">Gérer l’installation</Link>
        </div>}
      </>}
      {error && <p role="alert" className="text-danger mt-3">{error}</p>}
    </div>
    {configuring && <PlacementEditor title="Options du widget" contributions={contributions.filter(item => item.ref.contributionId === configuring.contribution.contributionId)} initial={{ ref: `${configuring.contribution.packageId}/${configuring.contribution.contributionId}`, binding: configuring.binding, config: configuring.config.values }} onClose={() => setConfiguring(null)} onSave={async (_definition, binding, config) => !!await mutate({ kind: 'widget.configure', dashboardId: configuring.dashboardId, placementId: configuring.placementId, binding, config })} />}
  </AppShell>
}
