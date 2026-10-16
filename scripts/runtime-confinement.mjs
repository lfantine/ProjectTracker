import { expect } from '@playwright/test'
// Real Chromium attacks with local HTTP/UDP/TCP sinks. No Internet needed.
export async function qualifyConfinement(app, page, frame, registrations) {
  console.log('Confinement Chromium : essais isolés sur collecteurs locaux')
  const sink = await app.evaluate(() => ({ url: global.runtimeFixture.sinkUrl, udpPort: global.runtimeFixture.udpPort, tcpPort: global.runtimeFixture.tcpPort }))
  expect(await app.evaluate(() => global.runtimeFixture.resolveNative('localhost')), 'native DNS positive control').toBe(true)
  expect(await app.evaluate(() => global.runtimeFixture.resolveChromium('localhost')), 'Chromium hostname resolution disabled').toBe(false)
  const control = await app.evaluate(() => global.runtimeFixture.rtcControl())
  expect(control.tcp, 'positive TURN/TCP control').toBeGreaterThan(0)
  expect(control.udp, 'positive STUN/UDP control').toBeGreaterThan(0)
  expect(control.download, 'positive native download control').toBe(true)
  const local = await frame.evaluate(async () => {
    const image = new Image(); image.src = 'local.svg'; document.body.append(image)
    await image.decode()
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'local.css'
    await new Promise((resolve, reject) => { css.onload = resolve; css.onerror = reject; document.head.append(css) })
    return { width: image.naturalWidth, color: getComputedStyle(document.querySelector('h2')).color }
  })
  expect(local).toEqual({ width: 2, color: 'rgb(12, 34, 56)' })
  console.log('Confinement: assets locaux vérifiés')
  const attempts = await frame.evaluate(async ({ sink, foreign }) => {
    const bounded = (promise, label = 'websocket') => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Confinement operation timed out: ' + label)), 2500))])
    const refused = async (operation) => { try { await bounded(Promise.resolve().then(operation), operation.toString()); return false } catch (error) { if (error.message.startsWith('Confinement operation timed out')) throw error; return true } }
    const remoteScript = document.createElement('script'); remoteScript.src = `${sink.url}/script`; document.head.append(remoteScript)
    const inlineScript = document.createElement('script'); inlineScript.textContent = 'window.inlineExecuted=true'; document.head.append(inlineScript)
    const evaluation = window.evalDenied // Package-defined function, not DevTools evaluation (which bypasses CSP).
    const inline = window.inlineExecuted !== true
    navigator.sendBeacon(`${sink.url}/beacon`, 'probe')
    const form = document.createElement('form'); form.action = `${sink.url}/form`; form.method = 'POST'; document.body.append(form); form.submit()
    const image = new Image(); image.src = `${sink.url}/image`; document.body.append(image)
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = `${sink.url}/css`; document.head.append(stylesheet)
    const style = document.createElement('style'); style.textContent = `@import url('${sink.url}/import'); @font-face { font-family: Leak; src: url('${sink.url}/font'); } body { background-image: url('${sink.url}/background'); font-family: Leak; }`; document.head.append(style)
    const iframe = document.createElement('iframe'); iframe.src = `${sink.url}/iframe`; document.body.append(iframe)
    const websocket = await bounded(new Promise((resolve) => { try { const ws = new WebSocket(sink.url.replace('http:', 'ws:') + '/socket'); ws.onopen = () => { ws.close(); resolve(false) }; ws.onerror = () => resolve(true) } catch { resolve(true) } }))
    const worker = await refused(async () => { await bounded(new Promise((resolve, reject) => { const worker = new Worker('probe.js'); worker.onmessage = () => { worker.terminate(); resolve() }; worker.onerror = () => { worker.terminate(); reject(new Error('Worker refused')) } }), 'worker') })
    const serviceWorker = await refused(async () => navigator.serviceWorker.register('probe.js'))
    const file = await refused(async () => fetch('file:///etc/hosts'))
    const crossContext = await refused(async () => fetch(`${foreign}/probe.js`))
    const media = await refused(async () => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); stream.getTracks().forEach((track) => track.stop()) })
    const clipboard = await refused(async () => navigator.clipboard.readText())
    const popup = window.open(`${sink.url}/popup`) === null
    const blobUrl = URL.createObjectURL(new Blob(['download'], { type: 'text/plain' })); const link = document.createElement('a'); link.download = 'forbidden.txt'; link.href = blobUrl; document.body.append(link); link.click(); setTimeout(() => URL.revokeObjectURL(blobUrl), 1500)
    return { evaluation, inline, websocket, worker, serviceWorker, file, crossContext, media, clipboard, popup }
  }, { sink, foreign: registrations[1].origin })
  console.log('Confinement: refus', attempts)
  for (const [name, denied] of Object.entries(attempts)) expect(denied, name).toBe(true)
  const original = frame.url()
  for (const url of [`${sink.url}/navigate`, 'file:///etc/hosts', 'data:text/html,forbidden']) {
    await frame.evaluate((url) => { location.href = url }, url).catch(() => {})
    await page.waitForTimeout(100)
    expect(frame.url(), `navigation ${url}`).toBe(original)
  }
  expect(await app.evaluate(() => global.runtimeFixture.sinkHits.http)).toEqual([])
  console.log('✓ Contrôles Chromium partiels : assets locaux, refus réseau HTTP/CSS/frames/WebSocket/workers/file, permissions, popups et navigation. WebRTC vérifié séparément ci-dessous.')
  await probeRtc(frame, sink)
  expect(await app.evaluate(() => global.runtimeFixture.sinkHits)).toEqual({ http: [], udp: 0, tcp: 0 })
  expect(await app.evaluate(() => global.runtimeFixture.downloadFiles())).toEqual([])
  console.log('✓ WebRTC : contrôles positifs STUN/UDP et TURN/TCP puis absence de connexion depuis la frame confinée.')
}

export async function probeRtc(frame, sink) {
  await frame.evaluate(async (sink) => {
    for (const urls of [`stun:127.0.0.1:${sink.udpPort}`, `turn:127.0.0.1:${sink.tcpPort}?transport=tcp`, `turns:127.0.0.1:${sink.tcpPort}?transport=tcp`, `turn:localhost:${sink.tcpPort}?transport=tcp`, `stun:localhost:${sink.udpPort}`]) {
      const rtc = new RTCPeerConnection({ iceServers: [{ urls, username: 'probe', credential: 'probe' }] })
      try { rtc.createDataChannel('probe'); await rtc.setLocalDescription(await rtc.createOffer()); await new Promise((resolve) => setTimeout(resolve, 1200)) } finally { rtc.close() }
    }
  }, sink)
}
