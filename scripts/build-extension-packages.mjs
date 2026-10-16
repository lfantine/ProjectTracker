import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { ZipFile } from 'yazl'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
export async function buildExtensionPackages(directory) {
  await mkdir(directory, { recursive: true })
  const outputs = []
  for (const name of ['builtin-amber-theme', 'builtin-week-report']) {
    const base = path.resolve('packages', name), bytes = await readFile(path.join(base, 'manifest.json')), manifest = JSON.parse(bytes)
    const files = new Map([['manifest.json', bytes]])
    if (manifest.extensionType === 'theme') files.set('theme.json', await readFile(path.join(base, 'theme.json')))
    else {
      const compiled = await build({ entryPoints: [path.join(base, 'src/view.ts')], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome144' })
      files.set('report.js', Buffer.from(compiled.outputFiles[0].contents)); files.set('summary.html', Buffer.from('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bilan</title></head><body><main id="report">Chargement du bilan…</main><script src="report.js" defer></script></body></html>'))
    }
    const zip = new ZipFile(), chunks = [], done = new Promise((resolve, reject) => { zip.outputStream.on('data', b => chunks.push(b)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
    const inventory = [...files].sort(([a],[b]) => a < b ? -1 : 1)
    for (const [file, contents] of inventory) zip.addBuffer(contents, file, { mtime: new Date('2020-01-01T00:00:00Z') })
    zip.end(); const file = `${manifest.id}-${manifest.version}.zip`, target = path.join(directory, file); await writeFile(target, await done)
    const metadata = { key: name, packageId: manifest.id, version: manifest.version, file, contentSha256: createHash('sha256').update(JSON.stringify(inventory.map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')]))).digest('hex') }
    await writeFile(`${target}.json`, JSON.stringify(metadata)); outputs.push(target)
  }
  return outputs
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await buildExtensionPackages(path.resolve('dist/packages')))
