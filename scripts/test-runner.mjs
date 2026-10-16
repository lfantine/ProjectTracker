import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const mode = process.argv[2] || 'all'
const args = process.argv.slice(3)
const colorEnabled = process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== '0' && process.env.TERM !== 'dumb'
const env = { ...process.env, FORCE_COLOR: colorEnabled ? (process.env.FORCE_COLOR || '1') : '0' }
if (env.NO_COLOR !== undefined) delete env.FORCE_COLOR
const paint = (code, text) => colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text
const duration = (since) => `${((performance.now() - since) / 1000).toFixed(2)} s`
const heading = (text) => console.log(`\n${paint('1;36', `━━ ${text} ━━`)}\n`)
const started = performance.now()
let failed = false

if (!['all', 'unit', 'dom', 'services', 'watch', 'legacy', 'e2e'].includes(mode)) {
  console.error(`Mode inconnu : ${mode}`)
  process.exit(1)
}
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
// Every automated run is flagged: the main-process path resolver then refuses
// the personal data directory.
const testEnv = { ...env, PROJECT_TRACKER_TEST: '1' }
function run(command, commandArgs, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, env: { ...testEnv, ...extraEnv }, stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.signal) process.exit(result.signal === 'SIGINT' ? 130 : 1)
  if (result.status !== 0 || result.error) failed = true
}
heading('ProjectTracker · Tests')
if (mode === 'watch') {
  run(process.execPath, [vitest, '--project', 'dom', ...args])
}
if (['all', 'unit', 'dom'].includes(mode)) {
  heading('Vitest · Logique et interface (jsdom)')
  run(process.execPath, [vitest, 'run', '--project', 'dom', ...args])
}
if (['all', 'unit', 'services'].includes(mode)) {
  heading('Vitest · Services du processus principal (Electron en mode Node)')
  // The services project must exercise the runtime shipped with the app.
  const electron = createRequire(import.meta.url)('electron')
  run(electron, [vitest, 'run', '--project', 'services', ...args], { ELECTRON_RUN_AS_NODE: '1' })
}
if (mode === 'e2e') {
  heading('Electron · Scénarios de bout en bout')
  run(process.execPath, [fileURLToPath(new URL('./e2e.mjs', import.meta.url)), ...args])
}
if (mode === 'all' || mode === 'legacy') {
  heading('Régressions · Scénarios existants')
  const suites = [
    ['ai-requests', 'IA : requêtes et erreurs'],
    ['task-content', 'Tâches : contenu et hiérarchie'],
    ['task-status', 'Tâches : calcul des statuts'],
    ['note-deletion', 'Notes : suppression et conservation'],
    ['workspace-flow', 'Espace de travail : onglets et restauration'],
    ['task-dialog-identity', 'Interface : identité des tâches'],
  ]
  let passed = 0
  for (const [file, label] of suites) {
    const since = performance.now()
    const result = spawnSync(process.execPath, [`tests/${file}.cjs`], { cwd: root, env, encoding: 'utf8' })
    const ok = result.status === 0 && !result.error
    console.log(`  ${paint(ok ? '32' : '31', ok ? '✓ RÉUSSI' : '✗ ÉCHEC')}  ${label}  ${paint('2', duration(since))}`)
    if (ok) passed++
    else {
      failed = true
      if (result.stdout) console.error(result.stdout.trimEnd())
      if (result.stderr) console.error(result.stderr.trimEnd())
      if (result.error) console.error(result.error.message)
      if (result.signal) process.exit(result.signal === 'SIGINT' ? 130 : 1)
    }
  }
  console.log(`\n  ${passed}/${suites.length} suites de régression réussies`)
}
if (mode !== 'watch') {
  heading(failed ? 'ÉCHEC · Des vérifications ont échoué' : 'RÉUSSI · Toutes les vérifications passent')
  console.log(`  Durée totale : ${duration(started)}\n`)
}
process.exitCode = failed ? 1 : 0
