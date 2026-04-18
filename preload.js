const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timetrackFiles', {
  list:   ()           => ipcRenderer.invoke('files:list'),
  switch: (path)       => ipcRenderer.invoke('files:switch', path),
  create: (name)       => ipcRenderer.invoke('files:new', name),
  open:   ()           => ipcRenderer.invoke('files:open'),
});
