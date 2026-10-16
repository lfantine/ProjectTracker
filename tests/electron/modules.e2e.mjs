import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const scenarios = {
  async 'package livré dans le vrai shell confiné et route statique'({ launch, dataDir, fixtures, close }) {
    fs.copyFileSync(path.join(fixtures, 'legacy', 'full-current', 'data.json'), path.join(dataDir, 'data.json'))
    let { page } = await launch({ PROJECT_TRACKER_MODULES: '1' })
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30_000 })
    assert.ok(page.url().startsWith('app://shell/'))
    const snapshot = await page.evaluate(() => window.api.core.snapshot())
    assert.equal(snapshot.ok, true)
    for (const key of ['weekPresets', 'activeWeekPresetId', 'weekSlots', 'wakeTimes']) assert.equal(key in snapshot.value.data, false)
    // Use the real static router, not loadURL (full navigation is confined).
    await page.evaluate(() => window.next.router.push('/module?package=builtin.week&contribution=planner'))
    const frame = page.frameLocator('iframe[title="Module amber"]')
    await frame.getByRole('button', { name: 'Gérer les semaines' }).waitFor({ timeout: 20_000 })
    assert.equal(await frame.locator('body').evaluate(() => typeof window.api), 'undefined')
    assert.equal(await frame.locator('body').evaluate(() => typeof window.require), 'undefined')
    assert.ok(await page.locator('iframe').getAttribute('src').then(url => url.startsWith('pt-plugin://ctx-')))
    const initialOrigin = await page.locator('iframe').getAttribute('src')
    await frame.getByRole('button', { name: 'Gérer les semaines', exact: true }).click()
    const selected = frame.locator('li').filter({ hasText: '· consultée' })
    await selected.getByLabel('Nouveau nom').fill('Semaine renommée dans le shell')
    await selected.getByRole('button', { name: 'Renommer', exact: true }).click()
    await frame.getByRole('button', { name: 'Gérer les semaines', exact: true }).waitFor({ timeout: 15_000 })
    assert.notEqual(await page.locator('iframe').getAttribute('src'), initialOrigin, 'renommer remonte un contexte neuf')
    const denied = await page.evaluate(async () => [
      await window.api.core.command('week.rename', { name: 'INTERDIT' }),
      await window.api.core.command('core.batch', { steps: [{ name: 'week.rename', params: { name: 'INTERDIT' } }], operationId: 'forged-week' }),
    ])
    assert.ok(denied.every(result => result.ok === false))
    const descriptor = await page.evaluate(() => window.api.modules.open({ kind: 'major', major: { packageId: 'builtin.week', contributionId: 'planner' }, permissions: {} }))
    assert.equal(descriptor.status, 'unavailable', 'les champs d’autorité renderer doivent être refusés')
    await frame.getByRole('button', { name: 'Gérer les semaines', exact: true }).click()
    await frame.getByLabel('Nom de la nouvelle semaine', { exact: true }).fill('Copie fixe shell')
    await frame.getByRole('button', { name: 'Dupliquer la semaine consultée', exact: true }).click()
    await frame.locator('li').filter({ hasText: 'Copie fixe shell' }).getByRole('button', { name: 'Consulter', exact: true }).click()
    await page.waitForURL(url => url.searchParams.has('instance'))
    await frame.getByRole('button', { name: 'Gérer les semaines', exact: true }).waitFor({ timeout: 15_000 })
    const fixedId = new URL(page.url()).searchParams.get('instance')
    const added = await page.evaluate(async instanceId => window.api.core.command('blocks.add', { projectId: 'p_alpha', block: {
      id: 'shell-week-minor', type: 'external', contribution: { packageId: 'builtin.week', contributionId: 'project-slots' },
      binding: { mode: 'fixed', major: { packageId: 'builtin.week', contributionId: 'planner' }, instanceId }, config: {},
    } }), fixedId)
    assert.equal(added.ok, true)
    await page.evaluate(() => window.next.router.push('/project?id=p_alpha'))
    await page.frameLocator('iframe[title="Module amber"]').getByRole('heading', { name: 'Créneaux du projet', exact: true }).waitFor({ timeout: 15_000 })
    await page.evaluate(() => window.next.router.push('/dashboard'))
    await page.frameLocator('iframe[title="Module amber"]').getByText('Planning du jour', { exact: true }).first().waitFor({ timeout: 10_000 })
    await close()
    ;({ page } = await launch({ PROJECT_TRACKER_MODULES: '1' }))
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30_000 })
    await page.evaluate(() => window.next.router.push('/module?package=builtin.week&contribution=planner'))
    await page.frameLocator('iframe[title="Module amber"]').getByRole('button', { name: 'Gérer les semaines' }).waitFor({ timeout: 20_000 })
  },
}
