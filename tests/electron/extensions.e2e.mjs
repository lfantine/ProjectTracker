import { ZipFile } from 'yazl'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
async function archive(directory, manifest, label) {
  const zip = new ZipFile(), chunks = [], done = new Promise((resolve, reject) => { zip.outputStream.on('data', b => chunks.push(b)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject) })
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from('<!doctype html><html><body><main id="root">Chargement…</main><script src="view.js" defer></script></body></html>'), 'view.html')
  zip.addBuffer(Buffer.from(`ProjectTracker.ready.then(sdk => { document.getElementById('root').textContent = ${JSON.stringify(label)} + sdk.context.kind; });`), 'view.js')
  if (manifest.migrations) { zip.addBuffer(Buffer.from('<!doctype html><html><body><script src="upgrade.js" defer></script></body></html>'), manifest.migrations.entry); zip.addBuffer(Buffer.from("ProjectTracker.ready.then(sdk => sdk.call('migration.complete', {}));"), 'upgrade.js') }
  zip.end(); const file = path.join(directory, `${manifest.id}-${manifest.version}.zip`); fs.writeFileSync(file, await done); return file
}
export const scenarios = {
  async 'thème et bilan depuis des ZIP externes dans le vrai shell'({ launch, root, dataDir, fixtures, close }) {
    fs.copyFileSync(path.join(fixtures, 'legacy/full-current/data.json'), path.join(dataDir, 'data.json'))
    const files = ['builtin.amber-theme-1.0.0.zip', 'builtin.week-report-1.0.0.zip'].map(name => {
      const target = path.join(dataDir, name); fs.copyFileSync(path.join(root, 'app/runtime', name), target); return target
    })
    const base = { manifestVersion: 1, name: 'Externe', author: 'Test', version: '1.0.0', hostApi: '^1.0.0', dependencies: {}, permissions: {}, storageVersion: 1 }
    files.push(await archive(dataDir, { ...base, id: 'example.external', kind: 'package', contributions: [
      { id: 'main', type: 'major', name: 'Majeur externe', entry: 'view.html', integrations: [] },
      { id: 'minor', type: 'minor', name: 'Mineur externe', entry: 'view.html' },
      { id: 'widget', type: 'widget', name: 'Widget externe', entry: 'view.html', size: { default: { w: 3, h: 4 } } },
    ] }, 'Contribution externe : '))
    files.push(await archive(dataDir, { ...base, id: 'example.second-feature', name: 'Seconde extension', kind: 'extension', extensionType: 'features', target: { package: 'builtin.week', version: '^1.0.0' }, features: [{ id: 'second', name: 'Seconde fonctionnalité', entry: 'view.html', slot: { id: 'summary', version: 1 } }] }, 'Seconde fonctionnalité : '))
    files.push(await archive(dataDir, { ...base, version: '1.1.0', storageVersion: 2, migrations: { entry: 'upgrade.html', steps: [1] }, id: 'example.second-feature', name: 'Seconde extension', kind: 'extension', extensionType: 'features', target: { package: 'builtin.week', version: '^1.0.0' }, features: [{ id: 'second', name: 'Seconde fonctionnalité', entry: 'view.html', slot: { id: 'summary', version: 1 } }] }, 'Seconde fonctionnalité : '))
    let { app, page } = await launch({ PROJECT_TRACKER_MODULES: '1' }); page.setDefaultTimeout(15000)
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
    page.on('console', message => { if (message.text().includes('Bilan indisponible')) console.error(message.text()) })
    await app.evaluate(({ dialog }, files) => {
      globalThis.__extensionFiles = files
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__extensionFiles.shift()] })
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    }, files)
    await page.getByRole('link', { name: 'Marketplace', exact: true }).click()
    for (const name of ['Ambre', 'Bilan de la semaine', 'Externe', 'Seconde extension']) {
      // One gesture: import then activation, each behind its native consent.
      await page.getByRole('button', { name: 'Importer un ZIP', exact: true }).click()
      await page.getByText('Module installé et activé.', { exact: true }).waitFor()
      await page.getByRole('dialog', { name }).waitFor()
      // Close through an ordinary route so the exact-URL bridges are exercised.
      await page.evaluate(() => window.next.router.push('/home'))
      await page.getByRole('link', { name: 'Marketplace', exact: true }).click()
    }
    await page.evaluate(() => window.next.router.push('/module?package=example.external&contribution=main'))
    await page.frameLocator('iframe[title="Module amber"]').getByText('Contribution externe : major', { exact: true }).waitFor()
    const add = command => page.evaluate(async command => { const snapshot = await window.api.composition.snapshot(); return window.api.composition.command({ command, expectedRevision: snapshot.value.revision, operationId: crypto.randomUUID() }) }, command)
    const widget = await add({ kind: 'widget.add', dashboardId: 'dash-home', contribution: { packageId: 'example.external', contributionId: 'widget' }, binding: { mode: 'none' }, config: {} })
    const minor = await add({ kind: 'project.add', projectId: 'p_alpha', contribution: { packageId: 'example.external', contributionId: 'minor' }, binding: { mode: 'none' }, config: {} })
    assert.equal(widget.ok, true); assert.equal(minor.ok, true)
    await page.evaluate(() => window.next.router.push('/dashboard?id=dash-home'))
    await page.frameLocator(`[data-placement="${widget.value.id}"] iframe`).getByText('Contribution externe : widget', { exact: true }).waitFor()
    await page.evaluate(() => window.next.router.push('/project?id=p_alpha'))
    await page.frameLocator('iframe[title="Module amber"]').getByText('Contribution externe : minor', { exact: true }).waitFor()
    await page.evaluate(() => window.next.router.push('/module?package=builtin.week&contribution=planner'))
    const planner = page.frameLocator('iframe[title="Module amber"]')
    await page.getByRole('heading', { name: 'Semaine type · Ambre', exact: true }).waitFor({ timeout: 20000 })
    const report = page.frameLocator('iframe[title="Bilan de la semaine"]')
    await report.getByRole('heading', { name: /Bilan de la semaine —/ }).waitFor().catch(async error => { console.error(await page.locator('iframe').evaluateAll(frames => frames.map(frame => ({ title: frame.title, src: frame.src })))); for (const frame of page.frames()) console.error('FRAME', frame.url(), (await frame.locator('body').innerText().catch(() => '')).slice(0, 1200)); throw error })
    await report.getByText('Total planifié : 270 minutes', { exact: true }).waitFor()
    await report.getByText('Sans projet : 120 minutes', { exact: true }).waitFor()
    await page.frameLocator('iframe[title="Seconde fonctionnalité"]').getByText('Seconde fonctionnalité : feature', { exact: true }).waitFor()
    assert.equal(await report.locator('body').evaluate(() => typeof window.api), 'undefined')
    assert.notEqual(await page.locator('iframe[title="Module amber"]').getAttribute('src'), await page.locator('iframe[title="Bilan de la semaine"]').getAttribute('src'))
    assert.equal(await planner.locator('body').evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 248, 235)')
    await planner.getByRole('button', { name: 'Gérer les semaines', exact: true }).click()
    await planner.locator('li').filter({ hasText: 'Semaine école' }).getByRole('button', { name: 'Consulter', exact: true }).click()
    await report.getByText('Total planifié : 510 minutes', { exact: true }).waitFor()
    await report.getByText('Projet manquant (p_deleted) : 60 minutes', { exact: true }).waitFor()
    const preference = await page.evaluate(() => window.api.core.command('preferences.update', { patch: { themeMode: 'dark' } }))
    assert.equal(preference.ok, true)
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
    await page.getByRole('heading', { name: 'Semaine type · Ambre', exact: true }).waitFor()
    assert.equal(await planner.locator('body').evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(33, 26, 17)')
    for (const id of ['p_alpha', 'p_beta', 'p_gamma']) assert.equal((await page.evaluate(id => window.api.core.command('projects.delete', { id }), id)).ok, true)
    await report.getByText('Projet manquant (p_alpha) : 150 minutes', { exact: true }).waitFor()
    await report.getByText('Total planifié : 510 minutes', { exact: true }).waitFor()
    const route = await page.evaluate(() => window.next.router.asPath)
    await page.getByRole('link', { name: 'Marketplace', exact: true }).click()
    await page.getByRole('button', { name: 'Importer un ZIP', exact: true }).click()
    await page.getByText('Module installé et activé.', { exact: true }).waitFor()
    const upgraded = await page.evaluate(() => window.api.packages.snapshot())
    assert.equal(upgraded.value.packages.find(item => item.id === 'example.second-feature').activeVersion, '1.1.0')

    for (const file of files) fs.unlinkSync(file)
    await close(); ({ app, page } = await launch({ PROJECT_TRACKER_MODULES: '1' })); page.setDefaultTimeout(15000)
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
    await page.evaluate(route => window.next.router.push(route), route)
    await page.frameLocator('iframe[title="Bilan de la semaine"]').getByText('Total planifié : 510 minutes', { exact: true }).waitFor()
    await page.frameLocator('iframe[title="Seconde fonctionnalité"]').getByText('Seconde fonctionnalité : feature', { exact: true }).waitFor()
  },
}
