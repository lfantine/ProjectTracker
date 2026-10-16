import { expect, it } from 'vitest'
import { canUpdateDeliveredWeek } from '../../main/modules/builtinUpdate'
const installed = { state: 'active', origin: 'bundled', active_version: '1.0.0', storage_version: 1, granted_permissions_json: JSON.stringify({ core: { projects: ['read'] } }) }
it('admits only the same-rights delivered week UI update', () => {
  expect(canUpdateDeliveredWeek(installed, '1.1.2')).toBe(true)
  expect(canUpdateDeliveredWeek({ ...installed, active_version: '1.1.0' }, '1.1.2')).toBe(true)
  expect(canUpdateDeliveredWeek({ ...installed, active_version: '1.1.1' }, '1.1.2')).toBe(true)
  for (const patch of [{ state: 'uninstalled' }, { state: 'disabled' }, { state: 'suspended' }, { origin: 'archive' }, { origin: 'folder' }, { active_version: '1.1.2' }, { storage_version: 2 }, { granted_permissions_json: '{}' }, { granted_permissions_json: '{broken' }]) expect(canUpdateDeliveredWeek({ ...installed, ...patch }, '1.1.2')).toBe(false)
  expect(canUpdateDeliveredWeek(installed, '2.0.0')).toBe(false)
})
it('does not silently add rights through the delivered bootstrap', async () => {
  const { permitsDeliveredWeek } = await import('../../main/modules/builtinUpdate')
  expect(permitsDeliveredWeek('builtin.week', '1.1.2', { core: { projects: ['read'] } })).toBe(true)
  expect(permitsDeliveredWeek('builtin.week', '1.1.2', { core: { projects: ['read', 'write'] } })).toBe(false)
  expect(permitsDeliveredWeek('other.package', '1.1.2', {})).toBe(false)
})
