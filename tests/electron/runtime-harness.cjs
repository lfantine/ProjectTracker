// Standalone Chromium qualification fixture, never loaded by the application.
require('tsx/cjs')
const { app, BrowserWindow, protocol, ipcMain, session } = require('electron')
process.on('uncaughtException', (error) => { console.error(error); app.exit(1) })
const path = require('node:path')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const { declarePluginScheme, installPluginProtocol } = require('../../main/runtime/protocol.ts')
const { ContextRegistry } = require('../../main/runtime/contexts.ts')
const { ResourceCatalog } = require('../../main/runtime/resources.ts')
const { openDatabase } = require('../../main/db/database.ts')
const { manifestSchema } = require('../../shared/manifest.ts')
const { normalizePermissions } = require('../../shared/permissions.ts')
const { CoreService } = require('../../main/core/service.ts')
const { SdkBroker } = require('../../main/runtime/broker.ts')
const { installRuntimeSession } = require('../../main/runtime/session.ts')
const { installRuntimeBridge } = require('../../main/runtime/bridge.ts')
const { createInstance } = require('../../main/core/packageStore.ts')
if (process.env.PROJECT_TRACKER_TEST !== '1' || !process.env.PROJECT_TRACKER_DATA_DIR || !process.env.PROJECT_TRACKER_USER_DATA_DIR) throw new Error('Isolated paths required')
require('../../main/runtime/chromiumPolicy.ts').configureRuntimeChromium(app)
app.setPath('userData', process.env.PROJECT_TRACKER_USER_DATA_DIR)
declarePluginScheme({ registerSchemesAsPrivileged: (schemes) => protocol.registerSchemesAsPrivileged([...schemes, { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]) })
app.whenReady().then(async () => {
  const http = require('node:http')
  const origin = 'app://shell'
  const sinkHits = { http: [], tcp: 0, udp: 0 }
  const sink = http.createServer((req, res) => { sinkHits.http.push(req.url); res.end('sink') })
  sink.on('upgrade', (req, socket) => { sinkHits.http.push(req.url); socket.destroy() })
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve))
  const udp = require('node:dgram').createSocket('udp4')
  udp.on('message', () => sinkHits.udp++)
  await new Promise((resolve) => udp.bind(0, '127.0.0.1', resolve))
  const tcpSockets = new Set()
  const tcp = require('node:net').createServer((socket) => { sinkHits.tcp++; tcpSockets.add(socket); socket.on('close', () => tcpSockets.delete(socket)); socket.on('error', () => {}); socket.resume() })
  await new Promise((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  const db = await openDatabase(path.join(process.env.PROJECT_TRACKER_DATA_DIR, 'tracker.sqlite'))
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/manifests/valid/combined.json'), 'utf8')))
  manifest.permissions.core.projects.push('write')
  manifest.permissions.network = ['https://example.com']
  const core = new CoreService(db)
  const createdProject = core.execute('projects.create', { input: { name: 'SDK fixture project', type: 'dev', category: 'Fixture', platforms: [] }, operationId: 'runtime-seed-project' })
  if (!createdProject.ok) throw new Error('Cannot seed fixture project')
  const projectId = createdProject.value.id
  core.execute('projects.update', { id: projectId, patch: { path: '/native/private-path' } })
  createInstance(db, { packageId: manifest.id, majorId: 'planner', instanceId: 'a', name: 'A', now: new Date().toISOString() })
  manifest.contributions.find((entry) => entry.id === 'today').config = { version: 1, fields: [{ key: 'label', label: 'Label', type: 'string', maxLength: 40 }] }
  db.run("INSERT INTO dashboards (id, name, position, created_at, updated_at) VALUES ('runtime-dashboard', 'Runtime', 0, 'now', 'now')")
  db.run("INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_json, binding_json, layouts_json) VALUES ('runtime-dashboard', 'shared-widget', 0, ?, 'today', '{}', ?, '{}')", manifest.id, JSON.stringify({ mode: 'active', major: { packageId: manifest.id, contributionId: 'planner' } }))
  const contexts = new ContextRegistry(db)
  const catalog = new ResourceCatalog(contexts, origin)
  const runtimeSession = session.fromPartition(`qualification-${require('node:crypto').randomBytes(12).toString('hex')}`, { cache: false })
  const downloadDir = path.join(process.env.PROJECT_TRACKER_DATA_DIR,'downloads'); fs.mkdirSync(downloadDir)
  runtimeSession.setDownloadPath(downloadDir)
  let disconnectProxy = () => {}
  const guard = installRuntimeSession(runtimeSession, origin + '/', contexts, disconnect => { disconnectProxy = disconnect })
  await guard.ready
  const shellHandler = () => new Response('<!doctype html><html><body><h1>Runtime fixture</h1></body></html>', { headers: { 'Content-Type': 'text/html' } })
  runtimeSession.protocol.handle('app', shellHandler)
  // Same URL in another session to prove sender identity (not URL alone).
  session.defaultSession.protocol.handle('app', shellHandler)
  const stop = installPluginProtocol(runtimeSession.protocol, catalog)
  const root = path.join(process.env.PROJECT_TRACKER_DATA_DIR, 'resources')
  fs.mkdirSync(root)
  const script = `window.evalDenied=false;try{(0,eval)('1+1')}catch{window.evalDenied=true};window.sdkWasPresent=!!window.ProjectTracker;window.sdkContext=await (await window.ProjectTracker.ready).call('context.get',{});window.probe={node:typeof process,preload:typeof window.api};try{parent.document.body;window.probe.parent=true}catch{window.probe.parent=false}window.parent.postMessage({type:'probe',probe:window.probe},'*');`
  const html = '<!doctype html><html><body><h2>Contribution</h2><script type="module" src="probe.js"></script></body></html>'
  fs.writeFileSync(path.join(root, 'today.html'), html)
  fs.writeFileSync(path.join(root, 'planner.html'), html)
  fs.writeFileSync(path.join(root, 'probe.js'), script)
  fs.writeFileSync(path.join(root, 'local.css'), 'h2 { color: rgb(12, 34, 56); }')
  fs.writeFileSync(path.join(root, 'local.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')
  const inventory = ['today.html', 'planner.html', 'probe.js', 'local.css', 'local.svg'].map((file) => ({ path: file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }))
  manifest.exports.find((entry) => entry.id === 'slots').collections = ['fixture']
  db.run("INSERT INTO packages (id, kind, name, author, active_version, state, origin, storage_version, granted_permissions_json, installed_at, updated_at) VALUES (?, 'package', 'Fixture', 'Test', ?, 'active', 'archive', 1, '{}', 'now', 'now')", manifest.id, manifest.version)
  db.run("INSERT INTO package_versions (package_id, version, content_fingerprint, source_fingerprint, manifest_json, files_dir, status, created_at) VALUES (?, ?, 'fixture', 'fixture', ?, 'fixture-only', 'active', 'now')", manifest.id, manifest.version, JSON.stringify(manifest))
  const consumerManifest = { ...structuredClone(manifest), id: 'consumer.report', dependencies: { [manifest.id]: '^1.0.0' }, permissions: { exports: [{ package: manifest.id, export: 'slots' }] }, exports: [] }
  const registrations = [0, 1, 2, 3].map((index) => {
    const registered = contexts.create({ manifest: index === 3 ? consumerManifest : manifest, contributionId: index === 3 ? 'standalone' : index === 2 ? 'planner' : 'today', grantedPermissions: normalizePermissions(index === 3 ? consumerManifest.permissions : manifest.permissions), placementId: index >= 2 ? null : 'shared-widget', owner: index >= 2 ? { kind: 'page' } : { kind: 'dashboard', dashboardId: 'runtime-dashboard' }, binding: index === 3 ? { mode: 'none' } : { mode: index === 2 ? 'fixed' : 'active', ...(index === 2 ? { instanceId: 'a' } : {}), major: { packageId: manifest.id, contributionId: 'planner' } } })
    catalog.add(registered.id, root, inventory)
    const url = catalog.prepareBootstrap(registered.id, index === 2 ? 'planner.html' : 'today.html', fs.readFileSync(process.env.PT_RUNTIME_BOOTSTRAP, 'utf8'))
    return { ...registered, url }
  })
  const confirmations = [], navigationRequests = [], navigatedRegistrations = []
  const runActivation = async (mode) => {
    const { PackageManager } = require('../../main/packages/manager.ts')
    const { installPackageShellBridge } = require('../../main/packages/shellBridge.ts')
    const { runtimeActivationHooks } = require('../../main/runtime/activationHooks.ts')
    const { putDocument } = require('../../main/core/packageStore.ts')
    const { ZipFile } = require('yazl')
    const dir = fs.mkdtempSync(path.join(process.env.PROJECT_TRACKER_DATA_DIR, 'activation-'))
    const isolatedDb = await openDatabase(path.join(dir, 'tracker.sqlite'))
    const contexts = new ContextRegistry(isolatedDb)
    const assets = { hostBundle:fs.readFileSync(process.env.PT_RUNTIME_HOST,'utf8'), bootstrapBundle:fs.readFileSync(process.env.PT_RUNTIME_BOOTSTRAP,'utf8'), preloadPath:process.env.PT_RUNTIME_PRELOAD }
    const runtimeHooks = runtimeActivationHooks(isolatedDb,contexts,assets,async()=>true,()=>{})
    let managementBridge, pickedArchive
    const manager = new PackageManager(isolatedDb,path.join(dir,'packages'),{
      confirmImport:async()=>true,confirmStop:async()=>true,activation:runtimeHooks,
      revokePackage:id=>runtimeHooks.revokePackage(id),changed:change=>managementBridge?.notify(change)
    },[],true)
    const managementSession=session.fromPartition('package-management-'+require('node:crypto').randomBytes(12).toString('hex'),{cache:false})
    const managementGuard=installRuntimeSession(managementSession,'app://shell/',contexts)
    await managementGuard.ready
    managementSession.protocol.handle('app',shellHandler)
    const managementWindow = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,session:managementSession,preload:path.join(__dirname,'package-shell-preload.cjs')}})
    managementGuard.attach(managementWindow.webContents)
    const invoke = async (script) => {
      const result = await managementWindow.webContents.executeJavaScript(script)
      if(!result.ok)throw Object.assign(Error(result.error.message),{code:result.error.code})
      return result.value
    }
    async function importVersion(version,storageVersion) {
      const target = { manifestVersion:1, kind:'package', id:'example.activation', name:'Qualification', author:'Fixture', version, hostApi:'^1.0.0', dependencies:{}, permissions:{}, storageVersion,
        contributions:[{id:'board',type:'major',name:'Board',entry:'index.html',integrations:[]}] }
      if(storageVersion>1)target.migrations={entry:'migration.html',steps:[1]}
      const zip = new ZipFile(),chunks=[]
      const done = new Promise((resolve,reject)=>{zip.outputStream.on('data',chunk=>chunks.push(chunk));zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));zip.outputStream.on('error',reject)})
      zip.addBuffer(Buffer.from(JSON.stringify(target)),'manifest.json')
      zip.addBuffer(Buffer.from('<!doctype html><html><body>Qualification</body></html>'),'index.html')
      if(storageVersion>1){
        zip.addBuffer(Buffer.from('<!doctype html><html><body><script type="module" src="migration.js"></script></body></html>'),'migration.html')
        zip.addBuffer(Buffer.from(`const sdk=await ProjectTracker.ready;const page=await sdk.call('migration.read',{});for(const entry of page.entries)if(entry.kind==='document'){entry.value={migrated:true};await sdk.call('migration.write',{entry})};await sdk.call(${JSON.stringify(mode==='failure'?'migration.fail':'migration.complete')},{});`),'migration.js')
      }
      zip.end()
      const source=path.join(dir,version+'.zip');fs.writeFileSync(source,await done)
      pickedArchive=source
      await invoke('packageQualification.importArchive()')
      fs.unlinkSync(source)
    }
    try {
      if(manager.canLaunch('example.activation'))throw Error('startup gate open')
      await manager.start()
      await managementWindow.loadURL('app://shell/')
      managementBridge=installPackageShellBridge(ipcMain,managementWindow.webContents,'app://shell/',manager,{archive:async()=>pickedArchive,folder:async()=>null})
      const attacker=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'package-shell-preload.cjs')}})
      try {
        await attacker.loadURL('app://shell/')
        const denied=await attacker.webContents.executeJavaScript('packageQualification.snapshot()')
        if(denied.ok||denied.error.code!=='PERMISSION_DENIED')throw Error('foreign shell IPC accepted')
      } finally {attacker.destroy()}
      await importVersion('1.0.0',1)
      await invoke("packageQualification.activate('example.activation','1.0.0')")
      putDocument(isolatedDb,{packageId:'example.activation',scope:'',collection:'items',id:'one'},{original:true},{now:'now'})
      await importVersion('1.1.0',2)
      let ok=true,code
      try {await invoke("packageQualification.activate('example.activation','1.1.0')")}catch(error){ok=false;code=error.code??error.message}
      if(!manager.canLaunch('example.activation'))throw Error('active package unavailable')
      return {ok,code, state:isolatedDb.get('SELECT active_version, storage_version FROM packages'), document:isolatedDb.get('SELECT value_json FROM package_documents'), versions:isolatedDb.all('SELECT status FROM package_versions ORDER BY version')}
    } finally {managementBridge?.dispose();managementWindow.destroy();managementGuard.close();managementSession.protocol.unhandle('app');contexts.close();isolatedDb.close();fs.rmSync(dir,{recursive:true,force:true})}
  }
  const runPrevalidation = async (mode) => {
    const { prevalidatePackage } = require('../../main/runtime/prevalidation.ts')
    const target = structuredClone(manifest)
    for (const contribution of target.contributions) contribution.entry = 'prevalidation.html'
    const dir = fs.mkdtempSync(path.join(process.env.PROJECT_TRACKER_DATA_DIR, 'prevalidation-'))
    fs.writeFileSync(path.join(dir, 'prevalidation.html'), '<!doctype html><html><body><script src="prevalidation.js"></script></body></html>')
    fs.writeFileSync(path.join(dir, 'prevalidation.js'), mode === 'failure' ? 'throw Error("fixture failure")' : ['timeout','cancel'].includes(mode) ? 'while(true){}' : 'if(!window.ProjectTracker)throw Error("SDK missing");')
    const files = ['prevalidation.html','prevalidation.js'].map(file=>({path:file,sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')}))
    if (mode === 'missing') fs.unlinkSync(path.join(dir, 'prevalidation.html'))
    const before = JSON.stringify(db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id'))
    const controller = new AbortController()
    const timer = mode === 'cancel' ? setTimeout(()=>controller.abort(),900) : undefined
    try {
      await prevalidatePackage({ manifest:target, root:dir, files, hostBundle:fs.readFileSync(process.env.PT_RUNTIME_HOST,'utf8'), bootstrapBundle:fs.readFileSync(process.env.PT_RUNTIME_BOOTSTRAP,'utf8'), preloadPath:process.env.PT_RUNTIME_PRELOAD, signal:controller.signal, timeoutMs:mode==='timeout'?1800:10000 })
      return {ok:true,unchanged:before===JSON.stringify(db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id'))}
    } catch(error) {return {ok:false,code:error.code,message:error.message,unchanged:before===JSON.stringify(db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id'))}}
    finally {if(timer)clearTimeout(timer);fs.rmSync(dir,{recursive:true,force:true})}
  }
  const runMigration = async (mode) => {
    const { runMigrationSandbox } = require('../../main/runtime/migrationSandbox.ts')
    const { snapshotPackage } = require('../../main/runtime/migrationCopy.ts')
    const target = structuredClone(manifest); target.storageVersion = 2; target.version = '1.1.0'; target.migrations = { entry: 'migration.html', steps: [1] }
    const dir = fs.mkdtempSync(path.join(process.env.PROJECT_TRACKER_DATA_DIR, 'migration-'))
    fs.writeFileSync(path.join(dir, 'migration.html'), '<!doctype html><html><body><script type="module" src="migration.js"></script></body></html>')
    const source = `const sdk=await ProjectTracker.ready;
      const context=await sdk.call('context.get',{}); if(context.kind!=='migration'||context.permissions.network.length)throw Error('context');
      for(const [method,params] of [['core.list',{resource:'projects'}],['network.fetch',{url:'https://example.com/'}],['storage.put',{collection:'forbidden',id:'x',value:{},expectedRevision:null}],['instances.create',{name:'forged',operationId:'forged'}],['navigation.open',{kind:'project',projectId:'forged'}]]){try{await sdk.call(method,params);throw Error('granted')}catch(e){if(e.code!=='PERMISSION_DENIED')throw e}}
      let cursor;const entries=[]; do{const p=await sdk.call('migration.read',{limit:1,...(cursor?{cursor}:{})});entries.push(...p.entries);cursor=p.nextCursor}while(cursor);
      for(const entry of entries){if(entry.kind==='document'){entry.value={migrated:true,previous:entry.value};await sdk.call('migration.write',{entry})}}
      if(${JSON.stringify(mode)}==='invalid-config'){for(const entry of entries)if(entry.kind==='config'){entry.version=999;await sdk.call('migration.write',{entry})}}
      await new Promise(resolve=>setTimeout(resolve,300));
      ${['timeout','cancel'].includes(mode) ? 'while(true){}' : mode === 'failure' ? "await sdk.call('migration.fail',{})" : "await sdk.call('migration.complete',{})"};`
    fs.writeFileSync(path.join(dir, 'migration.js'), source)
    const files = ['migration.html','migration.js'].map(file=>({path:file,sha256:createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')}))
    const snapshot = snapshotPackage(db, manifest.id, 1, 2)
    const before = JSON.stringify(db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id'))
    let alive = false
    const pulseDb = new (require('../../main/db/database.ts').Database)(db.file)
    const pulse = setTimeout(() => { pulseDb.run("UPDATE dashboards SET name = name WHERE id = 'runtime-dashboard'"); alive = true }, 100)
    const cancellation = new AbortController()
    const cancelTimer = mode==='cancel' ? setTimeout(()=>cancellation.abort(),900) : undefined
    try {
      const result = await runMigrationSandbox(db, { signal:cancellation.signal, manifest:target, root:dir, files, snapshot, hostBundle:fs.readFileSync(process.env.PT_RUNTIME_HOST,'utf8'), bootstrapBundle:fs.readFileSync(process.env.PT_RUNTIME_BOOTSTRAP,'utf8'), preloadPath:process.env.PT_RUNTIME_PRELOAD, timeoutMs:mode==='timeout'?1800:10000 })
      return {ok:true,result,unchanged:before===JSON.stringify(db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id')),alive}
    } catch(error) {return {ok:false,message:error.message,code:error.code,unchanged:before===JSON.stringify(db.all('SELECT * FROM package_documents ORDER BY package_id, instance_scope, collection, doc_id')),alive}}
    finally {if(cancelTimer)clearTimeout(cancelTimer);clearTimeout(pulse);pulseDb.close();fs.rmSync(dir,{recursive:true,force:true})}
  }
  global.runtimeFixture = { resolveNative:hostname=>require('node:dns').promises.lookup(hostname).then(()=>true,()=>false), disconnectProxy:()=>disconnectProxy(), resolveChromium:hostname=>runtimeSession.resolveHost(hostname).then(()=>true,()=>false), downloadFiles:()=>fs.readdirSync(downloadDir), runMigration, runPrevalidation, runActivation,
    rtcControl: async () => {
      const controlDir = path.join(process.env.PROJECT_TRACKER_DATA_DIR,'control-downloads');fs.mkdirSync(controlDir)
      session.defaultSession.setDownloadPath(controlDir)
      const control = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      try {
        await control.loadURL('app://shell/')
        await control.webContents.executeJavaScript(`(async()=>{ const rtc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udp.address().port}'},{urls:'turn:127.0.0.1:${tcp.address().port}?transport=tcp',username:'probe',credential:'probe'}]});try{rtc.createDataChannel('probe');await rtc.setLocalDescription(await rtc.createOffer());await new Promise(r=>setTimeout(r,1500))}finally{rtc.close()}})()`)
        session.defaultSession.once('will-download', (_event,item) => item.setSavePath(path.join(controlDir,'control.txt')))
        await control.webContents.executeJavaScript(`{const a=document.createElement('a');a.download='control.txt';a.href=URL.createObjectURL(new Blob(['control']));document.body.append(a);a.click();}void 0;`,true)
        for(let i=0;i<60&&!fs.existsSync(path.join(controlDir,'control.txt'));i++)await new Promise(resolve=>setTimeout(resolve,50))
        const hits = { ...sinkHits, download:fs.existsSync(path.join(controlDir,'control.txt')) }
        sinkHits.tcp = 0; sinkHits.udp = 0; sinkHits.http.length = 0
        return hits
      } finally { control.destroy() }
    }, sinkHits, sinkUrl: `http://127.0.0.1:${sink.address().port}`, udpPort: udp.address().port, tcpPort: tcp.address().port, fetch: (url, options) => runtimeSession.fetch(url, options), navigationRequests, navigatedRegistrations, confirmations, registrations, projectId, updateProject: (name) => core.execute('projects.update', { id: projectId, patch: { name } }), revoke: (id) => contexts.revoke(id), live: (id) => { try { contexts.get(id); return true } catch { return false } } }
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, session: runtimeSession, preload: process.env.PT_RUNTIME_PRELOAD } })
  guard.attach(win.webContents)
  await win.loadURL(origin)
  let weekArtifact
  const bridge = installRuntimeBridge(ipcMain, win.webContents, win.webContents.mainFrame.url, contexts, new SdkBroker(db, contexts, core, {
    confirmDeletion: async (_context, deletion) => { confirmations.push(deletion); return true },
    prepareNavigation: (source, target) => () => {
      navigationRequests.push({ sourceId: source.contextId, target })
      if (target.kind !== 'major') return // Fixture records project intents; no application routes here.
      const targetManifest = contexts.manifest(source.contextId)
      const registered = contexts.create({ manifest: targetManifest, contributionId: target.major.contributionId, grantedPermissions: normalizePermissions(targetManifest.permissions), placementId: null, owner: { kind: 'page' }, binding: target.binding })
      const artifact = targetManifest.id === 'builtin.week' ? weekArtifact : null
      catalog.add(registered.id, artifact?.root ?? root, artifact?.files ?? inventory)
      const url = catalog.prepareBootstrap(registered.id, 'planner.html', fs.readFileSync(process.env.PT_RUNTIME_BOOTSTRAP, 'utf8'))
      bridge.authorize(registered.id)
      navigatedRegistrations.push({ ...registered, url })
      if (source.context.kind === 'major' && source.context.owner.kind === 'page') contexts.revoke(source.contextId)
    },
  }))
  global.runtimeFixture.loadWeekPackage = async () => {
    const { buildWeekPackage } = await import(require('node:url').pathToFileURL(path.join(__dirname,'../../scripts/build-week-package.mjs')).href)
    const { LocalPackageInstaller } = require('../../main/packages/installer.ts')
    const { PackageActivation } = require('../../main/packages/activation.ts')
    const { runtimeActivationHooks } = require('../../main/runtime/activationHooks.ts')
    const { verifyManagedVersion } = require('../../main/packages/managedVersion.ts')
    const { ensureWeekInstance, writeWeekDocument, createWeek, readWeekFacade } = require('../../main/core/week.ts')
    const legacy = ensureWeekInstance(db,'now')
    const today=(new Date().getDay()+6)%7
    writeWeekDocument(db,legacy,{slots:[{id:'legacy-slot',title:'Archive legacy',day:today,start:'09:00',end:'10:00',projectId}, {id:'unlinked-slot',title:'Sans projet',day:today,start:'11:00',end:'12:00'}],wakeTimes:Array(7).fill('07:00')},'now')
    createWeek(db,{id:'week-active',name:'Semaine active',copy:false,now:'now'})
    writeWeekDocument(db,'week-active',{slots:[{id:'active-slot',title:'Planning actif',day:today,start:'13:00',end:'14:00'}],wakeTimes:Array(7).fill('08:00')},'now')
    const before=JSON.stringify(readWeekFacade(db))
    const source=await buildWeekPackage(path.join(process.env.PROJECT_TRACKER_DATA_DIR,'week-build'))
    const packageRoot=path.join(process.env.PROJECT_TRACKER_DATA_DIR,'packages')
    await new LocalPackageInstaller(db,packageRoot,async()=>true).importArchive(source)
    fs.unlinkSync(source)
    const assets={hostBundle:fs.readFileSync(process.env.PT_RUNTIME_HOST,'utf8'),bootstrapBundle:fs.readFileSync(process.env.PT_RUNTIME_BOOTSTRAP,'utf8'),preloadPath:process.env.PT_RUNTIME_PRELOAD}
    await new PackageActivation(db,packageRoot,runtimeActivationHooks(db,contexts,assets,async()=>true,()=>{}),true).activate('builtin.week','1.1.2')
    if(before!==JSON.stringify(readWeekFacade(db)))throw Error('week data changed on activation')
    const artifact=verifyManagedVersion(packageRoot,db.get("SELECT * FROM package_versions WHERE package_id = 'builtin.week' AND version = '1.1.2'"))
    weekArtifact=artifact
    const target=artifact.manifest
    const fixed={mode:'fixed',major:{packageId:'builtin.week',contributionId:'planner'},instanceId:legacy}
    const active={mode:'active',major:{packageId:'builtin.week',contributionId:'planner'}}
    db.run("INSERT INTO project_blocks(project_id,block_id,position,package_id,contribution_id,config_json,binding_json) VALUES (?,'week-minor',99,'builtin.week','project-slots','{}',?)",projectId,JSON.stringify(fixed))
    db.run("INSERT INTO dashboard_widgets(dashboard_id,placement_id,position,package_id,contribution_id,config_json,binding_json,layouts_json) VALUES ('runtime-dashboard','week-today',99,'builtin.week','today','{}',?,'{}')",JSON.stringify(active))
    global.runtimeFixture.mountWeekWidget = () => {
      const registered=contexts.create({manifest:target,contributionId:'today',grantedPermissions:normalizePermissions(target.permissions),placementId:'week-today',owner:{kind:'dashboard',dashboardId:'runtime-dashboard'},binding:active})
      catalog.add(registered.id,artifact.root,artifact.files)
      const url=catalog.prepareBootstrap(registered.id,'today.html',assets.bootstrapBundle); bridge.authorize(registered.id)
      return {...registered,url}
    }
    return target.contributions.map(contribution=>{
      const major=contribution.type==='major', minor=contribution.type==='minor'
      const registered=contexts.create({manifest:target,contributionId:contribution.id,grantedPermissions:normalizePermissions(target.permissions),placementId:major?null:minor?'week-minor':'week-today',owner:major?{kind:'page'}:minor?{kind:'project',projectId}:{kind:'dashboard',dashboardId:'runtime-dashboard'},binding:contribution.type==='widget'?active:fixed})
      catalog.add(registered.id,artifact.root,artifact.files)
      const url=catalog.prepareBootstrap(registered.id,contribution.entry,assets.bootstrapBundle)
      bridge.authorize(registered.id)
      return {...registered,url}
    })
  }
  registrations.forEach((registered) => bridge.authorize(registered.id))
  app.on('before-quit', () => { bridge.dispose(); guard.close(); stop(); catalog.close(); contexts.close(); db.close(); sink.close(); udp.close(); for (const socket of tcpSockets) socket.destroy(); tcp.close() })
}).catch((error) => { console.error(error); app.exit(1) })
