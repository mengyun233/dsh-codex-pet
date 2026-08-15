'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petHost', {
  list: () => ipcRenderer.invoke('pet:list'),
  getConfig: () => ipcRenderer.invoke('pet:getConfig'),
  saveDesktop: (patch) => ipcRenderer.invoke('pet:saveDesktop', patch),
  saveShared: (patch) => ipcRenderer.invoke('pet:saveShared', patch),
  fitWindow: (w, h, gap) => ipcRenderer.invoke('pet:fitWindow', w, h, gap),
  moveBy: (dx, dy) => ipcRenderer.invoke('pet:moveBy', dx, dy),
  state: () => ipcRenderer.invoke('pet:state'),
  openSession: (sessionId) => ipcRenderer.invoke('pet:openSession', sessionId),
  stopSession: (sessionId) => ipcRenderer.invoke('pet:stopSession', sessionId),
  sheet: (dir) => ipcRenderer.invoke('pet:sheet', dir),
  readPetJson: (dir) => ipcRenderer.invoke('pet:readPetJson', dir),
  quit: () => ipcRenderer.invoke('pet:quit'),
  onState: (fn) => {
    const listener = (_e, d) => fn(d)
    ipcRenderer.on('pet:state', listener)
    return () => ipcRenderer.removeListener('pet:state', listener)
  },
  onConfig: (fn) => {
    const listener = (_e, c) => fn(c)
    ipcRenderer.on('pet:config', listener)
    return () => ipcRenderer.removeListener('pet:config', listener)
  }
})
