'use strict';

function isUsableWindow(win) {
  if (!win) return false;
  return typeof win.isDestroyed !== 'function' || !win.isDestroyed();
}

/**
 * 单实例事件到来时，旧进程可能只剩悬浮球、主窗口已经关闭。
 * 此时必须重建主窗口，不能只在 currentWindow 非空时尝试 show。
 */
function recoverMainWindow(currentWindow, createWindow) {
  const win = isUsableWindow(currentWindow) ? currentWindow : createWindow();
  if (!isUsableWindow(win)) return null;
  if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
  if (typeof win.show === 'function') win.show();
  if (typeof win.focus === 'function') win.focus();
  return win;
}

/** Windows 关闭主窗口即退出；悬浮球不能作为后台常驻进程继续持有单实例锁。 */
function quitAfterMainClosed(platform, companion, application) {
  if (platform !== 'win32') return false;
  companion.destroyPetWindow();
  application.quit();
  return true;
}

module.exports = { isUsableWindow, recoverMainWindow, quitAfterMainClosed };
