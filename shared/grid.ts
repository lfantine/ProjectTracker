import { BREAKPOINT_ORDER, GRID_BREAKPOINTS, type DashboardWidgetPlacement, type GridBreakpoint, type GridRect } from './models'

export interface GridItem extends GridRect { id: string }
export function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
// Deterministic downward collision resolution; input and saved layouts untouched.
export function settleGrid(items: GridItem[], cols: number): GridItem[] {
  const placed: GridItem[] = []
  for (const item of items) {
    const next = { ...item, w: Math.min(item.w, cols), x: Math.max(0, Math.min(item.x, cols - Math.min(item.w, cols))), y: Math.max(0, item.y) }
    while (placed.some(other => overlaps(next, other))) next.y = Math.max(...placed.filter(other => overlaps(next, other)).map(other => other.y + other.h))
    placed.push(next)
  }
  return placed
}
export function deriveGrid(widgets: DashboardWidgetPlacement[], breakpoint: GridBreakpoint): GridItem[] {
  const cols = GRID_BREAKPOINTS[breakpoint].cols
  return settleGrid(widgets.map(widget => {
    const source = BREAKPOINT_ORDER.slice(0, BREAKPOINT_ORDER.indexOf(breakpoint) + 1).reverse().find(key => widget.layouts[key])
      ?? BREAKPOINT_ORDER.find(key => widget.layouts[key])
    const rect = source ? widget.layouts[source]! : { x: 0, y: 0, w: cols, h: 4 }
    const sourceCols = source ? GRID_BREAKPOINTS[source].cols : cols
    const w = Math.max(1, Math.min(cols, Math.round(rect.w * cols / sourceCols)))
    return { id: widget.placementId, ...rect, x: Math.min(cols - w, Math.floor(rect.x * cols / sourceCols)), w }
  }), cols)
}
export function moveGrid(items: GridItem[], id: string, patch: Partial<GridRect>, cols: number): GridItem[] {
  const target = items.find(item => item.id === id)
  if (!target) return items
  const ordered = [{ ...target, ...patch }, ...items.filter(item => item.id !== id)]
  const settled = settleGrid(ordered, cols)
  return items.map(item => settled.find(next => next.id === item.id)!)
}
