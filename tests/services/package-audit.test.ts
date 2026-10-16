import { describe, expect, it, vi } from 'vitest'
import { rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openDatabase } from '../../main/db/database'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageActivation } from '../../main/packages/activation'
import { auditActivePackages } from '../../main/packages/audit'
import { makeTempDir } from './helpers'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'
async function fixture() {
  const root = makeTempDir('amber-audit-'), managed = path.join(root, 'packages')
  const db = await openDatabase(path.join(root, 'tracker.sqlite'))
  const installer = new LocalPackageInstaller(db, managed, async () => true)
  const activation = new PackageActivation(db, managed, isolatedActivationHooks(), true)
  for (const [id, dependencies] of [['example.provider', {}], ['example.consumer', { 'example.provider': '*' }], ['example.indirect', { 'example.consumer': '*' }], ['example.other', {}]] as const) {
    await installer.importArchive(await packageArchive(root, { id, dependencies, permissions: id === 'example.provider' ? {core:{notes:['read']}} : {} }))
    await activation.activate(id, '1.0.0')
  }
  return { root, managed, db, hooks: { revokePackage: vi.fn(), changed: vi.fn() } }
}
describe('startup package audit (no imported code)', () => {
  it('leaves verified active packages unchanged, without revocation or events', async () => {
    const f = await fixture()
    try {
      const before = f.db.all('SELECT * FROM packages')
      expect(await auditActivePackages(f.db, f.managed, f.hooks)).toEqual([])
      expect(f.db.all('SELECT * FROM packages')).toEqual(before)
      expect(f.hooks.changed).not.toHaveBeenCalled()
      expect(f.hooks.revokePackage).not.toHaveBeenCalled()
    } finally { f.db.close() }
  })
  it.each(['missing', 'tampered', 'symlink'])('suspends %s resources and transitive consumers, preserving all data and pointers', async mode => {
    const f = await fixture()
    try {
      const entry = path.join(f.managed, 'versions/example.provider/1.0.0/board/index.html')
      f.db.run("INSERT INTO package_documents (package_id, collection, doc_id, value_json, size_bytes, updated_at) VALUES ('example.provider', 'items', 'one', '{}', 2, 'now')")
      const documents = f.db.all('SELECT * FROM package_documents')
      const versions = f.db.all('SELECT * FROM package_versions')
      if (mode === 'missing') await rm(entry)
      if (mode === 'tampered') await writeFile(entry, 'changed')
      if (mode === 'symlink') { await rm(entry); await symlink(path.join(f.managed, 'versions/example.other/1.0.0/board/index.html'), entry) }
      const result = await auditActivePackages(f.db, f.managed, f.hooks)
      expect(result).toEqual([{packageId:'example.consumer',reason:'dependency-unavailable'}, {packageId:'example.indirect',reason:'dependency-unavailable'}, {packageId:'example.provider',reason:'resources-invalid'}])
      expect(f.hooks.revokePackage).toHaveBeenCalledTimes(3)
      expect(f.hooks.changed).toHaveBeenCalledOnce()
      expect(f.db.get("SELECT state FROM packages WHERE id = 'example.other'")).toEqual({ state: 'active' })
      expect(f.db.get("SELECT state, active_version FROM packages WHERE id = 'example.provider'")).toEqual({ state: 'suspended', active_version: '1.0.0' })
      expect(f.db.all('SELECT * FROM package_versions')).toEqual(versions)
      expect(f.db.all('SELECT * FROM package_documents')).toEqual(documents)
      expect(await auditActivePackages(f.db, f.managed, f.hooks)).toEqual([])
    } finally { f.db.close() }
  })
  it('suspends an active package whose required rights were revoked, and its consumers', async () => {
    const f = await fixture()
    try {
      f.db.run("UPDATE packages SET granted_permissions_json = '{}' WHERE id = 'example.provider'")
      const problems = await auditActivePackages(f.db, f.managed, f.hooks)
      expect(problems).toContainEqual({packageId:'example.provider',reason:'permissions-missing'})
      expect(problems).toContainEqual({packageId:'example.indirect',reason:'dependency-unavailable'})
    } finally { f.db.close() }
  })
  it('requires native recovery if revocation fails; does not partially commit suspension', async () => {
    const f = await fixture()
    try {
      await rm(path.join(f.managed, 'versions/example.provider/1.0.0/board/index.html'))
      f.hooks.revokePackage.mockImplementationOnce(() => { throw Error('failed') })
      await expect(auditActivePackages(f.db, f.managed, f.hooks)).rejects.toThrow('AUDIT_REVOCATION_FAILED')
      expect(f.db.all("SELECT id FROM packages WHERE state != 'active'")).toEqual([])
      expect(f.hooks.changed).not.toHaveBeenCalled()
    } finally { f.db.close() }
  })
  it('never suspends native CORE through the external package audit', async () => {
    const f = await fixture()
    try {
      f.db.run("INSERT INTO packages (id, kind, name, author, state, origin, storage_version, granted_permissions_json, installed_at, updated_at) VALUES ('core', 'package', 'CORE', 'Host', 'active', 'bundled', 1, '{}', 'now', 'now')")
      expect(await auditActivePackages(f.db, f.managed, f.hooks)).toEqual([])
      expect(f.db.get("SELECT state FROM packages WHERE id = 'core'")).toEqual({state:'active'})
    } finally { f.db.close() }
  })
  it('suspends a missing active-version record without deleting the package', async () => {
    const f = await fixture()
    try {
      f.db.run("DELETE FROM package_versions WHERE package_id = 'example.provider'")
      expect(await auditActivePackages(f.db, f.managed, f.hooks)).toContainEqual({packageId:'example.provider',reason:'resources-invalid'})
      expect(f.db.get("SELECT state FROM packages WHERE id = 'example.provider'")).toEqual({state:'suspended'})
    } finally { f.db.close() }
  })
})
