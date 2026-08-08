'use strict';

/* ============ 应用初始化 ============ */

/* 全局错误兜底：让未捕获异常可见（toast 提示），避免页面"莫名无响应" */
window.addEventListener('error', (event) => {
  console.error('[global-error]', event.message, event.filename, event.lineno);
  try {
    App.toast(`页面错误：${event.message}`, 'error', 5000);
  } catch (e) { /* ignore */ }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason && reason.message ? reason.message : String(reason || '未知 Promise 错误');
  console.error('[unhandled-rejection]', reason);
  try {
    App.toast(`异步错误：${message}`, 'error', 5000);
  } catch (e) { /* ignore */ }
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await App.init();
  } catch (e) {
    console.error('初始化失败:', e);
    try {
      App.toast('初始化失败: ' + e.message, 'error');
    } catch (inner) { /* ignore */ }
  }
});
