// Helpers to keep unknown legacy fields: anything outside the known keys of an
// object is stored in an `extra_json` column and spread back when reading.

export function splitExtra<T extends object>(value: T, known: readonly string[]): string | null {
  const extra: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    if (!known.includes(key) && field !== undefined) extra[key] = field
  }
  return Object.keys(extra).length ? JSON.stringify(extra) : null
}

export function readExtra(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const value = JSON.parse(json)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function parseJson<T>(json: string | null | undefined, fallback: T): T {
  if (json === null || json === undefined) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

// Optional string column: NULL means "absent" in the legacy object.
export function optional<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value
}

export function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

// Adds a key only when its value is defined, preserving "absent" fields.
export function withOptional<T extends object>(target: T, entries: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) (target as Record<string, unknown>)[key] = value
  }
  return target
}
