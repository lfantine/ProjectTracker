import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const scenarios = {
  async 'sauvegarde vérifiée, annulation native et démarrage sans tiers'({ launch, close, dataDir }) {
    let { page, app } = await launch({ PROJECT_TRACKER_MODULES: '1' })
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
    const saved = await page.evaluate(() => window.api.core.backup())
    assert.equal(saved.ok, true)
    const directory = path.join(dataDir, 'backups', saved.value.name)
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'backup.json'), 'utf8'))
    assert.equal(metadata.version, 2)
    assert.ok(metadata.files.some(file => file.path === 'tracker.sqlite'))
    assert.ok(metadata.files.some(file => file.path.endsWith('manifest.json')))
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      dialog.showMessageBox = async (_window, options) => { globalThis.__recoveryOptions = options; return { response: 0 } }
    }, directory)
    const cancelled = await page.evaluate(() => window.api.core.restore())
    assert.equal(cancelled.ok, false)
    assert.match(cancelled.error.message, /annulée/)
    assert.deepEqual(await app.evaluate(() => [globalThis.__recoveryOptions.defaultId, globalThis.__recoveryOptions.cancelId]), [0, 0])
    assert.equal(fs.existsSync(path.join(dataDir, 'restore-pending.json')), false)
    await close()
    ;({ page } = await launch({ AMBER_SAFE_MODE: '1' }))
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
    assert.equal(await page.evaluate(() => window.api.core.safeMode()), true)
    const denied = await page.evaluate(() => window.api.modules.open({ kind: 'major', major: { packageId: 'builtin.week', contributionId: 'planner' } }))
    assert.equal(denied.status, 'unavailable')
    assert.equal(await page.locator('iframe').count(), 0)
    await page.getByRole('link', { name: 'Réglages', exact: true }).first().click()
    await page.getByText('Mode sans tiers : aucun package ni thème externe n’est exécuté.', { exact: true }).waitFor()
    await close()
    ;({ page } = await launch({ PROJECT_TRACKER_MODULES: '1' }))
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
    const state = await page.evaluate(() => window.api.packages.snapshot())
    assert.equal(state.value.packages.find(pkg => pkg.id === 'builtin.week').state, 'active')
  },
}

scenarios['récupération accessible même lorsque le runtime modulaire est demandé'] = async ({ launch, close, dataDir, fixtures }) => {
  const source = path.join(dataDir, 'data.json')
  fs.copyFileSync(path.join(fixtures, 'legacy/invalid-json/data.json'), source)
  const original = fs.readFileSync(source, 'utf8')
  let { page } = await launch({ PROJECT_TRACKER_MODULES: '1' })
  await page.getByRole('link', { name: 'Réglages', exact: true }).first().click()
  await page.getByRole('alert').filter({ hasText: 'Les données existantes' }).waitFor()
  assert.equal(fs.readFileSync(source, 'utf8'), original)
  assert.equal(await page.locator('iframe').count(), 0)
  await close()
  fs.copyFileSync(path.join(fixtures, 'legacy/full-current/data.json'), source)
  ;({ page } = await launch({ PROJECT_TRACKER_MODULES: '1' }))
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal((await page.evaluate(() => window.api.core.status())).mode, 'ready')
}

scenarios['restauration confirmée depuis le sélecteur natif puis redémarrage sans tiers'] = async ({ launch, close, dataDir }) => {
  let { page, app } = await launch({ PROJECT_TRACKER_MODULES: '1' })
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal((await page.evaluate(() => window.api.core.command('preferences.update', { patch: { themeMode: 'dark' } }))).ok, true)
  const organized = await page.evaluate(async () => {
    const command = async command => {
      const snapshot = await window.api.composition.snapshot()
      return window.api.composition.command({ command, expectedRevision: snapshot.value.revision, operationId: crypto.randomUUID() })
    }
    const group = await command({ kind: 'sidebar.group.add', name: 'Groupe sauvegardé' })
    if (!group.ok) throw Error('Fixture group failed')
    const snapshot = await window.api.composition.snapshot()
    await command({ kind: 'sidebar.place', id: snapshot.value.sidebar[0].id, beforeId: null, groupId: group.value.id })
    return (await window.api.composition.snapshot()).value
  })
  const saved = await page.evaluate(() => window.api.core.backup())
  assert.equal(saved.ok, true)
  assert.equal((await page.evaluate(() => window.api.core.command('preferences.update', { patch: { themeMode: 'light' } }))).ok, true)
  await app.evaluate(({ app, dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    dialog.showMessageBox = async () => ({ response: 1 })
    // The harness owns the following launch; never spawn an untracked process.
    app.relaunch = () => {}
  }, path.join(dataDir, 'backups', saved.value.name))
  const exited = app.waitForEvent('close')
  // Revoking the runtime intentionally closes its shell before replacement.
  // The durable result is verified after the native process exits/restarts.
  await page.evaluate(() => window.api.core.restore()).catch(error => { if (!/closed/.test(error.message)) throw error })
  await exited; await close()
  ;({ page, app } = await launch({ AMBER_SAFE_MODE: '1' }))
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal((await page.evaluate(() => window.api.core.snapshot())).value.preferences.themeMode, 'dark')
  const restored = (await page.evaluate(() => window.api.composition.snapshot())).value
  assert.deepEqual(restored.sidebarGroups, organized.sidebarGroups)
  assert.deepEqual(restored.sidebar.map(entry => [entry.id, entry.groupId]), organized.sidebar.map(entry => [entry.id, entry.groupId]))
  const states = await app.evaluate((_, file) => {
    const db = new (process.getBuiltinModule('node:sqlite').DatabaseSync)(file, { readOnly: true })
    try { return db.prepare('SELECT state, state_reason FROM packages').all() } finally { db.close() }
  }, path.join(dataDir, 'tracker.sqlite'))
  assert.ok(states.length > 0)
  assert.ok(states.every(row => row.state === 'disabled' && row.state_reason === 'restored-requires-consent'))
  assert.equal(await page.locator('iframe').count(), 0)
  assert.ok(fs.readdirSync(dataDir).some(name => name.startsWith('restore-')))
}

scenarios['préférences historiques du profil reprises avant le shell isolé une seule fois'] = async ({ launch, close, dataDir }) => {
  let { page, app } = await launch()
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
  await page.evaluate(() => {
    localStorage.setItem('tracker_theme_mode', 'dark')
    localStorage.setItem('tracker_sidebar_collapsed', '1')
  })
  await app.evaluate((_, file) => {
    const db = new (process.getBuiltinModule('node:sqlite').DatabaseSync)(file)
    try { db.exec("DELETE FROM import_markers WHERE kind = 'renderer-preferences'; DELETE FROM preferences WHERE key IN ('themeMode', 'sidebarCollapsed')") } finally { db.close() }
  }, path.join(dataDir, 'tracker.sqlite'))
  await close()
  ;({ page } = await launch({ PROJECT_TRACKER_MODULES: '1' }))
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
  let snapshot = await page.evaluate(() => window.api.core.snapshot())
  assert.equal(snapshot.value.preferences.themeMode, 'dark')
  assert.equal(snapshot.value.preferences.sidebarCollapsed, true)
  assert.equal(snapshot.value.preferencesAdopted, true)
  await page.evaluate(() => window.api.core.command('preferences.update', { patch: { themeMode: 'light' } }))
  await close()
  ;({ page } = await launch({ PROJECT_TRACKER_MODULES: '1' }))
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
  snapshot = await page.evaluate(() => window.api.core.snapshot())
  assert.equal(snapshot.value.preferences.themeMode, 'light')
}
