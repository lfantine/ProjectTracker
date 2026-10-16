import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const scenarios = {
  async 'commandes confirmées, sauvegarde et redémarrage'({ launch, close, dataDir }) {
    let { page } = await launch()
    await page.getByText('Projets actifs', { exact: true }).waitFor()
    const created = await page.evaluate(async () => {
      const result = await window.api.core.command('notes.create', { input: { title: 'Persistée', content: 'Texte conservé', tags: [] }, operationId: 'e2e-note' })
      if (!result.ok) throw new Error(result.error.message)
      const backup = await window.api.core.backup()
      const exported = await window.api.core.exportJson()
      return { id: result.value.id, backup, exported }
    })
    assert.equal(created.backup.ok, true)
    assert.equal(created.exported.ok, true)
    assert.ok(fs.existsSync(path.join(dataDir, 'backups', created.backup.value.name, 'tracker.sqlite')))
    const exported = JSON.parse(fs.readFileSync(path.join(dataDir, 'backups', created.exported.value.name), 'utf8'))
    assert.ok(exported.data.notes.some((note) => note.id === created.id))
    await close()
    ;({ page } = await launch())
    await page.getByText('Projets actifs', { exact: true }).waitFor()
    const snapshot = await page.evaluate(() => window.api.core.snapshot())
    assert.equal(snapshot.ok, true)
    assert.ok(snapshot.value.data.notes.some((note) => note.id === created.id && note.content === 'Texte conservé'))
    assert.equal(fs.existsSync(path.join(dataDir, 'data.json')), false)
  },
}

scenarios['préférences SQLite et onglet épinglé après redémarrage'] = async ({ launch, close, dataDir, fixtures }) => {
  fs.copyFileSync(path.join(fixtures, 'legacy', 'full-current', 'data.json'), path.join(dataDir, 'data.json'))
  let { page } = await launch()
  await page.getByText('Projets actifs', { exact: true }).waitFor()
  // These retained legacy keys must never override SQLite after adoption.
  await page.evaluate(() => {
    localStorage.setItem('tracker_theme_mode', 'light')
    localStorage.setItem('tracker_sidebar_collapsed', '0')
    localStorage.setItem('tracker_project_tabs_v1', JSON.stringify({ tabs: [] }))
  })
  await page.getByRole('link', { name: 'Réglages', exact: true }).click()
  await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.getByRole('button', { name: 'Réduire', exact: true }).click()
  await page.getByRole('button', { name: 'Agrandir', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Projets', exact: true }).click()
  await page.getByText('Alpha', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Épingler Alpha', exact: true }).click()
  await page.getByRole('button', { name: 'Désépingler Alpha', exact: true }).waitFor()
  const before = await page.evaluate(async () => (await window.api.core.snapshot()).value.preferences)
  assert.equal(before.themeMode, 'dark')
  assert.equal(before.sidebarCollapsed, true)
  assert.deepEqual(before.pinnedTabs, [{ projectId: 'p_alpha', pinned: true }])
  await close()
  ;({ page } = await launch())
  await page.getByRole('button', { name: 'Désépingler Alpha', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Agrandir', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true)
  assert.equal((await page.evaluate(() => window.api.core.snapshot())).value.preferences.activeTabId, 'p_alpha')
  const legacy = await page.evaluate(() => ({ theme: localStorage.getItem('tracker_theme_mode'), sidebar: localStorage.getItem('tracker_sidebar_collapsed'), tabs: localStorage.getItem('tracker_project_tabs_v1') }))
  assert.deepEqual(legacy, { theme: 'light', sidebar: '0', tabs: JSON.stringify({ tabs: [] }) })
}

scenarios['récupération accessible et reprise de migration après correction de la source'] = async ({ launch, dataDir, fixtures }) => {
  const source = path.join(dataDir, 'data.json')
  fs.copyFileSync(path.join(fixtures, 'legacy', 'invalid-json', 'data.json'), source)
  const original = fs.readFileSync(source, 'utf8')
  const { page } = await launch()
  await page.getByRole('link', { name: 'Réglages', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Les données existantes' }).waitFor()
  assert.equal(fs.readFileSync(source, 'utf8'), original)
  const unavailable = await page.evaluate(() => window.api.core.command('notes.create', { input: { title: 'Interdite', content: '', tags: [] }, operationId: 'recovery-note' }))
  assert.equal(unavailable.ok, false)
  fs.copyFileSync(path.join(fixtures, 'legacy', 'full-current', 'data.json'), source)
  await page.getByRole('button', { name: 'Réessayer le démarrage' }).click()
  await page.waitForFunction(async () => (await window.api.core.status()).mode === 'ready')
  await page.getByRole('link', { name: 'Projets', exact: true }).click()
  await page.getByText('Alpha', { exact: true }).first().waitFor()
}

scenarios['note : échec visible, brouillon conservé et nouvelle tentative'] = async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  await page.getByText('Projets actifs', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Notes', exact: true }).click()
  await page.getByRole('button', { name: /Nouvelle note/ }).click()
  await page.getByPlaceholder('Titre', { exact: true }).fill('Note de validation')
  await page.getByPlaceholder('Titre', { exact: true }).blur()
  await page.getByText(/Enregistré à/).waitFor()
  const database = path.join(dataDir, 'tracker.sqlite')
  await app.evaluate(async (_, file) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(file)
    db.exec("CREATE TRIGGER fail_note_write BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT, 'test write failure'); END")
    db.close()
  }, database)
  const body = page.getByPlaceholder('Écris ta note en markdown…')
  await body.fill('Brouillon conservé malgré un disque indisponible')
  await body.blur()
  await page.getByText(/Non enregistré/).waitFor()
  assert.equal(await body.inputValue(), 'Brouillon conservé malgré un disque indisponible')
  let snapshot = await page.evaluate(() => window.api.core.snapshot())
  assert.equal(snapshot.value.data.notes[0].content, '')
  await app.evaluate(async (_, file) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(file)
    db.exec('DROP TRIGGER fail_note_write')
    db.close()
  }, database)
  await body.focus()
  await body.blur()
  await page.waitForFunction(async () => (await window.api.core.snapshot()).value.data.notes[0].content === 'Brouillon conservé malgré un disque indisponible')
  snapshot = await page.evaluate(() => window.api.core.snapshot())
  assert.equal(snapshot.value.data.notes[0].title, 'Note de validation')
}
