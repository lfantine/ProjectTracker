import { fitContribution } from './layout'
import { RUNTIME_WINDOW_CONNECT, RUNTIME_WINDOW_PORT, RUNTIME_WINDOW_REVOKE } from '../../shared/runtime'
import { RUNTIME_LIMITS } from '../../shared/limits'
import { SDK_HELLO, type SdkWelcome } from '../../shared/sdk'
import { SDK_VERSION } from '../../shared/version'

export interface FrameRegistration { contextId: string; origin: string; url: string }
export interface FrameConnection { welcome: SdkWelcome; port: MessagePort }
export interface FrameConnector {
  connect(contextId: string, hello: unknown, signal?: AbortSignal): Promise<FrameConnection>
  revoke(contextId: string): void
}

// Shell-only helper. Registration is supplied by the trusted host, never by
// postMessage data. Kept framework-independent for static-export compatibility.
export function mountContribution(container: HTMLElement, registration: FrameRegistration, connector: FrameConnector, options: { autoSize?: boolean; fill?: boolean } = {}): { frame: HTMLIFrameElement; dispose(): void } {
  if (registration.origin !== `pt-plugin://${registration.contextId}` || !/^pt-plugin:\/\/ctx-[a-f0-9]{48}$/.test(registration.origin) || !registration.url.startsWith(`${registration.origin}/__pt_host__/`)) throw new Error('Invalid native frame registration')
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'")
  const stopLayout = options.autoSize ? fitContribution(frame, registration.origin, { fill: options.fill }) : () => {}
  const controller = new AbortController()
  let disposed = false
  let connecting = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    controller.abort()
    window.removeEventListener('message', onHello)
    observer.disconnect()
    stopLayout()
    frame.remove()
    connector.revoke(registration.contextId)
  }
  const onHello = (event: MessageEvent) => {
    if (disposed || connecting || event.source !== frame.contentWindow || event.origin !== registration.origin) return
    const hello = event.data
    if (!hello || typeof hello !== 'object' || Object.keys(hello).length !== 2 || hello.type !== SDK_HELLO || hello.sdkVersion !== SDK_VERSION || event.ports.length) return
    connecting = true
    void connector.connect(registration.contextId, hello, controller.signal).then(({ welcome, port }) => {
      if (disposed || !frame.isConnected) { port.close(); dispose(); return }
      frame.contentWindow!.postMessage(welcome, registration.origin, [port])
    }).catch(dispose)
  }
  // Removing a placement revokes its native context even when a caller forgets
  // to explicitly dispose. Ordinary teardown should still call dispose().
  const observer = new MutationObserver(() => { if (!frame.isConnected) dispose() })
  window.addEventListener('message', onHello)
  frame.src = registration.url
  container.append(frame)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  return { frame, dispose }
}

// The preload relays only top-level shell messages on these closed channels.
export function createElectronConnector(shellOrigin: string): FrameConnector {
  return {
    connect(contextId, hello, signal) {
      return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', cancel) }
        const cancel = () => { cleanup(); reject(new Error('Native SDK connection cancelled')) }
        const timer = setTimeout(() => { cleanup(); reject(new Error('Native SDK connection timeout')) }, RUNTIME_LIMITS.initTimeoutMs)
        const receive = (event: MessageEvent) => {
          if (event.source !== window || event.origin !== shellOrigin || event.data?.type !== RUNTIME_WINDOW_PORT || event.data.contextId !== contextId || event.ports.length !== 1) return
          cleanup()
          resolve({ welcome: event.data.welcome, port: event.ports[0] })
        }
        if (signal?.aborted) { cancel(); return }
        signal?.addEventListener('abort', cancel, { once: true })
        window.addEventListener('message', receive)
        window.postMessage({ type: RUNTIME_WINDOW_CONNECT, contextId, hello }, shellOrigin)
      })
    },
    revoke(contextId) { window.postMessage({ type: RUNTIME_WINDOW_REVOKE, contextId }, shellOrigin) },
  }
}
