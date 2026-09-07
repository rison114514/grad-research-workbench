'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Lifecycle = require('../renderer/js/task-lifecycle.js');

const now = new Date('2026-09-01T12:00:00.000Z').getTime();

test('完成圆圈：待办或进行中均直接完成，不再先移动到进行中', () => {
  const stamp = '2026-09-01T12:00:00.000Z';
  assert.deepEqual(Lifecycle.toggleCompletionPatch({ status: 'todo' }, stamp), { status: 'done', completedAt: stamp });
  assert.deepEqual(Lifecycle.toggleCompletionPatch({ status: 'doing' }, stamp), { status: 'done', completedAt: stamp });
});

test('完成圆圈：已完成任务再次点击会恢复为待办', () => {
  assert.deepEqual(Lifecycle.toggleCompletionPatch({ status: 'done' }), { status: 'todo', completedAt: null });
});

test('自动归档：完成超过 3 天才归档，三天整仍保留', () => {
  const threeDays = new Date(now - 3 * Lifecycle.DAY_MS).toISOString();
  const older = new Date(now - 3 * Lifecycle.DAY_MS - 1).toISOString();
  assert.equal(Lifecycle.isArchived({ status: 'done', completedAt: threeDays }, now), false);
  assert.equal(Lifecycle.isArchived({ status: 'done', completedAt: older }, now), true);
  assert.equal(Lifecycle.isArchived({ status: 'todo', completedAt: older }, now), false);
});

test('自动归档：兼容旧任务的 updatedAt，并正确划分当前与归档事项', () => {
  const old = { id: 'old', status: 'done', updatedAt: new Date(now - 5 * Lifecycle.DAY_MS).toISOString() };
  const recent = { id: 'recent', status: 'done', completedAt: new Date(now - Lifecycle.DAY_MS).toISOString() };
  const todo = { id: 'todo', status: 'todo' };
  const grouped = Lifecycle.partition([old, recent, todo], now);
  assert.deepEqual(grouped.archived.map((task) => task.id), ['old']);
  assert.deepEqual(grouped.active.map((task) => task.id), ['recent', 'todo']);
});

test('待办界面：归档入口存在，生命周期模块先于任务与看板加载', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const lifecycleIndex = html.indexOf('js/task-lifecycle.js');
  assert.match(html, /data-f="archive"/);
  assert.match(html, /id="taskArchiveCount"/);
  assert.ok(lifecycleIndex > -1 && lifecycleIndex < html.indexOf('js/tasks.js'));
  assert.ok(lifecycleIndex < html.indexOf('js/board.js'));
});

test('待办交互：点击卡片主体直接进入编辑，操作按钮保持独立', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'tasks.js'), 'utf8');
  assert.match(source, /if \(!btn\) \{ openTaskEditor\(id\); return; \}/);
  assert.match(source, /toggleCompletionPatch\(t\)/);
  assert.doesNotMatch(source, /t\.status === 'todo' \? 'doing' : 'done'/);
});
