import assert from 'node:assert/strict'
export const scenarios = {
  async 'marketplace natif sans projet et pont renouvelé après navigation'({ launch }) {
    const { page, app } = await launch({ PROJECT_TRACKER_MODULES: '1' })
    page.setDefaultTimeout(12000)
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30000 })
    await page.getByRole('link', { name: 'Marketplace', exact: true }).click()
    const installed = page.getByRole('region', { name: 'Installés', exact: true })
    const card = installed.getByRole('button', { name: 'Détails de Semaine type', exact: true })
    await card.waitFor()
    const artwork = installed.getByRole('listitem').filter({ has: card }).locator('img')
    await artwork.evaluate(image => image.decode())
    assert.deepEqual(await artwork.evaluate(image => [image.naturalWidth, image.naturalHeight]), [512, 512])
    assert.match(await artwork.getAttribute('src'), /^data:image\/png;base64,/)
    await card.click()
    await page.getByRole('heading', { name: 'Accès demandés', exact: true }).waitFor()
    await page.getByText('builtin.week', { exact: true }).waitFor({ state: 'attached' })
    // Exercise the real native stop hook after bootstrap. Cancel it without
    // presenting or accepting a dialog on the user's desktop.
    await app.evaluate(({ dialog }) => {
      globalThis.__amberStopOptions = null
      dialog.showMessageBox = async (_window, options) => { globalThis.__amberStopOptions = options; return { response: 0, checkboxChecked: false } }
    })
    await page.getByRole('button', { name: 'Désactiver', exact: true }).click()
    await page.getByText('Opération de package indisponible ou annulée.', { exact: true }).waitFor()
    const consent = await app.evaluate(() => ({ defaultId: globalThis.__amberStopOptions?.defaultId, cancelId: globalThis.__amberStopOptions?.cancelId, buttons: globalThis.__amberStopOptions?.buttons }))
    assert.equal(consent.defaultId, 0); assert.equal(consent.cancelId, 0)
    assert.equal(consent.buttons[0], 'Annuler')
    const cancelled = await page.evaluate(() => window.api.packages.snapshot())
    assert.equal(cancelled.value.packages.find(item => item.id === 'builtin.week').state, 'active')
    await page.getByRole('dialog').getByRole('link', { name: 'Ouvrir', exact: true }).click()
    await page.frameLocator('iframe[title="Module amber"]').getByRole('button', { name: 'Gérer les semaines', exact: true }).waitFor({ timeout: 20000 })
    const denied = await page.frameLocator('iframe[title="Module amber"]').locator('body').evaluate(() => typeof window.api)
    assert.equal(denied, 'undefined')
    await page.getByRole('link', { name: 'Marketplace', exact: true }).click()
    const snapshot = await page.evaluate(() => window.api.packages.snapshot())
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.value.phase, 'ready')
    assert.ok(snapshot.value.details.some(item => item.manifest.id === 'builtin.week'))
    assert.equal(snapshot.value.packages.find(item => item.id === 'builtin.week').state, 'active')
    await page.evaluate(() => window.next.router.push('/customize'))
    const settingsCard = page.getByRole('button', { name: /Semaine type.*Options/ })
    await settingsCard.locator('img').evaluate(image => image.decode())
    assert.equal(await settingsCard.locator('img').evaluate(image => image.naturalWidth), 512)
    await page.screenshot({ path: '/tmp/amber-package-logo-customize.png' })
    await page.getByRole('link', { name: 'Marketplace', exact: true }).click()
    await page.getByRole('tab', { name: 'Modules intégrés', exact: true }).click()
    await page.getByPlaceholder('Rechercher un module…').waitFor()
    assert.ok((await page.locator('body').innerText()).includes('projets'))
  },
}
