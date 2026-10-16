require('tsx/cjs')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const [root, source, phase] = process.argv.slice(2)
for (const target of [root, source]) {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(target))
  if (process.env.PROJECT_TRACKER_TEST !== '1' || !relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Temporary data required')
}
const { resolveDataPaths } = require('../../main/helpers/paths.ts')
const { restoreRecoveryBackup } = require('../../main/core/recovery.ts')
restoreRecoveryBackup(resolveDataPaths({ PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_DATA_DIR: root }), source, checkpoint => {
  if (checkpoint === phase) process.kill(process.pid, 'SIGKILL')
}).catch(error => { console.error(error); process.exitCode = 1 })
