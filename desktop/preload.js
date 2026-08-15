'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petHost', {
  list: () => ipcRenderer.invoke('pet:list'),
  getConfig: () => ipcRenderer.invoke('pet:getConfig'),
  saveConfig: (patch) => ipcRenderer.invoke('pet:saveConfig', patch),
  moveBy: (dx, dy) => ipcRenderer.invoke('pet:moveBy', dx, dy),
  state: () => ipcRenderer.invoke('pet:state'),
  sheet: (dir) => ipcRenderer.invoke('pet:sheet', dir),
  readPetJson: (dir) => ipcRenderer.invoke('pet:readPetJson', dir),
  quit: () => ipcRenderer.invoke('pet:quit'),
  onState: (fn) => {
    const listener = (_e, d) => fn(d)
    ipcRenderer.on('pet:state', listener)
    return () => ipcRenderer.removeListener('pet:state', listener)
  }
})
