import type { ContributionRef } from './bindings'

// Shell may name a page or an existing placement; it cannot supply permissions,
// manifests, configuration, ownership, bindings or filesystem paths.
export type ModuleHostRequest =
  | { kind: 'major'; major: ContributionRef; instanceId?: string }
  | { kind: 'project'; projectId: string; placementId: string }
  | { kind: 'dashboard'; dashboardId?: string; placementId?: string }
export type ModuleHostReply =
  | { status: 'available'; contextId: string; origin: string; url: string; features?: { contextId: string; origin: string; url: string; name: string }[]; theme?: { light: Record<string, string>; dark: Record<string, string>; texts: Record<string, string>; background?: string } | null }
  | { status: 'unavailable' }
export type ModuleHostEvent = { kind: 'revoked'; contextId: string } | { kind: 'navigate'; contextId: string; href: string }
