import { compare, valid } from 'semver'
import type { Manifest } from '../../shared/manifest'
import type { PackageShellSnapshot } from '../../shared/packageShell'

// One card per package identity, whatever the number of known versions. The
// native states (imported, active, disabled…) are folded into one status and
// one primary action so the marketplace reads at a glance.

type Issue = { code: string; packageId: string; dependency?: string }
export interface PackageVersion {
  manifest: Manifest
  logoDataUrl?: string
  // Present in the managed store (activatable without re-import).
  installed: boolean
  selection?: string
  bundleKey?: string
  issues: Issue[]
}
export type PackageStatus = 'active' | 'update' | 'ready' | 'disabled' | 'suspended' | 'available' | 'removed'
export type PackageAction = 'open' | 'manage' | 'install' | 'activate'
export interface PackageEntry {
  id: string
  manifest: Manifest
  logoDataUrl?: string
  versions: PackageVersion[]
  status: PackageStatus
  installed: boolean
  activeVersion: string | null
  reason: string | null
  // Version the primary action applies to (install = import then activate).
  target?: PackageVersion
  action: PackageAction
  problems: string[]
}

export const STATUS_LABEL: Record<PackageStatus, string> = {
  active: 'Actif', update: 'Mise à jour', ready: 'À activer', disabled: 'Désactivé', suspended: 'Suspendu', available: 'Disponible', removed: 'Désinstallé',
}
export const ACTION_LABEL: Record<PackageStatus, string> = {
  active: 'Ouvrir', update: 'Mettre à jour', ready: 'Activer', disabled: 'Réactiver', suspended: 'Réactiver', available: 'Installer', removed: 'Réinstaller',
}

export function problemLabel(issue: Issue): string {
  switch (issue.code) {
    case 'HOST_INCOMPATIBLE': return 'Version d’amber incompatible'
    case 'DEPENDENCY_MISSING': return `Nécessite ${issue.dependency}`
    case 'DEPENDENCY_INCOMPATIBLE': return `Version de ${issue.dependency} incompatible`
    case 'DEPENDENCY_CYCLE': return 'Dépendances circulaires'
    case 'DOWNGRADE': return 'Plus ancienne que la version installée'
    case 'STORAGE_DOWNGRADE': return 'Format de données plus ancien'
    default: return issue.code
  }
}
const newer = (a: string, b: string) => (valid(a) && valid(b) ? compare(a, b) : a.localeCompare(b)) > 0
const activatable = (status: string) => ['ready', 'retired', 'active'].includes(status)

export function packageEntries(snapshot: PackageShellSnapshot | null): PackageEntry[] {
  if (!snapshot) return []
  const byId = new Map<string, Map<string, PackageVersion>>()
  const add = (manifest: Manifest, patch: Partial<PackageVersion> & { issues: Issue[] }) => {
    const versions = byId.get(manifest.id) ?? new Map<string, PackageVersion>(); byId.set(manifest.id, versions)
    const prior = versions.get(manifest.version)
    versions.set(manifest.version, { manifest, installed: false, ...prior, ...patch, issues: patch.issues.length ? patch.issues : prior?.issues ?? [], logoDataUrl: patch.logoDataUrl ?? prior?.logoDataUrl })
  }
  for (const entry of snapshot.details ?? []) if (activatable(entry.status)) add(entry.manifest, { installed: true, logoDataUrl: entry.logoDataUrl, issues: entry.issues ?? [] })
  for (const entry of snapshot.bundledDetails ?? []) add(entry.manifest, { bundleKey: entry.key, logoDataUrl: entry.logoDataUrl, issues: entry.issues })
  if (snapshot.catalogue?.status === 'ok') for (const entry of snapshot.catalogue.entries) if (entry.status === 'available') add(entry.manifest, { selection: entry.selection, logoDataUrl: entry.logoDataUrl, issues: entry.issues })

  const result: PackageEntry[] = []
  for (const [id, map] of byId) {
    const versions = [...map.values()].sort((a, b) => newer(a.manifest.version, b.manifest.version) ? -1 : newer(b.manifest.version, a.manifest.version) ? 1 : 0)
    const registry = snapshot.packages.find(item => item.id === id)
    const active = registry?.state === 'active' ? registry.activeVersion : null
    const latestInstalled = versions.find(version => version.installed)
    const latestSource = versions.find(version => !version.installed && (version.selection || version.bundleKey))
    // Re-importing is only useful for a version not already in the store.
    const source = latestSource && (!latestInstalled || newer(latestSource.manifest.version, latestInstalled.manifest.version)) ? latestSource : undefined
    const current = versions.find(version => version.manifest.version === active)
    let status: PackageStatus, target: PackageVersion | undefined
    if (active) {
      const update = [latestInstalled, source].filter((version): version is PackageVersion => !!version && newer(version.manifest.version, active))
        .sort((a, b) => newer(a.manifest.version, b.manifest.version) ? -1 : 1)[0]
      status = update ? 'update' : 'active'; target = update ?? current
    } else if (registry?.state === 'uninstalled') { status = 'removed'; target = source ?? latestInstalled }
    else if (registry?.state === 'suspended') { status = 'suspended'; target = source ?? (versions.find(version => version.manifest.version === registry.activeVersion && version.installed) ?? latestInstalled) }
    else if (registry && registry.activeVersion) { status = 'disabled'; target = source ?? (versions.find(version => version.manifest.version === registry.activeVersion && version.installed) ?? latestInstalled) }
    else if (latestInstalled) { status = 'ready'; target = source ?? latestInstalled }
    else { status = 'available'; target = source }
    const shown = current ?? target ?? versions[0]
    const hasMajor = shown.manifest.kind === 'package' && shown.manifest.contributions.some(item => item.type === 'major')
    const action: PackageAction = status === 'active' ? (hasMajor ? 'open' : 'manage') : target?.installed ? 'activate' : 'install'
    result.push({
      id, manifest: shown.manifest, logoDataUrl: shown.logoDataUrl ?? versions.find(version => version.logoDataUrl)?.logoDataUrl, versions, status,
      installed: !!registry && registry.state !== 'uninstalled', activeVersion: active, reason: registry?.reason ?? null, target, action,
      problems: status === 'active' ? [] : (target?.issues ?? []).map(problemLabel),
    })
  }
  return result.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'fr'))
}

/** Registered packages whose metadata could not be read: still removable. */
export function orphanPackages(snapshot: PackageShellSnapshot | null, entries: PackageEntry[]) {
  return (snapshot?.packages ?? []).filter(item => item.state !== 'uninstalled' && !entries.some(entry => entry.id === item.id))
}
