import type { Session, WebContents, WebFrameMain, Event, WebContentsWillFrameNavigateEventParams } from 'electron'
import { AppError } from '../../shared/errors'
import { ContextRegistry } from './contexts'
import { requireRuntimeChromiumPolicy } from './chromiumPolicy'
import { createDenyProxy } from './denyProxy'

const owned = new WeakSet<Session>()
// Network containment combines webRequest, the WebRTC UDP policy and a
// fixed denying proxy (no DIRECT fallback). Await ready BEFORE creating frames.
// Owns ALL permission/webRequest handlers of a dedicated, non-persistent
// session. Never install on defaultSession or compose with another interceptor.
export function installRuntimeSession(session: Session, shellUrl: string, contexts: ContextRegistry, observeProxyForQualification?: (disconnect: () => void) => void) {
  requireRuntimeChromiumPolicy()
  if (session.isPersistent() || owned.has(session)) throw new AppError('VALIDATION', 'Session temporaire dédiée requise.')
  const shell = new URL(shellUrl)
  const shellOrigin = `${shell.protocol}//${shell.host}`
  if (shell.username || shell.password || !/^app:\/\/[a-zA-Z0-9.-]+$/.test(shellOrigin)) throw new AppError('VALIDATION', 'URL de shell invalide.')
  owned.add(session)
  let shellContents: WebContents | undefined, closed = false, prepared = false
  let proxy: Awaited<ReturnType<typeof createDenyProxy>> | undefined
  const ready = (async () => {
    proxy = await createDenyProxy()
    try {
      // No network bypass, even for loopback. The trusted shell is served by
      // a native app:// handler; HTTP dev-server shells are not supported here.
      await session.setProxy({ mode: 'fixed_servers', proxyRules: proxy.url, proxyBypassRules: '<-loopback>' })
      await session.closeAllConnections()
      if (closed) throw new AppError('UNAVAILABLE', 'Session fermée.')
      prepared = true
      observeProxyForQualification?.(() => proxy?.close())
    } catch (error) { proxy.close(); throw error }
  })()
  // Cleanup may abandon startup; callers still observe rejection through ready.
  void ready.catch(() => {})
  const frames = new Map<number, string>()
  const livePlugin = (url: string): string | null => {
    const match = /^pt-plugin:\/\/(ctx-[a-f0-9]{48})\//.exec(url)
    if (!match) return null
    try { contexts.get(match[1]); return match[1] } catch { return null }
  }
  const bootstrap = (url: string) => /^pt-plugin:\/\/ctx-[a-f0-9]{48}\/__pt_host__\/index\.html$/.test(url) && !!livePlugin(url)
  const main = (frame: WebFrameMain | null | undefined) => !!shellContents && !shellContents.isDestroyed() && frame === shellContents.mainFrame
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  session.on('will-download', (event, item) => { event.preventDefault(); item.cancel() })
  session.webRequest.onBeforeRequest((details, callback) => {
    let allow = false
    if (!closed) {
      const id = livePlugin(details.url)
      if (id && ['GET', 'HEAD'].includes(details.method)) {
        if (details.webContentsId === undefined || details.webContentsId === 0) allow = true // Native session.fetch only; catalog still authorizes resources.
        else if (shellContents && details.webContentsId === shellContents.id) {
          const frame = details.frame
          if (details.resourceType === 'subFrame') allow = bootstrap(details.url) && main(frame?.parent)
          else {
            allow = !!frame && livePlugin(frame.url) === id && !main(frame)
            if (allow && frame && frames.get(frame.frameTreeNodeId) !== id) {
              const nodeId = frame.frameTreeNodeId
              frames.set(nodeId, id)
              contexts.onRevoke(id, () => { if (frames.get(nodeId) === id) frames.delete(nodeId) })
            }
          }
        }
      } else if (shellContents && details.webContentsId === shellContents.id && main(details.frame)) {
        // Only the trusted main frame may access the shell's local assets.
        try { const url = new URL(details.url); allow = `${url.protocol}//${url.host}` === shellOrigin } catch { /* deny */ }
        if (details.resourceType === 'mainFrame') allow = details.url === shellUrl
        if (details.resourceType === 'webSocket') allow = false
      }
    }
    callback({ cancel: !allow })
  })
  const shutdown = () => {
    if (closed) return
    closed = true
    contexts.close()
    // Do not leave untrusted JS alive when releasing the owned proxy port.
    if (shellContents && !shellContents.isDestroyed()) {
      shellContents.once('destroyed', () => proxy?.close())
      shellContents.close({ waitForBeforeUnload: false })
    } else proxy?.close()
  }
  return {
    ready,
    attach(contents: WebContents) {
      if (!prepared || closed || shellContents || contents.session !== session) throw new AppError('VALIDATION', 'Fenêtre de runtime incompatible.')
      shellContents = contents
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      contents.on('will-attach-webview', (event) => event.preventDefault())
      contents.on('will-frame-navigate', (event: Event<WebContentsWillFrameNavigateEventParams>) => {
        // Only the trusted host can initially mount a native bootstrap. A
        // contribution cannot reload/navigate itself or target another frame.
        if (closed || event.isMainFrame || event.initiator !== contents.mainFrame || !main(event.frame?.parent) || !bootstrap(event.url)) event.preventDefault()
      })
      // Chromium does not emit cancellable will-frame-navigate for every
      // about:blank transition. Revoke the old capability on a committed
      // replacement document as well; inherited origins confer no native right.
      contents.on('did-frame-navigate', (_event, url, _code, _text, isMainFrame, processId, routingId) => {
        if (isMainFrame) return
        const frame = contents.mainFrame.framesInSubtree.find((candidate) => candidate.processId === processId && candidate.routingId === routingId)
        if (!frame) return
        const previous = frames.get(frame.frameTreeNodeId)
        if (previous && !url.startsWith(`pt-plugin://${previous}/`)) {
          frames.delete(frame.frameTreeNodeId)
          contexts.revoke(previous)
        }
      })
      contents.on('will-redirect', (event) => event.preventDefault())
      contents.once('destroyed', shutdown)
    },
    // Fail closed, retaining handlers until this disposable session is gone.
    close: shutdown,
  }
}
