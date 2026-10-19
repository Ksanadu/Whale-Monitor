'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('whaleDesktop', {
  regions: (rects, editing) => ipcRenderer.send('whale:regions', {rects, editing: editing === true}),
  openMonitor: () => ipcRenderer.send('whale:openMonitor')
});
