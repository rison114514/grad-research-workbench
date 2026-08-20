'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const elements = new Map();
const writes = [];
const rollbacks = [];
const commits = [];

function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      innerHTML: '',
      textContent: '',
      className: '',
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}
    });
  }
  return elements.get(id);
}

global.document = {
  getElementById: element,
  querySelectorAll: () => [],
  addEventListener() {}
};
global.confirm = () => true;
global.App = {
  esc: (value) => String(value ?? ''),
  markdown: (value) => String(value ?? ''),
  toast() {},
  navigate() {}
};
global.window = {
  api: {
    store: {
      list: async () => [],
      create: async (domain, record) => ({ id: 'created', ...record }),
      update: async (domain, id, patch) => {
        writes.push({ domain, id, patch: { ...patch } });
        return { id, ...patch };
      },
      remove: async () => true,
      rollbackTask: async (id) => {
        rollbacks.push(id);
        return { ok: true, operationCount: 1, restoredFields: 2, removedRecords: 1, conflicts: 0 };
      },
      commitTask: async (id) => { commits.push(id); return true; }
    }
  }
};

require(path.join(__dirname, '..', 'renderer', 'js', 'agent-tasks.js'));
const AgentTasks = global.window.AgentTasks;

beforeEach(() => {
  AgentTasks.tasks = [];
  AgentTasks.activeId = null;
  AgentTasks.filter = 'all';
  AgentTasks.cancelHandlers = new Map();
  elements.clear();
  writes.length = 0;
  rollbacks.length = 0;
  commits.length = 0;
});

test('取消成为终态，迟到的完成回调不能覆盖', async () => {
  AgentTasks.tasks = [{
    id: 'task-1', title: '后台摘要', goal: '生成摘要', detail: '请求模型',
    state: 'running', progress: 42, steps: [], createdAt: new Date().toISOString()
  }];
  AgentTasks.activeId = 'task-1';

  await AgentTasks.cancel('task-1');
  assert.equal(AgentTasks.tasks[0].state, 'canceled');
  assert.equal(AgentTasks.isCanceled('task-1'), true);
  assert.equal(writes.at(-1).patch.state, 'canceled');
  assert.deepEqual(rollbacks, ['task-1']);
  assert.equal(AgentTasks.tasks[0].detail, '已取消，已恢复执行前状态');

  const writeCount = writes.length;
  await AgentTasks.complete('task-1', '迟到的完成结果');
  assert.equal(AgentTasks.tasks[0].state, 'canceled');
  assert.equal(writes.length, writeCount, '取消后的完成回调不应再次写入');
});

test('任务正常完成会提交并清除回滚日志', async () => {
  AgentTasks.tasks = [{
    id: 'task-done', title: '正常任务', goal: '完成任务', detail: '执行中',
    state: 'running', progress: 80, steps: [], createdAt: new Date().toISOString()
  }];

  await AgentTasks.complete('task-done', '已完成');
  assert.deepEqual(commits, ['task-done']);
  assert.equal(AgentTasks.tasks[0].state, 'done');
});

test('需要人工处理时，取消按钮与人工处理按钮并排且样式一致', () => {
  AgentTasks.tasks = [{
    id: 'task-2', title: 'Zotero 同步', goal: '同步文献', detail: '需要处理',
    state: 'needs_input', progress: 52, steps: [], validation: [], createdAt: new Date().toISOString()
  }];
  AgentTasks.activeId = 'task-2';

  AgentTasks.renderDetail();
  const html = element('agentTaskDetailPanel').innerHTML;
  assert.match(html, /class="task-detail-actions">.*data-task-action="resolve".*data-task-action="cancel"/s);
  assert.match(html, /class="btn" data-task-action="resolve"/);
  assert.match(html, /class="btn" data-task-action="cancel"/);
});

test('运行中和等待确认的任务也显示取消入口', () => {
  for (const task of [
    { id: 'running', state: 'running', kind: 'general' },
    { id: 'waiting', state: 'waiting_confirmation', kind: 'task-planning' }
  ]) {
    AgentTasks.tasks = [{
      ...task, title: '测试任务', goal: '测试目标', detail: '处理中', progress: 50,
      steps: [], validation: [], createdAt: new Date().toISOString()
    }];
    AgentTasks.activeId = task.id;
    AgentTasks.renderDetail();
    const html = element('agentTaskDetailPanel').innerHTML;
    assert.match(html, /data-task-action="cancel"/);
    if (task.state === 'waiting_confirmation') assert.match(html, /data-task-action="resume-plan"/);
  }
});
