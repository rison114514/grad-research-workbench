'use strict';

/* ============ 待办事项 / 任务管理 ============ */

const Tasks = {
  filter: 'all',
  current: [],
  splitDraft: null,

  async render() {
    const today = App.todayStr();
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    document.getElementById('tasksDate').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · 周${week}`;

    this.current = await window.api.store.list('tasks');
    App.state.projects = await window.api.store.list('projects');
    this.renderStats();
    this.renderList();
    this.renderProjectsSelect();
  },

  renderStats() {
    const t = this.current;
    const lifecycle = window.TaskLifecycle;
    const grouped = lifecycle ? lifecycle.partition(t) : { active: t, archived: [] };
    const today = App.todayStr();
    const strip = document.getElementById('taskStatStrip');
    const overdue = grouped.active.filter((x) => x.dueDate && x.dueDate < today && x.status !== 'done').length;
    const doneToday = t.filter((x) => x.status === 'done' && x.completedAt && x.completedAt.slice(0, 10) === today).length;
    const doing = grouped.active.filter((x) => x.status === 'doing').length;
    const archiveCount = document.getElementById('taskArchiveCount');
    if (archiveCount) archiveCount.textContent = grouped.archived.length;
    strip.innerHTML = `
      <div class="stat-card"><div class="lbl">今日完成</div><div class="num hl-green">${doneToday}</div></div>
      <div class="stat-card"><div class="lbl">进行中</div><div class="num hl-blue">${doing}</div></div>
      <div class="stat-card"><div class="lbl">已逾期</div><div class="num hl-red">${overdue}</div></div>
      <div class="stat-card"><div class="lbl">当前事项</div><div class="num">${grouped.active.length}</div></div>`;
  },

  filtered() {
    const today = App.todayStr();
    const lifecycle = window.TaskLifecycle;
    const now = Date.now();
    return this.current
      .filter((t) => {
        const archived = lifecycle ? lifecycle.isArchived(t, now) : false;
        if (this.filter === 'archive') return archived;
        if (archived) return false;
        switch (this.filter) {
          case 'today': return t.dueDate === today || (t.status !== 'done' && (!t.dueDate || t.dueDate <= today));
          case 'overdue': return t.dueDate && t.dueDate < today && t.status !== 'done';
          case 'high': return t.priority === 'high' && t.status !== 'done';
          case 'done': return t.status === 'done';
          default: return true;
        }
      })
      .sort((a, b) => {
        if (this.filter === 'archive') {
          return String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || ''));
        }
        const order = { todo: 0, doing: 1, done: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        const pr = { high: 0, medium: 1, low: 2 };
        if (pr[a.priority] !== pr[b.priority]) return pr[a.priority] - pr[b.priority];
        return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1;
      });
  },

  renderList() {
    const list = document.getElementById('taskList');
    const items = this.filtered();
    const today = App.todayStr();
    if (items.length === 0) {
      const hasArchived = this.current.some((task) => window.TaskLifecycle?.isArchived(task));
      const emptyText = this.filter === 'archive'
        ? '暂无归档事项 · 完成超过 3 天的任务会自动进入这里'
        : hasArchived ? '当前筛选下没有事项，可前往「归档」查看历史任务' : '暂无任务，试试用「AI 添加」或新建任务';
      list.innerHTML = `<div class="empty-tip">${emptyText}</div>`;
      return;
    }
    list.innerHTML = items.map((t) => {
      const archived = window.TaskLifecycle?.isArchived(t) || false;
      const pName = App.projectName(t.projectId);
      const overdue = t.dueDate && t.dueDate < today && t.status !== 'done';
      const rarity = { high: 6, medium: 4, low: 2 }[t.priority] || 2;
      const rarityStars = Array.from({ length: rarity }, () => '<i></i>').join('');
      const planItems = t.aiSplit || (t.splitPlan && t.splitPlan.items) || [];
      const subs = planItems.length ? `
        <ul class="t-subs">${planItems.map((s, i) => `
          <li><span>${i + 1}. ${App.esc(typeof s === 'string' ? s : s.title)}</span></li>`).join('')}
        </ul>` : '';
      return `
      <div class="task-item priority-${t.priority} ${t.status === 'done' ? 'done' : ''} ${archived ? 'archived' : ''}" data-id="${t.id}" role="button" tabindex="0" title="点击查看并编辑任务">
        <div class="t-check" data-act="toggle" title="${t.status === 'done' ? '恢复为待办' : '标记完成'}">✓</div>
        <div class="t-main">
          <div class="t-title">${App.esc(t.title)}</div>
          <div class="t-meta">
            <span class="tag ${t.priority}">${App.priorityLabel(t.priority)}优先级</span>
            <span class="rarity-stars" title="${rarity}星优先级" aria-label="${rarity}星优先级">${rarityStars}</span>
            ${t.dueDate ? `<span class="tag ${overdue ? 'overdue' : ''}">${overdue ? 'OVERDUE 已逾期 ' : 'DUE '}${App.fmtDate(t.dueDate)}</span>` : ''}
            ${pName ? `<span class="tag project">PROJECT ${App.esc(pName)}</span>` : ''}
            <span class="tag status">${archived ? '已归档' : t.status === 'todo' ? '待办' : t.status === 'doing' ? '进行中' : '已完成'}</span>
          </div>
          ${t.note ? `<div class="t-note muted">${App.esc(t.note)}</div>` : ''}
          ${subs}
        </div>
        <div class="t-actions">
          ${archived
            ? '<button class="icon-btn restore-btn" data-act="restore" title="恢复为待办">RESTORE</button>'
            : '<button class="icon-btn plan-btn" data-act="split" title="拆解为执行步骤">PLAN</button>'}
          <button class="icon-btn" data-act="edit" title="编辑">EDIT</button>
          <button class="icon-btn" data-act="del" title="删除">DEL</button>
        </div>
      </div>`;
    }).join('');
  },

  async toggle(id) {
    const t = this.current.find((x) => x.id === id);
    if (!t) return;
    const patch = window.TaskLifecycle.toggleCompletionPatch(t);
    await window.api.store.update('tasks', id, patch);
    if (patch.status === 'done') {
      await window.api.store.create('activity', { date: App.todayStr(), taskId: id, action: '完成', content: `完成任务：${t.title}` });
      App.toast('任务已完成，将在 3 天后自动归档', 'ok');
    } else {
      App.toast('任务已恢复为待办', 'ok');
    }
    await this.render();
    window.Board && window.Board.invalidate();
  },

  renderProjectsSelect() {
    const sel = document.getElementById('tmProject');
    const projects = App.state.projects;
    sel.innerHTML = `<option value="">无</option>` + projects.map((p) => `<option value="${p.id}">${App.esc(p.name)}</option>`).join('');
  },

  async split(id) {
    const t = this.current.find((x) => x.id === id);
    if (!t) return;
    const taskId = await AgentTasks.start(`规划 · ${t.title}`, '理解任务目标与约束', {
      kind: 'task-planning', sourceRef: id, goal: `将「${t.title}」拆解为可执行且可验收的步骤`,
      steps: ['理解任务目标', '生成执行步骤', '检查步骤可执行性', '等待用户确认', '应用计划']
    });
    App.toast('正在生成可审核的执行计划…');
    try {
      await AgentTasks.update(taskId, 28, '生成执行步骤');
      const r = await window.api.ai.splitTask(t.title);
      if (!r.ok) throw new Error(r.error || '计划生成失败');
      const items = (r.items || []).filter(Boolean).slice(0, 8);
      if (items.length < 2) throw new Error('生成的执行步骤不足，请重试');
      const checks = this.checkPlan(items);
      await AgentTasks.update(taskId, 48, '检查步骤可执行性', { validation: checks });
      this.splitDraft = {
        taskId: id, agentTaskId: taskId, source: r.source,
        goal: r.goal || `完成「${t.title}」并形成可验收结果`,
        deliverable: r.deliverable || `${t.title}的完整交付成果与检查记录`,
        items
      };
      await AgentTasks.waitForConfirmation(taskId, '计划已生成，等待用户确认', {
        summary: `已生成 ${items.length} 个执行步骤，等待确认后应用。`,
        plan: { taskId: id, source: r.source, goal: this.splitDraft.goal, deliverable: this.splitDraft.deliverable, items }
      });
      this.openSplitPreview();
    } catch (error) {
      await AgentTasks.needsInput(taskId, '计划生成失败，需要用户处理', error.message);
      App.toast(error.message || '拆解失败', 'error');
    }
  },

  checkPlan(items) {
    return [
      { label: '至少包含 2 个执行步骤', passed: items.length >= 2 },
      { label: '每一步均包含明确动作', passed: items.every((item) => String(item).trim().length >= 6) },
      { label: '步骤数量适合人工审核', passed: items.length <= 8 }
    ];
  },

  openSplitPreview() {
    const draft = this.splitDraft;
    if (!draft) return;
    document.getElementById('splitGoal').value = draft.goal;
    document.getElementById('splitDeliverable').value = draft.deliverable;
    this.renderSplitSteps();
    Modal.open('splitPlanModal');
  },

  renderSplitSteps() {
    const box = document.getElementById('splitStepList');
    const items = this.splitDraft ? this.splitDraft.items : [];
    box.innerHTML = items.map((item, index) => `
      <div class="split-step-row" data-index="${index}">
        <b>${String(index + 1).padStart(2, '0')}</b>
        <input class="input" value="${App.esc(item)}" aria-label="步骤 ${index + 1}">
        <button class="step-move" data-move="up" title="上移">↑</button>
        <button class="step-move" data-move="down" title="下移">↓</button>
        <button class="step-remove" title="删除">✕</button>
      </div>`).join('');
    this.renderPlanChecks();
  },

  syncSplitInputs() {
    if (!this.splitDraft) return;
    this.splitDraft.goal = document.getElementById('splitGoal').value.trim();
    this.splitDraft.deliverable = document.getElementById('splitDeliverable').value.trim();
    this.splitDraft.items = [...document.querySelectorAll('#splitStepList input')].map((input) => input.value.trim()).filter(Boolean);
  },

  renderPlanChecks() {
    const checks = this.checkPlan(this.splitDraft ? this.splitDraft.items : []);
    document.getElementById('splitPlanChecks').innerHTML = checks.map((check) => `<span class="${check.passed ? 'passed' : 'failed'}">${check.passed ? '✓' : '!'} ${App.esc(check.label)}</span>`).join('');
  },

  async confirmSplit() {
    if (!this.splitDraft) return;
    this.syncSplitInputs();
    const draft = this.splitDraft;
    const parent = this.current.find((task) => task.id === draft.taskId);
    const checks = this.checkPlan(draft.items);
    if (!parent || checks.some((check) => !check.passed)) {
      this.renderPlanChecks();
      App.toast('请先修正未通过的计划检查项', 'error');
      return;
    }
    const mode = document.querySelector('input[name="splitApplyMode"]:checked').value;
    await AgentTasks.update(draft.agentTaskId, 82, '应用已确认的执行计划', { state: 'running', validation: checks });
    const splitPlan = { goal: draft.goal, deliverable: draft.deliverable, items: draft.items, mode, confirmedAt: new Date().toISOString() };
    if (mode === 'children') {
      for (const title of draft.items) {
        await window.api.store.create('tasks', {
          title, priority: parent.priority, dueDate: parent.dueDate, status: 'todo', completedAt: null,
          note: `源自任务：${parent.title}`, projectId: parent.projectId || null, parentTaskId: parent.id, aiSplit: null
        });
      }
      await window.api.store.update('tasks', parent.id, { splitPlan, aiSplit: draft.items });
    } else if (mode === 'checklist') {
      await window.api.store.update('tasks', parent.id, { splitPlan, aiSplit: draft.items });
    } else {
      await window.api.store.update('tasks', parent.id, { splitPlan });
    }
    await AgentTasks.complete(draft.agentTaskId, '执行计划已确认并应用', { summary: `${draft.items.length} 个步骤已按“${mode === 'children' ? '独立子任务' : mode === 'checklist' ? '检查清单' : '只保存计划'}”方式保存。` }, checks);
    Modal.close('splitPlanModal');
    this.splitDraft = null;
    await this.render();
    window.Board && window.Board.invalidate();
    App.toast('执行计划已确认并应用', 'ok');
  },

  async naturalAdd() {
    const input = document.getElementById('naturalTaskInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const parsed = await window.api.ai.parseNaturalTask(text);
    const task = await window.api.store.create('tasks', {
      title: parsed.title,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      status: 'todo',
      note: '',
      projectId: null,
      aiSplit: null
    });
    await window.api.store.create('activity', { date: App.todayStr(), taskId: task.id, action: '创建', content: `创建任务：${task.title}` });
    App.toast(`已添加任务${parsed.dueDate ? `（截止 ${parsed.dueDate}）` : ''}`, 'ok');
    this.render();
    window.Board && window.Board.invalidate();
  }
};

/* ---------- 事件绑定 ---------- */
window.Tasks = Tasks;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('naturalAddBtn').addEventListener('click', () => Tasks.naturalAdd());
  document.getElementById('naturalTaskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Tasks.naturalAdd();
  });

  document.getElementById('taskFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#taskFilter .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    Tasks.filter = btn.dataset.f;
    Tasks.renderList();
  });

  document.getElementById('taskList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const item = e.target.closest('.task-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!btn) { openTaskEditor(id); return; }
    const act = btn.dataset.act;
    if (act === 'toggle') await Tasks.toggle(id);
    else if (act === 'restore') await Tasks.toggle(id);
    else if (act === 'split') await Tasks.split(id);
    else if (act === 'edit') openTaskEditor(id);
    else if (act === 'del') {
      if (confirm('确定删除该任务？')) {
        await window.api.store.remove('tasks', id);
        App.toast('已删除', 'ok');
        Tasks.render();
        window.Board && window.Board.invalidate();
      }
    }
  });

  document.getElementById('taskList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('[data-act]')) return;
    const item = e.target.closest('.task-item');
    if (!item) return;
    e.preventDefault();
    openTaskEditor(item.dataset.id);
  });

  document.getElementById('openTaskModal').addEventListener('click', () => openTaskEditor(null));

  document.getElementById('splitAddStep').addEventListener('click', () => {
    Tasks.syncSplitInputs();
    Tasks.splitDraft.items.push('填写新的可执行步骤及完成标准');
    Tasks.renderSplitSteps();
  });
  document.getElementById('splitStepList').addEventListener('input', () => { Tasks.syncSplitInputs(); Tasks.renderPlanChecks(); });
  document.getElementById('splitStepList').addEventListener('click', (event) => {
    const row = event.target.closest('.split-step-row');
    if (!row || !Tasks.splitDraft) return;
    Tasks.syncSplitInputs();
    const index = Number(row.dataset.index);
    if (event.target.closest('.step-remove')) Tasks.splitDraft.items.splice(index, 1);
    const move = event.target.closest('[data-move]')?.dataset.move;
    if (move === 'up' && index > 0) [Tasks.splitDraft.items[index - 1], Tasks.splitDraft.items[index]] = [Tasks.splitDraft.items[index], Tasks.splitDraft.items[index - 1]];
    if (move === 'down' && index < Tasks.splitDraft.items.length - 1) [Tasks.splitDraft.items[index + 1], Tasks.splitDraft.items[index]] = [Tasks.splitDraft.items[index], Tasks.splitDraft.items[index + 1]];
    if (event.target.closest('.step-remove') || move) Tasks.renderSplitSteps();
  });
  document.getElementById('splitCancel').addEventListener('click', async () => {
    if (Tasks.splitDraft) await AgentTasks.cancel(Tasks.splitDraft.agentTaskId, '用户取消了计划应用');
    Tasks.splitDraft = null;
    Modal.close('splitPlanModal');
  });
  document.getElementById('splitConfirm').addEventListener('click', () => Tasks.confirmSplit());

  /* 任务弹窗 */
  document.getElementById('tmCancel').addEventListener('click', () => Modal.close('taskModal'));
  document.getElementById('tmSave').addEventListener('click', async () => {
    const title = document.getElementById('tmTitle').value.trim();
    if (!title) { App.toast('请填写任务标题', 'error'); return; }
    const id = document.getElementById('taskModal').dataset.editingId;
    const payload = {
      title,
      priority: document.getElementById('tmPriority').value,
      dueDate: document.getElementById('tmDue').value || null,
      projectId: document.getElementById('tmProject').value || null,
      note: document.getElementById('tmNote').value.trim()
    };
    if (id) {
      await window.api.store.update('tasks', id, payload);
      App.toast('任务已更新', 'ok');
    } else {
      await window.api.store.create('tasks', { ...payload, status: 'todo', completedAt: null, aiSplit: null });
      await window.api.store.create('activity', { date: App.todayStr(), action: '创建', content: `创建任务：${payload.title}` });
      App.toast('任务已创建', 'ok');
    }
    Modal.close('taskModal');
    Tasks.render();
    window.Board && window.Board.invalidate();
  });

  function openTaskEditor(id) {
    document.getElementById('taskModalTitle').textContent = id ? '编辑任务' : '新建任务';
    document.getElementById('taskModal').dataset.editingId = id || '';
    const t = id ? Tasks.current.find((x) => x.id === id) : null;
    document.getElementById('tmTitle').value = t ? t.title : '';
    document.getElementById('tmPriority').value = t ? t.priority : 'medium';
    document.getElementById('tmDue').value = t && t.dueDate ? t.dueDate : '';
    document.getElementById('tmProject').value = t && t.projectId ? t.projectId : '';
    document.getElementById('tmNote').value = t ? (t.note || '') : '';
    Modal.open('taskModal');
    document.getElementById('tmTitle').focus();
  }
});
