import { afterAll } from 'vitest'
import { cleanupTempDirs } from './helpers'

// Services must be validated against Electron's embedded Node (and its SQLite),
// never against whichever Node happens to be installed on the machine.
if (!process.versions.electron) {
  throw new Error('Les tests de services doivent être lancés avec Electron en mode Node (npm run test:services).')
}
process.env.PROJECT_TRACKER_TEST = '1'
afterAll(cleanupTempDirs)
