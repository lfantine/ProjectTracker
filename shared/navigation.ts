import { isContributionRef, isInstanceBinding, type ContributionRef, type InstanceBinding } from './bindings'
import { isValidContributionId, isValidOpaqueId, isValidPackageId } from './ids'

// Closed list of native pages a sidebar entry may target.
export const NATIVE_PAGES = {
  projects: { path: '/projects', label: 'Projets' },
  marketplace: { path: '/marketplace', label: 'Marketplace' },
  notes: { path: '/notes', label: 'Notes' },
  errors: { path: '/errors', label: 'Erreurs' },
  search: { path: '/search', label: 'Recherche' },
  settings: { path: '/settings', label: 'Réglages' },
} as const

export type NativePage = keyof typeof NATIVE_PAGES

export function isNativePage(value: unknown): value is NativePage {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NATIVE_PAGES, value)
}

export type SidebarTarget =
  | { kind: 'native'; page: NativePage }
  | { kind: 'dashboard'; dashboardId: string }
  | { kind: 'major'; major: ContributionRef; binding: InstanceBinding }

export function isSidebarTarget(value: unknown): value is SidebarTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  switch (target.kind) {
    case 'native':
      return Object.keys(target).length === 2 && isNativePage(target.page)
    case 'dashboard':
      return Object.keys(target).length === 2 && isValidOpaqueId(target.dashboardId)
    case 'major': {
      if (Object.keys(target).length !== 3 || !isContributionRef(target.major) || !isInstanceBinding(target.binding)) return false
      // A shortcut to a major opens either its active instance or a fixed one
      // of that same major.
      const binding = target.binding
      if (binding.mode === 'none') return false
      const major = target.major
      return binding.major.packageId === major.packageId && binding.major.contributionId === major.contributionId
    }
    default:
      return false
  }
}

// Static routes: identities are validated query parameters, never generated
// Next.js routes (the renderer is a static export).
export function dashboardHref(dashboardId: string): string {
  return `/dashboard?id=${encodeURIComponent(dashboardId)}`
}

export function moduleHref(major: ContributionRef, instanceId?: string): string {
  const params = new URLSearchParams({ package: major.packageId, contribution: major.contributionId })
  if (instanceId) params.set('instance', instanceId)
  return `/module?${params.toString()}`
}

export function targetHref(target: SidebarTarget): string {
  switch (target.kind) {
    case 'native':
      return NATIVE_PAGES[target.page].path
    case 'dashboard':
      return dashboardHref(target.dashboardId)
    case 'major':
      return moduleHref(target.major, target.binding.mode === 'fixed' ? target.binding.instanceId : undefined)
  }
}

export type ModuleRouteParams =
  | { ok: true; major: ContributionRef; instanceId?: string }
  | { ok: false; reason: 'missing' | 'invalid' }

// Query values may arrive as string | string[] | undefined (Next router).
export function parseModuleRoute(query: Record<string, unknown>): ModuleRouteParams {
  const single = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const packageId = single(query.package)
  const contributionId = single(query.contribution)
  if (query.instance !== undefined && typeof query.instance !== 'string') return { ok: false, reason: 'invalid' }
  const instanceId = single(query.instance)
  if (!packageId || !contributionId) return { ok: false, reason: 'missing' }
  if (!isValidPackageId(packageId) || !isValidContributionId(contributionId)) return { ok: false, reason: 'invalid' }
  if (instanceId !== undefined && !isValidOpaqueId(instanceId)) return { ok: false, reason: 'invalid' }
  return { ok: true, major: { packageId, contributionId }, ...(instanceId ? { instanceId } : {}) }
}

export function parseDashboardRoute(query: Record<string, unknown>): { ok: true; dashboardId?: string } | { ok: false } {
  const id = query.id
  if (id === undefined) return { ok: true }
  if (typeof id !== 'string' || !isValidOpaqueId(id)) return { ok: false }
  return { ok: true, dashboardId: id }
}
