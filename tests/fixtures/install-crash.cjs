// Deliberately SIGKILL this throwaway worker at real installer/SQLite boundaries.
// Never loaded by the application, never accepts a personal data directory.
require('tsx/cjs')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const [root, mode] = process.argv.slice(2)
const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root))
if (process.env.PROJECT_TRACKER_TEST !== '1' || !relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Temporary test data required')
const kill = () => process.kill(process.pid, 'SIGKILL')
if (mode === 'import-moved') {
  const promises = require('node:fs/promises'), rename = promises.rename
  promises.rename = async (...args) => { const value = await rename(...args); kill(); return value }
}
const { openDatabase } = require('../../main/db/database.ts')
const { LocalPackageInstaller } = require('../../main/packages/installer.ts')
const { PackageActivation } = require('../../main/packages/activation.ts')
;(async () => {
  const db = await openDatabase(path.join(root, 'tracker.sqlite'))
  const run = db.run.bind(db)
  db.run = (sql, ...args) => {
    const result = run(sql, ...args)
    if (mode === 'import-prepared' && sql.includes("'import-inactive'") && sql.includes('INSERT INTO install_journal')) kill()
    if (mode === 'import-transaction' && sql.includes('INSERT INTO package_versions')) kill()
    if (mode === 'activation-transaction' && sql.includes('UPDATE packages SET name')) kill()
    return result
  }
  if (mode === 'import-committed') {
    const transaction = db.transaction.bind(db)
    db.transaction = action => { const result = transaction(action); kill(); return result }
  }
  if (mode.startsWith('import-')) {
    const installer = new LocalPackageInstaller(db, path.join(root, 'packages'), async () => { if (mode === 'import-extracted') kill(); return true })
    await installer.importArchive(path.join(root, '1.1.0.zip'))
  } else {
    const hooks = { confirm: async () => true, prevalidate: async () => {}, suspendPackage: () => () => {}, revokePackage: () => {},
      migrate: async (_version, snapshot) => {
        if (mode === 'activation-migration') kill()
        for (const entry of snapshot.entries) if (entry.kind === 'document') entry.value = { migrated: true }
        return snapshot
      }, changed: () => { if (mode === 'activation-committed') kill() } }
    await new PackageActivation(db, path.join(root, 'packages'), hooks, true).activate('example.boards', '1.1.0')
  }
  db.close()
  throw Error('Crash boundary was not reached')
})().catch(error => { console.error(error); process.exitCode = 1 })
