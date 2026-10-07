const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {}, require }
  vm.runInNewContext(code, context)
  return context.exports
}
const { buildAiContext, requestAiJson, parseAiModules, buildLayoutFromAiModules } = load('renderer/lib/aiCreation.ts')
const { aiToolErrorMessage } = load('main/aiTool.ts')
async function main() {
  const data = { projects: [{ id: 'p1', name: 'Target', noteIds: ['n1'], tasks: [{ id: 't1', status: 'fait' }] }, { id: 'p2', name: 'Other', description: 'x'.repeat(100000), noteIds: [] }], notes: [{ id: 'n1', title: 'Linked', content: 'Keep complete', tags: [] }, { id: 'n2', title: 'Other', content: 'x'.repeat(100000), tags: [] }], errors: [] }
  const context = JSON.parse(buildAiContext(data, { action: 'edit', type: 'project', targetId: 'p1' }))
  assert.deepEqual(context.current, data.projects[0])
  assert.deepEqual(context.linkedNotes, [data.notes[0]])
  assert.equal(context.notes[1].id, 'n2')
  assert.ok(JSON.stringify(context).length < 1000)
  assert.equal(JSON.parse(buildAiContext(data, { action: 'create', type: 'project' })).current, null)
  let calls = 0
  await assert.rejects(requestAiJson('request', async () => { calls++; throw new Error('Provider failed') }, JSON.parse, () => {}), /Provider failed/)
  assert.equal(calls, 1)
  calls = 0
  const result = await requestAiJson('request', async () => ++calls === 1 ? 'bad json' : '{"ok":true}', JSON.parse, () => {})
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(requestAiJson('request', async () => { calls++; return 'invalid' }, JSON.parse, () => {}), /3 tentatives/)
  assert.equal(calls, 3)
  // Modules: every type is accepted, references and IDs are checked strictly.
  const known = { noteIds: ['n1'], errorIds: ['e1'], moduleIds: ['m_img', 'm_tasks'] }
  const specs = parseAiModules([
    { id: 'm_tasks', type: 'tasks' }, { type: 'deadlines' }, { type: 'stack' },
    { id: 'm_img', type: 'image', title: 'Nouveau titre' },
    { type: 'chart', title: 'Ventes', chart: { kind: 'line', points: [{ label: 'Jan', value: 3 }, { label: 'Fév', value: '4,5' }] } },
    { type: 'note', refId: 'n1' }, { type: 'error', refId: 'e1' },
  ], known)
  assert.equal(specs.length, 7)
  assert.deepEqual([...specs[4].chart.points.map((p) => p.value)], ['3', '4.5'])
  for (const bad of [[{ type: 'video' }], [{ type: 'note', refId: 'missing' }], [{ type: 'stack' }, { type: 'stack' }], [{ id: 'ghost', type: 'tasks' }], [{ type: 'image', imageUrl: 'javascript:x' }], [{ type: 'chart', chart: { kind: 'pie', points: [] } }], [{ type: 'chart', chart: { points: [{ label: 'a', value: 'abc' }] } }]]) {
    assert.throws(() => parseAiModules(bad, known))
  }
  // Retained modules keep their ID and untouched fields; removed ones disappear.
  let n = 0
  const layout = buildLayoutFromAiModules(specs, [{ id: 'm_img', type: 'image', imageUrl: 'https://x/y.png', text: 'garder' }, { id: 'm_tasks', type: 'tasks' }, { id: 'm_old', type: 'stack' }], () => `new_${++n}`)
  assert.deepEqual({ ...layout[3] }, { id: 'm_img', type: 'image', imageUrl: 'https://x/y.png', text: 'garder', title: 'Nouveau titre' })
  assert.equal(layout[0].id, 'm_tasks')
  assert.ok(!layout.some((m) => m.id === 'm_old'))
  assert.equal(new Set(layout.map((m) => m.id)).size, layout.length)
  assert.match(aiToolErrorMessage('groqtool', 'missing field `choices`'), /motif exact/)
  console.log('AI context and error regression tests passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
