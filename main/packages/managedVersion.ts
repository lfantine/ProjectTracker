import fs from 'node:fs'
import { packageLogoDataUrl } from './logo'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ARCHIVE_LIMITS as limits } from '../../shared/limits'
import { isValidPackageId } from '../../shared/ids'
import { missingFiles, validateManifest, type Manifest } from '../../shared/manifest'
import type { ResourceFile } from '../runtime/resources'

export interface ManagedVersion { logoDataUrl?: string; manifest: Manifest; root: string; files: ResourceFile[]; contentSha256: string; sourceSha256: string }
export function verifyManagedVersion(root: string, row: { package_id: string; version: string; files_dir: string; manifest_json: string; content_fingerprint: string; source_fingerprint: string }): ManagedVersion {
  if (!isValidPackageId(row.package_id) || row.package_id === 'core' || !/^[0-9A-Za-z.+-]+$/.test(row.version) || ['.', '..'].includes(row.version)) throw Error('VERSION_PATH_INVALID')
  const expected = path.join('versions', row.package_id, row.version)
  if (row.files_dir !== expected) throw Error('VERSION_PATH_INVALID')
  let current = root
  for (const part of ['', 'versions', row.package_id, row.version]) {
    if (part) current = path.join(current, part)
    if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink()) throw Error('VERSION_FILES_INVALID')
  }
  const files: ResourceFile[] = []
  let total = 0, entries = 0
  const expectedManifest = validateManifest(JSON.parse(row.manifest_json))
  if (!expectedManifest.ok) throw Error('VERSION_MANIFEST_INVALID')
  const logoPath = expectedManifest.manifest.logo
  let logoBytes: Buffer | undefined
  let manifestBytes: Buffer | undefined
  function visit(directory: string, prefix: string, depth: number) {
    if (depth > limits.maxPathDepth) throw Error('VERSION_LIMIT')
    for (const child of fs.readdirSync(directory)) {
      if (++entries > limits.maxFiles * limits.maxPathDepth) throw Error('VERSION_LIMIT')
      const relative = prefix + child, file = path.join(directory, child), info = fs.lstatSync(file)
      if (info.isSymbolicLink()) throw Error('VERSION_FILES_INVALID')
      if (info.isDirectory()) { visit(file, relative + '/', depth + 1); continue }
      const max = relative === 'manifest.json' ? limits.maxManifestBytes : limits.maxFileBytes
      if (!info.isFile() || info.size > max || files.length >= limits.maxFiles) throw Error('VERSION_LIMIT')
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
      let bytes: Buffer
      try {
        const stat = fs.fstatSync(fd)
        if (!stat.isFile() || stat.size > max) throw Error('VERSION_LIMIT')
        bytes = Buffer.alloc(stat.size + 1)
        let length = 0
        while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n }
        if (length !== stat.size) throw Error('VERSION_FILES_CHANGED')
        bytes = bytes.subarray(0, length)
      } finally { fs.closeSync(fd) }
      if (relative === 'manifest.json') manifestBytes = bytes
      if (relative === logoPath) logoBytes = bytes
      total += bytes.length
      if (total > limits.maxExtractedBytes) throw Error('VERSION_LIMIT')
      files.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
  }
  visit(current, '', 1)
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const contentSha256 = createHash('sha256').update(JSON.stringify(files.map(file => [file.path, file.sha256]))).digest('hex')
  if (contentSha256 !== row.content_fingerprint) throw Error('VERSION_CONTENT_CHANGED')
  const parsed = validateManifest(JSON.parse(row.manifest_json))
  if (!parsed.ok || parsed.manifest.id !== row.package_id || parsed.manifest.version !== row.version || missingFiles(parsed.manifest, new Set(files.map(file => file.path))).length) throw Error('VERSION_MANIFEST_INVALID')
  if (!manifestBytes) throw Error('VERSION_MANIFEST_INVALID')
  const disk = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)))
  if (!disk.ok || JSON.stringify(disk.manifest) !== JSON.stringify(parsed.manifest)) throw Error('VERSION_MANIFEST_CHANGED')
  return { ...(logoBytes ? { logoDataUrl: packageLogoDataUrl(logoBytes) } : {}), manifest: parsed.manifest, root: current, files, contentSha256, sourceSha256: row.source_fingerprint }
}
