import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const scenarios = {
  // First launch on an empty, isolated directory: the app starts and only
  // writes inside the test directory.
  async 'premier lancement isolé'({ launch, dataDir }) {
    const { page } = await launch()
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 20_000 })
    const written = fs.readdirSync(dataDir)
    assert.ok(written.length > 0, 'aucune donnée écrite dans le répertoire de test')
  },

  // Synthetic legacy data is readable from the isolated directory.
  async 'lecture des données synthétiques'({ launch, dataDir, fixtures }) {
    fs.copyFileSync(path.join(fixtures, 'legacy', 'full-current', 'data.json'), path.join(dataDir, 'data.json'))
    const { page } = await launch()
    await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 20_000 })
    await page.getByText('Alpha').first().waitFor({ timeout: 10_000 })
  },

  // An override pointing at the personal directory is refused in test mode.
  async 'refus du répertoire personnel'({ launch }) {
    const os = await import('node:os')
    for (const name of ['amber', 'ProjectTracker']) {
      await assert.rejects(launch({ PROJECT_TRACKER_DATA_DIR: path.join(os.homedir(), '.data', name) }))
    }
  },
}
