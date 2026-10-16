import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const created: string[] = []

// Every service test works in its own throwaway data directory under the
// system temp folder; the personal ~/.data directory is never involved.
export function makeTempDir(prefix = 'pt-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(dir)
  return dir
}

export function testEnv(dataDir = makeTempDir('pt-data-')): NodeJS.ProcessEnv {
  return {
    PROJECT_TRACKER_TEST: '1',
    PROJECT_TRACKER_DATA_DIR: dataDir,
    PROJECT_TRACKER_USER_DATA_DIR: makeTempDir('pt-profile-'),
  }
}

export const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url))

export function copyFixture(name: string, dataDir: string, target = 'data.json') {
  fs.copyFileSync(path.join(fixturesDir, 'legacy', name), path.join(dataDir, target))
}

export function cleanupTempDirs() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}
