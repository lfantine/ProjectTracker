import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from '../db/database'
import type { CatalogueEntry } from './catalogue'
import { LocalPackageInstaller, type ImportResult } from './installer'
import { PackageSources } from './sources'

type Available = Extract<CatalogueEntry, { status: 'available' }>
export interface BundledArchive {
  /** Stable native inventory key, not a renderer-provided path. */
  key: string
  path: string
  packageId: string
  version: string
  contentSha256: string
}

/** Explicit native imports only. Neither listing nor linking installs anything.
 * Bundles receive exactly the same validation, consent and inactive commit as ZIPs.
 */
export class PackageSourceImports {
  private readonly bundles: readonly BundledArchive[]
  constructor(private readonly db: Database, private readonly installer: LocalPackageInstaller,
    private readonly sources: PackageSources, bundles: readonly BundledArchive[] = []) {
    if (new Set(bundles.map(item => item.key)).size !== bundles.length ||
      bundles.some(item => !path.isAbsolute(item.path))) throw new Error('SOURCE_INVALID_INVENTORY')
    this.bundles = structuredClone(bundles)
  }

  bundledOffers(): BundledArchive[] {
    // A retained uninstall tombstone must never become a startup reinstall offer.
    return this.bundles.filter(item => this.db.get<{ state: string }>('SELECT state FROM packages WHERE id = ?', item.packageId)?.state !== 'uninstalled')
      .map(item => ({ ...item }))
  }

  importBundled(key: string, signal?: AbortSignal): Promise<ImportResult> {
    const item = this.bundles.find(candidate => candidate.key === key)
    if (!item) return Promise.reject(new Error('SOURCE_UNKNOWN_BUNDLE'))
    // Explicit reimport is allowed; unchanged never resurrects an uninstall.
    return this.installer.importArchive(item.path, signal, { origin: 'bundled', expected: item })
  }

  importFolder(selectedFolder: string, entry: Available, signal?: AbortSignal): Promise<ImportResult> {
    const fileName = entry.fileName
    if (!path.isAbsolute(selectedFolder) || !fileName || fileName.includes('/') || fileName.includes('\\') ||
      fileName.includes('\0') || !fileName.toLowerCase().endsWith('.zip')) return Promise.reject(new Error('SOURCE_INVALID_SELECTION'))
    const folder = path.normalize(selectedFolder)
    const source = path.join(folder, fileName)
    const validateSource = async () => {
      if (this.sources.linkedFolder()?.path !== folder) throw new Error('SOURCE_LINK_CHANGED')
      // Catalogue entries must remain first-level regular files, not symlinks.
      if (!(await lstat(source)).isFile()) throw new Error('SOURCE_INVALID_SELECTION')
    }
    return this.installer.importArchive(source, signal, { origin: 'folder', validateSource,
      expected: { packageId: entry.manifest.id, version: entry.manifest.version, contentSha256: entry.contentSha256 } })
  }
}
