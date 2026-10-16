import { isDeepStrictEqual } from 'node:util'
import { normalizePermissions, type PermissionSet } from '../../shared/permissions'
// One explicit, same-storage/same-rights update of our delivered builtin only.
// Never resurrect disabled/uninstalled packages or overwrite archive/folder code.
export function canUpdateDeliveredWeek(current: { state: string; origin: string; active_version: string | null; storage_version: number; granted_permissions_json: string } | undefined, deliveredVersion: string): boolean {
  if (!current || current.state !== 'active' || current.origin !== 'bundled' || !['1.0.0', '1.1.0', '1.1.1'].includes(current.active_version ?? '') || current.storage_version !== 1 || deliveredVersion !== '1.1.2') return false
  try { return isDeepStrictEqual(normalizePermissions(JSON.parse(current.granted_permissions_json)), normalizePermissions({ core: { projects: ['read'] } })) } catch { return false }
}

export function permitsDeliveredWeek(packageId: string, version: string, permissions: Partial<PermissionSet> | undefined): boolean {
  try { return packageId === 'builtin.week' && version === '1.1.2' && isDeepStrictEqual(normalizePermissions(permissions), normalizePermissions({ core: { projects: ['read'] } })) } catch { return false }
}
