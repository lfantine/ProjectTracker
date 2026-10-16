import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { MigrationCopy, snapshotPackage } from '../../main/runtime/migrationCopy'
import { openDatabase } from '../../main/db/database'
import { makeTempDir, fixturesDir } from './helpers'
import { ContextRegistry } from '../../main/runtime/contexts'
import { SdkBroker } from '../../main/runtime/broker'
import { CoreService } from '../../main/core/service'
import { manifestSchema } from '../../shared/manifest'
import { RUNTIME_LIMITS } from '../../shared/limits'
import type { MigrationEntry, MigrationSnapshot } from '../../shared/migration'
const document: MigrationEntry = { kind: 'document', collection: 'entries', id: 'a', instanceScope: '', value: { legacy: true } }
const snapshot = (): MigrationSnapshot => ({ fromVersion: 1, toVersion: 2, entries: [structuredClone(document), { kind: 'instance', majorId: 'planner', instanceId: 'one', name: 'One', position: 0, active: true }, { kind: 'config', owner: 'dashboard', ownerId: 'home', placementId: 'today', contributionId: 'today', version: 1, value: {} }] })
describe('copie privée des migrations', () => {
  it('pagine, clone et ne publie le résultat qu’après réponse native', () => {
    const source = snapshot(), done = vi.fn(), copy = new MigrationCopy(source, done), after: (() => void)[] = []
    const first = copy.dispatch('migration.read', {limit:1}, []) as any
    expect(first.nextCursor).toBe('1'); first.entries[0].value = null
    expect((copy.dispatch('migration.read', {limit:1}, []) as any).entries[0]).toEqual(document)
    copy.dispatch('migration.write', {entry:{...document,value:{migrated:true}}}, [])
    copy.dispatch('migration.complete', {}, after)
    expect(done).not.toHaveBeenCalled(); after[0]()
    expect(done.mock.calls[0][0].entries[0].value).toEqual({migrated:true})
    expect(source.entries[0]).toEqual(document)
    expect(() => copy.dispatch('migration.read', {}, [])).toThrow()
  })
  it('refuse les API normales, champs forgés et identités d’autres instances/emplacements', () => {
    const copy = new MigrationCopy(snapshot(), () => {})
    expect(() => copy.dispatch('network.fetch', {url:'https://example.com'}, [])).toThrow()
    expect(() => copy.dispatch('migration.read', {packageId:'other'}, [])).toThrow()
    expect(() => copy.dispatch('migration.write', {entry:{...document,instanceScope:'other'}}, [])).toThrow()
    expect(() => copy.dispatch('migration.write', {entry:{...snapshot().entries[2],ownerId:'other'}}, [])).toThrow()
    expect(() => copy.dispatch('migration.delete', {entry:snapshot().entries[1]}, [])).toThrow()
  })
  it('annule une mutation hors quota sans perdre la version précédente et autorise ajout/suppression de documents', () => {
    const copy = new MigrationCopy(snapshot(), () => {})
    expect(() => copy.dispatch('migration.write', {entry:{...document,value:'x'.repeat(RUNTIME_LIMITS.maxDocumentBytes)}}, [])).toThrow()
    expect((copy.dispatch('migration.read', {limit:1}, []) as any).entries[0]).toEqual(document)
    copy.dispatch('migration.write', {entry:{...document,id:'b'}}, [])
    copy.dispatch('migration.delete', {entry:document}, [])
    expect((copy.dispatch('migration.read', {}, []) as any).entries.filter((e:any)=>e.kind==='document').map((e:any)=>e.id)).toEqual(['b'])
  })
  it('échec explicite sans résultat partiel', () => {
    const done = vi.fn(), copy = new MigrationCopy(snapshot(), done), actions: (() => void)[] = []
    copy.dispatch('migration.write', {entry:{...document,value:'changed'}}, [])
    copy.dispatch('migration.fail', {}, actions); actions[0]()
    expect(done).toHaveBeenCalledWith(null)
  })
  it('snapshot SQLite limité au propriétaire, sans chemins, layouts ni données CORE', async () => {
    const db = await openDatabase(`${makeTempDir()}/data.sqlite`)
    try {
      for (const pkg of ['owned','foreign']) db.run("INSERT INTO package_documents(package_id,collection,doc_id,value_json,size_bytes,updated_at) VALUES (?,'entries','a',?,2,'now')",pkg,JSON.stringify({pkg}))
      const result = snapshotPackage(db,'owned',1,2)
      expect(result.entries).toEqual([{kind:'document',collection:'entries',id:'a',instanceScope:'',value:{pkg:'owned'}}])
      db.run("UPDATE package_documents SET value_json='{}' WHERE package_id='owned'")
      expect((result.entries[0] as any).value).toEqual({pkg:'owned'})
    } finally {db.close()}
  })
  it('broker : un contexte migration ne peut écrire SQLite même si le manifeste demande des droits', async () => {
    const db = await openDatabase(`${makeTempDir()}/data.sqlite`), registry = new ContextRegistry(db)
    try {
      const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(`${fixturesDir}/manifests/valid/combined.json`,'utf8')))
      if(manifest.kind!=='package') throw new Error()
      manifest.storageVersion=2;manifest.migrations={entry:'migration.html',steps:[1]}
      const context=registry.createMigration(manifest), messages:any[]=[], broker=new SdkBroker(db,registry,new CoreService(db),{migration:new MigrationCopy(snapshot(),()=>{})})
      expect(context.context.permissions.network).toEqual([])
      const port=broker.open(context.id,{send:m=>messages.push(m),close:()=>{}})
      await port.receive({type:'request',requestId:'request-1',method:'storage.put',params:{collection:'entries',id:'evil',value:{},expectedRevision:null}})
      expect(messages.at(-1).error.code).toBe('PERMISSION_DENIED')
      expect(db.get('SELECT 1 FROM package_documents')).toBeUndefined(); port.close()
    } finally {registry.close();db.close()}
  })
})
