import { it, expect, vi } from 'vitest'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../main/db/database'
import { LocalPackageInstaller } from '../../main/packages/installer'
import { PackageSources } from '../../main/packages/sources'
import { PackageSourceImports } from '../../main/packages/sourceImports'
import { scanFolderCatalogue } from '../../main/packages/catalogue'
import { packageArchive } from './package-fixtures'

for (const mode of ['folder', 'bundled'] as const) it(`imports ${mode} through common consent, preserves origin and uninstall tombstone`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-source-import-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  try {
    const source = await packageArchive(root)
    const catalogue = await scanFolderCatalogue(root, path.join(root, 'catalogue-stage'), [])
    if (catalogue.status !== 'ok' || catalogue.entries[0]?.status !== 'available') throw new Error('fixture')
    const entry = catalogue.entries[0]
    const confirm = vi.fn(async () => true)
    const installer = new LocalPackageInstaller(db, path.join(root, 'packages'), confirm)
    const sources = new PackageSources(db)
    sources.linkFolder(root)
    const imports = new PackageSourceImports(db, installer, sources, [{ key: 'builtin', path: source,
      packageId: entry.manifest.id, version: entry.manifest.version, contentSha256: entry.contentSha256 }])
    expect(imports.bundledOffers()).toHaveLength(1)
    expect(db.all('SELECT * FROM packages')).toHaveLength(0)
    const perform = () => mode === 'folder' ? imports.importFolder(root, entry) : imports.importBundled('builtin')
    expect((await perform()).status).toBe('ready')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(db.get('SELECT origin, state, active_version FROM packages')).toMatchObject({ origin: mode, state: 'disabled', active_version: null })
    db.run("UPDATE packages SET state = 'uninstalled'")
    expect(imports.bundledOffers()).toEqual([])
    expect((await perform()).status).toBe('unchanged')
    await installer.importArchive(source)
    expect(db.get('SELECT origin, state FROM packages')).toMatchObject({ origin: mode, state: 'uninstalled' })
    expect(confirm).toHaveBeenCalledTimes(1)
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})

it('rejects stale content, relinked sources, traversal and symlinks before consent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-source-stale-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  try {
    const source = await packageArchive(root)
    const catalogue = await scanFolderCatalogue(root, path.join(root, 'catalogue-stage'), [])
    if (catalogue.status !== 'ok' || catalogue.entries[0]?.status !== 'available') throw new Error('fixture')
    const entry = catalogue.entries[0], confirm = vi.fn(async () => true)
    const sources = new PackageSources(db)
    sources.linkFolder(root)
    const imports = new PackageSourceImports(db, new LocalPackageInstaller(db, path.join(root, 'packages'), confirm), sources)
    await expect(imports.importFolder(root, { ...entry, contentSha256: 'stale' })).rejects.toThrow('INSTALL_SOURCE_CHANGED')
    await expect(imports.importFolder(root, { ...entry, fileName: '../escape.zip' })).rejects.toThrow('SOURCE_INVALID_SELECTION')
    await symlink(source, path.join(root, 'link.zip'))
    await expect(imports.importFolder(root, { ...entry, fileName: 'link.zip' })).rejects.toThrow('SOURCE_INVALID_SELECTION')
    sources.unlinkFolder()
    await expect(imports.importFolder(root, entry)).rejects.toThrow('SOURCE_LINK_CHANGED')
    expect(confirm).not.toHaveBeenCalled()
    expect(db.all('SELECT * FROM packages')).toEqual([])
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})

it('rechecks linked source after consent and commits no version when unlinked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-source-consent-'))
  const db = await openDatabase(path.join(root, 'state.sqlite'))
  try {
    await packageArchive(root)
    const catalogue = await scanFolderCatalogue(root, path.join(root, 'catalogue-stage'), [])
    if (catalogue.status !== 'ok' || catalogue.entries[0]?.status !== 'available') throw new Error('fixture')
    const sources = new PackageSources(db)
    sources.linkFolder(root)
    const imports = new PackageSourceImports(db, new LocalPackageInstaller(db, path.join(root, 'packages'), async () => {
      sources.unlinkFolder(); return true
    }), sources)
    await expect(imports.importFolder(root, catalogue.entries[0])).rejects.toThrow('SOURCE_LINK_CHANGED')
    expect(db.all('SELECT * FROM package_versions')).toEqual([])
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})
