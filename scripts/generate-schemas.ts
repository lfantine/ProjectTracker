import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { manifestJsonSchema } from '../shared/schema'

const target = fileURLToPath(new URL('../shared/schema/manifest.schema.json', import.meta.url))
fs.writeFileSync(target, JSON.stringify(manifestJsonSchema(), null, 2) + '\n')
console.log(`Schéma écrit : ${target}`)
