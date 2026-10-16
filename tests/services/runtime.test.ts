import { DatabaseSync, backup } from 'node:sqlite'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from './helpers'

describe('runtime embarqué', () => {
  it('fournit node:sqlite et l’API de sauvegarde', async () => {
    expect(process.versions.electron).toBeTruthy()
    const dir = makeTempDir()
    const db = new DatabaseSync(path.join(dir, 'a.sqlite'))
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'x\')')
    await backup(db, path.join(dir, 'b.sqlite'))
    db.close()
    const copy = new DatabaseSync(path.join(dir, 'b.sqlite'), { readOnly: true })
    expect(copy.prepare('SELECT v FROM t').get()).toEqual({ v: 'x' })
    copy.close()
  })
})
