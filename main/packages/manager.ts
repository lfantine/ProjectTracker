import { prepareArchive } from './archive'
import { verifyManagedVersion } from './managedVersion'
import { validateTheme } from '../extensions/engine'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { validateManifest, type Manifest, type ContributionType } from '../../shared/manifest'
import type { ContributionRef } from '../../shared/bindings'
import type { Database } from '../db/database'
import { PackageActivation, type ActivationHooks } from './activation'
import { auditActivePackages, type AuditProblem } from './audit'
import { scanFolderCatalogue, type CatalogueEntry, type FolderCatalogue } from './catalogue'
import type { ConfirmImport } from './consent'
import { LocalPackageInstaller } from './installer'
import { PackageLifecycle, type ConfirmStop, type StopAction } from './lifecycle'
import { PackageSourceImports, type BundledArchive } from './sourceImports'
import { PackageSources } from './sources'
import { packageDirectory } from './directories'
import { assessInstallation } from './eligibility'
import { ContributionRegistry } from './registry'

export interface PackageManagerHooks {
  confirmImport: ConfirmImport
  confirmStop: ConfirmStop
  activation: Omit<ActivationHooks, 'revokePackage' | 'changed'>
  revokePackage(packageId: string): void
  /** After a durable registry change; native shell must discard stale views. */
  changed(change: { kind: 'activation' | 'stop' | 'audit'; affected: string[]; revision: number }): void
}
export interface PackageSummary {
  id: string; name: string; state: 'active' | 'disabled' | 'suspended' | 'uninstalled'
  activeVersion: string | null; reason: string | null; revision: number
}
export type PackageManagerPhase = 'idle' | 'starting' | 'ready' | 'recovery'
export type SourceCatalogue = FolderCatalogue | { status: 'unlinked' }

/** Native coordinator; requires an already locked/open database and app-owned
 * package root. No IPC or frames are created here. A startup failure is fatal
 * for package launch, but a missing linked folder only marks its catalogue.
 * The normal runtime qualification gate remains enforced by PackageActivation.
 */
export class PackageManager {
  private phase: PackageManagerPhase = 'idle'
  private startup: Promise<void> | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private bundleLogos = new Map<string, string>()
  private bundleManifests = new Map<string, Manifest>()
  private catalogue: SourceCatalogue = { status: 'unlinked' }
  private readonly sources: PackageSources
  private readonly installer: LocalPackageInstaller
  private readonly activation: PackageActivation
  private readonly lifecycle: PackageLifecycle
  private readonly imports: PackageSourceImports
  private readonly catalogueStage: string
  private readonly root: string

  constructor(private readonly db: Database, root: string, private readonly hooks: PackageManagerHooks,
    bundles: readonly BundledArchive[] = [], isolatedQualification = false) {
    if (!path.isAbsolute(root)) throw Error('INSTALL_ROOT_INVALID')
    this.root = path.normalize(root)
    // Deliberately separate from .staging, which recovery may delete wholesale.
    this.catalogueStage = path.join(this.root, '.catalogue-staging')
    this.sources = new PackageSources(db)
    this.installer = new LocalPackageInstaller(db, this.root, hooks.confirmImport)
    this.activation = new PackageActivation(db, this.root, { ...hooks.activation,
      revokePackage: id => hooks.revokePackage(id),
      changed: change => hooks.changed({ kind: 'activation', affected: change.affected, revision: change.revision }) }, isolatedQualification)
    this.lifecycle = new PackageLifecycle(db, this.root, hooks.confirmStop, {
      revokePackage: id => hooks.revokePackage(id),
      changed: change => hooks.changed({ kind: 'stop', affected: change.affected, revision: change.revision }) })
    this.imports = new PackageSourceImports(db, this.installer, this.sources, bundles)
  }

  status(): PackageManagerPhase { return this.phase }
  private requireReady(): void { if (this.phase !== 'ready') throw Error('PACKAGES_NOT_READY') }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action)
    this.tail = task.catch(() => {})
    return task
  }
  private operation<T>(action: () => Promise<T>): Promise<T> {
    // Requests during startup/recovery are refused, not silently deferred.
    if (this.phase !== 'ready') return Promise.reject(Error('PACKAGES_NOT_READY'))
    return this.enqueue(async () => { this.requireReady(); return action() })
  }
  start(): Promise<void> {
    if (this.startup) return this.startup
    if (this.phase === 'ready') return Promise.resolve()
    this.phase = 'starting'
    const task = this.enqueue(async () => {
      try {
        await this.installer.recover()
        await this.activation.recover()
        await auditActivePackages(this.db, this.root, {
          revokePackage: id => this.hooks.revokePackage(id),
          changed: (problems: AuditProblem[], revision) => this.hooks.changed({ kind: 'audit', affected: problems.map(item => item.packageId), revision }) })
        if (await packageDirectory(this.root, '.catalogue-staging', false)) await rm(this.catalogueStage, { recursive: true, force: true })
        this.catalogue = await this.scan()
        this.bundleLogos.clear()
        this.bundleManifests.clear()
        for (const bundle of this.imports.bundledOffers()) {
          let prepared: Awaited<ReturnType<typeof prepareArchive>> | undefined
          try {
            await packageDirectory(this.root, '.catalogue-staging', true)
            prepared = await prepareArchive(bundle.path, this.catalogueStage)
            if (prepared.manifest.id === bundle.packageId && prepared.manifest.version === bundle.version && prepared.contentSha256 === bundle.contentSha256) {
              this.bundleManifests.set(bundle.key, prepared.manifest)
              if (prepared.logoDataUrl) this.bundleLogos.set(bundle.key, prepared.logoDataUrl)
            }
          } catch { /* an invalid delivered offer is never executable metadata */ }
          finally { await prepared?.dispose() }
        }
        this.phase = 'ready'
      } catch (error) {
        this.phase = 'recovery'
        this.catalogue = { status: 'unlinked' }
        throw error
      }
    })
    this.startup = task.finally(() => { this.startup = undefined })
    return this.startup
  }
  private active(): Manifest[] {
    return this.db.all<{ manifest_json: string }>(`SELECT v.manifest_json FROM packages p JOIN package_versions v
      ON v.package_id = p.id AND v.version = p.active_version WHERE p.state = 'active'`).map(row => JSON.parse(row.manifest_json))
  }
  private async scan(): Promise<SourceCatalogue> {
    const source = this.sources.linkedFolder()
    if (!source) return { status: 'unlinked' }
    await packageDirectory(this.root, '.catalogue-staging', true)
    return scanFolderCatalogue(source.path, this.catalogueStage, this.active())
  }
  refreshCatalogue(): Promise<SourceCatalogue> {
    return this.operation(async () => { this.catalogue = await this.scan(); return structuredClone(this.catalogue) })
  }
  catalogueSnapshot(): SourceCatalogue {
    this.requireReady()
    const snapshot = structuredClone(this.catalogue)
    // Files are rescanned only explicitly; eligibility follows the current
    // registry so cached ZIPs never masquerade as installed dependencies.
    if (snapshot.status === 'ok') {
      const active = this.active()
      for (const entry of snapshot.entries) if (entry.status === 'available') entry.issues = assessInstallation(entry.manifest, active)
    }
    return snapshot
  }
  linkFolder(folder: string, signal?: AbortSignal): Promise<SourceCatalogue> {
    return this.operation(async () => { if (signal?.aborted) throw Error('INSTALL_CANCELLED'); this.sources.linkFolder(folder); this.catalogue = await this.scan(); return structuredClone(this.catalogue) })
  }
  unlinkFolder(signal?: AbortSignal): Promise<void> {
    return this.operation(async () => { if (signal?.aborted) throw Error('INSTALL_CANCELLED'); this.sources.unlinkFolder(); this.catalogue = { status: 'unlinked' } })
  }
  /** Native bridge only; never serialize this path to the shell. */
  linkedFolderPath(): string | undefined { this.requireReady(); return this.sources.linkedFolder()?.path }
  versions(): { packageId: string; version: string; status: string }[] {
    this.requireReady()
    return this.db.all(`SELECT package_id AS packageId, version, status FROM package_versions ORDER BY package_id, version`)
  }
  details(): { logoDataUrl?: string; manifest: Manifest; status: string; issues: ReturnType<typeof assessInstallation> }[] {
    this.requireReady()
    return this.db.all<{ package_id: string; version: string; files_dir: string; manifest_json: string; status: string; content_fingerprint: string; source_fingerprint: string }>('SELECT * FROM package_versions ORDER BY package_id, version').flatMap(row => {
      try {
        const value = validateManifest(JSON.parse(row.manifest_json))
        if (!value.ok) return []
        let logoDataUrl: string | undefined
        // Verify the managed inventory before exposing bytes. Damaged/missing
        // files leave metadata usable with a fallback, never a filesystem URL.
        if (value.manifest.logo) try { logoDataUrl = verifyManagedVersion(this.root, row).logoDataUrl } catch { /* fallback */ }
        return [{ manifest: value.manifest, status: row.status, issues: assessInstallation(value.manifest, this.active()), ...(logoDataUrl ? { logoDataUrl } : {}) }]
      } catch { return [] }
    })
  }

  packages(): PackageSummary[] {
    this.requireReady()
    return this.db.all<PackageSummary>(`SELECT id, name, state, active_version AS activeVersion,
      state_reason AS reason, revision FROM packages WHERE id != 'core' ORDER BY id`)
  }
  extensionArtifacts() {
    this.requireReady()
    return this.db.all<{ package_id: string; version: string; files_dir: string; manifest_json: string; content_fingerprint: string; source_fingerprint: string; granted_permissions_json: string }>("SELECT v.*, p.granted_permissions_json FROM packages p JOIN package_versions v ON v.package_id=p.id AND v.version=p.active_version WHERE p.state='active' AND p.kind='extension' AND v.status='active' ORDER BY p.id").flatMap(row => {
      try { return [{ artifact: verifyManagedVersion(this.root, row), permissions: JSON.parse(row.granted_permissions_json) }] } catch { return [] }
    })
  }
  themeFor(packageId: string) {
    const themes = this.extensionArtifacts().filter(item => item.artifact.manifest.kind === 'extension' && item.artifact.manifest.extensionType === 'theme' && item.artifact.manifest.target.package === packageId)
    if (themes.length !== 1) return null // corrupt/conflicting state fails closed
    try { return validateTheme(themes[0].artifact) } catch { return null }
  }
  resolveContribution(ref: ContributionRef, type: ContributionType) {
    this.requireReady()
    return new ContributionRegistry(this.db).resolve(ref, type)
  }
  canLaunch(packageId: string): boolean {
    return this.phase === 'ready' && packageId !== 'core' && !!this.db.get("SELECT id FROM packages WHERE id = ? AND state = 'active' AND active_version IS NOT NULL", packageId)
  }
  bundledDetails() { this.requireReady(); return [...this.bundleManifests].map(([key, manifest]) => ({ key, manifest, logoDataUrl: this.bundleLogos.get(key), issues: assessInstallation(manifest, this.active()) })) }
  bundledOffers(): BundledArchive[] { this.requireReady(); return this.imports.bundledOffers() }
  importArchive(source: string, signal?: AbortSignal) { return this.operation(() => this.installer.importArchive(source, signal)) }
  importBundled(key: string, signal?: AbortSignal) { return this.operation(() => this.imports.importBundled(key, signal)) }
  importFolder(folder: string, entry: Extract<CatalogueEntry, { status: 'available' }>, signal?: AbortSignal) {
    // Freeze the UI selection before waiting behind another native operation.
    const selected = structuredClone(entry)
    return this.operation(() => this.imports.importFolder(folder, selected, signal))
  }
  activate(packageId: string, version: string, signal?: AbortSignal) {
    return this.operation(() => this.activation.activate(packageId, version, signal))
  }
  stop(packageId: string, action: StopAction, signal?: AbortSignal) {
    return this.operation(() => this.lifecycle.stop(packageId, action, signal))
  }
}
