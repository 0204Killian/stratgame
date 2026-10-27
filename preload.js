// Exposes a small, explicit file API to the game page. The page never gets Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  listSaves: () => ipcRenderer.invoke('saves:list'),
  saveGame: (name, text) => ipcRenderer.invoke('saves:write', name, text),
  loadGame: name => ipcRenderer.invoke('saves:read', name),
  deleteSave: name => ipcRenderer.invoke('saves:delete', name),
  openSavesFolder: () => ipcRenderer.invoke('saves:open'),
  readProfile: () => ipcRenderer.invoke('profile:read'),
  writeProfile: text => ipcRenderer.invoke('profile:write', text),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
