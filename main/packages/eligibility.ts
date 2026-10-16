import satisfies from 'semver/functions/satisfies'
import { effectiveDependencies, type Manifest } from '../../shared/manifest'
import { CORE_VERSION, HOST_API_VERSION } from '../../shared/version'

export interface InstallIssue {
  code: 'HOST_INCOMPATIBLE' | 'DEPENDENCY_MISSING' | 'DEPENDENCY_INCOMPATIBLE' | 'DEPENDENCY_CYCLE' | 'DOWNGRADE' | 'STORAGE_DOWNGRADE'
  packageId: string
  dependency?: string
}

/** Evaluate a proposed replacement against locally active manifests only, never
 * against available ZIPs. Includes reverse dependants, so updates cannot silently
 * break an installed consumer. CORE is supplied by the host, never by a ZIP.
 * Eligibility is NOT authorization or evidence of runtime prevalidation.
 */
export function assessInstallation(candidate: Manifest, active: readonly Manifest[]): InstallIssue[] {
  const issues: InstallIssue[] = []
  const graph = new Map(active.map(manifest => [manifest.id, manifest]))
  const previous = graph.get(candidate.id)
  // semver's range comparison also handles prereleases conservatively.
  if (previous && !satisfies(candidate.version, `>=${previous.version}`, { includePrerelease: true })) issues.push({ code: 'DOWNGRADE', packageId: candidate.id })
  if (previous && candidate.storageVersion < previous.storageVersion) issues.push({ code: 'STORAGE_DOWNGRADE', packageId: candidate.id })
  graph.set(candidate.id, candidate)
  for (const manifest of graph.values()) {
    if (!satisfies(HOST_API_VERSION, manifest.hostApi)) issues.push({ code: 'HOST_INCOMPATIBLE', packageId: manifest.id })
    for (const [id, range] of Object.entries(effectiveDependencies(manifest))) {
      const version = id === 'core' ? CORE_VERSION : graph.get(id)?.version
      if (!version) issues.push({ code: 'DEPENDENCY_MISSING', packageId: manifest.id, dependency: id })
      else if (!satisfies(version, range)) issues.push({ code: 'DEPENDENCY_INCOMPATIBLE', packageId: manifest.id, dependency: id })
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string) {
    if (visited.has(id)) return
    visiting.add(id)
    const manifest = graph.get(id)
    for (const dependency of Object.keys(manifest ? effectiveDependencies(manifest) : {})) {
      if (visiting.has(dependency)) issues.push({ code: 'DEPENDENCY_CYCLE', packageId: id, dependency })
      else if (graph.has(dependency)) visit(dependency)
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
  return issues
}
