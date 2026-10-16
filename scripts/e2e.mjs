// Electron end-to-end harness.
//
// Every scenario runs the production build in a real Electron session with its
// own throwaway data directory and Electron profile. The personal data
// directory is fingerprinted before and after the run: any change fails it.
//
// Usage: node scripts/e2e.mjs [--build] [scenario-name-filter...]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const forceBuild = args.includes('--build')
const executablePath = process.env.AMBER_E2E_EXECUTABLE
if (executablePath && !path.isAbsolute(executablePath)) throw Error('Executable absolu requis')
const filters = args.filter((arg) => !arg.startsWith('--'))
const personalDir = path.join(os.homedir(), '.data', 'ProjectTracker')

function fingerprint(dir) {
  if (!fs.existsSync(dir)) return 'absent'
  const hash = createHash('sha256')
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name)
      const stat = fs.statSync(full)
      hash.update(`${path.relative(dir, full)}|${entry.isDirectory() ? 'd' : stat.size}|${stat.mtimeMs}\n`)
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(dir)
  return hash.digest('hex')
}

if (!executablePath && (forceBuild || !fs.existsSync(path.join(root, 'app', 'main.js')) || !fs.existsSync(path.join(root, 'app', 'home', 'index.html')))) {
  console.log('Construction de production (nextron build --no-pack)…')
  const build = spawnSync('npx', ['nextron', 'build', '--no-pack'], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status || 1)
}

const scenarioDir = path.join(root, 'tests', 'electron')
const scenarios = fs.readdirSync(scenarioDir)
  .filter((file) => file.endsWith('.e2e.mjs'))
  .filter((file) => !filters.length || filters.some((filter) => file.includes(filter)))
  .sort()

const personalBefore = fingerprint(personalDir)
const tempRoots = []
let failures = 0

export function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

for (const file of scenarios) {
  const mod = await import(pathToFileURL(path.join(scenarioDir, file)).href)
  for (const [name, scenario] of Object.entries(mod.scenarios || {})) {
    const started = performance.now()
    const dataDir = makeTemp('pt-e2e-data-')
    const profileDir = makeTemp('pt-e2e-profile-')
    let app
    let childProcess
    let appClosed = false
    const launch = async (extraEnv = {}) => {
      app = await electron.launch({
        ...(executablePath ? { executablePath, args: [] } : { args: [root] }),
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PROJECT_TRACKER_TEST: '1',
          ...(executablePath ? { AMBER_E2E_BOOT_BARRIER: '1' } : {}),
          PROJECT_TRACKER_DATA_DIR: dataDir,
          PROJECT_TRACKER_USER_DATA_DIR: profileDir,
          ...extraEnv,
        },
        timeout: 30_000,
      })
      childProcess = app.process()
      appClosed = false
      app.once('close', () => { appClosed = true })
      if (executablePath) await app.evaluate(() => { globalThis.__amberQualificationReady = true })
      app.process().stderr?.on('data', bytes => {
        const message = bytes.toString()
        if (/Erreur native fatale|Démarrage interrompu/.test(message)) console.error(message)
      })
      let page
      if (extraEnv.PROJECT_TRACKER_MODULES === '1') {
        // Real activation may create disposable hidden validation windows
        // before the visible shell has committed its first navigation.
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          page = app.windows().find(candidate => !candidate.isClosed() && candidate.url().startsWith('app://shell/'))
          if (page) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (!page) throw Error(`Le shell modulaire n’a pas démarré : ${app.windows().map(window => window.url()).join(', ')}`)
      } else page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      return { app, page }
    }
    const close = async () => {
      if (app && !appClosed && childProcess?.exitCode === null && childProcess?.signalCode === null) {
        const current = app
        let timer
        try {
          await Promise.race([current.close(), new Promise((_, reject) => { timer = setTimeout(() => { childProcess?.kill('SIGKILL'); reject(Error('Electron close timeout')) }, 15000) })])
        } catch (error) { console.error(error.message); failures++ }
        finally { clearTimeout(timer) }
      }
      app = undefined
    }
    try {
      await scenario({ root, dataDir, profileDir, launch, close, fixtures: path.join(root, 'tests', 'fixtures') })
      console.log(`  ✓ ${file} › ${name}  ${((performance.now() - started) / 1000).toFixed(2)} s`)
    } catch (error) {
      failures++
      console.error(`  ✗ ${file} › ${name}`)
      console.error(error?.stack || error)
    } finally {
      await close()
    }
  }
}

for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true })
const personalAfter = fingerprint(personalDir)
if (personalBefore !== personalAfter) {
  failures++
  console.error('  ✗ Le répertoire de données personnel a changé pendant les scénarios.')
} else {
  console.log('  ✓ Répertoire de données personnel inchangé')
}
console.log(`\n  ${failures ? `${failures} échec(s)` : 'Tous les scénarios Electron passent'}`)
process.exitCode = failures ? 1 : 0
