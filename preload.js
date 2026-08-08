'use strict';

/**
 * 安全桥：向渲染进程暴露白名单 API（contextIsolation 开启）
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  },
  store: {
    list: (d) => ipcRenderer.invoke('store:list', d),
    create: (d, r) => ipcRenderer.invoke('store:create', d, r),
    update: (d, id, p) => ipcRenderer.invoke('store:update', d, id, p),
    remove: (d, id) => ipcRenderer.invoke('store:remove', d, id),
    batchCreate: (d, rs) => ipcRenderer.invoke('store:batchCreate', d, rs),
    upsertBy: (d, k, r) => ipcRenderer.invoke('store:upsertBy', d, k, r),
    getSettings: () => ipcRenderer.invoke('store:getSettings'),
    saveSettings: (p) => ipcRenderer.invoke('store:saveSettings', p),
    getDataDir: () => ipcRenderer.invoke('store:getDataDir'),
    openDataDir: () => ipcRenderer.invoke('store:openDataDir'),
    backup: () => ipcRenderer.invoke('store:backup'),
    taskStats: () => ipcRenderer.invoke('store:taskStats')
  },
  dialog: {
    pickProjectFolder: () => ipcRenderer.invoke('dialog:pickProjectFolder'),
    pickPdf: () => ipcRenderer.invoke('dialog:pickPdf'),
    pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
    exportMarkdown: (o) => ipcRenderer.invoke('dialog:exportMarkdown', o),
    exportMarkdowns: (o) => ipcRenderer.invoke('dialog:exportMarkdowns', o)
  },
  fs: {
    scanTree: (p, d) => ipcRenderer.invoke('fs:scanTree', p, d),
    readImage: (f) => ipcRenderer.invoke('fs:readImage', f),
    buildGraph: (p) => ipcRenderer.invoke('fs:buildGraph', p),
    readTextFile: (p) => ipcRenderer.invoke('fs:readTextFile', p),
    pathInfo: (p) => ipcRenderer.invoke('fs:pathInfo', p)
  },
  pdf: {
    extract: (p) => ipcRenderer.invoke('pdf:extract', p)
  },
  github: {
    searchTrending: (k, n) => ipcRenderer.invoke('github:searchTrending', k, n),
    repoReleases: (f, n) => ipcRenderer.invoke('github:repoReleases', f, n),
    repoInfo: (f) => ipcRenderer.invoke('github:repoInfo', f),
    trending: (o) => ipcRenderer.invoke('github:trending', o)
  },
  ai: {
    providers: () => ipcRenderer.invoke('ai:providers'),
    test: (s) => ipcRenderer.invoke('ai:test', s),
    chat: (m, o) => ipcRenderer.invoke('ai:chat', m, o),
    chatTools: (m, t, o) => ipcRenderer.invoke('ai:chatTools', m, t, o),
    summarizeLiterature: (meta) => ipcRenderer.invoke('ai:summarizeLiterature', meta),
    polishReport: (c, t) => ipcRenderer.invoke('ai:polishReport', c, t),
    splitTask: (t) => ipcRenderer.invoke('ai:splitTask', t),
    parseNaturalTask: (t) => ipcRenderer.invoke('ai:parseNaturalTask', t),
    isConfigured: () => ipcRenderer.invoke('ai:isConfigured')
  },
  report: {
    generate: (t, d, o) => ipcRenderer.invoke('report:generate', t, d, o)
  },
  zotero: {
    test: (config) => ipcRenderer.invoke('zotero:test', config),
    sync: (config) => ipcRenderer.invoke('zotero:sync', config)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  pet: {
    isDesktop: () => ipcRenderer.invoke('pet:isDesktop'),
    setEnabled: (b) => ipcRenderer.invoke('pet:setEnabled', b),
    openChat: () => ipcRenderer.invoke('pet:openChat'),
    closeChat: () => ipcRenderer.invoke('pet:closeChat'),
    getState: () => ipcRenderer.invoke('pet:getState'),
    focusMain: () => ipcRenderer.invoke('pet:focusMain'),
    move: (dx, dy) => ipcRenderer.invoke('pet:move', dx, dy),
    onModeChanged: (cb) => ipcRenderer.on('pet:mode-changed', (e, m) => cb(m))
  }
});
