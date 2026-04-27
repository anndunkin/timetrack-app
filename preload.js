const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timetrackFiles', {
  list:       ()           => ipcRenderer.invoke('files:list'),
  switch:     (path)       => ipcRenderer.invoke('files:switch', path),
  create:     (name)       => ipcRenderer.invoke('files:new', name),
  open:       ()           => ipcRenderer.invoke('files:open'),
  saveAs:     ()           => ipcRenderer.invoke('files:saveas'),
  exportOrg:  (orgId)      => ipcRenderer.invoke('orgs:export', orgId),
  /** Subscribe to file-switch events triggered from the native menu.
   *  cb receives the updated registry array (active file is index 0).
   *  Returns an unsubscribe function. */
  onReloaded: (cb) => {
    const handler = (_event, registry) => cb(registry);
    ipcRenderer.on('files:reloaded', handler);
    return () => ipcRenderer.removeListener('files:reloaded', handler);
  },
});
