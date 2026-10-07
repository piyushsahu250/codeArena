// Minimal, isolated bridge: the page can read the client's status and ask for an invigilator exit. It can NOT read the device
// secret, the secure token (that lives in sessionStorage only for the page's own API calls) or any Node API.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("codearenaSecureClient", {
  version: "1.0.0",
  onStatus: (cb) => ipcRenderer.on("secure:status", (_e, s) => cb(s)),
  invigilatorExit: (pin) => ipcRenderer.invoke("secure:invigilator-exit", String(pin || "")),
});
