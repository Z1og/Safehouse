const { contextBridge, ipcRenderer, webUtils } = require('electron');
const channels = ['state', 'scan', 'chooseGame', 'chooseImports', 'import', 'enable', 'uninstall', 'search', 'searchPlan', 'consoleShow', 'consoleHide', 'consoleBounds', 'consoleConnect', 'consoleReload', 'consoleAuth', 'consoleOpen', 'consoleZoom', 'panelInstall', 'panelReveal', 'details', 'subscribe', 'unsubscribe', 'translate', 'settings', 'cancel', 'retry', 'clearDownloads', 'open', 'projectLink', 'copyGroup', 'reveal', 'launch', 'openSteam', 'steamDownloads', 'window'];
const api = Object.fromEntries(channels.map(channel => [channel, (...args) => ipcRenderer.invoke(`safehouse:${channel}`, ...args)]));
api.consoleCopyConnection = () => ipcRenderer.invoke('safehouse:consoleCopyConnection');
api.onConsoleChanged = callback => { const listener = (_, value) => callback(value); ipcRenderer.on('safehouse:consoleChanged', listener); return () => ipcRenderer.removeListener('safehouse:consoleChanged', listener); };
api.filePath = file => webUtils.getPathForFile(file);
api.onChanged = listener => { const handler = () => listener(); ipcRenderer.on('safehouse:changed', handler); return () => ipcRenderer.removeListener('safehouse:changed', handler); };
contextBridge.exposeInMainWorld('safehouse', api);
