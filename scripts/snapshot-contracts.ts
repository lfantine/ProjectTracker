// Regenerates tests/fixtures/manifests/_expected-validation.json after an
// intentional contract change. Review the diff before committing it.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validationSummary } from '../tests/contracts/summary'

const target = fileURLToPath(new URL('../tests/fixtures/manifests/_expected-validation.json', import.meta.url))
fs.writeFileSync(target, JSON.stringify(validationSummary(), null, 2) + '\n')
console.log(`Résumé écrit : ${target}`)
