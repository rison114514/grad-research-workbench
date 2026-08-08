'use strict';

/**
 * IPC 通道注册
 * 渲染进程通过 preload 暴露的白名单 API 与主进程通信。
 * 所有数据操作均落盘本地，AI/GitHub 网络请求统一由主进程发起。
 */
const { ipcMain, dialog, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const petWindow = require('./pet-window');
const fsService = require('./fs-service');
const github = require('./github-service');
const ai = require('./ai-service');
const reportService = require('./report-service');
const pdfService = require('./pdf-service');
const zotero = require('./zotero-service');

function registerIpc() {
  /* ---------- 通用 ---------- */
  ipcMain.handle('app:getVersion', () => ({ version: app.getVersion(), platform: process.platform }));

  /* ---------- 数据 CRUD（通用化） ---------- */
  ipcMain.handle('store:list', (e, domain) => store.list(domain));
  ipcMain.handle('store:create', (e, domain, record) => store.create(domain, record));
  ipcMain.handle('store:update', (e, domain, id, patch) => store.update(domain, id, patch));
  ipcMain.handle('store:remove', (e, domain, id) => store.remove(domain, id));
  ipcMain.handle('store:batchCreate', (e, domain, records) => store.batchCreate(domain, records));
  ipcMain.handle('store:upsertBy', (e, domain, keyField, record) => store.upsertBy(domain, keyField, record));
  ipcMain.handle('store:getSettings', () => store.getSettings());
  ipcMain.handle('store:saveSettings', (e, patch) => store.saveSettings(patch));
  ipcMain.handle('store:getDataDir', () => store.getDataDirPath());
  ipcMain.handle('store:openDataDir', () => shell.openPath(store.getDataDirPath()));
  ipcMain.handle('store:backup', () => store.backupAll());
  ipcMain.handle('store:taskStats', () => store.taskStats());

  /* ---------- 文件系统 / 项目 ---------- */
  ipcMain.handle('dialog:pickProjectFolder', async () => {
    const win = require('electron').BrowserWindow.getFocusedWindow() ||
      require('electron').BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, {
      title: '选择项目文件夹',
      properties: ['openDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:pickPdf', async () => {
    const win = require('electron').BrowserWindow.getFocusedWindow() ||
      require('electron').BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, {
      title: '导入 PDF 文献',
      properties: ['openFile'],
      filters: [{ name: 'PDF 文献', extensions: ['pdf'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    const stat = fs.statSync(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size };
  });

  ipcMain.handle('fs:scanTree', (e, rootPath, maxDepth) => {
    try {
      return { ok: true, tree: fsService.scanTree(rootPath, maxDepth || 6) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* 桌面宠物：选择本地图片（头像） */
  ipcMain.handle('dialog:pickImage', async () => {
    const win = require('electron').BrowserWindow.getFocusedWindow() ||
      require('electron').BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, {
      title: '选择宠物头像图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
    return { ok: true, path: res.filePaths[0] };
  });

  /* 桌面宠物：读取本地图片为 base64 data URI（CSP img-src 已含 data:） */
  ipcMain.handle('fs:readImage', async (e, filePath) => {
    try {
      const buf = fs.readFileSync(filePath);
      if (buf.length > 5 * 1024 * 1024) return { ok: false, error: '图片过大（限 5MB）' };
      const ext = String(filePath).split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
      return { ok: true, dataUri: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:buildGraph', (e, rootPath) => {
    try {
      const tree = fsService.scanTree(rootPath, 6);
      return { ok: true, graph: fsService.buildGraph(tree, rootPath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:readTextFile', (e, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { ok: true, content: content.slice(0, 50000), truncated: content.length > 50000 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:pathInfo', (e, p) => {
    try {
      const s = fs.statSync(p);
      return { ok: true, isDir: s.isDirectory(), size: s.size, modified: s.mtime.toISOString() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('pdf:extract', async (e, filePath) => {
    try {
      return await pdfService.extract(filePath);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:exportMarkdown', async (e, { defaultName, content }) => {
    const win = require('electron').BrowserWindow.getAllWindows()[0];
    const res = await dialog.showSaveDialog(win, {
      title: '导出 Markdown',
      defaultPath: path.join(app.getPath('documents'), `${defaultName || 'report'}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, content, 'utf-8');
    return { ok: true, filePath: res.filePath };
  });

  /* 多文件导出：选择目录后逐个写入（历史报告多选导出） */
  ipcMain.handle('dialog:exportMarkdowns', async (e, { files }) => {
    const win = require('electron').BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, {
      title: '选择导出目录',
      buttonLabel: '导出到此目录',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const dir = res.filePaths[0];
    const written = [];
    for (const f of files || []) {
      const safe = String(f.name || 'report').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
      const fp = path.join(dir, `${safe}.md`);
      fs.writeFileSync(fp, f.content || '', 'utf-8');
      written.push(fp);
    }
    return { ok: true, files: written };
  });

  /* ---------- GitHub ---------- */
  ipcMain.handle('github:searchTrending', async (e, keyword, perPage) => {
    const token = store.getSettings().githubToken || '';
    try {
      const r = await github.searchTrending(keyword, token, perPage || 15);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('github:repoReleases', async (e, fullName, perPage) => {
    const token = store.getSettings().githubToken || '';
    try {
      const r = await github.repoReleases(fullName, token, perPage || 5);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('github:repoInfo', async (e, fullName) => {
    const token = store.getSettings().githubToken || '';
    try {
      const r = await github.repoInfo(fullName, token);
      return { ok: !!r, repo: r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* 官网 trending（github.com/trending 页面抓取，匿名可用） */
  ipcMain.handle('github:trending', async (e, opts) => {
    const token = store.getSettings().githubToken || '';
    try {
      const r = await github.fetchOfficialTrending(opts || {}, token);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ---------- AI ---------- */
  ipcMain.handle('ai:providers', () => ai.PROVIDERS);
  ipcMain.handle('ai:test', async (e, settings) => await ai.testConnection(settings || store.getSettings()));
  ipcMain.handle('ai:chat', async (e, messages, opts) => {
    const settings = store.getSettings();
    return await ai.chat(messages, settings, opts || {});
  });
  ipcMain.handle('ai:chatTools', async (e, messages, tools, opts) => {
    const settings = store.getSettings();
    return await ai.chatWithTools(messages, tools, settings, opts || {});
  });
  ipcMain.handle('ai:summarizeLiterature', async (e, meta) => {
    return await ai.summarizeLiterature(meta, store.getSettings());
  });
  ipcMain.handle('ai:polishReport', async (e, content, typeLabel) => {
    return await ai.polishReport(content, store.getSettings(), typeLabel || '报告');
  });
  ipcMain.handle('ai:splitTask', async (e, taskTitle) => {
    return await ai.splitTask(taskTitle, store.getSettings());
  });
  ipcMain.handle('ai:parseNaturalTask', (e, text) => ai.parseNaturalTask(text));
  ipcMain.handle('ai:isConfigured', () => ai.isConfigured(store.getSettings()));

  /* ---------- Zotero（只读） ---------- */
  ipcMain.handle('zotero:test', async (e, config) => {
    try { return { ok: true, ...(await zotero.testConnection(config || {})) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('zotero:sync', async (e, config) => {
    try { return { ok: true, ...(await zotero.fetchLibrary(config || {})) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  /* ---------- 报告 ---------- */
  ipcMain.handle('report:generate', async (e, type, date, opts) => {
    return await reportService.generate(type, date, opts || {});
  });

  /* ---------- 外部链接 ---------- */
  ipcMain.handle('shell:openExternal', (e, url) => {
    if (typeof url === 'string' && url.startsWith('http')) shell.openExternal(url);
  });
  ipcMain.handle('pet:isDesktop', () => true);
  ipcMain.handle('pet:setEnabled', (e, enabled) => {
    if (enabled) petWindow.createPetWindow();
    else petWindow.destroyPetWindow();
    return { ok: true };
  });
  ipcMain.handle('pet:openChat', () => {
    petWindow.setMode('chat');
    petWindow.ensureMainVisible(); // 最小化/隐藏的主窗口自动恢复（悬浮球展开聊天即唤起工作台）
    return { ok: true };
  });
  ipcMain.handle('pet:closeChat', () => { petWindow.setMode('ball'); return { ok: true }; });
  ipcMain.handle('pet:getState', () => petWindow.getState());
  ipcMain.handle('pet:focusMain', () => { petWindow.focusMain(); return { ok: true }; });
  ipcMain.handle('pet:move', (e, dx, dy) => { petWindow.moveBy(Number(dx) || 0, Number(dy) || 0); return { ok: true }; });
}

module.exports = { registerIpc };
