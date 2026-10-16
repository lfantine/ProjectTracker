import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Contribution, Manifest } from '../../shared/manifest'
import type { PackageShellSnapshot } from '../../shared/packageShell'
import type { Result } from '../../shared/errors'
import { matchesMarketplace } from '../../shared/marketplace'
import { normalizePermissions, describePermissions } from '../../shared/permissions'
import { moduleHref } from '../../shared/navigation'
import { useComposition } from '../lib/composition'
import { useData } from '../lib/store'
import { ACTION_LABEL, STATUS_LABEL, orphanPackages, packageEntries, problemLabel, type PackageEntry, type PackageStatus, type PackageVersion } from '../lib/packageCatalog'
import { PlacementEditor } from './PlacementEditor'
import { PackageLogo } from './PackageLogo'
import { Modal, Select, Spinner } from './ui'
import {
  AlertIcon, BlockIcon, CheckIcon, ChevronDownIcon, FolderIcon, PageIcon, PaletteIcon, PuzzleIcon, RefreshIcon, SearchIcon, ShieldIcon, StoreIcon, UploadIcon, WidgetIcon, XIcon,
} from './icons'

type Kind = 'all' | 'package' | 'extension'
type Busy = string | null
const STATUS_TONE: Record<PackageStatus, string> = {
  active: 'bg-success-soft text-success', update: 'bg-accent-soft text-accent-soft-text', ready: 'bg-warning-soft text-warning',
  disabled: 'bg-surface2 text-text-faint', suspended: 'bg-danger-soft text-danger', available: 'bg-surface2 text-text-muted', removed: 'bg-surface2 text-text-faint',
}
const CONTRIBUTION: Record<Contribution['type'], { label: string; long: string; Icon: typeof PageIcon }> = {
  major: { label: 'Page', long: 'Page complète', Icon: PageIcon },
  widget: { label: 'Widget', long: 'Widget de dashboard', Icon: WidgetIcon },
  minor: { label: 'Bloc projet', long: 'Bloc dans un projet', Icon: BlockIcon },
}

function contents(manifest: Manifest): { key: string; label: string; Icon: typeof PageIcon; count: number }[] {
  if (manifest.kind === 'extension') return manifest.extensionType === 'theme'
    ? [{ key: 'theme', label: 'Thème', Icon: PaletteIcon, count: 1 }]
    : [{ key: 'features', label: 'Complément', Icon: PuzzleIcon, count: manifest.features.length }]
  return (['major', 'widget', 'minor'] as const).map(type => ({ key: type, ...CONTRIBUTION[type], count: manifest.contributions.filter(item => item.type === type).length })).filter(item => item.count)
}
const firstMajor = (manifest: Manifest) => manifest.kind === 'package' ? manifest.contributions.find(item => item.type === 'major') : undefined

function StatusBadge({ status }: { status: PackageStatus }) {
  return <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_TONE[status]}`}>
    {status === 'active' && <CheckIcon size={11} />}{STATUS_LABEL[status]}
  </span>
}

function ActionButton({ entry, busy, disabled, onRun, size = 'sm' }: { entry: PackageEntry; busy: Busy; disabled: boolean; onRun: (entry: PackageEntry) => void; size?: 'sm' | 'lg' }) {
  const major = firstMajor(entry.manifest)
  const base = `relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg font-bold no-underline transition ${size === 'lg' ? 'text-[13.5px] px-4 py-2.5' : 'text-[12.5px] px-3.5 py-1.5'}`
  if (entry.action === 'open' && major) return <Link className={`${base} bg-accent text-accent-text hover:brightness-105`} href={moduleHref({ packageId: entry.id, contributionId: major.id })}>Ouvrir</Link>
  if (entry.action === 'manage') return size === 'sm' ? <button type="button" onClick={() => onRun(entry)} className={`${base} border border-border bg-transparent text-text-muted cursor-pointer hover:bg-surface-hover`}>Gérer</button> : null
  const blocked = entry.problems.length > 0 || !entry.target
  return <button type="button" disabled={disabled || blocked} onClick={() => onRun(entry)}
    className={`${base} border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${entry.status === 'available' || entry.status === 'removed' ? 'bg-text text-bg hover:opacity-90' : 'bg-accent text-accent-text hover:brightness-105'}`}>
    {busy === entry.id && <Spinner size={13} />}{ACTION_LABEL[entry.status]}
  </button>
}

function PackageCard({ entry, busy, disabled, onSelect, onRun }: { entry: PackageEntry; busy: Busy; disabled: boolean; onSelect: () => void; onRun: (entry: PackageEntry) => void }) {
  const { manifest } = entry
  return <li className="relative flex flex-col gap-3 p-4 rounded-2xl border border-border bg-surface hover:border-accent hover:shadow-lg transition">
    <button type="button" aria-label={`Détails de ${manifest.name}`} onClick={onSelect} className="absolute inset-0 rounded-2xl border-none bg-transparent cursor-pointer" />
    <div className="flex items-start justify-between gap-3 pointer-events-none">
      <PackageLogo name={manifest.name} logoDataUrl={entry.logoDataUrl} />
      <StatusBadge status={entry.status} />
    </div>
    <div className="min-w-0 pointer-events-none">
      <h3 className="text-[15px] font-bold leading-tight truncate">{manifest.name}</h3>
      <p className="text-[11.5px] text-text-faint mt-0.5 truncate">v{manifest.version} · {manifest.author}</p>
      {manifest.description && <p className="text-[12.5px] text-text-muted leading-snug mt-2 line-clamp-2">{manifest.description}</p>}
    </div>
    <div className="flex flex-wrap gap-1.5 pointer-events-none">
      {contents(manifest).map(({ key, label, Icon, count }) => <span key={key} className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted bg-surface2 rounded-md px-1.5 py-0.5"><Icon size={12} />{count > 1 ? `${count} × ` : ''}{label}</span>)}
    </div>
    {entry.problems.length > 0 && <p className="flex items-center gap-1.5 text-[12px] font-semibold text-danger pointer-events-none"><AlertIcon size={13} />{entry.problems[0]}</p>}
    <div className="mt-auto flex justify-end"><ActionButton entry={entry} busy={busy} disabled={disabled} onRun={onRun} /></div>
  </li>
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section aria-label={title} className="flex flex-col gap-3">
    <h2 className="text-[12px] font-bold uppercase tracking-wide text-text-faint">{title} <span className="ml-1 text-text-faint/70">{count}</span></h2>
    <ul className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>{children}</ul>
  </section>
}

function Steps({ entry, used }: { entry: PackageEntry; used: boolean }) {
  const steps = [['Installé', entry.installed], ['Activé', entry.activeVersion !== null], ['Utilisé', used]] as const
  return <ol aria-label="Étapes" className="flex items-center gap-2 list-none p-0 m-0">
    {steps.map(([label, done], index) => <li key={label} className="flex items-center gap-2">
      {index > 0 && <span aria-hidden="true" className={`h-px w-6 ${done ? 'bg-success' : 'bg-border'}`} />}
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold ${done ? 'text-success' : 'text-text-faint'}`}>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center ${done ? 'bg-success-soft' : 'border border-border'}`}>{done ? <CheckIcon size={12} /> : index + 1}</span>{label}
      </span>
    </li>)}
  </ol>
}

export function PackageMarketplace() {
  const [snapshot, setSnapshot] = useState<PackageShellSnapshot | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState<Busy>(null)
  const [kind, setKind] = useState<Kind>('all'), [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null), [placement, setPlacement] = useState<string | null>(null), [destination, setDestination] = useState('')
  const composition = useComposition(), { data } = useData()
  const alive = useRef(false), sequence = useRef(0), running = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    try {
      const result = await window.api?.packages?.snapshot()
      if (!alive.current || request !== sequence.current) return
      if (result?.ok) setSnapshot(result.value)
      else setError(result && !result.ok ? result.error.message : 'Gestion des packages indisponible dans ce profil.')
    } catch { if (alive.current && request === sequence.current) setError('Gestion des packages non activée dans ce profil. Les modules intégrés restent accessibles.') }
  }, [])
  useEffect(() => { alive.current = true; void refresh(); const stop = window.api?.packages?.onChanged(() => { void refresh() }); return () => { alive.current = false; sequence.current++; stop?.() } }, [refresh])

  /** Runs native steps in order; stops at the first refusal or cancellation. */
  async function run(key: string, steps: (() => Promise<Result<unknown>>)[], message: string, after?: (values: unknown[]) => void) {
    if (running.current) return
    running.current = true; setBusy(key); setError(''); setNotice('')
    const values: unknown[] = []
    try {
      for (const step of steps) {
        const result = await step()
        if (!alive.current) return
        if (!result.ok) { setError(result.error.message); return }
        if (result.value === null) return // native picker cancelled
        values.push(result.value)
      }
      setNotice(message); after?.(values)
    } catch { if (alive.current) setError('Opération non confirmée. Actualise pour vérifier son état avant de réessayer.') }
    finally { running.current = false; if (alive.current) { setBusy(null); await refresh() } }
  }
  const activate = (id: string, version: string) => () => window.api.packages.activate({ packageId: id, version })
  function primary(entry: PackageEntry) {
    if (entry.action === 'manage') return setSelected(entry.id)
    const target = entry.target
    if (!target) return
    const { id } = entry, { version } = target.manifest, name = entry.manifest.name
    if (entry.action === 'activate') return void run(id, [activate(id, version)], `${name} est activé.`)
    const load = target.selection ? () => window.api.packages.importFolder({ selection: target.selection! }) : target.bundleKey ? () => window.api.packages.importBundled({ key: target.bundleKey! }) : null
    if (load) void run(id, [load, activate(id, version)], `${name} est installé et activé.`)
  }
  // A ZIP is installed in one gesture: import, then activation (two native consents).
  function importZip() {
    void run('import', [async () => {
      const result = await window.api.packages.importArchive()
      if (!result.ok || !result.value) return result
      const { packageId, version } = result.value as { packageId: string; version: string }
      setSelected(packageId)
      return window.api.packages.activate({ packageId, version })
    }], 'Module installé et activé.')
  }
  const ready = snapshot?.phase === 'ready', disabled = !!busy || !ready
  const entries = packageEntries(snapshot)
  const visible = entries.filter(entry => (kind === 'all' || entry.manifest.kind === kind) && matchesMarketplace(entry.manifest, { query, contributions: [] }))
  const installed = visible.filter(entry => entry.installed), available = visible.filter(entry => !entry.installed)
  const orphans = orphanPackages(snapshot, entries)
  const linked = snapshot?.catalogue && snapshot.catalogue.status !== 'unlinked' ? snapshot.catalogue : null
  const invalid = snapshot?.catalogue?.status === 'ok' ? snapshot.catalogue.entries.filter(item => item.status === 'invalid') : []

  const current = selected ? entries.find(entry => entry.id === selected) : undefined
  const manifest = current?.manifest
  const definitions = composition.snapshot?.contributions.filter(item => item.ref.packageId === manifest?.id) ?? []
  const definition = definitions.find(item => item.ref.contributionId === placement)
  const usage = manifest ? {
    instances: composition.snapshot?.instances.filter(item => item.packageId === manifest.id).length ?? 0,
    widgets: composition.snapshot?.dashboards.flatMap(item => item.widgets).filter(item => item.contribution.packageId === manifest.id).length ?? 0,
    minors: data.projects.flatMap(item => item.layout ?? []).filter(item => item.contribution?.packageId === manifest.id).length,
  } : null
  const rights = manifest ? describePermissions(normalizePermissions(manifest.permissions)) : []
  const otherVersions = current ? current.versions.filter(version => version.installed && version.manifest.version !== current.activeVersion) : []
  const closeDetail = () => { if (!busy) { setSelected(null); setPlacement(null) } }

  return <section aria-label="Catalogue des packages" className="flex flex-col gap-6">
    <div className="flex flex-wrap items-center gap-3">
      <label className="relative flex-1 min-w-[220px] max-w-md">
        <span className="sr-only">Rechercher</span>
        <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un module…"
          className="w-full font-sans text-sm pl-9 pr-3 py-2.5 rounded-lg border border-border bg-bg text-text placeholder:text-text-faint outline-none focus:border-accent transition" />
      </label>
      <div role="radiogroup" aria-label="Type" className="inline-flex p-1 rounded-lg bg-surface2 border border-border">
        {([['all', 'Tout'], ['package', 'Modules'], ['extension', 'Thèmes et compléments']] as const).map(([value, label]) =>
          <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)}
            className={`border-none text-[12.5px] font-semibold px-3 py-1.5 rounded-md cursor-pointer transition ${kind === value ? 'bg-surface text-text shadow-sm' : 'bg-transparent text-text-muted hover:text-text'}`}>{label}</button>)}
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {linked
          ? <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted bg-surface2 border border-border rounded-lg pl-2.5 pr-1 py-1">
              <FolderIcon size={14} />Dossier lié
              <button type="button" title="Actualiser le dossier" aria-label="Actualiser le dossier" disabled={disabled} onClick={() => void run('refresh', [() => window.api.packages.refresh()], 'Dossier actualisé.')} className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-text-faint hover:text-text rounded cursor-pointer disabled:opacity-50"><RefreshIcon size={13} /></button>
              <button type="button" title="Délier le dossier" aria-label="Délier le dossier" disabled={disabled} onClick={() => void run('unlink', [() => window.api.packages.unlinkFolder()], 'Dossier délié. Les modules installés restent.')} className="w-6 h-6 flex items-center justify-center border-none bg-transparent text-text-faint hover:text-danger rounded cursor-pointer disabled:opacity-50"><XIcon size={13} /></button>
            </span>
          : <button type="button" title="Afficher les ZIP d’un dossier comme modules disponibles" disabled={disabled} onClick={() => void run('link', [() => window.api.packages.linkFolder()], 'Dossier lié.')} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-muted bg-transparent border border-border rounded-lg px-3 py-2 cursor-pointer hover:bg-surface-hover disabled:opacity-50"><FolderIcon size={14} />Lier un dossier</button>}
        <button type="button" disabled={disabled} onClick={importZip} className="inline-flex items-center gap-1.5 border-none bg-accent text-accent-text font-bold text-[13px] px-4 py-2 rounded-lg cursor-pointer hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed">
          {busy === 'import' ? <Spinner size={14} /> : <UploadIcon size={15} />}Importer un ZIP
        </button>
      </div>
    </div>

    {error && <p role="alert" className="flex items-center gap-2 text-[13px] font-semibold text-danger bg-danger-soft rounded-lg px-3 py-2"><AlertIcon size={15} />{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 text-[13px] font-semibold text-success bg-success-soft rounded-lg px-3 py-2"><CheckIcon size={15} />{notice}</p>}
    {snapshot && !ready && <p role="status" className="flex items-center gap-2 text-[13px] text-warning bg-warning-soft rounded-lg px-3 py-2"><AlertIcon size={15} />Gestion des modules en cours de démarrage ({snapshot.phase}). Tes données sont conservées.</p>}
    {linked?.status === 'error' && <p role="status" className="flex items-center gap-2 text-[13px] text-warning bg-warning-soft rounded-lg px-3 py-2"><AlertIcon size={15} />Dossier lié illisible. Relie-le ou actualise.</p>}
    {invalid.length > 0 && <p role="status" className="flex items-center gap-2 text-[12.5px] text-text-muted"><AlertIcon size={14} />ZIP ignoré{invalid.length > 1 ? 's' : ''} : {invalid.map(item => item.fileName).join(', ')}</p>}

    {!snapshot && !error && <div className="flex justify-center py-16"><Spinner /></div>}
    {snapshot && !entries.length && !orphans.length && <div className="flex flex-col items-center text-center gap-3 py-16 px-6 rounded-2xl border border-dashed border-border">
      <span className="w-14 h-14 rounded-2xl bg-accent-soft text-accent-soft-text flex items-center justify-center"><StoreIcon size={26} /></span>
      <h2 className="text-[16px] font-bold">Aucun module pour l’instant</h2>
      <p className="text-[13px] text-text-muted max-w-sm">Importe un fichier ZIP de module pour l’ajouter à amber.</p>
    </div>}
    {!!entries.length && !visible.length && <p className="text-[13px] text-text-faint text-center py-10">Aucun module ne correspond à ta recherche.</p>}

    {(installed.length > 0 || orphans.length > 0) && <Section title="Installés" count={installed.length + orphans.length}>
      {installed.map(entry => <PackageCard key={entry.id} entry={entry} busy={busy} disabled={disabled} onSelect={() => setSelected(entry.id)} onRun={primary} />)}
      {orphans.map(item => <li key={item.id} className="flex flex-col gap-3 p-4 rounded-2xl border border-dashed border-border bg-surface">
        <div className="flex items-start justify-between gap-3"><PackageLogo name={item.name} /><span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger">Illisible</span></div>
        <div><h3 className="text-[15px] font-bold truncate">{item.name}</h3><p className="text-[11.5px] text-text-faint">Fichiers introuvables · données conservées</p></div>
        <button type="button" disabled={disabled} onClick={() => void run(item.id, [() => window.api.packages.stop({ packageId: item.id, action: 'uninstall' })], `${item.name} est désinstallé.`)} className="self-end border border-border bg-transparent text-text-muted text-[12.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer hover:text-danger disabled:opacity-50">Désinstaller {item.name}</button>
      </li>)}
    </Section>}
    {available.length > 0 && <Section title="Disponibles" count={available.length}>
      {available.map(entry => <PackageCard key={entry.id} entry={entry} busy={busy} disabled={disabled} onSelect={() => setSelected(entry.id)} onRun={primary} />)}
    </Section>}

    {current && manifest && !placement && <Modal open compact width={640} title={manifest.name} onClose={closeDetail}>
      <div className="flex flex-col gap-5 pt-1">
        <div className="flex items-start gap-4">
          <PackageLogo name={manifest.name} logoDataUrl={current.logoDataUrl} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={current.status} /><span className="text-[12px] text-text-faint">v{manifest.version} · {manifest.author}</span></div>
            {manifest.description && <p className="text-[13px] text-text-muted leading-relaxed mt-2">{manifest.description}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-surface2">
          <Steps entry={current} used={!!usage && usage.instances + usage.widgets + usage.minors > 0} />
          <ActionButton entry={current} busy={busy} disabled={disabled} onRun={primary} size="lg" />
        </div>
        {current.problems.length > 0 && <ul className="list-none m-0 p-3 rounded-xl bg-danger-soft text-danger text-[12.5px] font-semibold flex flex-col gap-1">
          {current.problems.map(problem => <li key={problem} className="flex items-center gap-1.5"><AlertIcon size={13} />{problem}</li>)}
        </ul>}

        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-text-faint">Contenu</h3>
          {manifest.kind === 'package' ? <ul className="list-none m-0 p-0 flex flex-col gap-2">{manifest.contributions.map(item => {
            const { long, Icon } = CONTRIBUTION[item.type]
            const active = current.status === 'active' || current.status === 'update'
            return <li key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-border">
              <span className="w-9 h-9 rounded-lg bg-accent-soft text-accent-soft-text flex items-center justify-center flex-shrink-0"><Icon size={17} /></span>
              <div className="flex-1 min-w-0"><strong className="block text-[13.5px] truncate">{item.name}</strong><span className="text-[11.5px] text-text-faint">{long}</span></div>
              {active && item.type === 'major' && <>
                <button type="button" disabled={composition.pending} onClick={() => void composition.mutate({ kind: 'sidebar.add', label: item.name, icon: item.icon ?? 'note', target: { kind: 'major', major: { packageId: manifest.id, contributionId: item.id }, binding: { mode: 'active', major: { packageId: manifest.id, contributionId: item.id } } } }).then(done => { if (done) setNotice(`${item.name} est dans le menu.`) })}
                  className="text-[12px] font-semibold text-text-muted bg-transparent border border-border rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-surface-hover disabled:opacity-50">Ajouter au menu</button>
                {/* A single page is already opened by the main action above. */}
                {manifest.contributions.filter(other => other.type === 'major').length > 1 && <Link className="text-[12px] font-bold text-accent-text bg-accent rounded-lg px-2.5 py-1.5 no-underline" href={moduleHref({ packageId: manifest.id, contributionId: item.id })}>Ouvrir</Link>}
              </>}
              {active && item.type !== 'major' && <button type="button" onClick={() => { setPlacement(item.id); setDestination('') }} className="text-[12px] font-semibold text-text-muted bg-transparent border border-border rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-surface-hover">{item.type === 'widget' ? 'Ajouter à un dashboard' : 'Ajouter à un projet'}</button>}
            </li>
          })}</ul> : <p className="flex items-center gap-3 p-3 rounded-xl border border-border text-[13px]">
            {manifest.extensionType === 'theme' ? <PaletteIcon size={17} /> : <PuzzleIcon size={17} />}
            {manifest.extensionType === 'theme' ? 'Thème' : `${manifest.features.length} complément${manifest.features.length > 1 ? 's' : ''}`} pour <strong>{manifest.target.package}</strong>
          </p>}
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="flex flex-col gap-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-text-faint">Accès demandés</h3>
            {rights.length ? <ul className="list-none m-0 p-0 flex flex-col gap-1.5">{rights.map(right => <li key={right} className="flex items-center gap-2 text-[12.5px]"><ShieldIcon size={14} className="text-warning flex-shrink-0" />{right}</li>)}</ul>
              : <p className="flex items-center gap-2 text-[12.5px] text-success"><ShieldIcon size={14} />Aucun accès à tes données ni à Internet</p>}
          </div>
          {usage && current.installed && <div className="flex flex-col gap-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-text-faint">Utilisation</h3>
            <div className="flex gap-2">{([['instances', usage.instances, firstMajor(manifest)?.instanceLabel ?? 'Instances'], ['widgets', usage.widgets, 'Widgets'], ['blocs', usage.minors, 'Blocs projet']] as const).map(([key, value, label]) =>
              <div key={key} className="flex-1 rounded-lg bg-surface2 px-2.5 py-2"><strong className="block text-[17px] leading-none">{value}</strong><span className="text-[11px] text-text-faint">{label}</span></div>)}</div>
          </div>}
        </div>

        <details className="group rounded-xl border border-border">
          <summary className="flex items-center justify-between cursor-pointer px-3 py-2.5 text-[12.5px] font-semibold text-text-muted list-none">Infos techniques<ChevronDownIcon size={14} className="transition group-open:rotate-180" /></summary>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 pb-3 text-[12px]">
            <dt className="text-text-faint">Identifiant</dt><dd className="m-0 font-mono">{manifest.id}</dd>
            <dt className="text-text-faint">API amber</dt><dd className="m-0 font-mono">{manifest.hostApi}</dd>
            <dt className="text-text-faint">Version active</dt><dd className="m-0">{current.activeVersion ?? '—'}</dd>
            {!!Object.keys(manifest.dependencies).length && <><dt className="text-text-faint">Dépendances</dt><dd className="m-0">{Object.entries(manifest.dependencies).map(([id, range]) => `${id} ${range}`).join(', ')}</dd></>}
            {current.reason && <><dt className="text-text-faint">État</dt><dd className="m-0">{current.reason}</dd></>}
            <dt className="text-text-faint">Éditeur</dt><dd className="m-0">Non vérifié</dd>
          </dl>
          {otherVersions.length > 0 && <ul className="list-none m-0 px-3 pb-3 flex flex-col gap-1.5">{otherVersions.map((version: PackageVersion) =>
            <li key={version.manifest.version} className="flex items-center justify-between gap-2 text-[12px]">
              <span>Version {version.manifest.version}{version.issues.length ? ` · ${version.issues.map(problemLabel).join(', ')}` : ''}</span>
              <button type="button" disabled={disabled || !!version.issues.length} onClick={() => void run(current.id, [activate(current.id, version.manifest.version)], `Version ${version.manifest.version} activée.`)} className="text-[11.5px] font-semibold bg-transparent border border-border rounded-md px-2 py-1 cursor-pointer disabled:opacity-50">Activer cette version</button>
            </li>)}</ul>}
        </details>

        {current.installed && <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-border">
          <span className="mr-auto text-[11.5px] text-text-faint">Tes données sont conservées.</span>
          {current.activeVersion && <button type="button" disabled={disabled} onClick={() => void run(current.id, [() => window.api.packages.stop({ packageId: current.id, action: 'disable' })], `${manifest.name} est désactivé.`)} className="text-[12.5px] font-semibold text-text-muted bg-transparent border border-border rounded-lg px-3 py-1.5 cursor-pointer hover:bg-surface-hover disabled:opacity-50">Désactiver</button>}
          <button type="button" disabled={disabled} onClick={() => void run(current.id, [() => window.api.packages.stop({ packageId: current.id, action: 'uninstall' })], `${manifest.name} est désinstallé.`)} className="text-[12.5px] font-semibold text-danger bg-transparent border border-border rounded-lg px-3 py-1.5 cursor-pointer hover:bg-danger-soft disabled:opacity-50">Désinstaller</button>
        </div>}
        {composition.error && <p role="alert" className="text-[12.5px] text-danger">{composition.error}</p>}
      </div>
    </Modal>}
    {definition && !destination && <Modal open compact center width={420} title={definition.type === 'widget' ? 'Ajouter à un dashboard' : 'Ajouter à un projet'} onClose={() => setPlacement(null)}>
      <div className="flex flex-col gap-3 pt-1">
        <Select aria-label="Destination" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choisir…</option>{definition.type === 'widget' ? composition.snapshot?.dashboards.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        {definition.type === 'minor' && !data.projects.length && <Link href="/projects/new" className="text-[13px] text-accent">Créer un projet</Link>}
      </div>
    </Modal>}
    {definition && destination && <PlacementEditor key={`${definition.ref.contributionId}-${destination}`} title="Configurer l’emplacement" contributions={[definition]} onClose={() => setPlacement(null)} onSave={async (item, binding, config) => !!await composition.mutate(item.type === 'widget' ? { kind: 'widget.add', dashboardId: destination, contribution: item.ref, binding, config } : { kind: 'project.add', projectId: destination, contribution: item.ref, binding, config })} />}
  </section>
}
