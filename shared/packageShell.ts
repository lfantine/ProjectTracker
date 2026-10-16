// Shell-only native management contract. Never part of the package SDK.
export const PACKAGE_SHELL_CHANNELS = {
  snapshot: 'packages:snapshot', refresh: 'packages:refresh',
  linkFolder: 'packages:link-folder', unlinkFolder: 'packages:unlink-folder',
  importArchive: 'packages:import-archive', importFolder: 'packages:import-folder',
  importBundled: 'packages:import-bundled', activate: 'packages:activate', stop: 'packages:stop',
} as const
export const PACKAGE_SHELL_CHANGED = 'packages:changed'
export interface PackageRegistryChange {
  kind: 'activation' | 'stop' | 'audit'
  affected: string[]
  revision: number
}

import type { Manifest } from './manifest'
import type { Result } from './errors'
export interface PackageShellSnapshot {
  hostTheme?: { light: Record<string, string>; dark: Record<string, string>; texts: Record<string, string>; background?: string } | null
  phase: 'idle' | 'starting' | 'ready' | 'recovery'
  packages: { id: string; name: string; state: 'active' | 'disabled' | 'suspended' | 'uninstalled'; activeVersion: string | null; reason: string | null; revision: number }[]
  versions: { packageId: string; version: string; status: string }[]
  details?: { manifest: Manifest; logoDataUrl?: string; status: string; issues?: { code: string; packageId: string; dependency?: string }[] }[]
  catalogue: null | { status: 'unlinked' } | { status: 'error'; code: string } | { status: 'ok'; entries: ({ status: 'invalid'; fileName: string; code: string } | { status: 'available'; fileName: string; manifest: Manifest; logoDataUrl?: string; selection?: string; publisherVerified: false; sourceSha256: string; contentSha256: string; issues: { code: string; packageId: string; dependency?: string }[] })[] }
  bundledDetails?: { key: string; manifest: Manifest; logoDataUrl?: string; issues: { code: string; packageId: string; dependency?: string }[] }[]
  bundled: { key: string; packageId: string; version: string; contentSha256: string }[]
}
export interface PackageShellApi {
  snapshot(): Promise<Result<PackageShellSnapshot>>
  refresh(): Promise<Result<PackageShellSnapshot>>
  linkFolder(): Promise<Result<PackageShellSnapshot>>
  unlinkFolder(): Promise<Result<PackageShellSnapshot>>
  importArchive(): Promise<Result<unknown>>
  importFolder(input: { selection: string }): Promise<Result<unknown>>
  importBundled(input: { key: string }): Promise<Result<unknown>>
  activate(input: { packageId: string; version: string }): Promise<Result<unknown>>
  stop(input: { packageId: string; action: 'disable' | 'uninstall' }): Promise<Result<unknown>>
  onChanged(listener: (change: PackageRegistryChange) => void): () => void
}
