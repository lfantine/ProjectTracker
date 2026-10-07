const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync('renderer/lib/noteOperations.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const context = { exports: {}, require }
vm.runInNewContext(code, context)
const { removeNoteFromData } = context.exports
const data = {
  notes: [{ id: 'delete' }, { id: 'keep' }],
  projects: [
    { id: 'legacy', noteIds: ['delete', 'keep'] },
    { id: 'empty' },
    { id: 'modern', noteIds: ['delete'], layout: [
      { id: 'removed', type: 'note', refId: 'delete' },
      { id: 'kept', type: 'note', refId: 'keep' },
      { id: 'tasks', type: 'tasks' },
    ] },
  ],
  errors: [{ id: 'unrelated' }],
}
const original = structuredClone(data)
const result = removeNoteFromData(data, 'delete')
assert.deepEqual(result.notes.map(n => n.id), ['keep'])
assert.deepEqual(result.projects[0].noteIds, ['keep'])
assert.equal(result.projects[1].layout.length, 0)
assert.deepEqual(result.projects[2].layout.map(m => m.id), ['kept', 'tasks'])
assert.equal(result.errors, data.errors)
assert.deepEqual(data, original)
assert.equal(removeNoteFromData(result, 'delete').notes.length, 1)
console.log('Note deletion regression passed: legacy projects, pinned notes, retained content and repeated deletion')
