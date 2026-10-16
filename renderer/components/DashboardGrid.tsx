import { DropTrash, isOverTrash } from './DropTrash'
import { GripIcon, SettingsIcon } from './icons'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import GridLayout, { useContainerWidth, noCompactor, type Layout } from 'react-grid-layout'
import type { Dashboard, DashboardWidgetPlacement } from '../../shared/models'
import { breakpointForWidth, GRID_BREAKPOINTS } from '../../shared/models'
import { deriveGrid, moveGrid, settleGrid } from '../../shared/grid'
import { useComposition } from '../lib/composition'
import { ModuleHost } from './ModuleHost'
import { PlacementEditor } from './PlacementEditor'
import type { CoreWidgetId } from '../../shared/core'
import { isCoreWidget } from '../../shared/core'

export default function DashboardGrid({ dashboard, editing, renderCore }: { dashboard: Dashboard; editing: boolean; renderCore(id: CoreWidgetId): ReactNode }) {
  const { snapshot, mutate, pending } = useComposition()
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true })
  const breakpoint = breakpointForWidth(width), cols = GRID_BREAKPOINTS[breakpoint].cols
  const [gesturing, setGesturing] = useState(false), gestureWidth = useRef(breakpoint)
  const trash = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false), [trashHot, setTrashHot] = useState(false)
  const [configuring, setConfiguring] = useState<DashboardWidgetPlacement | null>(null)
  const definitions = snapshot?.contributions.filter(item => item.type === 'widget') ?? []
  const definition = (widget: DashboardWidgetPlacement) => definitions.find(item => item.ref.packageId === widget.contribution.packageId && item.ref.contributionId === widget.contribution.contributionId)
  const layout = useMemo(() => {
    const derived = deriveGrid(dashboard.widgets, breakpoint).map(item => {
      const widget = dashboard.widgets.find(widget => widget.placementId === item.id)!, size = definition(widget)?.size
      return { ...item, w: Math.max(Math.min(cols, size?.min?.w ?? 1), Math.min(item.w, size?.max?.w ?? cols)), h: Math.max(size?.min?.h ?? 1, Math.min(item.h, size?.max?.h ?? 200)) }
    })
    return settleGrid(derived, cols).map(item => {
      const widget = dashboard.widgets.find(widget => widget.placementId === item.id)!, size = definition(widget)?.size
      return { i: item.id, x: item.x, y: item.y, w: item.w, h: item.h, minW: Math.min(cols, size?.min?.w ?? 1), minH: size?.min?.h ?? 1, maxW: Math.min(cols, size?.max?.w ?? cols), maxH: size?.max?.h ?? 200 }
    })
    // Metadata is immutable within each native snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard, breakpoint, cols, snapshot])
  useEffect(() => { setGesturing(false); setDragging(false); setTrashHot(false) }, [breakpoint, editing])
  function start() { gestureWidth.current = breakpoint; setGesturing(true) }
  function save(next: Layout) {
    setGesturing(false)
    if (gestureWidth.current !== breakpoint || !editing || pending) return
    void mutate({ kind: 'layout.save', dashboardId: dashboard.id, breakpoint, items: next.map(item => ({ id: item.i, rect: { x: item.x, y: item.y, w: item.w, h: item.h } })) })
  }
  function change(id: string, patch: { x?: number; y?: number; w?: number; h?: number }) {
    const next = moveGrid(layout.map(item => ({ id: item.i, x: item.x, y: item.y, w: item.w, h: item.h })), id, patch, cols)
    void mutate({ kind: 'layout.save', dashboardId: dashboard.id, breakpoint, items: next.map(({ id, ...rect }) => ({ id, rect })) })
  }
  return <div ref={containerRef} data-breakpoint={mounted ? breakpoint : undefined} className={gesturing ? 'dashboard-grid gesturing' : 'dashboard-grid'}>
    {!mounted ? <p>Mesure de la grille…</p> : <GridLayout width={width} layout={layout} compactor={noCompactor}
      gridConfig={{ cols, rowHeight: 36, margin: [12, 12], containerPadding: [0, 0] }}
      dragConfig={{ enabled: editing && !pending, handle: '.widget-move-handle', cancel: 'input,select,textarea,a' }}
      resizeConfig={{ enabled: editing && !pending, handles: ['se', 'sw', 'ne', 'nw'] }}
      onDragStart={() => { start(); setDragging(true) }} onResizeStart={start}
      onDrag={(_next, _old, _item, _placeholder, event) => setTrashHot(isOverTrash(event, trash.current))}
      onDragStop={(next, _old, item, _placeholder, event) => {
        const remove = isOverTrash(event, trash.current)
        setDragging(false); setTrashHot(false)
        if (editing && !pending && remove && item) { setGesturing(false); void mutate({ kind: 'widget.remove', dashboardId: dashboard.id, placementId: item.i }) }
        else save(next)
      }} onResizeStop={save}>
      {dashboard.widgets.map(widget => {
        const descriptor = definition(widget), rect = layout.find(item => item.i === widget.placementId)!, title = descriptor?.name ?? `${widget.contribution.packageId}/${widget.contribution.contributionId}`
        return <div key={widget.placementId} data-placement={widget.placementId} className={`dashboard-placement flex flex-col min-h-0 ${editing ? 'is-editing' : ''}`}>
          {editing && <div className="widget-tools flex items-center justify-between gap-1 px-2 py-1 text-xs" aria-label={`Modifier ${title}`}>
            <button className="widget-move-handle cursor-move" aria-label={`Déplacer ${title}`} onKeyDown={event => {
              if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void mutate({ kind: 'widget.remove', dashboardId: dashboard.id, placementId: widget.placementId }); return }
              if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); change(widget.placementId, { w: Math.max(rect.minW, Math.min(rect.maxW, rect.w + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))), h: Math.max(rect.minH, Math.min(rect.maxH, rect.h + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0))) }); return }
              const delta: Record<string, { x?: number; y?: number }> = { ArrowLeft: { x: Math.max(0, rect.x - 1) }, ArrowRight: { x: Math.min(cols - rect.w, rect.x + 1) }, ArrowUp: { y: Math.max(0, rect.y - 1) }, ArrowDown: { y: rect.y + 1 } }
              if (delta[event.key]) { event.preventDefault(); change(widget.placementId, delta[event.key]) }
            }} disabled={pending}><GripIcon size={14} />{title}</button>
            <button className="widget-configure" aria-label={`Configurer ${title}`} title="Configurer le widget" disabled={pending} onClick={() => setConfiguring(widget)}><SettingsIcon size={14} /></button>
          </div>}
          <div className="widget-content flex-1 min-h-0 overflow-auto" aria-label={title}>
            {widget.contribution.packageId === 'core' && isCoreWidget(widget.contribution.contributionId) ? renderCore(widget.contribution.contributionId)
              : widget.contribution.packageId === 'core' ? <p>Widget indisponible. Disposition conservée.</p>
              : <ModuleHost compact key={JSON.stringify([widget.binding, widget.config])} request={{ kind: 'dashboard', dashboardId: dashboard.id, placementId: widget.placementId }} />}
          </div>
        </div>
      })}
    </GridLayout>}
    {!dashboard.widgets.length && <p role="status">Dashboard vide. Activez le mode édition pour ajouter un widget.</p>}
    <DropTrash active={dragging && editing} hot={trashHot} zoneRef={trash} />
    {configuring && <PlacementEditor title="Configurer le widget" contributions={definitions.filter(item => item.ref.packageId === configuring.contribution.packageId && item.ref.contributionId === configuring.contribution.contributionId)} initial={{ ref: `${configuring.contribution.packageId}/${configuring.contribution.contributionId}`, binding: configuring.binding, config: configuring.config.values }}
      onSave={async (_definition, binding, config) => !!await mutate({ kind: 'widget.configure', dashboardId: dashboard.id, placementId: configuring.placementId, binding, config })} onClose={() => setConfiguring(null)} />}
  </div>
}
