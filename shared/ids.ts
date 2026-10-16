// Stable identities shared by the main process, the renderer and the SDK.
// Package identity, contribution identity, business instance and UI placement
// are four distinct notions and must never be used interchangeably.

// Lowercase ASCII letters, digits, dots and dashes; must start and end with a
// letter or digit and never contain empty segments ("a..b", "a.-b").
export const PACKAGE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
export const CONTRIBUTION_ID_PATTERN = PACKAGE_ID_PATTERN
export const MAX_ID_LENGTH = 128

// Exact identity reserved to the native core. No archive may use it.
export const CORE_PACKAGE_ID = 'core'

// Identities of the packages shipped with the application. These references
// are permanent: a future public product name must not change them.
export const BUILTIN_WEEK_ID = 'builtin.week'
export const BUILTIN_WEEK_REPORT_ID = 'builtin.week-report'
export const BUILTIN_AMBER_THEME_ID = 'builtin.amber-theme'

export function isValidPackageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && PACKAGE_ID_PATTERN.test(value)
}

export function isValidContributionId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && CONTRIBUTION_ID_PATTERN.test(value)
}

// Opaque identifiers of instances, placements, dashboards and sidebar entries.
// Legacy identifiers (e.g. "week-preset_k2j3", "mod_tasks") must stay valid.
export const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export function isValidOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && OPAQUE_ID_PATTERN.test(value)
}
