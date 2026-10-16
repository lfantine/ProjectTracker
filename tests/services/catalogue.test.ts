import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { scanFolderCatalogue } from '../../main/packages/catalogue'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))) })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-catalogue-'))
  roots.push(root)
  const folder = path.join(root, 'source')
  await mkdir(folder)
  return { root, folder, stage: path.join(root, 'staging') }
}
async function archive(destination: string) {
  const manifest = JSON.parse(await readFile('tests/fixtures/manifests/valid/major-only.json', 'utf8'))
  manifest.dependencies = { 'example.absent': '^1.0.0' }
  const zip = new ZipFile()
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', chunk => chunks.push(chunk))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from('<html></html>'), 'board/index.html')
  zip.end()
  await writeFile(destination, await done)
}
describe('linked-folder catalogue snapshot', () => {
  it('inspects only first-level regular ZIPs, isolates invalid entries and cleans preparations', async () => {
    const f = await fixture()
    await archive(path.join(f.folder, 'a.ZIP'))
    await writeFile(path.join(f.folder, 'b.zip'), 'broken zip')
    await writeFile(path.join(f.folder, 'ignore.txt'), 'not a zip')
    await mkdir(path.join(f.folder, 'nested'))
    await archive(path.join(f.folder, 'nested', 'hidden.zip'))
    await symlink(path.join(f.folder, 'a.ZIP'), path.join(f.folder, 'link.zip'))
    const result = await scanFolderCatalogue(f.folder, f.stage, [])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw Error('unexpected source error')
    expect(result.entries.map(entry => entry.fileName)).toEqual(['a.ZIP', 'b.zip'])
    expect(result.entries[0]).toMatchObject({ status: 'available', publisherVerified: false, issues: [{ code: 'DEPENDENCY_MISSING' }] })
    expect(result.entries[1]).toEqual({ fileName: 'b.zip', status: 'invalid', code: 'ARCHIVE_INVALID' })
    expect(await readdir(f.stage)).toEqual([])
    expect(await readdir(f.root)).toEqual(['source', 'staging'])
    expect(await scanFolderCatalogue(f.folder, f.stage, [])).toEqual(result)
  })
  it('reports missing sources without touching existing resources', async () => {
    const f = await fixture()
    await writeFile(path.join(f.root, 'installed-sentinel'), 'untouched')
    expect(await scanFolderCatalogue(path.join(f.root, 'missing'), f.stage, [])).toEqual({ status: 'error', code: 'SOURCE_UNREADABLE' })
    expect(await readFile(path.join(f.root, 'installed-sentinel'), 'utf8')).toBe('untouched')
  })
  it('bounds the number of archives without extracting any of them', async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 1001 }, (_, i) => writeFile(path.join(f.folder, `${i}.zip`), '')))
    expect(await scanFolderCatalogue(f.folder, f.stage, [])).toEqual({ status: 'error', code: 'SOURCE_TOO_MANY_ARCHIVES' })
    expect(await readdir(f.root)).toEqual(['source'])
  })
})
