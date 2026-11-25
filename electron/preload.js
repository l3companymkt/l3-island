const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandBridge', {
  resize: (mode) => ipcRenderer.send('island:mode', mode),
  openExternal: () => ipcRenderer.send('island:browser'),
  quit: () => ipcRenderer.send('island:quit'),
  setLoginItem: (on) => ipcRenderer.send('island:login', on),
  getLoginItem: () => ipcRenderer.sendSync('island:login-get'),
  onCommand: (fn) => ipcRenderer.on('island:command', (_e, cmd) => fn(cmd)),
});
