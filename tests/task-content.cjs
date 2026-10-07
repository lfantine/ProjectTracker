const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename)
  }
}
const { updateTaskNode, flattenTasks } = require('../renderer/lib/helpers.ts')
const { TaskTree } = require('../renderer/components/TaskTree.tsx')
const { TaskKanban } = require('../renderer/components/TaskKanban.tsx')
const { parseAiErrorDraft } = require('../renderer/lib/aiCreation.ts')
const child = { id: 'child', name: 'Corriger le formulaire', content: '## Étapes\nTester la saisie', status: 'en_cours', children: [] }
let tasks = [{ id: 'parent', name: 'Authentification', content: '', status: 'a_faire', children: [child, { id: 'done', name: 'Diagnostic', content: '', status: 'fait', children: [] }] }]
const original = structuredClone(tasks)
for (let i = 0; i < 10; i++) {
  tasks = updateTaskNode(tasks, 'child', (task) => ({ ...task, content: child.content }))
  tasks = updateTaskNode(tasks, 'child', (task) => ({ ...task, status: i % 2 ? 'en_cours' : 'a_faire' }))
}
assert.equal(flattenTasks(tasks).length, 3)
assert.equal(tasks[0].children[0].content, child.content)
assert.deepEqual(original[0].children[0], child)
const noop = () => {}
const tree = renderToStaticMarkup(React.createElement(TaskTree, { tasks, onAddTop: noop, onAddSub: noop, onCycleStatus: noop, onRemove: noop, onOpenDetail: noop }))
assert.match(tree, /1\/2 sous-tâches terminées/)
assert.match(tree, /aria-expanded="true"/)
assert.equal((tree.match(/Corriger le formulaire/g) || []).length, 2) // label and delete accessibility label
const kanban = renderToStaticMarkup(React.createElement(TaskKanban, { tasks, visibleStatuses: ['en_cours'], onSetStatus: noop, onOpenDetail: noop }))
assert.match(kanban, /title="Authentification"/)
assert.match(kanban, /Corriger le formulaire/)
assert.doesNotMatch(kanban, /Diagnostic/)
const empty = renderToStaticMarkup(React.createElement(TaskKanban, { tasks, visibleStatuses: [], onSetStatus: noop }))
assert.match(empty, /Aucun statut sélectionné/)
const draft = { title: 'Erreur API', content: 'Erreur 500', causes: 'Hypothèse à vérifier', solution: 'Consulter les logs' }
assert.deepEqual(parseAiErrorDraft('```json\n' + JSON.stringify(draft) + '\n```'), draft)
for (const invalid of ['null', '[]', '{}', '{"title":"   ","content":"","causes":"","solution":""}', '{"title":"Erreur","content":42,"causes":"","solution":""}']) assert.throws(() => parseAiErrorDraft(invalid))
console.log('Task content, hierarchy rendering and AI error validation regression tests passed')
