import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { openDatabase, type Database } from '../../main/db/database'
import { PackageManager, type PackageManagerHooks } from '../../main/packages/manager'
import { installPackageShellBridge } from '../../main/packages/shellBridge'
import { PACKAGE_SHELL_CHANNELS as channels, PACKAGE_SHELL_CHANGED } from '../../shared/packageShell'
import { isolatedActivationHooks, packageArchive } from './package-fixtures'
const resources: { root: string; db: Database; dispose(): void }[] = []
afterEach(async () => { for (const f of resources.splice(0)) { f.dispose(); f.db.close(); await rm(f.root, { recursive: true, force: true }) } })
async function fixture(qualified = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-shell-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<any>>()
  const ipc = { handle: (name: string, handler: any) => { if (handlers.has(name)) throw Error('duplicate'); handlers.set(name, handler) }, removeHandler: (name: string) => handlers.delete(name) }
  const shell = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'app://shell/settings' }, send: vi.fn() })
  const event = { sender: shell, senderFrame: shell.mainFrame } as unknown as IpcMainInvokeEvent
  const hooks: PackageManagerHooks = { confirmImport: vi.fn(async () => true), confirmStop: vi.fn(async () => true),
    activation: isolatedActivationHooks(), revokePackage: vi.fn(), changed: change => bridge.notify(change) }
  const manager = new PackageManager(db, path.join(root, 'packages'), hooks, [], qualified)
  const pickers = { archive: vi.fn(async (): Promise<string | null> => null), folder: vi.fn(async (): Promise<string | null> => null) }
  const bridge = installPackageShellBridge(ipc as unknown as IpcMain, shell as unknown as WebContents, shell.mainFrame.url, manager, pickers)
  resources.push({ root, db, dispose: bridge.dispose })
  if (qualified) await manager.start()
  else await expect(manager.start()).rejects.toThrow('ACTIVATION_NOT_QUALIFIED')
  const invoke = (name: string, ...args: unknown[]) => handlers.get(name)!(event, ...args)
  return { root, db, hooks, manager, pickers, bridge, shell, event, handlers, invoke }
}

it('rejects subframes, same-URL foreign senders and changed documents before picker or DB access', async () => {
  const f = await fixture()
  const handler = f.handlers.get(channels.importArchive)!
  for (const event of [ { sender: f.shell, senderFrame: { url: f.shell.mainFrame.url } },
    { sender: {}, senderFrame: f.shell.mainFrame } ]) {
    expect((await handler(event as IpcMainInvokeEvent)).error.code).toBe('PERMISSION_DENIED')
  }
  f.shell.mainFrame.url = 'app://untrusted/'
  expect((await f.invoke(channels.importArchive)).error.code).toBe('PERMISSION_DENIED')
  expect(f.pickers.archive).not.toHaveBeenCalled()
  expect(f.db.all('SELECT * FROM packages')).toEqual([])
})

it('accepts no renderer paths, extra fields, invalid versions, CORE or arbitrary actions', async () => {
  const f = await fixture()
  for (const [channel, input] of [
    [channels.importArchive, { path: '/private/stolen.zip' }], [channels.linkFolder, { folder: '/private' }],
    [channels.importFolder, { selection: 'x', folder: '/private' }],
    [channels.activate, { packageId: 'core', version: '1.0.0' }],
    [channels.activate, { packageId: 'example.boards', version: '../escape' }],
    [channels.stop, { packageId: 'example.boards', action: 'purge' }],
    [channels.snapshot, {}],
  ] as const) expect((await f.invoke(channel, input)).error.code).toBe('VALIDATION')
  expect(f.pickers.archive).not.toHaveBeenCalled()
  expect(f.pickers.folder).not.toHaveBeenCalled()
})

it('uses native picker and opaque catalogue selection, expires old selections and keeps paths native', async () => {
  const f = await fixture()
  await packageArchive(f.root)
  f.pickers.folder.mockResolvedValue(f.root)
  const linked = await f.invoke(channels.linkFolder)
  expect(linked.ok).toBe(true)
  const selection = linked.value.catalogue.entries[0].selection
  expect(typeof selection).toBe('string')
  expect(JSON.stringify(linked)).not.toContain(f.root)
  await f.invoke(channels.refresh)
  expect((await f.invoke(channels.importFolder, { selection })).error.code).toBe('CONFLICT')
  const fresh = await f.invoke(channels.refresh)
  expect((await f.invoke(channels.importFolder, { selection: fresh.value.catalogue.entries[0].selection })).value.status).toBe('ready')
  expect(f.hooks.confirmImport).toHaveBeenCalledTimes(1)
  const snapshot = await f.invoke(channels.snapshot)
  expect(snapshot.value.versions).toEqual([{ packageId: 'example.boards', version: '1.0.0', status: 'ready' }])
  expect(JSON.stringify(snapshot)).not.toContain(f.root)
  expect((await f.invoke(channels.activate, { packageId: 'example.boards', version: '1.0.0' })).ok).toBe(true)
  expect(f.shell.send).toHaveBeenCalledWith(PACKAGE_SHELL_CHANGED, expect.objectContaining({ kind: 'activation', affected: ['example.boards'] }))
  expect((await f.invoke(channels.stop, { packageId: 'example.boards', action: 'uninstall' })).ok).toBe(true)
  expect(f.manager.packages()[0].state).toBe('uninstalled')
})

it('imports an explicitly picked ZIP and sanitizes native errors/cancellation', async () => {
  const f = await fixture()
  expect(await f.invoke(channels.importArchive)).toEqual({ ok: true, value: null })
  f.pickers.archive.mockResolvedValue(path.join(f.root, 'secret-missing.zip'))
  const failure = await f.invoke(channels.importArchive)
  expect(failure.error.code).toBe('UNAVAILABLE')
  expect(JSON.stringify(failure)).not.toContain(f.root)
  f.pickers.archive.mockResolvedValue(await packageArchive(f.root))
  expect((await f.invoke(channels.importArchive)).value.status).toBe('ready')
})

it('navigation during picker invalidates the request and removes all handlers/listeners', async () => {
  const f = await fixture()
  let release!: (source: string) => void
  f.pickers.archive.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const pending = f.invoke(channels.importArchive)
  const stale = f.handlers.get(channels.snapshot)!
  f.shell.emit('did-start-navigation', {}, 'app://elsewhere', false, true)
  release(await packageArchive(f.root))
  expect((await pending).error.code).toBe('PERMISSION_DENIED')
  expect((await stale(f.event)).error.code).toBe('PERMISSION_DENIED')
  expect(f.handlers.size).toBe(0)
  expect(f.shell.listenerCount('destroyed')).toBe(0)
  expect(f.manager.packages()).toEqual([])
  f.bridge.dispose()
})

it('disposal during consent aborts before durable import; child navigation does not dispose', async () => {
  const f = await fixture()
  f.shell.emit('did-start-navigation', {}, 'plugin://frame', false, false)
  expect(f.handlers.size).toBe(Object.keys(channels).length)
  let entered!: () => void, release!: () => void
  const confirming = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(f.hooks.confirmImport).mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve }); return true })
  f.pickers.archive.mockResolvedValue(await packageArchive(f.root))
  const pending = f.invoke(channels.importArchive)
  await confirming
  f.shell.emit('destroyed')
  release()
  expect((await pending).error.code).toBe('UNAVAILABLE')
  expect(f.manager.packages()).toEqual([])
})

it('cancels a linked-folder change queued behind consent when its document is disposed', async () => {
  const f = await fixture()
  let entered!: () => void, release!: () => void
  const confirming = new Promise<void>(resolve => { entered = resolve })
  vi.mocked(f.hooks.confirmImport).mockImplementation(async () => { entered(); await new Promise<void>(resolve => { release = resolve }); return true })
  f.pickers.archive.mockResolvedValue(await packageArchive(f.root))
  f.pickers.folder.mockResolvedValue(f.root)
  const importing = f.invoke(channels.importArchive)
  await confirming
  const linking = f.invoke(channels.linkFolder)
  await Promise.resolve() // picker has resolved; folder mutation waits in the manager queue
  f.bridge.dispose()
  release()
  const results = await Promise.all([importing, linking])
  expect(results.every(result => !result.ok)).toBe(true)
  expect(f.manager.linkedFolderPath()).toBeUndefined()
  expect(f.manager.packages()).toEqual([])
  f.bridge.notify({ kind: 'stop', affected: ['example.boards'], revision: 1 })
  expect(f.shell.send).not.toHaveBeenCalled()
})


it('reports recovery status without package details and refuses pickers/mutations while unqualified', async () => {
  const f = await fixture(false)
  expect(await f.invoke(channels.snapshot)).toEqual({ ok: true, value: { phase: 'recovery', packages: [], versions: [], catalogue: null, bundled: [] } })
  expect((await f.invoke(channels.importArchive)).error.code).toBe('UNAVAILABLE')
  expect(f.pickers.archive).not.toHaveBeenCalled()
})

it('exposes validated manifest details for installed versions without managed paths or file authority', async () => {
  const f = await fixture()
  f.pickers.archive.mockResolvedValue(await packageArchive(f.root))
  expect((await f.invoke(channels.importArchive)).ok).toBe(true)
  const snapshot = await f.invoke(channels.snapshot)
  expect(snapshot.value.details).toMatchObject([{ status: 'ready', manifest: { id: 'example.boards', kind: 'package', author: 'Exemple', contributions: [{ id: 'board' }] } }])
  expect(JSON.stringify(snapshot)).not.toContain(f.root)
  expect(snapshot.value.details[0]).not.toHaveProperty('files_dir')
  f.db.run("UPDATE package_versions SET manifest_json = '{}' WHERE package_id = 'example.boards'")
  expect((await f.invoke(channels.snapshot)).value.details).toEqual([])
})
it('keeps catalogue selections valid across read-only snapshots from theme observers', async () => {
  const f = await fixture()
  await packageArchive(f.root); f.pickers.folder.mockResolvedValue(f.root)
  const linked = await f.invoke(channels.linkFolder), token = linked.value.catalogue.entries[0].selection
  expect((await f.invoke(channels.snapshot)).value.catalogue.entries[0].selection).toBe(token)
  expect((await f.invoke(channels.importFolder, { selection: token })).ok).toBe(true)
})
