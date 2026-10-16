import { z } from 'zod'
const name = z.string().min(1).max(128)
export const migrationEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('document'), collection: name, id: name, instanceScope: z.string().max(128), value: z.json() }),
  z.strictObject({ kind: z.literal('instance'), majorId: name, instanceId: name, name: z.string().min(1).max(80), position: z.number().int().nonnegative(), active: z.boolean() }),
  z.strictObject({ kind: z.literal('config'), owner: z.enum(['project', 'dashboard']), ownerId: name, placementId: name, contributionId: name, version: z.number().int().positive(), value: z.record(z.string(), z.json()) }),
])
export type MigrationEntry = z.infer<typeof migrationEntrySchema>
export interface MigrationSnapshot { fromVersion: number; toVersion: number; entries: MigrationEntry[] }
export const migrationSchemas = {
  'migration.read': z.strictObject({ cursor: z.string().regex(/^\d{1,8}$/).optional(), limit: z.number().int().min(1).max(200).optional() }),
  'migration.write': z.strictObject({ entry: migrationEntrySchema }),
  'migration.delete': z.strictObject({ entry: migrationEntrySchema }),
  'migration.complete': z.strictObject({}),
  'migration.fail': z.strictObject({}),
}
