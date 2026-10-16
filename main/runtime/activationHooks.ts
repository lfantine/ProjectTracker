import { extensionRuntime } from '../../shared/extensions'
import { validateTheme } from '../extensions/engine'
import type { Database } from '../db/database'
import type { ActivationHooks } from '../packages/activation'
import type { ContextRegistry } from './contexts'
import { prevalidatePackage } from './prevalidation'
import { runMigrationSandbox } from './migrationSandbox'

export interface TrustedRuntimeAssets { hostBundle: string; bootstrapBundle: string; preloadPath: string }
// Native adapters only. Assets are compiled host code, never package sources.
export function runtimeActivationHooks(db: Database, contexts: ContextRegistry, assets: TrustedRuntimeAssets,
  confirm: ActivationHooks['confirm'], changed: ActivationHooks['changed']): ActivationHooks {
  return {
    confirm, changed,
    suspendPackage: id => contexts.suspendPackage(id),
    revokePackage: id => contexts.revokePackage(id),
    async prevalidate(version, signal) {
      if (version.manifest.kind === 'extension' && version.manifest.extensionType === 'theme') { validateTheme(version); return }
      await prevalidatePackage({ ...assets, featureMode: version.manifest.kind === 'extension', manifest: extensionRuntime(version.manifest), root: version.root, files: version.files, signal })
    },
    async migrate(version, snapshot, signal) {
      return runMigrationSandbox(db, { ...assets, manifest: extensionRuntime(version.manifest), root: version.root, files: version.files, snapshot, signal })
    },
  }
}
