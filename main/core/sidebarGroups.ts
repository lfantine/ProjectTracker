import { z } from 'zod'
import type { Database } from '../db/database'
const schema = z.object({ groups: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80), collapsed: z.boolean() }).strict()).max(25), membership: z.record(z.string().max(128), z.string().uuid()) }).strict()
export type SidebarOrganization = z.infer<typeof schema>
// Host-owned presentation preference. No schema migration or business-data rewrite.
export function readSidebarOrganization(db: Database): SidebarOrganization {
  const row = db.get<{ value_json: string }>("SELECT value_json FROM preferences WHERE key = 'sidebar-organization'")
  if (!row) return { groups: [], membership: {} }
  return schema.parse(JSON.parse(row.value_json))
}
export function writeSidebarOrganization(db: Database, value: SidebarOrganization): void {
  const checked = schema.parse(value)
  db.run("INSERT INTO preferences (key, value_json, updated_at) VALUES ('sidebar-organization', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, revision = preferences.revision + 1, updated_at = excluded.updated_at", JSON.stringify(checked), new Date().toISOString())
}
