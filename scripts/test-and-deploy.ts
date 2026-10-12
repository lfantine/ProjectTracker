import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'


const root = fileURLToPath(new URL('../', import.meta.url))
const colorEnabled = process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== '0' && process.env.TERM !== 'dumb'
const paint = (code: number, text: string) => colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text

function tests(): boolean {
  const runner = fileURLToPath(new URL('./test-runner.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [runner, 'all'], {
    cwd: root,
    stdio: 'inherit',
  })

  if (result.error) console.error(result.error.message)
  if (result.signal) {
    console.error(paint(31, `Tests interrompus (${result.signal}).`))
  }
  if (result.status !== 0 || result.error) {
    process.exitCode = result.signal === 'SIGINT' ? 130 : (result.status || 1)
    return false
  }
  return true
}


async function askCommitDescription(): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  const controller = new AbortController()
  readline.once('SIGINT', () => controller.abort())
  try {
    return (await readline.question('Description du commit : ', { signal: controller.signal })).trim()
  } finally {
    readline.close()
  }
}

async function deploy(): Promise<boolean> {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  if (status.error || status.status !== 0) {
    console.error(paint(31, `Git status impossible : ${status.error?.message ?? status.stderr.trim()}`))
    return false
  }
  if (!status.stdout.trim()) {
    console.log(paint(33, 'Aucun changement à committer.'))
    return true
  }

  const description = await askCommitDescription()
  if (!description) {
    console.error(paint(31, 'Message vide : commit annulé.'))
    return false
  }

  const add = spawnSync('git', ['add', '.'], { cwd: root, stdio: 'inherit' })
  if (add.error || add.status !== 0) {
    console.error(paint(31, `Git add impossible : ${add.error?.message ?? add.signal ?? `code de sortie ${add.status}`}`))
    return false
  }

  const commit = spawnSync('git', ['commit', '-m', description], { cwd: root, stdio: 'inherit' })
  if (commit.error || commit.status !== 0) {
    console.error(paint(31, `Git commit impossible : ${commit.error?.message ?? commit.signal ?? `code de sortie ${commit.status}`}`))
    return false
  }

  console.log(paint(32, 'Commit créé avec succès.'))
  return true
}

async function main() {
  try {
    if (!tests()) {
      console.error(paint(31, 'Échec des tests : commit annulé.'))
    } else {
      console.log(paint(32, 'Tests réussis.'))
      if (!(await deploy())) process.exitCode = 1
    }
  } catch (error) {
    const cancelled = error instanceof Error && error.name === 'AbortError'
    console.error(paint(31, cancelled ? 'Commit annulé.' : `Erreur : ${error instanceof Error ? error.message : String(error)}`))
    process.exitCode = cancelled ? 130 : 1
  }
}

main()
