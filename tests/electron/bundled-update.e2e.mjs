import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { ZipFile } from 'yazl'

async function scenario(oldVersion, { root, dataDir, fixtures, launch, close }) {
    fs.copyFileSync(path.join(fixtures, 'legacy/full-current/data.json'), path.join(dataDir, 'data.json'))
    // First migrate synthetic legacy data with the non-module test shell.
    let { page } = await launch()
    await page.getByText('Projets actifs', { exact: true }).waitFor()
    await close()
    // A genuine old managed artifact, not forged registry rows. This fixture's
    // empty UI is seeded offline with test hooks; the NEW delivered artifact is
    // subsequently validated/activated by the real confined runtime at startup.
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/builtin-week/manifest.json'), 'utf8'))
    manifest.version = oldVersion
    delete manifest.logo // Old delivered archives did not declare a logo.
    const zip = new ZipFile(), chunks = []
    const done = new Promise((resolve, reject) => {
      zip.outputStream.on('data', chunk => chunks.push(chunk))
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
      zip.outputStream.on('error', reject)
    })
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
    for (const contribution of manifest.contributions) zip.addBuffer(Buffer.from('<!doctype html><html><body>Ancienne UI de test</body></html>'), contribution.entry)
    zip.end()
    const archive = path.join(dataDir, 'old-week.zip')
    fs.writeFileSync(archive, await done)
    const helper = path.join(dataDir, 'seed-old-week.cjs')
    await build({ absWorkingDir: root, stdin: { contents: `
      import path from 'node:path';
      import { openDatabase } from './main/db/database';
      import { prepareArchive } from './main/packages/archive';
      import { LocalPackageInstaller } from './main/packages/installer';
      import { PackageSourceImports } from './main/packages/sourceImports';
      import { PackageSources } from './main/packages/sources';
      import { PackageActivation } from './main/packages/activation';
      import { isolatedActivationHooks } from './tests/services/package-fixtures';
      (async () => {
        const [directory, archive] = process.argv.slice(2);
        const db = await openDatabase(path.join(directory, 'tracker.sqlite'));
        const prepared = await prepareArchive(archive, path.join(directory, 'stage'));
        try {
          const root = path.join(directory, 'packages');
          const installer = new LocalPackageInstaller(db, root, async () => true);
          await new PackageSourceImports(db, installer, new PackageSources(db), [{ key: 'old', path: archive, packageId: 'builtin.week', version: '${oldVersion}', contentSha256: prepared.contentSha256 }]).importBundled('old');
          await new PackageActivation(db, root, isolatedActivationHooks(), true).activate('builtin.week', '${oldVersion}');
          console.log(JSON.stringify({ documents: db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id'), instances: db.all('SELECT * FROM major_instances ORDER BY instance_id') }));
        } finally { await prepared.dispose(); db.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1 });
    `, resolveDir: root, sourcefile: 'seed-old-week.ts', loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: helper, logLevel: 'silent' })
    const seeded = spawnSync(createRequire(import.meta.url)('electron'), [helper, dataDir, archive], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROJECT_TRACKER_TEST: '1' }, encoding: 'utf8', timeout: 30000,
    })
    assert.equal(seeded.status, 0, seeded.stderr)
    const before = JSON.parse(seeded.stdout.trim())
    fs.unlinkSync(archive); fs.unlinkSync(helper)
    const { page: upgradedPage, app } = await launch({ PROJECT_TRACKER_MODULES: '1' }); page = upgradedPage
    await page.getByText('Projets actifs', { exact: true }).waitFor()
    const packages = (await page.evaluate(() => window.api.packages.snapshot())).value.packages
    assert.equal(packages.find(item => item.id === 'builtin.week').activeVersion, '1.1.2')
    await page.evaluate(() => window.next.router.push('/week'))
    await page.frameLocator('iframe').first().getByRole('button', { name: 'Gérer les semaines', exact: true }).waitFor()
    const after = await app.evaluate((_, file) => {
      const db = new (process.getBuiltinModule('node:sqlite').DatabaseSync)(file, { readOnly: true })
      try { return { documents: db.prepare('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id').all(), instances: db.prepare('SELECT * FROM major_instances ORDER BY instance_id').all() } }
      finally { db.close() }
    }, path.join(dataDir, 'tracker.sqlite'))
    assert.deepEqual(after, before)
}
export const scenarios = Object.fromEntries(['1.0.0', '1.1.0', '1.1.1'].map(version => [`mise à jour UI livrée ${version} vers 1.1.2 sans réécriture des semaines`, options => scenario(version, options)]))
