import { randomUUID } from 'node:crypto'
import { lstat, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import lessThan from 'semver/functions/lt'
import type { Manifest } from '../../shared/manifest'
import { normalizePermissions, type PermissionSet } from '../../shared/permissions'
import type { Database } from '../db/database'
import { prepareArchive } from './archive'
import type { ConfirmImport } from './consent'
import { assessInstallation } from './eligibility'
import { serialPackageOperation as serial } from './operations'
import { verifyManagedVersion } from './managedVersion'
import { packageDirectory } from './directories'

interface VersionRow { package_id: string; version: string; content_fingerprint: string; source_fingerprint: string; files_dir: string; manifest_json: string }
interface PendingRow { id: number; package_id: string; version: string }
/** Trusted native selection, never supplied directly by SDK/IPC. */
export interface ImportSelection {
  origin: 'archive' | 'folder' | 'bundled'
  expected?: { packageId: string; version: string; contentSha256: string }
  validateSource?: () => void | Promise<void>
}
export interface ImportResult { packageId: string; version: string; status: 'ready' | 'unchanged' }
/** Native-only, inactive installation increment. Never executes package code,
 * flips active_version, changes existing grants/data or opens a runtime context.
 * root must be app-owned and outside ASAR; call recover before exposing packages.
 */
export class LocalPackageInstaller {
  private readonly root: string
  constructor(private readonly db: Database, root: string, private readonly confirm: ConfirmImport) {
    if (!path.isAbsolute(root)) throw new Error('INSTALL_ROOT_INVALID')
    this.root = path.normalize(root)
  }
  private active(): Manifest[] {
    return this.db.all<{ manifest_json: string }>(`SELECT v.manifest_json FROM packages p JOIN package_versions v
      ON v.package_id = p.id AND v.version = p.active_version WHERE p.state = 'active'`).map(row => JSON.parse(row.manifest_json) as Manifest)
  }
  private directory(packageId: string, version: string): string {
    // Never trust journal paths for deletion, even on recovery.
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(packageId) || packageId === 'core' ||
        !/^[0-9A-Za-z.+-]+$/.test(version) || version === '.' || version === '..') throw new Error('INSTALL_PATH_INVALID')
    return path.join('versions', packageId, version)
  }
  private async recoverLocked(): Promise<void> {
    await packageDirectory(this.root, '.staging', true)
    const pending = this.db.all<PendingRow>("SELECT id, package_id, version FROM install_journal WHERE action = 'import-inactive' AND status = 'started'")
    for (const row of pending) {
      const relative = this.directory(row.package_id, row.version)
      const registered = this.db.get<VersionRow>('SELECT * FROM package_versions WHERE package_id = ? AND version = ?', row.package_id, row.version)
      // Commit and journal completion share one SQLite transaction. Never delete
      // a registered version, including versions retained by another operation.
      if (!registered && await packageDirectory(this.root, relative, false)) await rm(path.join(this.root, relative), { force: true, recursive: true })
      this.db.run("UPDATE install_journal SET status = 'rolled-back', step = 'recovered' WHERE id = ?", row.id)
    }
    const stage = path.join(this.root, '.staging')
    for (const entry of await readdir(stage)) await rm(path.join(stage, entry), { force: true, recursive: true })
  }
  recover(): Promise<void> { return serial(this.root, () => this.recoverLocked()) }

  importArchive(source: string, signal?: AbortSignal, selection: ImportSelection = { origin: 'archive' }): Promise<ImportResult> {
    selection = { ...selection, expected: selection.expected ? { ...selection.expected } : undefined }
    return serial(this.root, async () => {
      await this.recoverLocked()
      if (signal?.aborted) throw new Error('INSTALL_CANCELLED')
      await selection.validateSource?.()
      const prepared = await prepareArchive(source, path.join(this.root, '.staging'))
      const { manifest } = prepared
      let relative = ''
      let journalId: number | undefined
      let moved = false
      let committed = false
      try {
        await selection.validateSource?.()
        const expected = selection.expected
        if (expected && (manifest.id !== expected.packageId || manifest.version !== expected.version ||
          prepared.contentSha256 !== expected.contentSha256)) throw new Error('INSTALL_SOURCE_CHANGED')
        relative = this.directory(manifest.id, manifest.version)
        const existing = this.db.get<VersionRow>('SELECT * FROM package_versions WHERE package_id = ? AND version = ?', manifest.id, manifest.version)
        if (existing) {
          if (existing.content_fingerprint !== prepared.contentSha256) throw new Error('INSTALL_VERSION_CONFLICT')
          // One verifier for activation, audit and idempotent reimport: checks
          // complete inventory (including additions), metadata, links and bounds.
          try { verifyManagedVersion(this.root, existing) } catch { throw Error('INSTALL_FILES_CORRUPT') }
          return { packageId: manifest.id, version: manifest.version, status: 'unchanged' }
        }
        const assess = () => {
          if (assessInstallation(manifest, this.active()).length) throw new Error('INSTALL_INELIGIBLE')
          const stored = this.db.get<{ storage_version: number; active_version: string | null }>('SELECT storage_version, active_version FROM packages WHERE id = ?', manifest.id)
          if (stored?.active_version && lessThan(manifest.version, stored.active_version)) throw new Error('INSTALL_DOWNGRADE')
          if (stored && manifest.storageVersion < stored.storage_version) throw new Error('INSTALL_STORAGE_DOWNGRADE')
        }
        assess()
        const previous = this.db.get<{ granted_permissions_json: string; revision: number }>('SELECT granted_permissions_json, revision FROM packages WHERE id = ?', manifest.id)
        const accepted = await this.confirm({ manifest: structuredClone(manifest), contentSha256: prepared.contentSha256,
          sourceSha256: prepared.sourceSha256, previousPermissions: previous ? JSON.parse(previous.granted_permissions_json) as PermissionSet : undefined }, signal)
        if (!accepted || signal?.aborted) throw new Error('INSTALL_CANCELLED')
        await selection.validateSource?.()
        assess()
        const now = new Date().toISOString()
        const inserted = this.db.run(`INSERT INTO install_journal (operation_id, package_id, version, action, step, status, created_at)
          VALUES (?, ?, ?, 'import-inactive', 'prepared', 'started', ?)`, randomUUID(), manifest.id, manifest.version, now)
        journalId = Number(inserted.lastInsertRowid)
        const destination = path.join(this.root, relative)
        await packageDirectory(this.root, path.dirname(relative), true)
        // Do not overwrite an unregistered directory. Recovery is responsible
        // for directories belonging to interrupted journalled operations.
        try { await lstat(destination); throw new Error('INSTALL_DIRECTORY_CONFLICT') } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        await rename(prepared.root, destination)
        moved = true
        if (signal?.aborted) throw new Error('INSTALL_CANCELLED')
        this.db.transaction(() => {
          assess()
          const current = this.db.get<{ revision: number }>('SELECT revision FROM packages WHERE id = ?', manifest.id)
          if (current?.revision !== previous?.revision) throw new Error('INSTALL_STATE_CHANGED')
          this.db.run(`INSERT INTO packages (id, kind, name, author, state, origin, storage_version, granted_permissions_json, installed_at, updated_at)
            VALUES (?, ?, ?, ?, 'disabled', ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`, manifest.id, manifest.kind, manifest.name, manifest.author,
            selection.origin, manifest.storageVersion, JSON.stringify(normalizePermissions(manifest.permissions)), now, now)
          this.db.run(`INSERT INTO package_versions (package_id, version, content_fingerprint, source_fingerprint, manifest_json, files_dir, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`, manifest.id, manifest.version, prepared.contentSha256, prepared.sourceSha256, JSON.stringify(manifest), relative, now)
          this.db.run("UPDATE install_journal SET status = 'done', step = 'ready' WHERE id = ?", journalId!)
        })
        committed = true
        return { packageId: manifest.id, version: manifest.version, status: 'ready' }
      } catch (error) {
        if (moved && !committed) await rm(path.join(this.root, relative), { force: true, recursive: true })
        if (journalId !== undefined && !committed) this.db.run("UPDATE install_journal SET status = 'failed', step = 'rolled-back' WHERE id = ?", journalId)
        throw error
      } finally { await prepared.dispose() }
    })
  }
}
