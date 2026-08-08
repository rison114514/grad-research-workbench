'use strict';

/* ============ 每日计划：按日/按周时间表 + 任务联动 ============ */

const DailyPlan = {
  state: {
    date: App ? App.todayStr() : '',
    mode: 'day',       // day | week
    weekOffset: 0
  },
  typeLabels: { work: '工作', study: '学习', meeting: '会议', life: '生活', rest: '休息' },
  typeColors: { work: '#f5a623', study: '#3b82f6', meeting: '#ff625d', life: '#8eef5b', rest: '#9b9fa5' },

  async render() {
    document.getElementById('planDate').value = this.state.date;
    document.getElementById('planDate').max = App.todayStr();
    if (this.state.mode === 'day') await this.renderDay();
    else await this.renderWeek();
  },

  /* ---------- 按日视图 ---------- */
  async getPlan(date) {
    const plans = await window.api.store.list('dailyPlans');
    return plans.find((p) => p.date === date) || null;
  },

  async getOrCreatePlan(date) {
    let plan = await this.getPlan(date);
    if (!plan) {
      plan = await window.api.store.create('dailyPlans', { date, items: [] });
    }
    return plan;
  },

  async renderDay() {
    const plan = await this.getPlan(this.state.date);
    const box = document.getElementById('planTimeline');
    const today = App.todayStr();
    if (!plan || !plan.items.length) {
      box.innerHTML = `<div class="empty-tip">${this.state.date === today ? '今天还没有安排，点击「新增计划」从早到晚规划一天' : '这一天还没有计划'}</div>`;
      return;
    }
    const tasks = await window.api.store.list('tasks');
    const items = [...plan.items].sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
    // 读时同步：有 taskId 的计划项，按任务状态回写 done
    let dirty = false;
    const synced = items.map((item) => {
      if (item.taskId) {
        const task = tasks.find((t) => t.id === item.taskId);
        if (task) {
          const done = task.status === 'done';
          if (done !== !!item.done) { item = { ...item, done }; dirty = true; }
        }
      }
      return item;
    });
    if (dirty) await window.api.store.update('dailyPlans', plan.id, { items: synced });

    box.innerHTML = synced.map((item, index) => {
      const isToday = this.state.date === today;
      return `
        <div class="plan-item ${item.done ? 'done' : ''}" data-index="${index}">
          <div class="plan-item-time">
            <b>${App.esc(item.startTime || '--:--')}</b>
            <span>${App.esc(item.endTime || '--:--')}</span>
          </div>
          <div class="plan-item-main">
            <div class="plan-item-title">${App.esc(item.title)}</div>
            ${item.note ? `<div class="plan-item-note">${App.esc(item.note)}</div>` : ''}
            <div class="plan-item-meta">
              <span class="tag" style="background:${this.typeColors[item.type] || '#9b9fa5'};color:#fff;border:none">${this.typeLabels[item.type] || item.type}</span>
              ${item.taskId ? '<span class="tag" style="background:#fff44f;color:#000;border:none">已转任务</span>' : ''}
            </div>
          </div>
          <div class="plan-item-actions">
            <button class="icon-btn" data-act="toggle" title="${item.done ? '标记未完成' : '标记完成'}">${item.done ? '↩' : '✓'}</button>
            ${item.taskId
              ? `<button class="icon-btn" data-act="goto" title="查看任务">➜</button>`
              : `<button class="icon-btn" data-act="totask" title="转为待办事项任务">⇥</button>`}
            <button class="icon-btn" data-act="del" title="删除">✕</button>
          </div>
        </div>`;
    }).join('');
  },

  async addItem() {
    const title = document.getElementById('planItemTitle').value.trim();
    if (!title) { App.toast('请填写计划标题', 'error'); return; }
    const item = {
      id: `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      startTime: document.getElementById('planItemStart').value || '',
      endTime: document.getElementById('planItemEnd').value || '',
      title,
      type: document.getElementById('planItemType').value,
      note: document.getElementById('planItemNote').value.trim(),
      done: false,
      taskId: null
    };
    const plan = await this.getOrCreatePlan(this.state.date);
    plan.items = [...(plan.items || []), item];
    await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
    Modal.close('planModal');
    document.getElementById('planItemTitle').value = '';
    document.getElementById('planItemNote').value = '';
    App.toast('计划已添加', 'ok');
    await this.render();
  },

  async toggleItem(index) {
    const plan = await this.getPlan(this.state.date);
    if (!plan) return;
    const items = [...(plan.items || [])];
    items[index] = { ...items[index], done: !items[index].done };
    await window.api.store.update('dailyPlans', plan.id, { items });
    await this.render();
  },

  async removeItem(index) {
    const plan = await this.getPlan(this.state.date);
    if (!plan) return;
    const items = [...(plan.items || [])];
    items.splice(index, 1);
    if (items.length) await window.api.store.update('dailyPlans', plan.id, { items });
    else await window.api.store.remove('dailyPlans', plan.id);
    App.toast('计划已删除', 'ok');
    await this.render();
  },

  async toTask(index) {
    const plan = await this.getPlan(this.state.date);
    if (!plan) return;
    const item = plan.items[index];
    if (!item || item.taskId) return;
    if (!confirm(`将「${item.title}」转为待办事项任务？`)) return;
    const task = await window.api.store.create('tasks', {
      title: item.title,
      priority: 'medium',
      dueDate: plan.date,
      status: 'todo',
      completedAt: null,
      note: item.note || (item.startTime ? `计划时间 ${item.startTime}-${item.endTime || '?'}` : ''),
      projectId: null,
      aiSplit: null
    });
    const items = [...(plan.items || [])];
    items[index] = { ...item, taskId: task.id };
    await window.api.store.update('dailyPlans', plan.id, { items });
    App.toast('已转为任务，可在待办事项查看', 'ok');
    await this.render();
    window.Board && window.Board.invalidate();
  },

  /* ---------- 按周视图 ---------- */
  weekDates() {
    const monday = new Date();
    monday.setDate(monday.getDate() + this.state.weekOffset * 7 - ((monday.getDay() || 7) - 1));
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return days;
  },

  async renderWeek() {
    const days = this.weekDates();
    const weekLabel = `${days[0].slice(5).replace('-', '/')} - ${days[6].slice(5).replace('-', '/')}`;
    document.getElementById('planWeekLabel').textContent = weekLabel;
    const plans = await window.api.store.list('dailyPlans');
    const tasks = await window.api.store.list('tasks');
    const today = App.todayStr();
    const grid = document.getElementById('planWeekGrid');
    grid.innerHTML = days.map((date) => {
      const plan = plans.find((p) => p.date === date);
      const items = plan ? [...plan.items].sort((a, b) => (a.startTime || '99').localeCompare(b.startTime || '99')) : [];
      const dow = ['日', '一', '二', '三', '四', '五', '六'][new Date(date + 'T00:00:00').getDay()];
      const isToday = date === today;
      return `
        <div class="plan-week-col ${isToday ? 'today' : ''}">
          <div class="plan-week-head">
            <span>${date.slice(5).replace('-', '/')}</span>
            <b>周${dow}</b>
          </div>
          <div class="plan-week-items">
            ${items.length ? items.slice(0, 8).map((item) => {
              const done = item.taskId ? (tasks.find((t) => t.id === item.taskId)?.status === 'done') : item.done;
              return `<div class="plan-week-item ${done ? 'done' : ''}">
                <span class="pw-time">${App.esc(item.startTime || '--:--')}</span>
                <span class="pw-title">${App.esc(item.title)}</span>
              </div>`;
            }).join('') : '<span class="pw-empty">无安排</span>'}
            ${items.length > 8 ? `<span class="pw-more">+${items.length - 8} 项</span>` : ''}
          </div>
        </div>`;
    }).join('');
  },

  async gotoDate(date) {
    this.state.date = date;
    document.getElementById('planDate').value = date;
    await this.render();
  }
};

window.DailyPlan = DailyPlan;

document.addEventListener('DOMContentLoaded', () => {
  DailyPlan.state.date = App.todayStr();

  document.getElementById('planMode').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#planMode .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    DailyPlan.state.mode = btn.dataset.m;
    document.getElementById('planDayView').classList.toggle('hidden', btn.dataset.m !== 'day');
    document.getElementById('planWeekView').classList.toggle('hidden', btn.dataset.m !== 'week');
    DailyPlan.render();
  });

  document.getElementById('planDate').addEventListener('change', (e) => {
    DailyPlan.state.date = e.target.value || App.todayStr();
    DailyPlan.render();
  });

  document.getElementById('planAddBtn').addEventListener('click', () => {
    Modal.open('planModal');
    document.getElementById('planItemTitle').focus();
  });
  document.getElementById('planItemCancel').addEventListener('click', () => Modal.close('planModal'));
  document.getElementById('planItemSave').addEventListener('click', () => DailyPlan.addItem());

  document.getElementById('planTimeline').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const item = e.target.closest('.plan-item');
    if (!btn || !item) return;
    const index = parseInt(item.dataset.index, 10);
    const act = btn.dataset.act;
    if (act === 'toggle') await DailyPlan.toggleItem(index);
    else if (act === 'del') { if (confirm('确定删除该计划项？')) await DailyPlan.removeItem(index); }
    else if (act === 'totask') await DailyPlan.toTask(index);
    else if (act === 'goto') App.navigate('tasks');
  });

  document.getElementById('planWeekPrev').addEventListener('click', () => { DailyPlan.state.weekOffset -= 1; DailyPlan.render(); });
  document.getElementById('planWeekNext').addEventListener('click', () => { DailyPlan.state.weekOffset += 1; DailyPlan.render(); });
  document.getElementById('planWeekToday').addEventListener('click', () => { DailyPlan.state.weekOffset = 0; DailyPlan.render(); });
});
