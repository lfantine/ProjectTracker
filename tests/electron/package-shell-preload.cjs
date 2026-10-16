// Qualification-only bridge. Never shipped as the application's preload.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('packageQualification', {
  snapshot: () => ipcRenderer.invoke('packages:snapshot'),
  importArchive: () => ipcRenderer.invoke('packages:import-archive'),
  activate: (packageId, version) => ipcRenderer.invoke('packages:activate', { packageId, version }),
})
