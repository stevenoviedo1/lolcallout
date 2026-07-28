const { contextBridge, ipcRenderer, shell } = require("electron");

contextBridge.exposeInMainWorld("lolcallout", {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  setAlwaysOnTop: (on) => ipcRenderer.invoke("app:setAlwaysOnTop", Boolean(on)),
});
