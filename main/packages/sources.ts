import path from 'node:path'
import type { Database } from '../db/database'

export interface LinkedFolder { path: string; addedAt: string }

/** Native-only source preference. Selecting a folder never imports its contents.
 * A missing folder remains linked so the catalogue can report a source error.
 * Existing installations/data are deliberately outside this repository.
 */
export class PackageSources {
  constructor(private readonly db: Database) {}

  linkedFolder(): LinkedFolder | undefined {
    return this.db.get<LinkedFolder>('SELECT path, added_at AS addedAt FROM package_sources WHERE kind = ? ORDER BY added_at DESC, id LIMIT 1', 'folder')
  }

  linkFolder(folder: string): LinkedFolder {
    if (!path.isAbsolute(folder) || folder.includes('\0')) throw new Error('SOURCE_INVALID_PATH')
    const normalized = path.normalize(folder)
    const existing = this.linkedFolder()
    if (existing?.path === normalized) return existing
    const source = { path: normalized, addedAt: new Date().toISOString() }
    this.db.transaction(() => {
      // v1 has exactly one linked folder. Replacing/unlinking never uninstalls.
      this.db.run('DELETE FROM package_sources WHERE kind = ?', 'folder')
      this.db.run('INSERT INTO package_sources (id, kind, path, added_at) VALUES (?, ?, ?, ?)', 'linked-folder', 'folder', source.path, source.addedAt)
    })
    return source
  }

  unlinkFolder(): void {
    this.db.run('DELETE FROM package_sources WHERE kind = ?', 'folder')
  }
}
