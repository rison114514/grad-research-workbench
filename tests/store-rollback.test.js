'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tempRoot = path.join(os.tmpdir(), `grad-workbench-rollback-${process.pid}-${Date.now()}`);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tempRoot } };
  return originalLoad.call(this, request, parent, isMain);
};

const store = require('../main/store.js');
Module._load = originalLoad;

beforeEach(() => {
  for (const domain of store.DOMAINS) {
    for (const item of [...store.list(domain)]) store.remove(domain, item.id);
  }
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function startTask(id = 'agent-1') {
  return store.create('agentTasks', {
    id,
    title: '可回滚任务',
    state: 'running',
    progress: 10,
    rollbackOps: []
  });
}

test('取消任务会恢复修改字段并移除本次新增记录', () => {
  const literature = store.create('literature', { title: '原文献', summary: '旧摘要' });
  store.saveSettings({ zoteroLastSyncAt: '旧时间', stableSetting: '保留' });
  startTask();

  store.transactionUpdate('agent-1', 'literature', literature.id, { summary: '新摘要', summarySource: 'ai' });
  store.transactionCreate('agent-1', 'tasks', { title: '新子任务', status: 'todo' });
  store.transactionBatchCreate('agent-1', 'activity', [
    { action: '一' },
    { action: '二' }
  ]);
  store.transactionSaveSettings('agent-1', { zoteroLastSyncAt: '新时间', zoteroLibraryVersion: '42' });

  store.update('agentTasks', 'agent-1', { state: 'canceled' });
  const result = store.rollbackTask('agent-1');

  assert.equal(result.ok, true);
  assert.equal(result.removedRecords, 3);
  assert.equal(store.list('tasks').length, 0);
  assert.equal(store.list('activity').length, 0);
  const restored = store.get('literature', literature.id);
  assert.equal(restored.summary, '旧摘要');
  assert.equal(Object.hasOwn(restored, 'summarySource'), false);
  const settings = store.getSettings();
  assert.equal(settings.zoteroLastSyncAt, '旧时间');
  assert.equal(settings.stableSetting, '保留');
  assert.equal(Object.hasOwn(settings, 'zoteroLibraryVersion'), false);
  assert.equal(store.get('agentTasks', 'agent-1').rollbackOps.length, 0);
});

test('同一字段若在任务写入后被人工修改，回滚会保留人工值并报告冲突', () => {
  const literature = store.create('literature', { title: '原文献', summary: '旧摘要', note: '旧备注' });
  startTask('agent-conflict');

  store.transactionUpdate('agent-conflict', 'literature', literature.id, { summary: '任务摘要' });
  store.update('literature', literature.id, { summary: '人工摘要', note: '人工备注' });
  store.update('agentTasks', 'agent-conflict', { state: 'canceled' });
  const result = store.rollbackTask('agent-conflict');

  assert.equal(result.ok, false);
  assert.ok(result.conflicts >= 1);
  const preserved = store.get('literature', literature.id);
  assert.equal(preserved.summary, '人工摘要');
  assert.equal(preserved.note, '人工备注');
});

test('任务进入取消终态后，迟到的事务写入会被主进程拒绝', () => {
  startTask('agent-canceled');
  store.update('agentTasks', 'agent-canceled', { state: 'canceled' });

  const created = store.transactionCreate('agent-canceled', 'tasks', { title: '不应写入' });
  assert.equal(created, null);
  assert.equal(store.list('tasks').length, 0);
});
