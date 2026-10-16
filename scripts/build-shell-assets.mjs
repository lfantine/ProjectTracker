import { buildExtensionPackages } from './build-extension-packages.mjs'
import { build } from 'esbuild'
import { mkdir, writeFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { buildRuntimeAssets } from './build-runtime.mjs'
import { buildWeekPackage } from './build-week-package.mjs'

// This runs from Nextron's main compilation, including direct `nextron build`.
// Only repository-owned sources are compiled; installed ZIPs are never inputs.
export async function buildShellAssets() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'amber-shell-build-'))
  try {
    const assets = await buildRuntimeAssets()
    const migration = await build({ entryPoints: ['preload/sandbox.ts'], bundle: true, write: false,
      platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' })
    const shell = await build({ entryPoints: ['preload/shell.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' })
    const zip = await buildWeekPackage(temporary)
    const extensions = await buildExtensionPackages(temporary)
    const extra = []
    for (const file of extensions) { extra.push([`runtime/${path.basename(file)}`, await readFile(file)]); extra.push([`runtime/${path.basename(file)}.json`, await readFile(`${file}.json`)]) }
    return new Map([
      ...extra,
      ['runtime/bootstrap.js', Buffer.from(assets.bootstrap)], ['runtime/host.js', Buffer.from(assets.host)],
      ['runtime/preload.cjs', Buffer.from(migration.outputFiles[0].contents)],
      ['runtime/shell-preload.cjs', Buffer.from(shell.outputFiles[0].contents)],
      [`runtime/${path.basename(zip)}`, await readFile(zip)],
      ['runtime/builtin-week.json', await readFile(`${zip}.json`)],
    ])
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

export async function writeShellAssets(directory) {
  for (const [name, bytes] of await buildShellAssets()) {
    const target = path.join(directory, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
}
