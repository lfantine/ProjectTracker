import type { Manifest, PackageManifest } from './manifest'
// Native-only callers use this projection to reuse the exact SDK sandbox and
// private migration namespace. It grants nothing beyond the original manifest.
export function extensionRuntime(manifest: Manifest): PackageManifest {
  if (manifest.kind === 'package') return manifest
  const { kind: _kind, extensionType: _type, target, ...base } = manifest
  const { features: _features, theme: _theme, ...common } = base as typeof base & { features?: unknown; theme?: unknown }
  return { ...common, kind: 'package', dependencies: { ...manifest.dependencies, [target.package]: target.version }, contributions: manifest.extensionType === 'features'
    ? manifest.features.map(item => ({ id: item.id, type: 'widget', name: item.name, entry: item.entry, size: { default: { w: 12, h: 6 } } }))
    : [{ id: 'theme-data', type: 'widget', name: manifest.name, entry: manifest.migrations?.entry ?? 'theme-validation.html', size: { default: { w: 1, h: 1 } } }] }
}
