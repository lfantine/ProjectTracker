import { AppError } from '../../shared/errors'
import { MessageChannelMain, type IpcMain, type IpcMainEvent, type WebContents } from 'electron'
import { ContextRegistry } from './contexts'
import { SdkBroker } from './broker'
import { negotiateSdk } from './handshake'

import { RUNTIME_CONNECT, RUNTIME_REVOKE, RUNTIME_PORT } from '../../shared/runtime'

// Created per trusted shell WebContents. Only native registration can authorize
// a context. A shell message cannot register packages or widen permissions.
export function installRuntimeBridge(ipc: IpcMain, shell: WebContents, shellUrl: string, contexts: ContextRegistry, broker: SdkBroker): { authorize(contextId: string): void; dispose(): void } {
  let disposed = false
  const allowed = new Set<string>()
  const stops = new Map<string, () => void>()
  const trusted = (event: IpcMainEvent) => !shell.isDestroyed() && event.sender === shell && event.senderFrame === shell.mainFrame && event.senderFrame.url === shellUrl
  const connect = (event: IpcMainEvent, input: unknown) => {
    if (event.ports?.length) { for (const port of event.ports) port.close(); return }
    if (!trusted(event) || !input || typeof input !== 'object') return
    const value = input as Record<string, unknown>
    if (Object.keys(value).length !== 2 || typeof value.contextId !== 'string' || !allowed.has(value.contextId)) return
    const id = value.contextId
    let channel: MessageChannelMain | undefined
    try {
      channel = new MessageChannelMain()
      const { port1, port2 } = channel
      const { welcome, session } = negotiateSdk(contexts, broker, id, value.hello, { send: (message) => port1.postMessage(message), close: () => { port1.close(); port2.close() } })
      port1.on('message', (message) => {
        if (message.ports.length) { for (const port of message.ports) port.close(); contexts.revoke(id); return }
        void session.receive(message.data)
      })
      port1.on('close', () => contexts.revoke(id))
      port1.start()
      event.senderFrame!.postMessage(RUNTIME_PORT, { contextId: id, welcome }, [port2])
    } catch {
      channel?.port1.close(); channel?.port2.close()
      contexts.revoke(id)
    }
  }
  const revoke = (event: IpcMainEvent, id: unknown) => { if (trusted(event) && typeof id === 'string' && allowed.has(id)) contexts.revoke(id) }
  const dispose = () => {
    if (disposed) return
    disposed = true
    ipc.removeListener(RUNTIME_CONNECT, connect)
    ipc.removeListener(RUNTIME_REVOKE, revoke)
    shell.removeListener('destroyed', dispose)
    shell.removeListener('did-start-navigation', navigate)
    for (const id of [...allowed]) contexts.revoke(id)
  }
  const navigate = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) dispose() }
  ipc.on(RUNTIME_CONNECT, connect)
  ipc.on(RUNTIME_REVOKE, revoke)
  shell.on('destroyed', dispose)
  shell.on('did-start-navigation', navigate)
  return {
    authorize(id) {
      if (disposed) throw new AppError('UNAVAILABLE', 'Pont de contexte fermé.')
      contexts.get(id)
      if (allowed.has(id)) return
      allowed.add(id)
      stops.set(id, contexts.onRevoke(id, () => { allowed.delete(id); stops.get(id)?.(); stops.delete(id) }))
    },
    dispose,
  }
}
