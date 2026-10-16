// Normal installed startup, not the isolated qualification branch. Only HOME
// and Electron's profile location are redirected; real personal data are hashed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright'

const executablePath = process.argv[2]
assert.ok(executablePath && path.isAbsolute(executablePath), 'Installed executable required')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-release-'))
function fingerprint(dir) {
  const hash = createHash('sha256')
  function walk(file) {
    if (!fs.existsSync(file)) { hash.update('absent'); return }
    const stat = fs.lstatSync(file)
    hash.update(`${path.relative(dir, file)}:${stat.mode}:${stat.size}:${stat.mtimeMs}`)
    if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file))
    else if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name))
    else hash.update(fs.readFileSync(file))
  }
  walk(dir); return hash.digest('hex')
}
const personal = ['.data/amber', '.data/ProjectTracker', 'Library/Application Support/amber', 'Library/Application Support/my-nextron-app'].map(dir => path.join(os.homedir(), dir))
const before = personal.map(fingerprint)
let application
async function close() {
  if (!application) return
  const app = application; application = null
  const child = app.process()
  let timer
  try { await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Release shutdown timeout')) }, 15000) })]) }
  finally { clearTimeout(timer) }
}
async function launch(home, safe = false) {
  const profile = path.join(home, 'profile')
  fs.mkdirSync(profile, { recursive: true })
  const env = { ...process.env, HOME: home, PROJECT_TRACKER_USER_DATA_DIR: profile }
  for (const key of ['PROJECT_TRACKER_TEST', 'PROJECT_TRACKER_MODULES', 'PROJECT_TRACKER_DATA_DIR', 'AMBER_E2E_BOOT_BARRIER', 'AMBER_SAFE_MODE', 'NODE_ENV', 'ELECTRON_RUN_AS_NODE']) delete env[key]
  application = await electron.launch({ executablePath, args: safe ? ['--safe-mode'] : [], env, timeout: 30000 })
  assert.equal(await application.evaluate(() => process.getBuiltinModule('node:os').homedir()), home)
  // Electron packaged startup can create isolated-session windows before CDP
  // attaches. Inspect the native window directly, without a boot barrier.
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const ready = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible() && !w.webContents.isLoading() && /^app:/.test(w.webContents.getURL())))
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Release window not ready')
}
async function shell(source) {
  return application.evaluate(({ BrowserWindow }, script) => {
    const window = BrowserWindow.getAllWindows().find(w => w.isVisible() && /^app:/.test(w.webContents.getURL()))
    if (!window) throw Error('Missing release shell')
    return window.webContents.executeJavaScript(script)
  }, source)
}
try {
  const home = path.join(temporary, 'home')
  // Seeded under the pre-amber name: the first launch must move it.
  const legacyData = path.join(home, '.data/ProjectTracker'), data = path.join(home, '.data/amber')
  fs.mkdirSync(legacyData, { recursive: true })
  const fixture = fs.readFileSync('tests/fixtures/legacy/full-current/data.json')
  fs.writeFileSync(path.join(legacyData, 'data.json'), fixture)
  await launch(home)
  assert.equal(fs.existsSync(legacyData), false)
  assert.match(await shell('location.href'), /^app:\/\/shell\//)
  assert.equal((await shell('window.api.core.status()')).mode, 'ready')
  const first = await shell('window.api.core.snapshot()')
  assert.equal(first.ok, true); assert.equal(first.value.data.projects.length, 3)
  assert.equal(first.value.preferencesAdopted, true)
  const opened = await shell("window.api.modules.open({kind:'major',major:{packageId:'builtin.week',contributionId:'planner'}})")
  assert.equal(opened.status, 'available')
  assert.match(opened.url, /^pt-plugin:/)
  assert.deepEqual(fs.readFileSync(path.join(data, 'data.json')), fixture)
  const archives = fs.readdirSync(path.join(data, 'migration')).filter(name => name.startsWith('legacy-'))
  assert.equal(archives.length, 1)
  const archive = path.join(data, 'migration', archives[0])
  assert.deepEqual(fs.readFileSync(path.join(archive, 'data.json')), fixture)
  assert.equal(JSON.parse(fs.readFileSync(path.join(archive, 'fingerprints.json'))).data.sha256, createHash('sha256').update(fixture).digest('hex'))
  const backup = await shell('window.api.core.backup()')
  assert.equal(backup.ok, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'backups', backup.value.name, 'backup.json'))).version, 2)
  assert.equal((await shell("window.api.core.command('preferences.update',{patch:{themeMode:'dark'}})")).ok, true)
  await close()
  await launch(home)
  const second = await shell('window.api.core.snapshot()')
  assert.equal(second.value.data.projects.length, 3)
  assert.equal(second.value.preferences.themeMode, 'dark')
  assert.equal((await shell('window.api.core.status()')).migratedThisLaunch, false)
  assert.equal(fs.readdirSync(path.join(data, 'migration')).filter(name => name.startsWith('legacy-')).length, 1)
  await close()
  await launch(home, true)
  assert.equal(await shell('window.api.core.safeMode()'), true)
  assert.equal((await shell('window.api.core.status()')).mode, 'ready')
  assert.equal((await shell("window.api.modules.open({kind:'major',major:{packageId:'builtin.week',contributionId:'planner'}})")).status, 'unavailable')
  assert.equal(await shell("document.querySelectorAll('iframe').length"), 0)
  await close()
  const broken = path.join(temporary, 'broken')
  const brokenData = path.join(broken, '.data/amber')
  fs.mkdirSync(brokenData, { recursive: true }); fs.writeFileSync(path.join(brokenData, 'data.json'), '{broken')
  await launch(broken)
  assert.equal((await shell('window.api.core.status()')).reason, 'legacy-invalid')
  assert.match(await shell('location.href'), /^app:\/\/shell\//)
  assert.equal(fs.readFileSync(path.join(brokenData, 'data.json'), 'utf8'), '{broken')
  await close()
  console.log('✓ Normal installed release: ~/.data/ProjectTracker moved to ~/.data/amber, default HOME migration, unchanged JSON + verified archive, builtin runtime, v2 backup, restart without reimport, preferences, safe mode and invalid-source recovery. No qualification flags.')
} finally {
  await close()
  try { assert.deepEqual(personal.map(fingerprint), before, 'Real personal data/profile changed') }
  finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}
