const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('reader', {
  init: () => invoke('app:init'),
  open: () => invoke('book:open-dialog'),
  load: file => invoke('book:load', file),
  demo: () => invoke('book:demo'),
  drop: file => invoke('book:load', webUtils.getPathForFile(file)),
  remember: (id, metadata) => invoke('book:remember', id, metadata),
  saveBook: (id, state) => invoke('book:save', id, state),
  saveSettings: settings => invoke('settings:save', settings),
  window: action => invoke('window:action', action),
  onExternal: callback => ipcRenderer.on('book:external', (_event, file) => callback(file)),
  onMaximized: callback => ipcRenderer.on('window:maximized', (_event, value) => callback(value))
});
