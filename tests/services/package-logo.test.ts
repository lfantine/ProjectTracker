import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { packageLogoDataUrl, MAX_LOGO_BYTES } from '../../main/packages/logo'
import { validateManifest, missingFiles } from '../../shared/manifest'
import { prepareArchive } from '../../main/packages/archive'
import { PackageManager } from '../../main/packages/manager'
import { openDatabase, type Database } from '../../main/db/database'
import { isolatedActivationHooks } from './package-fixtures'
import manifest from '../fixtures/manifests/valid/major-only.json'
const resources: { root: string; db?: Database }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.db?.close(); await rm(f.root, { recursive: true, force: true }) } })
const sourceLogo = () => readFile('docs/logo/week-module-logo.png')
function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(payload.length + 8)
  result.writeUInt32BE(data.length, 0); payload.copy(result, 4)
  let crc = 0xffffffff
  for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'amber-logo-')); const f = { root, db: await openDatabase(path.join(root, 'state.sqlite')) }; resources.push(f); return f }
async function archive(root: string, logo?: Buffer) {
  const zip = new ZipFile(), chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', x => chunks.push(x)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
  zip.addBuffer(Buffer.from(JSON.stringify({ ...manifest, logo: 'assets/logo.png' })), 'manifest.json')
  zip.addBuffer(Buffer.from('<html></html>'), 'board/index.html')
  if (logo) zip.addBuffer(logo, 'assets/logo.png')
  zip.end()
  const file = path.join(root, 'logo-package.zip'); await writeFile(file, await done); return file
}
it('accepts local PNG metadata, includes it in referenced files, rejects remote/traversal/vector paths', () => {
  const parsed = validateManifest({ ...manifest, logo: 'assets/logo.png' })
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw Error('fixture')
  expect(missingFiles(parsed.manifest, new Set(['board/index.html']))).toEqual(['assets/logo.png'])
  for (const logo of ['../logo.png', '/logo.png', 'https://example.org/logo.png', 'data:image/png;base64,a', 'assets/logo.svg', 'assets\\logo.png']) expect(validateManifest({ ...manifest, logo }).ok).toBe(false)
})
it('prepares a bounded static PNG with ancillary metadata removed', async () => {
  const bytes = await sourceLogo(), url = packageLogoDataUrl(bytes)
  const image = Buffer.from(url.split(',')[1], 'base64')
  expect(image.subarray(0, 8)).toEqual(bytes.subarray(0, 8))
  expect(image.readUInt32BE(16)).toBe(512)
  expect(image.readUInt32BE(20)).toBe(512)
  expect(packageLogoDataUrl(image)).toBe(url)
  expect(image.includes(Buffer.from('iCCP'))).toBe(false)
  expect(image.includes(Buffer.from('tEXt'))).toBe(false)
})
it('rejects wrong signatures, truncated/CRC-corrupted/trailing bytes and oversized files', async () => {
  const bytes = await sourceLogo(), badCrc = Buffer.from(bytes); badCrc[30] ^= 1
  for (const invalid of [Buffer.from('<svg/>'), bytes.subarray(0, 40), badCrc, Buffer.concat([bytes, Buffer.from('hidden')]), Buffer.alloc(MAX_LOGO_BYTES + 1)]) expect(() => packageLogoDataUrl(invalid)).toThrow('PACKAGE_LOGO_INVALID')
})
it('checks dimensions and animation even with valid CRC, strips ancillary content and bounds inflation', async () => {
  const bytes = await sourceLogo(), signature = bytes.subarray(0, 8), header = bytes.subarray(16, 29)
  const png = (...chunks: Buffer[]) => Buffer.concat([signature, ...chunks, chunk('IEND', Buffer.alloc(0))])
  const idat = chunk('IDAT', deflateSync(Buffer.from([0])))
  const largeHeader = Buffer.from(header); largeHeader.writeUInt32BE(1025, 0)
  expect(() => packageLogoDataUrl(png(chunk('IHDR', largeHeader), idat))).toThrow('PACKAGE_LOGO_INVALID')
  expect(() => packageLogoDataUrl(png(chunk('IHDR', header), chunk('acTL', Buffer.alloc(8)), idat))).toThrow('PACKAGE_LOGO_INVALID')
  expect(() => packageLogoDataUrl(png(chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(10 * 1024 * 1024)))))).toThrow('PACKAGE_LOGO_INVALID')
  const withText = Buffer.concat([bytes.subarray(0, 33), chunk('tEXt', Buffer.from('note\0untrusted metadata')), bytes.subarray(33)])
  expect(packageLogoDataUrl(withText)).toBe(packageLogoDataUrl(bytes))
})
it('rejects missing or invalid PNG files during archive preparation', async () => {
  const f = await fixture()
  await expect(prepareArchive(await archive(f.root), path.join(f.root, 'stage'))).rejects.toThrow('ARCHIVE_REFERENCED_FILE_MISSING')
  await expect(prepareArchive(await archive(f.root, Buffer.from('<svg/>')), path.join(f.root, 'stage'))).rejects.toThrow('PACKAGE_LOGO_INVALID')
})
it('supplies verified logos for delivered, catalogue and installed packages after source deletion; changed managed bytes fall back', async () => {
  const f = await fixture(), png = await sourceLogo(), source = await archive(f.root, png)
  const prepared = await prepareArchive(source, path.join(f.root, 'stage'))
  const contentSha256 = prepared.contentSha256, logoDataUrl = prepared.logoDataUrl
  await prepared.dispose()
  const manager = new PackageManager(f.db, path.join(f.root, 'packages'), {
    confirmImport: async () => true, confirmStop: async () => true, activation: isolatedActivationHooks(), revokePackage: () => {}, changed: () => {},
  }, [{ key: 'example', packageId: manifest.id, version: manifest.version, path: source, contentSha256 }], true)
  await manager.start()
  expect(manager.bundledDetails()[0].logoDataUrl).toBe(logoDataUrl)
  await manager.linkFolder(f.root)
  const catalogue = manager.catalogueSnapshot()
  expect(catalogue).toMatchObject({ status: 'ok', entries: [{ logoDataUrl }] })
  await manager.importBundled('example')
  await rm(source)
  expect(manager.details()[0].logoDataUrl).toBe(logoDataUrl)
  const managed = path.join(f.root, 'packages/versions', manifest.id, manifest.version, 'assets/logo.png')
  expect(hash(await readFile(managed))).toBe(hash(png))
  await writeFile(managed, Buffer.from('tampered'))
  expect(manager.details()[0].logoDataUrl).toBeUndefined()
  expect(manager.details()[0].manifest.name).toBe(manifest.name)
})
