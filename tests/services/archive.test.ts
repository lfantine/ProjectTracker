import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { prepareArchive } from '../../main/packages/archive'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(entries?: [string, Buffer][], compress = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-archive-'))
  roots.push(root)
  const manifest = await readFile('tests/fixtures/manifests/valid/major-only.json')
  const parsed = JSON.parse(manifest.toString())
  const zip = new ZipFile()
  const chunks: Buffer[] = []
  const output = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', chunk => chunks.push(chunk))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
  for (const [name, content] of entries ?? [['manifest.json', manifest], [parsed.contributions[0].entry, Buffer.from('<html></html>')]]) {
    zip.addBuffer(content, name, { compress })
  }
  zip.end()
  const source = path.join(root, 'source.zip')
  await writeFile(source, await output)
  return { root, source, stage: path.join(root, 'staging') }
}
describe('native ZIP preparation (no activation)', () => {
  it('survives removal of the source and fingerprints extracted contents independently of compression', async () => {
    const a = await fixture(undefined, true)
    const b = await fixture(undefined, false)
    const first = await prepareArchive(a.source, a.stage)
    const second = await prepareArchive(b.source, b.stage)
    expect(first.contentSha256).toBe(second.contentSha256)
    expect(first.sourceSha256).not.toBe(second.sourceSha256)
    await unlink(a.source)
    expect(await readFile(path.join(first.root, 'manifest.json'), 'utf8')).toContain('manifestVersion')
    await first.dispose()
    await first.dispose()
    expect(await readdir(a.stage)).toEqual([])
    await second.dispose()
  })
  it.each([
    [['MANIFEST.json', Buffer.from('{}')], ['manifest.json', Buffer.from('{}')]],
    [['file', Buffer.from('x')], ['file/child', Buffer.from('x')]],
    [['file/child', Buffer.from('x')], ['file', Buffer.from('x')]],
    [['NUL.txt', Buffer.from('x')]],
    [['Foo/a', Buffer.from('x')], ['foo/b', Buffer.from('x')]],
    [['bad./entry', Buffer.from('x')]],
    [['manifest.json', Buffer.from('{}')]],
    [['other.txt', Buffer.from('x')]],
  ] as [string, Buffer][][])('rejects ambiguous or invalid archive %# and removes partial extraction', async (...entries) => {
    const input = await fixture(entries)
    await expect(prepareArchive(input.source, input.stage)).rejects.toThrow()
    expect(await readdir(input.stage)).toEqual([])
  })
  it('rejects traversal even when the ZIP central directory is forged', async () => {
    const input = await fixture([['abc/x', Buffer.from('x')]])
    const bytes = await readFile(input.source)
    // Equal-length replacement affects both local and central directory names.
    await writeFile(input.source, Buffer.from(bytes.toString('latin1').replaceAll('abc/x', '../xx'), 'latin1'))
    await expect(prepareArchive(input.source, input.stage)).rejects.toThrow()
    expect(await readdir(input.stage)).toEqual([])
  })
  it('rejects symbolic links encoded in Unix external attributes', async () => {
    const input = await fixture([['link', Buffer.from('../../outside')]])
    const bytes = await readFile(input.source)
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bytes.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38)
    await writeFile(input.source, bytes)
    await expect(prepareArchive(input.source, input.stage)).rejects.toThrow('ARCHIVE_UNSUPPORTED_ENTRY')
    expect(await readdir(input.stage)).toEqual([])
  })
  it('rejects a valid manifest whose contribution entry is absent', async () => {
    const manifest = await readFile('tests/fixtures/manifests/valid/major-only.json')
    const input = await fixture([['manifest.json', manifest]])
    await expect(prepareArchive(input.source, input.stage)).rejects.toThrow('ARCHIVE_REFERENCED_FILE_MISSING')
    expect(await readdir(input.stage)).toEqual([])
  })
  it('rejects actual oversized manifest bytes', async () => {
    const input = await fixture([['manifest.json', Buffer.alloc(256 * 1024 + 1)]])
    await expect(prepareArchive(input.source, input.stage)).rejects.toThrow('ARCHIVE_FILE_SIZE')
    expect(await readdir(input.stage)).toEqual([])
  })
})
