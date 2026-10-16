import { ipcRenderer } from 'electron'
import { RUNTIME_CONNECT, RUNTIME_REVOKE, RUNTIME_PORT, RUNTIME_WINDOW_CONNECT, RUNTIME_WINDOW_REVOKE, RUNTIME_WINDOW_PORT } from '../shared/runtime'

// Optional runtime preload component. Not installed by the normal app preload
// until runtime qualification. Must run only in the trusted shell main frame.
export function installRuntimePreload(shellOrigin: string): void {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== shellOrigin || event.ports.length) return
    const input = event.data
    if (!input || typeof input !== 'object' || typeof input.contextId !== 'string' || !/^ctx-[a-f0-9]{48}$/.test(input.contextId)) return
    if (input.type === RUNTIME_WINDOW_CONNECT && Object.keys(input).length === 3) ipcRenderer.send(RUNTIME_CONNECT, { contextId: input.contextId, hello: input.hello })
    if (input.type === RUNTIME_WINDOW_REVOKE && Object.keys(input).length === 2) ipcRenderer.send(RUNTIME_REVOKE, input.contextId)
  })
  ipcRenderer.on(RUNTIME_PORT, (event, input) => {
    if (event.ports.length !== 1 || typeof input?.contextId !== 'string') { for (const port of event.ports) port.close(); return }
    window.postMessage({ type: RUNTIME_WINDOW_PORT, contextId: input.contextId, welcome: input.welcome }, shellOrigin, [event.ports[0]])
  })
}
