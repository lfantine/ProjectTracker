const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename)
const { syncTaskStatuses } = require('../renderer/lib/taskStatus.ts')
const { normalizeAppData } = require('../renderer/lib/types.ts')
const { updateTaskNode, addTaskNode, removeTaskNode, extractTaskNode, insertTaskNode } = require('../renderer/lib/helpers.ts')
const leaf = (id, status) => ({ id, name: id, status, content: '', children: [] })
const parent = (children) => ({ ...leaf('parent', 'a_faire'), children })
for (const [statuses, expected] of [
  [['a_faire', 'a_faire'], 'a_faire'],
  [['en_cours', 'a_faire'], 'en_cours'],
  [['en_cours', 'fait'], 'en_cours'],
  [['fait', 'fait'], 'fait'],
  [['fait', 'a_faire'], 'en_cours'],
]) {
  const tasks = [parent(statuses.map((status, i) => leaf(String(i), status)))]
  const original = structuredClone(tasks)
  const synced = syncTaskStatuses(tasks)
  assert.equal(synced[0].status, expected)
  assert.deepEqual(tasks, original)
  assert.equal(syncTaskStatuses(synced), synced)
}
for (const status of ['a_faire', 'en_cours', 'fait']) assert.equal(syncTaskStatuses([leaf('leaf', status)])[0].status, status)
let tasks = syncTaskStatuses([parent([{ ...leaf('nested', 'a_faire'), children: [leaf('child', 'en_cours')] }])])
assert.equal(tasks[0].status, 'en_cours')
assert.equal(tasks[0].children[0].status, 'en_cours')
tasks = syncTaskStatuses(updateTaskNode(tasks, 'child', (task) => ({ ...task, status: 'fait' })))
assert.equal(tasks[0].status, 'fait')
assert.equal(tasks[0].children[0].status, 'fait')
tasks = syncTaskStatuses(addTaskNode(tasks, 'parent', leaf('new', 'a_faire')))
assert.equal(tasks[0].status, 'en_cours')
tasks = syncTaskStatuses(removeTaskNode(tasks, 'new'))
assert.equal(tasks[0].status, 'fait')
tasks = syncTaskStatuses(updateTaskNode(tasks, 'parent', (task) => ({ ...task, status: 'a_faire' })))
assert.equal(tasks[0].status, 'fait')
const beforeMove = [parent([leaf('moving', 'en_cours'), leaf('remaining', 'a_faire')]), leaf('target', 'fait')]
const { node, rest } = extractTaskNode(beforeMove, 'moving')
const moved = syncTaskStatuses(insertTaskNode(rest, 'target', node, 'inside'))
assert.equal(moved[0].status, 'a_faire')
assert.equal(moved[1].status, 'en_cours')
assert.equal(normalizeAppData({ projects: beforeMove }).projects[0].tasks.length, 0)
assert.equal(normalizeAppData({ projects: [{ tasks: beforeMove }] }).projects[0].tasks[0].status, 'en_cours')
console.log('Automatic task status tests passed: leaf status, mixed children, nested propagation, add/remove, move, load and manual override')
