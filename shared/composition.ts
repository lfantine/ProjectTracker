import type { ContributionRef, InstanceBinding } from './bindings'
import type { ConfigSchema } from './manifest'
import type { Dashboard, GridBreakpoint, GridRect, MajorInstance, SidebarEntry, SidebarGroup } from './models'
import type { SidebarTarget } from './navigation'
import type { HostIcon } from './version'
import type { ErrorPayload } from './errors'

export interface CompositionContribution {
  ref: ContributionRef
  name: string
  type: 'major' | 'minor' | 'widget'
  major: ContributionRef | null
  config?: ConfigSchema
  size?: { default: { w: number; h: number }; min?: { w: number; h: number }; max?: { w: number; h: number } }
}
export interface CompositionSnapshot {
  revision: number
  dashboards: Dashboard[]
  sidebar: SidebarEntry[]
  sidebarGroups?: SidebarGroup[]
  contributions: CompositionContribution[]
  instances: MajorInstance[]
}
export type CompositionCommand =
  | { kind: 'dashboard.create'; name: string }
  | { kind: 'dashboard.rename'; id: string; name: string }
  | { kind: 'dashboard.duplicate'; id: string; name: string }
  | { kind: 'dashboard.delete'; id: string; replacementId?: string }
  | { kind: 'dashboard.default'; id: string }
  | { kind: 'widget.add'; dashboardId: string; contribution: ContributionRef; binding: InstanceBinding; config: Record<string, unknown> }
  | { kind: 'widget.configure'; dashboardId: string; placementId: string; binding: InstanceBinding; config: Record<string, unknown> }
  | { kind: 'widget.remove'; dashboardId: string; placementId: string }
  | { kind: 'layout.save'; dashboardId: string; breakpoint: GridBreakpoint; items: { id: string; rect: GridRect }[] }
  | { kind: 'project.add'; projectId: string; contribution: ContributionRef; binding: InstanceBinding; config: Record<string, unknown> }
  | { kind: 'project.configure'; projectId: string; placementId: string; binding: InstanceBinding; config: Record<string, unknown> }
  | { kind: 'sidebar.add'; label: string; icon: HostIcon; target: SidebarTarget }
  | { kind: 'sidebar.update'; id: string; label: string; icon: HostIcon; target: SidebarTarget; hidden: boolean }
  | { kind: 'sidebar.place'; id: string; beforeId: string | null; groupId: string | null }
  | { kind: 'sidebar.group.add'; name: string }
  | { kind: 'sidebar.group.update'; id: string; name: string; collapsed: boolean }
  | { kind: 'sidebar.group.remove'; id: string }
  | { kind: 'sidebar.group.place'; id: string; beforeId: string | null }
  | { kind: 'sidebar.move'; id: string; direction: -1 | 1 }
  | { kind: 'sidebar.remove'; id: string }
  | { kind: 'sidebar.restore' }
export type CompositionRequest = { command: CompositionCommand; expectedRevision: number; operationId: string }
export type CompositionResult<T> = { ok: true; value: T } | { ok: false; error: ErrorPayload }
