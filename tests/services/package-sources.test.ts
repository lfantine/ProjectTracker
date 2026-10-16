import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../main/db/database'
import { PackageSources } from '../../main/packages/sources'

it('persists exactly one linked source across restart; relinking is idempotent and unlinking changes no package data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'amber-sources-'))
  let db = await openDatabase(path.join(root, 'state.sqlite'))
  try {
    let sources = new PackageSources(db)
    expect(sources.linkedFolder()).toBeUndefined()
    expect(() => sources.linkFolder('relative')).toThrow('SOURCE_INVALID_PATH')
    const linked = sources.linkFolder(path.join(root, 'absent-source'))
    expect(sources.linkFolder(linked.path)).toEqual(linked)
    db.close()
    db = await openDatabase(path.join(root, 'state.sqlite'))
    sources = new PackageSources(db)
    expect(sources.linkedFolder()).toEqual(linked)
    sources.linkFolder(path.join(root, 'replacement'))
    expect(db.get<{ count: number }>('SELECT count(*) AS count FROM package_sources')?.count).toBe(1)
    const before = db.all('SELECT * FROM packages')
    sources.unlinkFolder()
    sources.unlinkFolder()
    expect(sources.linkedFolder()).toBeUndefined()
    expect(db.all('SELECT * FROM packages')).toEqual(before)
  } finally { db.close(); await rm(root, { force: true, recursive: true }) }
})
