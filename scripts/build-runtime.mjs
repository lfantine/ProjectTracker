import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
// Build controlled host code only. Package resources are never input to this
// compiler. Distribution wiring belongs to the later packaging qualification.
export async function buildRuntimeAssets() {
  const compile = async (file, globalName) => {
    const result = await build({ entryPoints: [path.join(root, file)], bundle: true, write: false, platform: 'browser', format: 'iife', globalName, target: 'chrome144', sourcemap: false })
    return result.outputFiles[0].text
  }
  const preload = await build({ entryPoints: [path.join(root, 'tests/electron/runtime-preload.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' })
  return { preload: preload.outputFiles[0].text, bootstrap: await compile('sdk/src/bootstrap.ts', 'PtBootstrap'), host: await compile('sdk/src/host.ts', 'PtHost') }
}
