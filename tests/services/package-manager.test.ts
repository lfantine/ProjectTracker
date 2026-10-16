import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, access, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase, type Database } from '../../main/db/database'
import { PackageManager, type PackageManagerHooks } from '../../main/packages/manager'
import { PackageSources } from '../../main/packages/sources'
import { packageArchive, isolatedActivationHooks } from './package-fixtures'
const resources: { root: string; db: Database }[] = []
afterEach(async () => { for (const { root, db } of resources.splice(0)) { db.close(); await rm(root, { recursive: true, force: true }) } })
async function fixture(qualified = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-manager-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  resources.push({ root, db })
  const hooks: PackageManagerHooks = { confirmImport: vi.fn(async () => true), confirmStop: vi.fn(async () => true),
    activation: isolatedActivationHooks(), revokePackage: vi.fn(), changed: vi.fn() }
  const create = () => new PackageManager(db, path.join(root, 'packages'), hooks, [], qualified)
  return { root, db, hooks, create, manager: create() }
}

it('refuses operations before/during startup; coalesces startup and keeps a missing source nonfatal', async () => {
  const f = await fixture()
  new PackageSources(f.db).linkFolder(path.join(f.root, 'absent'))
  const abandoned = path.join(f.root, 'packages/.catalogue-staging/prepare-abandoned')
  await mkdir(abandoned, { recursive: true })
  await writeFile(path.join(abandoned, 'old.html'), 'unused')
  expect(f.manager.status()).toBe('idle')
  expect(f.manager.canLaunch('example.boards')).toBe(false)
  expect(() => f.manager.packages()).toThrow('PACKAGES_NOT_READY')
  await expect(f.manager.importArchive('unused')).rejects.toThrow('PACKAGES_NOT_READY')
  const startup = f.manager.start()
  expect(f.manager.start()).toBe(startup)
  expect(f.manager.status()).toBe('starting')
  await expect(f.manager.refreshCatalogue()).rejects.toThrow('PACKAGES_NOT_READY')
  await startup
  expect(f.manager.status()).toBe('ready')
  await expect(access(abandoned)).rejects.toThrow()
  expect(f.manager.catalogueSnapshot()).toEqual({ status: 'error', code: 'SOURCE_UNREADABLE' })
  await f.manager.start()
  expect(f.hooks.confirmImport).not.toHaveBeenCalled()
})

it('keeps normal qualification closed and enters recovery rather than exposing operations', async () => {
  const f = await fixture(false)
  await expect(f.manager.start()).rejects.toThrow('ACTIVATION_NOT_QUALIFIED')
  expect(f.manager.status()).toBe('recovery')
  await expect(f.manager.importBundled('anything')).rejects.toThrow('PACKAGES_NOT_READY')
  expect(f.manager.canLaunch('core')).toBe(false)
})

it('scans at startup/manual refresh without importing; folder import and activation/stop use native hooks', async () => {
  const f = await fixture()
  await packageArchive(f.root)
  new PackageSources(f.db).linkFolder(f.root)
  await f.manager.start()
  const catalogue = f.manager.catalogueSnapshot()
  if (catalogue.status !== 'ok' || catalogue.entries[0]?.status !== 'available') throw Error('fixture')
  expect(f.manager.packages()).toEqual([])
  catalogue.entries.length = 0
  const current = f.manager.catalogueSnapshot()
  if (current.status !== 'ok' || current.entries[0]?.status !== 'available') throw Error('fixture')
  const entry = current.entries[0]
  await f.manager.importFolder(f.root, entry)
  expect(f.manager.packages()[0]).toMatchObject({ state: 'disabled', activeVersion: null })
  expect(f.manager.canLaunch(entry.manifest.id)).toBe(false)
  await f.manager.activate(entry.manifest.id, entry.manifest.version)
  expect(f.manager.canLaunch(entry.manifest.id)).toBe(true)
  expect(f.hooks.changed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'activation', affected: [entry.manifest.id] }))
  await f.manager.stop(entry.manifest.id, 'uninstall')
  expect(f.manager.canLaunch(entry.manifest.id)).toBe(false)
  expect(f.manager.packages()[0].state).toBe('uninstalled')
  expect(f.hooks.changed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stop' }))
  await packageArchive(f.root, { version: '1.1.0' })
  expect((f.manager.catalogueSnapshot() as { entries: unknown[] }).entries).toHaveLength(1)
  expect((await f.manager.refreshCatalogue() as { entries: unknown[] }).entries).toHaveLength(2)
  await f.manager.unlinkFolder()
  expect(f.manager.catalogueSnapshot()).toEqual({ status: 'unlinked' })
  expect(f.manager.packages()[0].state).toBe('uninstalled')
})

it('recovers journals before audit and exposes a damaged version only as suspended', async () => {
  const f = await fixture()
  await f.manager.start()
  await f.manager.importArchive(await packageArchive(f.root))
  await f.manager.activate('example.boards', '1.0.0')
  f.db.run(`INSERT INTO install_journal(operation_id, package_id, version, action, step, status, created_at)
    VALUES ('interrupted', 'example.boards', '1.0.0', 'activate', 'migrate', 'started', 'now')`)
  await writeFile(path.join(f.root, 'packages/versions/example.boards/1.0.0/board/index.html'), 'tampered')
  const restarted = f.create()
  f.hooks.revokePackage = vi.fn(() => {
    expect(restarted.status()).toBe('starting')
    expect(restarted.canLaunch('example.boards')).toBe(false)
    expect(f.db.all("SELECT * FROM install_journal WHERE status = 'started'")).toEqual([])
  })
  await restarted.start()
  expect(restarted.packages()[0]).toMatchObject({ state: 'suspended', activeVersion: '1.0.0', reason: 'startup-audit:resources-invalid' })
  expect(restarted.canLaunch('example.boards')).toBe(false)
  expect(f.hooks.changed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audit' }))
})

it('failed audit blocks all operations; explicit retry can complete recovery', async () => {
  const f = await fixture()
  await f.manager.start()
  await f.manager.importArchive(await packageArchive(f.root))
  await f.manager.activate('example.boards', '1.0.0')
  await rm(path.join(f.root, 'packages/versions/example.boards/1.0.0/board/index.html'))
  const restarted = f.create()
  f.hooks.revokePackage = () => { throw Error('revoke failure') }
  await expect(restarted.start()).rejects.toThrow('AUDIT_REVOCATION_FAILED')
  expect(restarted.status()).toBe('recovery')
  expect(restarted.canLaunch('example.boards')).toBe(false)
  await expect(restarted.stop('example.boards', 'uninstall')).rejects.toThrow('PACKAGES_NOT_READY')
  f.hooks.revokePackage = vi.fn()
  await restarted.start()
  expect(restarted.status()).toBe('ready')
  expect(restarted.packages()[0].state).toBe('suspended')
})

it('a cancelled import does not poison subsequent native operations', async () => {
  const f = await fixture()
  await f.manager.start()
  const source = await packageArchive(f.root)
  const cancelled = new AbortController(); cancelled.abort()
  const failed = f.manager.importArchive(source, cancelled.signal)
  const accepted = f.manager.importArchive(source)
  await expect(failed).rejects.toThrow('INSTALL_CANCELLED')
  expect((await accepted).status).toBe('ready')
  expect(f.manager.status()).toBe('ready')
})


it('recomputes cached catalogue dependency issues after activation/disable without rescanning ZIPs', async () => {
  const f = await fixture()
  const board = await packageArchive(f.root)
  // Distinct version gives the fixture a separate source filename.
  const consumer = await packageArchive(f.root, { id: 'example.consumer', version: '1.0.1', dependencies: { 'example.boards': '^1.0.0' } })
  new PackageSources(f.db).linkFolder(f.root)
  await f.manager.start()
  const issues = () => {
    const snapshot = f.manager.catalogueSnapshot()
    if (snapshot.status !== 'ok') throw Error('fixture')
    const entry = snapshot.entries.find(entry => entry.status === 'available' && entry.manifest.id === 'example.consumer')
    if (entry?.status !== 'available') throw Error('fixture')
    return entry.issues
  }
  expect(issues()).toContainEqual({ code: 'DEPENDENCY_MISSING', packageId: 'example.consumer', dependency: 'example.boards' })
  await f.manager.importArchive(board)
  expect(issues()).toHaveLength(1) // Available/ready is not an active dependency.
  await f.manager.activate('example.boards', '1.0.0')
  await rm(consumer) // No implicit source scan, install or ZIP dependency at runtime.
  expect(issues()).toEqual([])
  await f.manager.stop('example.boards', 'disable')
  expect(issues()).toContainEqual({ code: 'DEPENDENCY_MISSING', packageId: 'example.consumer', dependency: 'example.boards' })
})


it('enters recovery without deleting outside files when catalogue staging was replaced by a symlink', async () => {
  const f = await fixture()
  const outside = path.join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'sentinel'), 'keep')
  await mkdir(path.join(f.root, 'packages'))
  await symlink(outside, path.join(f.root, 'packages/.catalogue-staging'))
  await expect(f.manager.start()).rejects.toThrow('INSTALL_DIRECTORY_INVALID')
  expect(f.manager.status()).toBe('recovery')
  expect(await readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('keep')
})
