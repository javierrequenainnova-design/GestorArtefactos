const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportData: () => ipcRenderer.invoke('dialog:export'),
  importData: () => ipcRenderer.invoke('dialog:import'),
  onDataImported: (callback) => ipcRenderer.on('data:imported', (event, data) => callback(data)),
  // Zoom del lienzo pedido desde el menú Ver: 'in' | 'out' | 'reset'
  onCanvasZoom: (callback) => ipcRenderer.on('canvas:zoom', (event, action) => callback(action)),
  // Carpeta donde se guardan los datos
  getDataFolder: () => ipcRenderer.invoke('folder:get'),
  changeDataFolder: () => ipcRenderer.invoke('folder:change'),
  resetDataFolder: () => ipcRenderer.invoke('folder:reset'),
  openDataFolder: () => ipcRenderer.invoke('folder:open'),
  onDataFolderChanged: (callback) => ipcRenderer.on('folder:changed', (event, info) => callback(info))
});
