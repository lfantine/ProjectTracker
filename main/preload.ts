import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

const handler = {
  send<T>(channel: string, value?: T) {
    ipcRenderer.send(channel, value)
  },
  on<T>(channel: string, callback: (...args: T[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: T[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
}

const api = {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data: unknown) => ipcRenderer.invoke('data:save', data),
  getDataDir: () => ipcRenderer.invoke('data:getDir'),
  chooseFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:chooseFile'),
  revealInFinder: (targetPath: string): Promise<string | null> =>
    ipcRenderer.invoke('shell:revealInFinder', targetPath),
  openExternal: (url: string): Promise<string | null> =>
    ipcRenderer.invoke('shell:openExternal', url),
  getSettings: (): Promise<{ aiCommand: string }> =>
    ipcRenderer.invoke('settings:get'),
  setSettings: (patch: { aiCommand?: string }): Promise<{ aiCommand: string }> =>
    ipcRenderer.invoke('settings:set', patch),
  ai: {
    call: (request: string, format?: string): Promise<string> =>
      ipcRenderer.invoke('ai:call', request, format),
  },
  openWith: (
    target: 'terminal' | 'zed',
    targetPath: string
  ): Promise<string | null> =>
    ipcRenderer.invoke('shell:openWith', target, targetPath),
}

contextBridge.exposeInMainWorld('ipc', handler)
contextBridge.exposeInMainWorld('api', api)

export type IpcHandler = typeof handler
export type ApiHandler = typeof api
