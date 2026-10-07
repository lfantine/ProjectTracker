const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

// Inspect the real dialog's element identities, without a DOM or persistence calls.
const page = fs.readFileSync('renderer/pages/project.tsx', 'utf8')
const dialogSource = page.slice(page.indexOf('function TaskDetailModal('))
function loadDialog(source) {
  const code = ts.transpileModule(`
    import React, { useState, useEffect } from 'react'
    import { TASK_STATUS_LABEL, statusTone } from './constants'
    import { Modal, Input, Textarea, PrimaryButton, StatusPill, Switch, Markdown, ChevronRightIcon, TrashIcon } from './components'
    ${source}
    export { TaskDetailModal }
  `, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017, esModuleInterop: true } }).outputText
  const context = { exports: {}, require: (id) => {
    if (id === 'react') return { ...React, useState: (value) => [value, () => {}], useEffect: () => {} }
    if (id === './constants') return { TASK_STATUS_LABEL: { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' }, statusTone: () => 'neutral' }
    if (id === './components') return Object.fromEntries(['Modal', 'Input', 'Textarea', 'PrimaryButton', 'StatusPill', 'Switch', 'Markdown', 'ChevronRightIcon', 'TrashIcon'].map((name) => [name, name]))
    return require(id)
  } }
  vm.runInNewContext(code, context)
  return context.exports.TaskDetailModal
}
function assertUniqueSiblingKeys(element) {
  if (!React.isValidElement(element)) return
  const children = [element.props.children].flat(Infinity).filter(React.isValidElement)
  const keys = new Set()
  for (const child of children) {
    if (child.key !== null) {
      assert.ok(!keys.has(child.key), `Duplicate sibling key: ${child.key}`)
      keys.add(child.key)
    }
    assertUniqueSiblingKeys(child)
  }
}
const noop = () => {}
const props = { task: { id: 'task-1', name: 'Unique title', content: 'Preserved description', status: 'a_faire', children: [] }, ancestors: [], onClose: noop, onOpenChild: noop, onBreadcrumbClick: noop, onUpdate: noop, onAddSub: noop, onRemove: noop }
const Dialog = loadDialog(dialogSource)
for (const status of ['a_faire', 'en_cours', 'fait']) {
  const element = Dialog({ ...props, task: { ...props.task, status } })
  assertUniqueSiblingKeys(element)
  const fields = element.props.children.filter(React.isValidElement)
  assert.equal(fields.filter(field => field.props['aria-label'] === 'Titre de la tâche').length, 1)
  assert.equal(fields.filter(field => field.props['aria-label'] === 'Description de la tâche').length, 1)
}
// The regression test must reject the original collision, not merely render the data.
const broken = dialogSource.replace('<input\n', '<input key={task.id}\n').replace('<Textarea\n', '<Textarea key={task.id}\n')
assert.throws(() => assertUniqueSiblingKeys(loadDialog(broken)(props)), /Duplicate sibling key/)
const parsedPage = ts.createSourceFile('project.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let stableBoundary = false
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsedPage) === 'TaskDetailModal') {
    const key = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(parsedPage) === 'key')
    stableBoundary = key?.initializer && ts.isJsxExpression(key.initializer) && key.initializer.expression?.getText(parsedPage) === 'selectedTask.id'
  }
  ts.forEachChild(node, visit)
}
visit(parsedPage)
assert.ok(stableBoundary, 'Reset the dialog only when navigating to a different task.')
console.log('Task dialog identity regression passed: unique sibling keys and stable task boundary; original collision rejected')
