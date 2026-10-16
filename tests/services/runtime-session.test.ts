import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { configureRuntimeChromium } from '../../main/runtime/chromiumPolicy'
import { afterEach } from 'vitest'
import { installRuntimeSession } from '../../main/runtime/session'

configureRuntimeChromium({isReady:()=>false,commandLine:{appendSwitch:vi.fn()}} as any)
const cleanups: Array<() => void> = []
afterEach(() => { for (const close of cleanups.splice(0)) close() })
const id = `ctx-${'a'.repeat(48)}`
const origin = `pt-plugin://${id}`
const shellUrl = 'app://shell/'
function fixture(persistent = false) {
  const session = Object.assign(new EventEmitter(), {
    isPersistent: () => persistent, setProxy: vi.fn(async () => {}), closeAllConnections: vi.fn(async () => {}),
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
  })
  const contexts = { onRevoke: vi.fn(() => () => {}), revoke: vi.fn(), get: vi.fn((key) => { if (key !== id) throw new Error('revoked') }), close: vi.fn() }
  const install = () => { const guard = installRuntimeSession(session as any, shellUrl, contexts as any); cleanups.push(() => guard.close()); return guard }
  const contents = Object.assign(new EventEmitter(), {
    close: vi.fn(() => contents.emit('destroyed')), id: 7, session, mainFrame: { url: shellUrl }, isDestroyed: () => false,
    setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(),
  })
  const request = (details: object) => {
    const callback = vi.fn()
    session.webRequest.onBeforeRequest.mock.calls[0][0]({ method: 'GET', webContentsId: 7, ...details }, callback)
    return callback.mock.calls[0][0].cancel
  }
  return { session, contexts, contents, install, request }
}
describe('session Chromium dédiée (politique native)', () => {
  it('refuse attach avant préparation et n’autorise aucun bypass/DIRECT', async () => {
    const f=fixture(), guard=f.install()
    expect(()=>guard.attach(f.contents as any)).toThrow()
    await guard.ready
    expect(f.session.setProxy).toHaveBeenCalledWith({mode:'fixed_servers',proxyRules:expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),proxyBypassRules:'<-loopback>'})
    expect(f.session.closeAllConnections).toHaveBeenCalledOnce()
    guard.attach(f.contents as any)
  })
  it('un échec de préparation du proxy ne permet jamais attach', async () => {
    const f=fixture();f.session.setProxy.mockRejectedValueOnce(new Error('unavailable'))
    const guard=f.install()
    await expect(guard.ready).rejects.toThrow('unavailable')
    expect(()=>guard.attach(f.contents as any)).toThrow()
  })
  it('refuse une session persistante, réutilisée ou une autre fenêtre', async () => {
    expect(() => fixture(true).install()).toThrow()
    const f = fixture(); const guard = f.install(); await guard.ready
    expect(f.install).toThrow()
    expect(() => guard.attach({ session: {} } as any)).toThrow()
    guard.attach(f.contents as any)
    expect(() => guard.attach(f.contents as any)).toThrow()
  })
  it('refuse permissions, capture, téléchargements, popups et webviews', async () => {
    const f = fixture(); const guard = f.install(); await guard.ready; guard.attach(f.contents as any)
    const callback = vi.fn()
    f.session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    expect(f.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    expect(f.session.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false)
    f.session.setDisplayMediaRequestHandler.mock.calls[0][0]({}, callback)
    expect(callback).toHaveBeenLastCalledWith({})
    const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn() }
    f.session.emit('will-download', event, item)
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(item.cancel).toHaveBeenCalledOnce()
    expect(f.contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
    f.contents.emit('will-attach-webview', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })
  it('ne permet que le shell principal et les assets du contexte vivant courant', async () => {
    const f = fixture(); const guard = f.install(); await guard.ready; guard.attach(f.contents as any)
    const main = f.contents.mainFrame, frame = { url: `${origin}/today.html`, parent: main }
    expect(f.request({ url: shellUrl, frame: main, resourceType: 'mainFrame' })).toBe(false)
    expect(f.request({ url: shellUrl, frame, resourceType: 'script' })).toBe(true)
    expect(f.request({ url: `${origin}/local.css`, frame, resourceType: 'stylesheet' })).toBe(false)
    expect(f.request({ url: `${origin}/local.css`, frame: main, resourceType: 'script' })).toBe(true)
    expect(f.request({ url: `${origin}/__pt_host__/index.html`, frame, resourceType: 'subFrame' })).toBe(false)
    for (const url of ['https://example.com/', 'file:///etc/hosts', 'ws://localhost:12345/', `pt-plugin://ctx-${'b'.repeat(48)}/probe.js`]) {
      expect(f.request({ url, frame, resourceType: 'other' })).toBe(true)
    }
    expect(f.request({ url: `${origin}/probe.js`, frame, method: 'POST' })).toBe(true)
    expect(f.request({ url: `${origin}/probe.js`, frame, webContentsId: 8 })).toBe(true)
  })
  it('interdit navigation/redirect tiers et conserve le refus après fermeture', async () => {
    const f = fixture(); const guard = f.install(); await guard.ready; guard.attach(f.contents as any)
    const event = { preventDefault: vi.fn(), isMainFrame: false, initiator: f.contents.mainFrame, frame: { parent: f.contents.mainFrame }, url: `${origin}/__pt_host__/index.html` }
    f.contents.emit('will-frame-navigate', event); expect(event.preventDefault).not.toHaveBeenCalled()
    f.contents.emit('will-frame-navigate', { ...event, initiator: {} }); expect(event.preventDefault).toHaveBeenCalledOnce()
    f.contents.emit('will-redirect', event); expect(event.preventDefault).toHaveBeenCalledTimes(2)
    guard.close(); expect(f.contexts.close).toHaveBeenCalledOnce()
    expect(f.contents.close).toHaveBeenCalledWith({waitForBeforeUnload:false})
    expect(f.request({ url: `${origin}/probe.js`, webContentsId: 0 })).toBe(true)
    expect(f.request({ url: shellUrl, frame: f.contents.mainFrame })).toBe(true)
  })
})
