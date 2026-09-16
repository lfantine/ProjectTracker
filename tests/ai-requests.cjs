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
const { buildAiContext, requestAiJson } = load('renderer/lib/aiCreation.ts')
const { groqErrorMessage } = load('main/groq.ts')
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
  assert.match(groqErrorMessage('missing field `choices`'), /motif exact/)
  console.log('AI context and error regression tests passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
