// Install the actual DMG into a disposable Applications directory, detach the
// image, then run the ordinary E2E suite against the copied .app (including ASAR).
// Never launch a packaged binary without the harness's temporary data/profile.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') throw Error('Qualification macOS seulement')
const image = path.resolve(process.argv[2] || `dist/amber-1.0.0-mac-${process.arch}.dmg`)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-install-'))
const mount = path.join(temporary, 'volume'), applications = path.join(temporary, 'Applications')
fs.mkdirSync(mount); fs.mkdirSync(applications)
let mounted = false
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error || result.status !== 0) throw result.error || Error(`${command}: ${result.status}`)
}
try {
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image]); mounted = true
  const installed = path.join(applications, 'amber.app')
  fs.cpSync(path.join(mount, 'amber.app'), installed, { recursive: true, dereference: false, verbatimSymlinks: true })
  run('hdiutil', ['detach', mount]); mounted = false
  const executablePath = path.join(installed, 'Contents', 'MacOS', 'amber')
  const stat = fs.statSync(path.join(installed, 'Contents', 'Resources', 'app.asar'))
  if (!stat.isFile() || stat.size === 0) throw Error('ASAR absent')
  run(process.execPath, ['scripts/qualify-release.mjs', executablePath])
  run(process.execPath, ['scripts/e2e.mjs', ...process.argv.slice(3)], { env: { ...process.env, AMBER_E2E_EXECUTABLE: executablePath } })
  console.log('✓ Application copiée depuis le DMG et exécutée hors volume ; ASAR et données externes qualifiés sur ce macOS uniquement.')
} finally {
  if (mounted) spawnSync('hdiutil', ['detach', mount], { stdio: 'inherit' })
  fs.rmSync(temporary, { recursive: true, force: true })
}
