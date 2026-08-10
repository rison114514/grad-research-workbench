'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const petWindow = require('./pet-window');
const { recoverMainWindow, quitAfterMainClosed } = require('./app-lifecycle');

let mainWindow = null;
let isQuitting = false;

// Windows 透明窗口支持（桌面宠物悬浮球需要；enable-transparent-visuals 为透明必需，
// 注意不要加 disable-gpu-compositing——部分 Win 环境强制软件合成会致透明窗口整窗不渲染）
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

// 单实例锁：防止重复启动产生多个应用进程/多个桌面宠物窗口（Windows 尤其关键）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 正常情况唤起现有主窗口；若旧进程只剩悬浮球，则重建主窗口自恢复。
    mainWindow = recoverMainWindow(mainWindow, createWindow);
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
    // Windows 不采用 macOS 的“关窗不退应用”语义。悬浮球必须随主窗口关闭，
    // 否则旧进程会继续持有单实例锁，下一次启动无法创建主窗口。
    if (!isQuitting) quitAfterMainClosed(process.platform, petWindow, app);
  });

  return mainWindow;
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
    } catch (e) { console.error('[pet] 恢复桌面宠物失败:', e); /* 恢复失败不影响启动 */ }

    app.on('activate', () => {
      // macOS 可能只剩悬浮球窗口；不能用 getAllWindows().length 判断主窗口是否存在。
      mainWindow = recoverMainWindow(mainWindow, createWindow);
    });
  });

  app.on('window-all-closed', () => {
    petWindow.destroyPetWindow();
    if (process.platform !== 'darwin') app.quit();
  });

  // 覆盖 Cmd+Q、系统退出、更新退出等不经过 mainWindow.closed 的路径。
  app.on('before-quit', () => {
    isQuitting = true;
    petWindow.destroyPetWindow();
  });
}
