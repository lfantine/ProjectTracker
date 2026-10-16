import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import type { ModuleHostRequest } from '../../shared/moduleHost'
import { mountContribution, createElectronConnector } from '../../sdk/src/host'

/** Trusted renderer host only. No package code is imported into React. */
export function ModuleHost({ request, compact = false, onTitle }: { request: ModuleHostRequest; compact?: boolean; onTitle?(title: string | undefined): void }) {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [generation, setGeneration] = useState(0)
  const router = useRouter()
  const key = JSON.stringify(request)
  useEffect(() => window.api?.core?.onChanged(event => { if (event.changes.some(change => change.entity === 'preferences')) setGeneration(value => value + 1) }), [])
  useEffect(() => window.api?.packages?.onChanged(() => setGeneration(value => value + 1)), [])
  useEffect(() => {
    const children: ReturnType<typeof mountContribution>[] = []
    let disposed = false, contextId: string | undefined, mounted: ReturnType<typeof mountContribution> | undefined
    setState('loading'); onTitle?.(undefined)
    const api = window.api?.modules
    if (!api) { setState('unavailable'); return }
    const stop = api.onEvent(event => {
      if (disposed) return
      if (event.kind === 'navigate') { if (event.contextId === contextId) void router.push(event.href) }
      else if (event.contextId === contextId) {
        contextId = undefined
        mounted?.dispose(); mounted = undefined
        setGeneration(value => value + 1)
      }
    })
    void api.open(JSON.parse(key) as ModuleHostRequest).then(result => {
      if (result.status !== 'available') { if (!disposed) setState('unavailable'); return }
      if (disposed || !container.current) { void api.close(result.contextId); return }
      contextId = result.contextId
      if (request.kind === 'major' && request.major.packageId === 'builtin.week' && request.major.contributionId === 'planner') onTitle?.(result.theme?.texts['week.title'])
      try {
        mounted = mountContribution(container.current, result, createElectronConnector(`${window.location.protocol}//${window.location.host}`), { autoSize: !compact, fill: !compact && request.kind === 'major' })
        mounted.frame.title = 'Module amber'
        mounted.frame.style.cssText = compact ? 'width:100%;height:100%;min-height:0;border:0;display:block;flex:1' : 'width:100%;height:460px;border:0;display:block;flex:none'
        for (const feature of result.features ?? []) {
          const child = mountContribution(container.current, feature, createElectronConnector(`${window.location.protocol}//${window.location.host}`), { autoSize: !compact })
          child.frame.title = feature.name; child.frame.style.cssText = 'width:100%;height:200px;border:0;display:block;flex:none'; children.push(child)
        }
        setState('ready')
      } catch { for (const child of children) child.dispose(); mounted?.dispose(); mounted = undefined; void api.close(result.contextId); setState('unavailable') }
    }).catch(() => { if (!disposed) setState('unavailable') })
    return () => { disposed = true; stop(); for (const child of children) child.dispose(); mounted?.dispose(); if (contextId) void api.close(contextId) }
    // Requests are compared by value, not recreated object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, generation, compact])
  return <section className={`module-host ${compact ? 'is-compact' : 'is-major'}`} aria-label="Contribution de module" aria-busy={state === 'loading'}>
    {state === 'loading' && <p>Chargement du module…</p>}
    {state === 'unavailable' && <p role="status">Module indisponible. L’emplacement et ses données sont conservés.</p>}
    <div className="module-frame-container" ref={container} />
  </section>
}
