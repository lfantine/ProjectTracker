// Repository-specific build of the LinkedIn planner package, not a public CLI.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipFile } from 'yazl'
const root = fileURLToPath(new URL('../', import.meta.url))
export async function buildLinkedinPlannerPackage(outputDirectory) {
  if (!path.isAbsolute(outputDirectory)) throw Error('Absolute output directory required')
  const base = path.join(root, 'packages/linkedin-post-planner')
  const manifestBytes = await readFile(path.join(base, 'manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  const compiled = await build({ absWorkingDir: root, entryPoints: [path.join(base, 'src/view.ts')], bundle: true, write: false,
    platform: 'browser', format: 'iife', target: 'chrome144', sourcemap: false, minify: false })
  const files = new Map([['manifest.json', manifestBytes], ['assets/planner.js', Buffer.from(compiled.outputFiles[0].contents)],
    ['assets/planner.css', await readFile(path.join(base, 'style.css'))]])
  if (manifest.logo) files.set(manifest.logo, await readFile(path.join(base, manifest.logo)))
  for (const contribution of manifest.contributions) files.set(contribution.entry, Buffer.from('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Posts LinkedIn</title><link rel="stylesheet" href="assets/planner.css"></head><body><main id="planner-root" aria-live="polite">Chargement…</main><script src="assets/planner.js" defer></script></body></html>'))
  const zip = new ZipFile(), chunks = []
  const done = new Promise((resolve, reject) => { zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
  // Stable file order/timestamps make repeated builds reproducible for identical inputs.
  const sorted = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  for (const [name, bytes] of sorted) zip.addBuffer(bytes, name, { mtime: new Date('2020-01-01T00:00:00Z') })
  zip.end()
  await mkdir(outputDirectory, { recursive: true })
  const target = path.join(outputDirectory, `${manifest.id}-${manifest.version}.zip`)
  await writeFile(target, await done)
  const inventory = sorted.map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])
  await writeFile(`${target}.json`, JSON.stringify({ key: 'linkedin-post-planner', packageId: manifest.id, version: manifest.version,
    file: path.basename(target), contentSha256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex') }))
  return target
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await buildLinkedinPlannerPackage(path.join(root, 'dist/packages')))
}
