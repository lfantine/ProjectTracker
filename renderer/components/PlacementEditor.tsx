import { useState } from 'react'
import type { CompositionContribution } from '../../shared/composition'
import type { InstanceBinding } from '../../shared/bindings'
import { useComposition } from '../lib/composition'
import { Modal } from './ui'

// Closed declarative controls only. Custom UI remains inside the SDK frame.
export function PlacementEditor({ title, contributions, initial, onSave, onClose }: {
  title: string; contributions: CompositionContribution[]
  initial?: { ref: string; binding: InstanceBinding; config: Record<string, unknown> }
  onSave(ref: CompositionContribution, binding: InstanceBinding, config: Record<string, unknown>): Promise<boolean>
  onClose(): void
}) {
  const { snapshot } = useComposition()
  const key = (item: CompositionContribution) => `${item.ref.packageId}/${item.ref.contributionId}`
  const [selected, setSelected] = useState(initial?.ref ?? (contributions[0] ? key(contributions[0]) : ''))
  const [mode, setMode] = useState(initial?.binding.mode ?? 'active')
  const [instance, setInstance] = useState(initial?.binding.mode === 'fixed' ? initial.binding.instanceId : '')
  const [config, setConfig] = useState<Record<string, unknown>>(initial?.config ?? {})
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const definition = contributions.find(item => key(item) === selected)
  const instances = snapshot?.instances.filter(item => item.packageId === definition?.major?.packageId && item.majorId === definition.major.contributionId) ?? []
  async function save() {
    if (!definition || pending) return
    if (definition.major && mode === 'fixed' && !instances.some(item => item.instanceId === instance)) { setError('Choisissez une instance existante.'); return }
    const binding: InstanceBinding = !definition.major ? { mode: 'none' } : mode === 'fixed' ? { mode: 'fixed', major: definition.major, instanceId: instance } : { mode: 'active', major: definition.major }
    setPending(true); setError('')
    try { if (await onSave(definition, binding, config)) onClose(); else setError('Non enregistré. Vérifiez les champs ou rechargez avant de réessayer.') }
    finally { setPending(false) }
  }
  return <Modal open title={title} onClose={() => { if (!pending) onClose() }}>
    <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save() }}>
      <label>Contribution<select aria-label="Contribution" value={selected} disabled={!!initial || pending} onChange={event => { setSelected(event.target.value); setConfig({}); setInstance(''); setMode('active') }}>
        {contributions.map(item => <option key={key(item)} value={key(item)}>{item.name} — {item.ref.packageId}</option>)}
      </select></label>
      {!definition && <p role="status">Contribution indisponible. Configuration conservée ; réactivez le package pour la modifier, ou retirez cet emplacement.</p>}
      {definition?.major && <>
        <label>Liaison<select aria-label="Liaison" value={mode} disabled={pending} onChange={event => setMode(event.target.value as 'fixed' | 'active')}><option value="active">Suivre l’instance active</option><option value="fixed">Instance fixe</option></select></label>
        {mode === 'fixed' && <label>Instance<select aria-label="Instance" value={instance} disabled={pending} onChange={event => setInstance(event.target.value)}>
          <option value="">Choisir une instance</option>
          {instance && !instances.some(item => item.instanceId === instance) && <option value={instance}>Instance supprimée — {instance}</option>}
          {instances.map(item => <option key={item.instanceId} value={item.instanceId}>{item.name}</option>)}
        </select></label>}
      </>}
      {definition?.config?.fields.map(field => {
        const value = config[field.key] ?? field.default
        const update = (value: unknown) => setConfig(current => ({ ...current, [field.key]: value }))
        return <label key={field.key}>{field.label}{field.help && <small className="block">{field.help}</small>}
          {field.type === 'boolean' ? <input type="checkbox" checked={!!value} disabled={pending} onChange={event => update(event.target.checked)} />
            : field.type === 'choice' ? <select value={String(value ?? '')} disabled={pending} onChange={event => update(event.target.value)}><option value="">Choisir</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : field.type === 'number' ? <input type="number" value={typeof value === 'number' ? value : ''} min={field.min} max={field.max} step={field.integer ? 1 : 'any'} disabled={pending} onChange={event => update(event.target.value === '' ? undefined : Number(event.target.value))} />
            : field.type === 'list' ? <textarea value={Array.isArray(value) ? value.join('\n') : ''} disabled={pending} onChange={event => update(event.target.value.split('\n').filter(Boolean).map(item => field.item === 'number' ? Number(item) : item))} />
            : field.multiline ? <textarea value={String(value ?? '')} maxLength={field.maxLength ?? 10000} disabled={pending} onChange={event => update(event.target.value)} />
            : <input value={String(value ?? '')} maxLength={field.maxLength ?? 10000} disabled={pending} onChange={event => update(event.target.value)} />}
        </label>
      })}
      {definition?.config?.customUi && <p>Les réglages avancés restent disponibles dans le module isolé.</p>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending || !definition}>Enregistrer</button><button type="button" disabled={pending} onClick={onClose}>Annuler</button>
    </form>
  </Modal>
}
