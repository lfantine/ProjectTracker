import { createHash } from 'node:crypto'
import { readFile, open, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fromBufferPromise } from 'yauzl'
import { ARCHIVE_LIMITS as limits } from '../../shared/limits'
import { isSafeRelativePath, missingFiles, validateManifest, type Manifest } from '../../shared/manifest'

import { packageLogoDataUrl } from './logo'

export interface PreparedArchive {
  logoDataUrl?: string
  root: string
  manifest: Manifest
  sourceSha256: string
  contentSha256: string
  files: { path: string; sha256: string; bytes: number }[]
  /** The caller owns this staging directory; no installation or activation occurs. */
  dispose(): Promise<void>
}
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

// Portable names avoid collisions on Windows/macOS as well as traversal. Reject
// ambiguous names rather than silently rewriting an author's archive.
function portableName(name: string): string {
  if (!isSafeRelativePath(name) || name.split('/').length > limits.maxPathDepth ||
      name !== name.normalize('NFC') || /[\x00-\x1f\x7f:<>"|?*]/.test(name) ||
      name.split('/').some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('ARCHIVE_UNSAFE_PATH')
  }
  return name.toLowerCase()
}

/** Native-only preparation. stagingParent must be an application-owned directory.
 * Snapshot the source once, so inspection and extraction cannot observe different ZIPs.
 * No imported code is evaluated and no active package/data is touched.
 */
export async function prepareArchive(source: string, stagingParent: string): Promise<PreparedArchive> {
  const input = await open(source, 'r')
  let bytes: Buffer
  try {
    const stat = await input.stat()
    if (!stat.isFile() || stat.size > limits.maxArchiveBytes) throw new Error('ARCHIVE_SIZE')
    // A bounded read also handles a source growing after stat().
    bytes = Buffer.alloc(Math.min(stat.size + 1, limits.maxArchiveBytes + 1))
    let offset = 0
    while (offset < bytes.length) {
      const read = await input.read(bytes, offset, bytes.length - offset, offset)
      if (!read.bytesRead) break
      offset += read.bytesRead
    }
    if (offset !== stat.size) throw new Error('ARCHIVE_SOURCE_CHANGED')
    bytes = bytes.subarray(0, offset)
  } finally { await input.close() }
  const zip = await fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true })
  let root: string | undefined
  try {
    if (zip.entryCount > limits.maxFiles) throw new Error('ARCHIVE_FILE_COUNT')
    await mkdir(stagingParent, { recursive: true })
    root = await mkdtemp(path.join(stagingParent, 'prepare-'))
    const files: PreparedArchive['files'] = []
    const names = new Map<string, 'file' | 'directory'>()
    const spellings = new Map<string, string>()
    let total = 0
    let manifestBytes: Buffer | undefined
    for await (const entry of zip.eachEntry()) {
      const directory = entry.fileName.endsWith('/')
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName
      const canonical = portableName(name)
      const originalParts = name.split('/')
      for (let n = 1; n <= originalParts.length; n++) {
        const spelling = originalParts.slice(0, n).join('/')
        const key = spelling.toLowerCase()
        if (spellings.has(key) && spellings.get(key) !== spelling) throw new Error('ARCHIVE_PATH_COLLISION')
        spellings.set(key, spelling)
      }
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000
      if ((mode !== 0 && mode !== (directory ? 0x4000 : 0x8000)) || (entry.generalPurposeBitFlag & 1)) throw new Error('ARCHIVE_UNSUPPORTED_ENTRY')
      if (names.has(canonical)) throw new Error('ARCHIVE_DUPLICATE_PATH')
      const segments = canonical.split('/')
      for (let n = 1; n < segments.length; n++) if (names.get(segments.slice(0, n).join('/')) === 'file') throw new Error('ARCHIVE_PATH_COLLISION')
      if (!directory && [...names.keys()].some(key => key.startsWith(canonical + '/'))) throw new Error('ARCHIVE_PATH_COLLISION')
      names.set(canonical, directory ? 'directory' : 'file')
      if (directory) continue
      const max = name === 'manifest.json' ? limits.maxManifestBytes : limits.maxFileBytes
      if (entry.uncompressedSize > max) throw new Error('ARCHIVE_FILE_SIZE')
      const stream = await zip.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      let size = 0
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk)
          size += buffer.length
          total += buffer.length
          if (size > max || total > limits.maxExtractedBytes) throw new Error('ARCHIVE_EXTRACTED_SIZE')
          chunks.push(buffer)
        }
      } finally { stream.destroy() }
      const content = Buffer.concat(chunks)
      const destination = path.join(root, ...name.split('/'))
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, content, { flag: 'wx', mode: 0o600 })
      files.push({ path: name, sha256: hash(content), bytes: size })
      if (name === 'manifest.json') manifestBytes = content
    }
    if (!manifestBytes) throw new Error('ARCHIVE_MANIFEST_MISSING')
    const parsed = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)))
    if (!parsed.ok) throw new Error('ARCHIVE_MANIFEST_INVALID')
    if (missingFiles(parsed.manifest, new Set(files.map(file => file.path))).length) throw new Error('ARCHIVE_REFERENCED_FILE_MISSING')
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    const preparedRoot = root
    return {
      root, manifest: parsed.manifest, files, sourceSha256: hash(bytes),
      ...(parsed.manifest.logo ? { logoDataUrl: packageLogoDataUrl(await readFile(path.join(root, parsed.manifest.logo))) } : {}),
      contentSha256: hash(JSON.stringify(files.map(file => [file.path, file.sha256]))),
      dispose: () => rm(preparedRoot, { recursive: true, force: true }),
    }
  } catch (error) {
    if (root) await rm(root, { recursive: true, force: true })
    throw error
  } finally { zip.close() }
}
