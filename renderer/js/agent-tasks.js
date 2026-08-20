'use strict';

/* Agent 任务中心：持久化规划、执行、验证与人工介入记录。 */
const AgentTasks = {
  tasks: [],
  activeId: null,
  filter: 'all',
  cancelHandlers: new Map(),

  async init() {
    await this.load();
    const card = document.getElementById('agentTaskCard');
    card.addEventListener('click', () => this.open());
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.open(); }
    });
    document.getElementById('agentTaskClose').addEventListener('click', () => this.close());
    document.getElementById('agentTaskMask').addEventListener('click', () => this.close());
    document.getElementById('agentTaskFilter').addEventListener('click', (event) => {
      const button = event.target.closest('[data-state]');
      if (!button) return;
      this.filter = button.dataset.state;
      document.querySelectorAll('#agentTaskFilter .seg-btn').forEach((item) => item.classList.toggle('active', item === button));
      this.renderList();
    });
    document.getElementById('agentTaskList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-task-id]');
      if (!item) return;
      this.activeId = item.dataset.taskId;
      this.renderList();
      this.renderDetail();
    });
    document.getElementById('agentTaskDetailPanel').addEventListener('click', (event) => {
      const action = event.target.closest('[data-task-action]')?.dataset.taskAction;
      if (action === 'resume-plan') this.resumePlan();
      if (action === 'resolve') this.resolveCurrent();
      if (action === 'cancel') this.cancelCurrent();
    });
    document.getElementById('agentTaskClear').addEventListener('click', () => this.clearCompleted());
  },

  async load() {
    this.tasks = (await window.api.store.list('agentTasks')).sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    if (this.activeId && !this.tasks.some((task) => task.id === this.activeId)) this.activeId = null;
    this.paint();
    this.renderList();
    this.renderDetail();
  },

  async start(title, detail = '正在准备…', options = {}) {
    const steps = (options.steps || []).map((label, index) => ({ label, state: index === 0 ? 'running' : 'pending', detail: '' }));
    const task = await window.api.store.create('agentTasks', {
      kind: options.kind || 'general',
      title,
      goal: options.goal || title,
      detail,
      state: 'running',
      progress: Math.max(1, Number(options.progress) || 5),
      steps,
      retryCount: 0,
      sourceRef: options.sourceRef || null,
      result: null,
      validation: [],
      error: null,
      rollbackOps: [],
      rollback: { state: 'recording', operationCount: 0 }
    });
    this.tasks.unshift(task);
    this.activeId = task.id;
    this.paint();
    this.renderList();
    return task.id;
  },

  async createRecord(taskId, domain, record) {
    if (this.isCanceled(taskId)) return null;
    return window.api.store.transactionCreate(taskId, domain, record);
  },

  async updateRecord(taskId, domain, id, patch) {
    if (this.isCanceled(taskId)) return null;
    return window.api.store.transactionUpdate(taskId, domain, id, patch);
  },

  async batchCreateRecords(taskId, domain, records) {
    if (this.isCanceled(taskId)) return [];
    return window.api.store.transactionBatchCreate(taskId, domain, records);
  },

  async saveSettings(taskId, patch) {
    if (this.isCanceled(taskId)) return null;
    return window.api.store.transactionSaveSettings(taskId, patch);
  },

  onCancel(taskId, handler) {
    if (typeof handler === 'function') this.cancelHandlers.set(taskId, handler);
  },

  async update(id, progress, detail, extra = {}) {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return null;
    // 取消是终态。后台 Promise 可能稍后返回，不能让迟到的进度或完成回调覆盖取消状态。
    if (task.state === 'canceled' && extra.state !== 'canceled') return task;
    const nextProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    const steps = (extra.steps || task.steps || []).map((step) => ({ ...step }));
    if (!extra.steps && steps.length) {
      const segment = 100 / steps.length;
      const activeIndex = Math.min(steps.length - 1, Math.floor(nextProgress / segment));
      steps.forEach((step, index) => {
        if (index < activeIndex) step.state = 'done';
        else if (index === activeIndex && nextProgress < 100) step.state = 'running';
        else if (nextProgress >= 100) step.state = 'done';
        else step.state = 'pending';
      });
    }
    const patch = { progress: nextProgress, detail: detail || task.detail, steps, state: extra.state || task.state, ...extra };
    const updated = await window.api.store.update('agentTasks', id, patch);
    // 处理“更新已发出、用户随后取消”的竞态：重新固化本地已经生效的取消终态。
    if (task.state === 'canceled' && extra.state !== 'canceled') {
      await window.api.store.update('agentTasks', id, {
        state: 'canceled', detail: task.detail, canceledAt: task.canceledAt
      });
      return task;
    }
    Object.assign(task, updated || patch);
    this.resort();
    this.paint();
    this.renderList();
    this.renderDetail();
    return task;
  },

  async complete(id, detail = '任务已完成', result = null, validation = []) {
    const completed = await this.update(id, 100, detail, { state: 'done', result, validation, error: null });
    if (completed && completed.state === 'done') {
      await window.api.store.commitTask(id);
      completed.rollbackOps = [];
      completed.rollback = { state: 'committed' };
      this.cancelHandlers.delete(id);
    }
    return completed;
  },

  async fail(id, detail = '任务执行失败', error = null) {
    const task = this.tasks.find((item) => item.id === id);
    const retryCount = (task && task.retryCount || 0) + 1;
    return this.update(id, task ? task.progress : 0, detail, { state: 'error', error: error || detail, retryCount });
  },

  async needsInput(id, detail, error = null) {
    const task = this.tasks.find((item) => item.id === id);
    return this.update(id, task ? task.progress : 0, detail, { state: 'needs_input', error: error || detail });
  },

  async waitForConfirmation(id, detail, result) {
    const task = this.tasks.find((item) => item.id === id);
    return this.update(id, task ? task.progress : 50, detail, { state: 'waiting_confirmation', result });
  },

  async cancel(id, detail = '已由用户取消') {
    const task = this.tasks.find((item) => item.id === id);
    if (!task || task.state === 'canceled' || task.state === 'done') return task || null;
    const canceledAt = new Date().toISOString();
    // 先同步更新内存，让仍在运行的流程能够立即在下一个检查点退出。
    Object.assign(task, { state: 'canceled', detail, canceledAt });
    this.resort();
    this.paint();
    this.renderList();
    this.renderDetail();
    const updated = await window.api.store.update('agentTasks', id, { state: 'canceled', detail, canceledAt });
    if (updated && task.state === 'canceled') Object.assign(task, updated);
    let rollback;
    try {
      rollback = await window.api.store.rollbackTask(id);
    } catch (error) {
      rollback = { ok: false, operationCount: 0, restoredFields: 0, removedRecords: 0, conflicts: 1, error: error.message };
    }
    const changed = (rollback.restoredFields || 0) + (rollback.removedRecords || 0);
    const finalDetail = rollback.conflicts
      ? `已取消；已恢复 ${changed} 项，${rollback.conflicts} 项因后续人工修改而保留`
      : rollback.operationCount
        ? '已取消，已恢复执行前状态'
        : '已取消，执行期间未产生本地数据变更';
    const finalPatch = { state: 'canceled', detail: finalDetail, canceledAt, rollback };
    const finalized = await window.api.store.update('agentTasks', id, finalPatch);
    Object.assign(task, finalized || finalPatch);
    const handler = this.cancelHandlers.get(id);
    this.cancelHandlers.delete(id);
    if (handler) {
      try { await handler(rollback); } catch (error) { console.error('[agent-task] 取消后界面恢复失败:', error); }
    }
    await this.refreshAfterRollback(task);
    this.resort();
    this.paint();
    this.renderList();
    this.renderDetail();
    return task;
  },

  async refreshAfterRollback(task) {
    if (!task) return;
    if (task.kind === 'task-planning') {
      if (window.Tasks?.splitDraft?.agentTaskId === task.id) window.Tasks.splitDraft = null;
      window.Modal?.close('splitPlanModal');
      if (window.Tasks?.render) await window.Tasks.render();
      window.Board?.invalidate();
    }
    if (['literature-summary', 'pdf-literature', 'zotero-sync'].includes(task.kind) && window.Literature?.render) {
      await window.Literature.render();
    }
  },

  isCanceled(id) {
    return this.tasks.some((task) => task.id === id && task.state === 'canceled');
  },

  isCancelable(task) {
    return !!task && ['running', 'waiting_confirmation', 'needs_input', 'error'].includes(task.state);
  },

  resort() {
    this.tasks.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  },

  open() {
    document.getElementById('agentTaskDrawer').classList.add('open');
    document.getElementById('agentTaskMask').classList.remove('hidden');
    if (!this.activeId && this.tasks.length) this.activeId = this.tasks[0].id;
    this.renderList();
    this.renderDetail();
  },

  close() {
    document.getElementById('agentTaskDrawer').classList.remove('open');
    document.getElementById('agentTaskMask').classList.add('hidden');
  },

  visibleTasks() {
    if (this.filter === 'active') return this.tasks.filter((task) => ['running', 'waiting_confirmation'].includes(task.state));
    if (this.filter === 'needs_input') return this.tasks.filter((task) => ['needs_input', 'error'].includes(task.state));
    if (this.filter === 'done') return this.tasks.filter((task) => ['done', 'canceled'].includes(task.state));
    return this.tasks;
  },

  paint() {
    const card = document.getElementById('agentTaskCard');
    if (!card) return;
    const active = this.tasks.filter((task) => ['running', 'waiting_confirmation', 'needs_input'].includes(task.state));
    const task = active[0] || this.tasks[0];
    document.getElementById('agentTaskCount').textContent = active.length;
    if (!task) {
      card.className = 'agent-task-card idle';
      document.getElementById('agentTaskTitle').textContent = '后台任务待命';
      document.getElementById('agentTaskDetail').textContent = '点击打开任务中心';
      document.getElementById('agentTaskProgress').style.width = '0%';
      return;
    }
    card.className = `agent-task-card ${task.state}`;
    document.getElementById('agentTaskTitle').textContent = task.title;
    document.getElementById('agentTaskDetail').textContent = task.detail;
    document.getElementById('agentTaskProgress').style.width = `${task.progress || 0}%`;
  },

  renderList() {
    const box = document.getElementById('agentTaskList');
    if (!box) return;
    const items = this.visibleTasks();
    if (!items.length) { box.innerHTML = '<div class="empty-tip">当前分类暂无任务</div>'; return; }
    box.innerHTML = items.map((task) => `
      <button class="task-center-item ${task.id === this.activeId ? 'active' : ''}" data-task-id="${task.id}">
        <span class="task-state ${task.state}">${this.stateLabel(task.state)}</span>
        <strong>${App.esc(task.title)}</strong>
        <small>${App.esc(task.detail || '')}</small>
        <span class="task-mini-progress"><i style="width:${task.progress || 0}%"></i></span>
        <em>${this.timeLabel(task.updatedAt || task.createdAt)}</em>
      </button>`).join('');
  },

  renderDetail() {
    const box = document.getElementById('agentTaskDetailPanel');
    if (!box) return;
    const task = this.tasks.find((item) => item.id === this.activeId);
    if (!task) { box.innerHTML = '<div class="empty-tip">从左侧选择一项任务查看执行轨迹</div>'; return; }
    const steps = task.steps || [];
    const checks = task.validation || [];
    const actions = [];
    if (task.state === 'waiting_confirmation' && task.kind === 'task-planning') {
      actions.push('<button class="btn btn-primary" data-task-action="resume-plan">继续审核计划</button>');
    }
    if (['needs_input', 'error'].includes(task.state)) {
      actions.push('<button class="btn" data-task-action="resolve">标记为已人工处理</button>');
    }
    if (this.isCancelable(task)) {
      actions.push('<button class="btn" data-task-action="cancel">取消</button>');
    }
    box.innerHTML = `
      <div class="task-detail-head">
        <span class="task-state ${task.state}">${this.stateLabel(task.state)}</span>
        <h3>${App.esc(task.title)}</h3>
        <p>${App.esc(task.goal || task.title)}</p>
      </div>
      <div class="task-detail-progress"><span><i style="width:${task.progress || 0}%"></i></span><b>${task.progress || 0}%</b></div>
      <section><label>当前阶段</label><strong>${App.esc(task.detail || '—')}</strong></section>
      ${steps.length ? `<section><label>执行轨迹</label><ol class="task-step-timeline">${steps.map((step) => `<li class="${step.state || 'pending'}"><i></i><div><b>${App.esc(step.label)}</b>${step.detail ? `<p>${App.esc(step.detail)}</p>` : ''}</div></li>`).join('')}</ol></section>` : ''}
      ${checks.length ? `<section><label>验证结果</label><div class="task-validation">${checks.map((check) => `<div class="${check.passed ? 'passed' : 'failed'}"><b>${check.passed ? 'PASS' : 'CHECK'}</b><span>${App.esc(check.label || check)}</span></div>`).join('')}</div></section>` : ''}
      ${task.result ? `<section><label>任务产物</label><div class="task-result">${App.markdown(typeof task.result === 'string' ? task.result : (task.result.summary || task.result.message || JSON.stringify(task.result, null, 2)))}</div></section>` : ''}
      ${task.error ? `<section class="task-error"><label>异常与介入建议</label><p>${App.esc(task.error)}</p></section>` : ''}
      ${task.state === 'canceled' && task.rollback ? `<section><label>取消恢复</label><strong>${task.rollback.conflicts ? `已恢复 ${(task.rollback.restoredFields || 0) + (task.rollback.removedRecords || 0)} 项；保留 ${task.rollback.conflicts} 项后续人工修改` : task.rollback.operationCount ? `已恢复 ${task.rollback.restoredFields || 0} 个字段，移除 ${task.rollback.removedRecords || 0} 条新增记录` : '执行期间未产生本地数据变更'}</strong></section>` : ''}
      ${actions.length ? `<div class="task-detail-actions">${actions.join('')}</div>` : ''}
      <div class="task-detail-meta">创建 ${this.timeLabel(task.createdAt)} · 重试 ${task.retryCount || 0} 次</div>`;
  },

  resumePlan() {
    const task = this.tasks.find((item) => item.id === this.activeId);
    const plan = task && task.result && task.result.plan;
    if (!plan || !window.Tasks) { App.toast('计划草稿不完整，请重新拆解任务', 'error'); return; }
    window.Tasks.splitDraft = { ...plan, agentTaskId: task.id };
    this.close();
    App.navigate('tasks');
    setTimeout(() => window.Tasks.openSplitPreview(), 80);
  },

  async resolveCurrent() {
    const task = this.tasks.find((item) => item.id === this.activeId);
    if (!task) return;
    await this.complete(task.id, '已由用户确认并完成处理', task.result, task.validation || []);
    App.toast('任务已标记为人工处理完成', 'ok');
  },

  async cancelCurrent() {
    const task = this.tasks.find((item) => item.id === this.activeId);
    if (!this.isCancelable(task)) return;
    if (!confirm('确定取消这个任务吗？\n本任务已写入的本地数据将恢复为执行前状态。')) return;
    await this.cancel(task.id, '已由用户取消');
    if (task.rollback?.conflicts) {
      App.toast(`任务已取消并回滚；${task.rollback.conflicts} 项后续人工修改已保留`, 'info');
    } else {
      App.toast('任务已取消，已恢复执行前状态', 'ok');
    }
  },

  async clearCompleted() {
    const removable = this.tasks.filter((task) => ['done', 'canceled'].includes(task.state));
    await Promise.all(removable.map((task) => window.api.store.remove('agentTasks', task.id)));
    removable.forEach((task) => this.cancelHandlers.delete(task.id));
    if (removable.some((task) => task.id === this.activeId)) this.activeId = null;
    await this.load();
    App.toast(`已清理 ${removable.length} 条完成记录`, 'ok');
  },

  stateLabel(state) {
    return ({ running: '执行中', waiting_confirmation: '等待确认', needs_input: '需要处理', error: '执行失败', done: '已完成', canceled: '已取消' })[state] || '等待中';
  },

  timeLabel(value) {
    if (!value) return '—';
    const date = new Date(value);
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
};

window.AgentTasks = AgentTasks;
document.addEventListener('DOMContentLoaded', () => AgentTasks.init());
