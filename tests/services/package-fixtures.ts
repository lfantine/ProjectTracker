import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ZipFile } from 'yazl'
import type { Manifest } from '../../shared/manifest'
import type { ActivationHooks } from '../../main/packages/activation'
export const isolatedActivationHooks = (): ActivationHooks => ({ confirm: async () => true, prevalidate: async () => {}, migrate: async (_version, snapshot) => snapshot, suspendPackage: () => () => {}, revokePackage: () => {}, changed: () => {} })
export async function packageArchive(root: string, changes: Partial<Manifest> = {}) {
  const manifest = { ...JSON.parse(await readFile('tests/fixtures/manifests/valid/major-only.json', 'utf8')), ...changes }
  const zip = new ZipFile(), chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from('<html></html>'), 'board/index.html')
  if (manifest.migrations) zip.addBuffer(Buffer.from('<html></html>'), manifest.migrations.entry)
  zip.end()
  const source = path.join(root, `${manifest.version}.zip`)
  await writeFile(source, await done)
  return source
}
