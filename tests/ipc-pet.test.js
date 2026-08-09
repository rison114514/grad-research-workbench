'use strict';
/* IPC 悬浮球行为回归测试：pet:openChat 只展开桌宠对话框，不得唤起最小化主窗口
 * 回归背景：v1.5.0 中 pet:openChat 调用了 ensureMainVisible()，导致点击悬浮球
 * 会同时展开最小化的工作台 —— 正确语义：主窗口只由程序坞/双击悬浮球（focusMain）唤起。
 */
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

/* ---------- mock：electron + pet-window ---------- */
const handlers = {};
const calls = { setMode: [], ensureMainVisible: 0, focusMain: 0 };
const mockPetWindow = {
  setMode: (m) => calls.setMode.push(m),
  ensureMainVisible: () => { calls.ensureMainVisible++; }, // 若被调用即视为回归失败
  focusMain: () => { calls.focusMain++; },
  getState: () => ({ mode: 'ball' }),
  moveBy: () => {},
  createPetWindow: () => {}, destroyPetWindow: () => {}
};
const mockElectron = {
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: {},
  app: { getVersion: () => '1.5.1', getPath: () => '/tmp/ipc-test-userdata', getAppPath: () => '/tmp' },
  shell: { openPath: async () => '', openExternal: async () => {} },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  if (request === './pet-window') return mockPetWindow;
  return origLoad.apply(this, arguments);
};

const { registerIpc } = require(path.join(__dirname, '..', 'main', 'ipc.js'));

before(() => { registerIpc(); });

test('pet:openChat：只展开对话框（setMode chat），不唤起主窗口（ensureMainVisible=0）', () => {
  const r = handlers['pet:openChat']();
  assert.deepEqual(calls.setMode, ['chat'], '应仅调用 setMode(chat)');
  assert.equal(calls.ensureMainVisible, 0, '回归失败：不得调用 ensureMainVisible（最小化主窗口不应被唤起）');
  assert.equal(r.ok, true);
});

test('pet:focusMain：双击悬浮球仍可唤起主窗口（显式意图保留）', () => {
  handlers['pet:focusMain']();
  assert.equal(calls.focusMain, 1, 'focusMain 应保留唤起主窗口能力');
  assert.equal(calls.ensureMainVisible, 0, 'openChat 链路仍不应触发 ensureMainVisible');
});

test('pet:closeChat：收起对话框回到 ball 态', () => {
  handlers['pet:closeChat']();
  assert.deepEqual(calls.setMode, ['chat', 'ball']);
});
