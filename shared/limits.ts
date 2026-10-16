// Centralised resource limits. Every check in the installer, the runtime and
// the network service reads these values; tests import them too.

const KiB = 1024
const MiB = 1024 * KiB

export const ARCHIVE_LIMITS = {
  // Size of the .zip file itself.
  maxArchiveBytes: 100 * MiB,
  // Sum of the bytes actually produced by decompression (not the announced sizes).
  maxExtractedBytes: 250 * MiB,
  maxFileBytes: 25 * MiB,
  maxFiles: 5000,
  maxManifestBytes: 256 * KiB,
  maxPathLength: 512,
  maxPathDepth: 32,
} as const

export const RUNTIME_LIMITS = {
  // Bootstrap/handshake and ordinary SDK calls.
  initTimeoutMs: 10_000,
  callTimeoutMs: 10_000,
  // Isolated package data migration.
  migrationTimeoutMs: 30_000,
  // Private storage, per package.
  maxStorageBytesPerPackage: 50 * MiB,
  maxDocumentBytes: 1 * MiB,
  maxPageSize: 200,
  maxMessageBytes: 2 * MiB,
  maxPendingRequestsPerContext: 64,
  maxSubscriptionsPerContext: 32,
} as const

export const NETWORK_LIMITS = {
  timeoutMs: 20_000,
  maxRedirects: 5,
  maxResponseBytes: 10 * MiB,
  maxRequestBodyBytes: 1 * MiB,
  maxUrlLength: 8192,
  maxHeaderNameLength: 80,
  maxHeaderValueLength: 8192,
  maxHeaderBytes: 16 * KiB,
  maxDnsAnswers: 64,
  dnsTimeoutMs: 3000,
  dnsTries: 2,
} as const

export const THEME_LIMITS = {
  maxThemeFileBytes: 64 * KiB,
  maxBackgroundBytes: 5 * MiB,
  maxTextLength: 120,
} as const
