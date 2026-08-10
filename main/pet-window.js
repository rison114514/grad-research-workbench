'use strict';

/**
 * 桌面宠物悬浮球（系统级独立窗口）
 * - 透明无边框、置顶、不进任务栏，独立于主窗口悬浮于桌面
 * - 双态：ball（132x132 悬浮球）⇄ chat（340x520 聊天窗），右下角锚定切换
 * - 位置持久化到 userData/pet-pos.json（拖动自动保存）
 * - 桌面宠物 = Agent 的悬浮入口：页面仅负责渲染与输入，能力全在渲染层 Agent 链路
 */
const { BrowserWindow, app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const BALL_W = 132;
const BALL_H = 132;
const CHAT_W = 340;
const CHAT_H = 520;
const TRANSPARENT_COLOR = 'rgba(0, 0, 0, 0)';

let petWindow = null;
let mode = 'ball';

/**
 * Electron 的 transparent:true 只开启透明能力，Windows 11 的 DWM 仍可能为
 * 无边框窗口附加 auto backdrop / accent border。窗口首次绘制和 setBounds 后
 * 都重新清空这些原生材质，避免整个 132x132 surface 被补成白色圆角矩形。
 */
function enforceTransparentSurface(win, platform = process.platform) {
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(TRANSPARENT_COLOR);
  win.setHasShadow(false);
  if (platform === 'win32') {
    if (typeof win.setBackgroundMaterial === 'function') win.setBackgroundMaterial('none');
    if (typeof win.setAccentColor === 'function') win.setAccentColor(false);
  }
}

function posPath() {
  return path.join(app.getPath('userData'), 'pet-pos.json');
}

function loadPos() {
  try {
    const obj = JSON.parse(fs.readFileSync(posPath(), 'utf-8'));
    if (typeof obj.x === 'number' && typeof obj.y === 'number') {
      // 屏外校验：坐标须落在当前任一显示器 workArea 内（显示器布局变更后窗口建于屏外会「看似消失」）
      const inAnyDisplay = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return obj.x >= a.x && obj.x < a.x + a.width && obj.y >= a.y && obj.y < a.y + a.height;
      });
      if (inAnyDisplay) return obj;
    }
  } catch (e) { /* 无保存位置 */ }
  return null;
}

function savePos(x, y) {
  try {
    fs.writeFileSync(posPath(), JSON.stringify({ x, y }));
  } catch (e) { /* 忽略写失败 */ }
}

function createPetWindow() {
  if (petWindow) return;
  const saved = loadPos();
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const x = saved ? saved.x : wa.width - BALL_W - 28;
  const y = saved ? saved.y : wa.height - BALL_H - 64;
  petWindow = new BrowserWindow({
    width: BALL_W,
    height: BALL_H,
    x, y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: TRANSPARENT_COLOR,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  enforceTransparentSurface(petWindow);
  petWindow.setAlwaysOnTop(true);

  // 避免 CSS 尚未加载时显示 Chromium 默认白色首帧；首个完整透明帧准备好后再展示。
  const reveal = () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    enforceTransparentSurface(petWindow);
    if (!petWindow.isVisible()) {
      if (typeof petWindow.showInactive === 'function') petWindow.showInactive();
      else petWindow.show();
    }
  };
  petWindow.once('ready-to-show', reveal);
  petWindow.webContents.once('did-finish-load', () => {
    enforceTransparentSurface(petWindow);
  });
  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet-floating.html'))
    .then(reveal)
    .catch((error) => console.error('[pet] 悬浮球页面加载失败:', error));
  let _moveSaveTimer = null;
  petWindow.on('moved', () => {
    if (!petWindow) return;
    clearTimeout(_moveSaveTimer);
    _moveSaveTimer = setTimeout(() => {
      if (!petWindow) return;
      const [px, py] = petWindow.getPosition();
      savePos(px, py);
    }, 400);
  });
  petWindow.on('closed', () => { petWindow = null; });
}

function destroyPetWindow() {
  if (petWindow) {
    petWindow.destroy();
    petWindow = null;
  }
  mode = 'ball';
}

/** 切换窗口形态（ball ⇄ chat），右下角锚定保持视觉位置（含销毁防护，防止卡死） */
function setMode(next) {
  const prev = mode;
  mode = next === 'chat' ? 'chat' : 'ball';
  if (!petWindow || petWindow.isDestroyed()) return;
  try {
    const [x, y] = petWindow.getPosition();
    const w = mode === 'chat' ? CHAT_W : BALL_W;
    const h = mode === 'chat' ? CHAT_H : BALL_H;
    // 双向右下角锚定：ball→chat 向左上扩展；chat→ball 右下对齐回原位（修复收起后球跑左上）
    let nx = x, ny = y;
    if (mode === 'chat' && prev === 'ball') { nx = x + BALL_W - CHAT_W; ny = y + BALL_H - CHAT_H; }
    else if (mode === 'ball' && prev === 'chat') { nx = x + CHAT_W - BALL_W; ny = y + CHAT_H - BALL_H; }
    petWindow.setBounds({ x: nx, y: ny, width: w, height: h });
    // Windows 在改变无边框窗口尺寸后可能重新应用 DWM backdrop。
    enforceTransparentSurface(petWindow);
    if (!petWindow.isDestroyed()) petWindow.webContents.send('pet:mode-changed', mode);
  } catch (e) { /* 窗口销毁等异常不阻断 */ }
}

/** 主窗口若最小化/不可见 → 恢复并聚焦（悬浮球展开聊天时自动唤起工作台） */
function ensureMainVisible() {
  const wins = BrowserWindow.getAllWindows();
  const main = wins.find((w) => w !== petWindow && !w.isDestroyed());
  if (!main) return false;
  const need = main.isMinimized() || !main.isVisible();
  if (main.isMinimized()) main.restore();
  if (!main.isVisible()) main.show();
  if (need) main.focus();
  return need;
}

/** 增量移动窗口（悬浮球手动拖动，替代 -webkit-app-region:drag） */
function moveBy(dx, dy) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  petWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
}

function getState() {
  return { enabled: !!petWindow, mode, position: petWindow ? petWindow.getPosition() : null };
}

/** 回到主窗口（悬浮球双击） */
function focusMain() {
  ensureMainVisible();
  const wins = BrowserWindow.getAllWindows();
  const main = wins.find((w) => w !== petWindow && !w.isDestroyed());
  if (main) { main.show(); main.focus(); }
}

module.exports = {
  BALL_W, BALL_H, CHAT_W, CHAT_H,
  TRANSPARENT_COLOR,
  enforceTransparentSurface,
  createPetWindow,
  destroyPetWindow,
  setMode,
  moveBy,
  getState,
  focusMain,
  ensureMainVisible
};
