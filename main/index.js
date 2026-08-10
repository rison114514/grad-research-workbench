'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const petWindow = require('./pet-window');

let mainWindow = null;

// 单实例锁：防止重复启动产生多个应用进程/多个桌面宠物窗口（Windows 尤其关键）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 已有实例运行时再次启动 → 唤起主窗口（不新建进程，不重复创建宠物）
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '科研工作台 · Graduate Research Workbench',
    backgroundColor: '#f4f6fb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (gotLock) {
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    // 若设置开启桌面宠物 → 恢复系统级悬浮球（独立于主窗口）
    try {
      const store = require('./store');
      const st = store.getSettings();
      if (st.petEnabled) petWindow.createPetWindow();
    } catch (e) { /* 恢复失败不影响启动 */ }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    petWindow.destroyPetWindow();
    if (process.platform !== 'darwin') app.quit();
  });
}
