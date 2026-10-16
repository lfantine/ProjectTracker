// Stable error codes shared by native commands and the plugin SDK. Messages
// returned with them must never contain secrets, personal content or internal
// system paths.
export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'CONFLICT',
  'DEPENDENCY',
  'INCOMPATIBLE',
  'STORAGE',
  'TIMEOUT',
  'UNAVAILABLE',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
// The SDK exposes the same closed list.
export type SdkErrorCode = ErrorCode

export interface ErrorPayload {
  code: ErrorCode
  message: string
  // Optional machine-readable details (field names, expected revision...).
  details?: Record<string, unknown>
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorPayload }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): { ok: false; error: ErrorPayload } {
  return { ok: false, error: details ? { code, message, details } : { code, message } }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

// Error thrown inside services and converted to an ErrorPayload at the IPC /
// SDK boundary.
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: Record<string, unknown>
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
  toPayload(): ErrorPayload {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message }
  }
}
