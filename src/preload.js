'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshApp', {
  name: 'dsh app',
  installDsh: () => ipcRenderer.invoke('dsh:install'),
  retryBoot: () => ipcRenderer.invoke('dsh:retry-boot'),
  theme: {
    report: (theme) => ipcRenderer.send('theme:report', theme),
    onSet: (cb) => {
      const listener = (_event, theme) => cb(theme);
      ipcRenderer.on('theme:set', listener);
      return () => ipcRenderer.removeListener('theme:set', listener);
    },
  },
  plaza: {
    show: (which) => ipcRenderer.invoke('plaza:show', which),
    onActive: (cb) => {
      const listener = (_event, which) => cb(which);
      ipcRenderer.on('plaza:active', listener);
      return () => ipcRenderer.removeListener('plaza:active', listener);
    },
  },
  marketplace: {
    snapshot: () => ipcRenderer.invoke('market:snapshot'),
    install: (pluginId) => ipcRenderer.invoke('market:install', pluginId),
    uninstall: (pluginId) => ipcRenderer.invoke('market:uninstall', pluginId),
    repair: (pluginId) => ipcRenderer.invoke('market:repair', pluginId),
    openUrl: (url) => ipcRenderer.invoke('market:open-url', url),
  },
});
