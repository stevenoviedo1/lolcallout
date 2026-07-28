// Reserved for future secure bridge; UI uses query params for API URLs.
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("lolcallout", {
  isElectron: true,
});
