import { spawnSync } from 'node:child_process'
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

if (!['all', 'unit', 'watch', 'legacy'].includes(mode)) {
  console.error(`Mode inconnu : ${mode}`)
  process.exit(1)
}
heading('ProjectTracker · Tests')
if (mode !== 'legacy') {
  heading('Vitest · Logique, données et interface')
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), ...(mode === 'watch' ? [] : ['run']), ...args], { cwd: root, env, stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  failed = result.status !== 0
  if (result.signal) process.exit(result.signal === 'SIGINT' ? 130 : 1)
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
