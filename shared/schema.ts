import { z } from 'zod'
import { manifestSchema } from './manifest'

// Structural JSON Schema of manifest.json, published for package authors.
// Cross-field rules (associations, dependencies, paths, origins) are enforced
// by validateManifest() and documented in docs/packages/FORMAT.md.
export function manifestJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(manifestSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return {
    $id: 'https://projecttracker.local/schema/manifest-v1.json',
    title: 'ProjectTracker package manifest v1',
    ...schema,
  }
}
