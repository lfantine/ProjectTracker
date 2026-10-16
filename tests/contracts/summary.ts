import fs from 'node:fs'
import path from 'node:path'
import { effectiveDependencies, referencedFiles, validateManifest } from '../../shared/manifest'
import { normalizePermissions } from '../../shared/permissions'

// Tests and scripts run from the repository root.
export const root = path.resolve('tests/fixtures/manifests')
export const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
export const validFiles = fs.readdirSync(path.join(root, 'valid')).sort()
export const invalidFiles = fs.readdirSync(path.join(root, 'invalid')).filter((file) => !file.startsWith('_')).sort()
export const expectedPaths: Record<string, string> = read('invalid/_expected-paths.json')

// Environment-independent summary of every validation. Both test environments
// (jsdom and Electron in Node mode) must produce exactly this document.
export function validationSummary() {
  const summary: Record<string, unknown> = {}
  for (const file of validFiles) {
    const result = validateManifest(read(`valid/${file}`))
    summary[`valid/${file}`] = result.ok
      ? { ok: true, files: referencedFiles(result.manifest), dependencies: effectiveDependencies(result.manifest), permissions: normalizePermissions(result.manifest.permissions) }
      : result
  }
  for (const file of invalidFiles) summary[`invalid/${file}`] = validateManifest(read(`invalid/${file}`))
  return JSON.parse(JSON.stringify(summary))
}

