import { ApiHandler, IpcHandler } from '../main/preload'

declare global {
  interface Window {
    ipc: IpcHandler
    api: ApiHandler
  }
}
