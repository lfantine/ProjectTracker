import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Manifest } from '../../shared/manifest'
import { prepareArchive } from './archive'
import { assessInstallation, type InstallIssue } from './eligibility'

export type CatalogueEntry = {
  fileName: string
  status: 'available'
  logoDataUrl?: string
  manifest: Manifest
  sourceSha256: string
  contentSha256: string
  publisherVerified: false
  issues: InstallIssue[]
} | { fileName: string; status: 'invalid'; code: 'ARCHIVE_INVALID' }
export type FolderCatalogue = { status: 'ok'; entries: CatalogueEntry[] } |
  { status: 'error'; code: 'SOURCE_UNREADABLE' | 'SOURCE_TOO_MANY_ARCHIVES' }

// A source is never an execution root. This snapshot is informational only: an
// eventual installation MUST prepare the selected ZIP again and reconfirm its
// exact identity/content/rights. No SQL, context or active-directory mutation.
export async function scanFolderCatalogue(folder: string, stagingParent: string, active: readonly Manifest[]): Promise<FolderCatalogue> {
  let names: string[]
  try {
    const children = await readdir(folder, { withFileTypes: true })
    // No recursion, symlinks, development folders or automatic installation.
    names = children.filter(child => child.isFile() && child.name.toLowerCase().endsWith('.zip')).map(child => child.name).sort()
  } catch { return { status: 'error', code: 'SOURCE_UNREADABLE' } }
  // Sequential preparation bounds decompression concurrency and peak memory.
  if (names.length > 1000) return { status: 'error', code: 'SOURCE_TOO_MANY_ARCHIVES' }
  const entries: CatalogueEntry[] = []
  for (const fileName of names) {
    let prepared: Awaited<ReturnType<typeof prepareArchive>> | undefined
    try {
      prepared = await prepareArchive(path.join(folder, fileName), stagingParent)
      entries.push({ fileName, status: 'available', manifest: prepared.manifest, logoDataUrl: prepared.logoDataUrl,
        sourceSha256: prepared.sourceSha256, contentSha256: prepared.contentSha256,
        publisherVerified: false, issues: assessInstallation(prepared.manifest, active) })
    } catch {
      // Do not expose raw fs errors (absolute paths) or archive-controlled text.
      entries.push({ fileName, status: 'invalid', code: 'ARCHIVE_INVALID' })
    } finally { await prepared?.dispose() }
  }
  return { status: 'ok', entries }
}
