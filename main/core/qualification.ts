import { isQualifiedRelease } from './release'
import type { CoreRuntime } from './startup'
import { startCore } from './startup'
import { defaultDataDir, physicalPath, type DataPaths } from '../helpers/paths'

// Lot 8 must explicitly change this only after the distribution and recovery
// matrix has passed. Development and validation use an isolated data override.
export const PERSONAL_SQLITE_MIGRATION_QUALIFIED = true

export async function startQualifiedCore(paths: DataPaths): Promise<CoreRuntime> {
  if ((!PERSONAL_SQLITE_MIGRATION_QUALIFIED || !isQualifiedRelease()) && physicalPath(paths.root) === physicalPath(defaultDataDir())) {
    return {
      paths,
      status: { mode: 'recovery', reason: 'migration-not-qualified', message: 'Cette version de développement n’est pas encore qualifiée pour migrer tes données personnelles. Les fichiers existants sont conservés.', reportId: null },
      service: null,
      lastReport: null,
      close() {},
    }
  }
  return startCore(paths)
}
