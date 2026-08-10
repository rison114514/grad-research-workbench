'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recoverMainWindow,
  quitAfterMainClosed
} = require('../main/app-lifecycle');

function fakeWindow({ minimized = false, destroyed = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  };
}

test('Windows 单实例恢复：旧进程只剩悬浮球时重建主窗口', () => {
  const replacement = fakeWindow();
  let creates = 0;
  const result = recoverMainWindow(null, () => { creates += 1; return replacement; });
  assert.equal(creates, 1);
  assert.equal(result, replacement);
  assert.deepEqual(replacement.calls, ['show', 'focus']);
});

test('单实例恢复：现有主窗口最小化时恢复，不重复创建', () => {
  const current = fakeWindow({ minimized: true });
  const result = recoverMainWindow(current, () => assert.fail('不应重建可用主窗口'));
  assert.equal(result, current);
  assert.deepEqual(current.calls, ['restore', 'show', 'focus']);
});

test('Windows 关闭主窗口：先销毁悬浮球，再退出进程', () => {
  const calls = [];
  const handled = quitAfterMainClosed(
    'win32',
    { destroyPetWindow: () => calls.push('destroy-pet') },
    { quit: () => calls.push('quit') }
  );
  assert.equal(handled, true);
  assert.deepEqual(calls, ['destroy-pet', 'quit']);
});

test('macOS 关闭主窗口：保留系统原生关窗语义，不强制退出', () => {
  const calls = [];
  const handled = quitAfterMainClosed(
    'darwin',
    { destroyPetWindow: () => calls.push('destroy-pet') },
    { quit: () => calls.push('quit') }
  );
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});
