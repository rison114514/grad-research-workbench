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
    else if (this.state.mode === 'week') await this.renderWeek();
    else await this.renderTemplates();
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

    box.innerHTML = synced.map((item) => {
      const isToday = this.state.date === today;
      return `
        <div class="plan-item ${item.done ? 'done' : ''}" data-id="${App.esc(item.id || '')}">
          <div class="plan-item-time">
            <b>${App.esc(item.startTime || '--:--')}</b>
            <span>${App.esc(item.endTime || '--:--')}</span>
          </div>
          <div class="plan-item-main">
            <div class="plan-item-title">${App.esc(item.title)}${item.source === 'template' ? ' <span class="plan-src-tag" title="来自模板：' + App.esc(item.templateName || '') + '">🔄</span>' : ''}</div>
            ${item.note ? `<div class="plan-item-note">${App.esc(item.note)}</div>` : ''}
            <div class="plan-item-meta">
              <span class="tag" style="background:${this.typeColors[item.type] || '#9b9fa5'};color:#fff;border:none">${this.typeLabels[item.type] || item.type}</span>
              ${item.source === 'template' ? `<span class="tag" style="background:#3a3f45;color:#e8eaed;border:none">模板</span>` : ''}
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

  /** 按 item.id 定位（修复：排序渲染 vs 原始索引错位——点击 A 完成 B 的严重 BUG） */
  async toggleItem(id) {
    const plan = await this.getPlan(this.state.date);
    if (!plan) return;
    const idx = (plan.items || []).findIndex((i) => i.id === id);
    if (idx < 0) return;
    const items = [...(plan.items || [])];
    items[idx] = { ...items[idx], done: !items[idx].done };
    await window.api.store.update('dailyPlans', plan.id, { items });
    await this.render();
  },

  async removeItem(id) {
    const plan = await this.getPlan(this.state.date);
    if (!plan) return;
    const idx = (plan.items || []).findIndex((i) => i.id === id);
    if (idx < 0) return;
    const items = [...(plan.items || [])];
    items.splice(idx, 1);
    if (items.length) await window.api.store.update('dailyPlans', plan.id, { items });
    else await window.api.store.remove('dailyPlans', plan.id);
    App.toast('计划已删除', 'ok');
    await this.render();
  },

  async toTask(id) {
    const plan = await this.getPlan(this.state.date);
    if (!plan) return;
    const item = (plan.items || []).find((i) => i.id === id);
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
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    items[idx] = { ...item, taskId: task.id };
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
                <span class="pw-title">${item.source === 'template' ? '🔄 ' : ''}${App.esc(item.title)}</span>
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
  },

  /* ---------- 模板视图（每日/每周固定安排） ---------- */
  async renderTemplates() {
    const [dailyTpls, weeklyTpls] = await Promise.all([
      window.api.store.list('dailyTemplates'),
      window.api.store.list('weeklyTemplates')
    ]);
    const freqLabel = { everyday: '每天', weekdays: '周内', weekend: '周末' };
    const weekdayLabel = ['日', '一', '二', '三', '四', '五', '六'];
    document.getElementById('planTplDailyCount').textContent = dailyTpls.length;
    document.getElementById('planTplWeeklyCount').textContent = weeklyTpls.length;
    const today = this.state.date || App.todayStr();

    const dailyHtml = dailyTpls.length ? dailyTpls.map((t) => {
      const f = freqLabel[t.frequency] || `自定义${(t.weekdays || []).map((w) => '周' + weekdayLabel[w]).join('/')}`;
      return `<div class="plan-tpl-item" data-tpl="${App.esc(t.id)}" data-domain="dailyTemplates">
        <div class="plan-tpl-info">
          <b>${App.esc(t.name)}</b>
          <span>${f} · ${t.items.length} 项</span>
        </div>
        <div class="plan-tpl-acts">
          <button class="btn btn-sm" data-act="apply" title="应用到 ${today}">应用到今日</button>
          <button class="btn btn-sm danger" data-act="del">删除</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty-tip">暂无每日模板。让塞西创建，例如说「每天9点到10点上班，下午2点学3小时」</div>';

    const weeklyHtml = weeklyTpls.length ? weeklyTpls.map((t) => {
      return `<div class="plan-tpl-item" data-tpl="${App.esc(t.id)}" data-domain="weeklyTemplates">
        <div class="plan-tpl-info">
          <b>${App.esc(t.name)}</b>
          <span>每周${weekdayLabel[t.weekday] || '?'} · ${t.items.length} 项</span>
        </div>
        <div class="plan-tpl-acts">
          <button class="btn btn-sm" data-act="apply" title="应用到 ${today}">应用到今日</button>
          <button class="btn btn-sm danger" data-act="del">删除</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty-tip">暂无每周模板。让塞西创建，例如说「每周三晚上买菜」</div>';

    document.getElementById('planTplDailyList').innerHTML = dailyHtml;
    document.getElementById('planTplWeeklyList').innerHTML = weeklyHtml;
  },

  async applyTemplateToToday(domain, tplId) {
    // 模板派生走确定性逻辑（不依赖 AI）
    try {
      if (window.AssistantActions && AssistantActions.applyTemplateStructured) {
        const reply = await AssistantActions.applyTemplateStructured({ templateId: tplId, targetDate: this.state.date || App.todayStr() });
        App.toast(typeof reply === 'string' ? reply.split('\n')[0] : '已应用');
      } else {
        // 浏览器预览降级：本地展开
        const plans = await window.api.store.list('dailyPlans');
        const tpls = await window.api.store.list(domain);
        const tpl = tpls.find((t) => t.id === tplId);
        if (!tpl) { App.toast('模板不存在'); return; }
        const date = this.state.date || App.todayStr();
        let plan = plans.find((p) => p.date === date);
        if (!plan) plan = await window.api.store.create('dailyPlans', { date, items: [] });
        const dupKeys = new Set(plan.items.map((e) => `${e.startTime}|${e.title}`));
        let added = 0;
        for (const it of (domain === 'dailyTemplates' ? tpl.items : tpl.items.map((i) => ({ ...i, startTime: i.startTime || '09:00', endTime: i.endTime || '10:00' })))) {
          const k = `${it.startTime}|${it.title}`;
          if (dupKeys.has(k)) continue;
          dupKeys.add(k);
          plan.items.push({ id: `item-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, startTime: it.startTime, endTime: it.endTime, title: it.title, type: it.type || 'work', note: it.note || '', done: false, taskId: null, source: 'template', templateId: tpl.id, templateName: tpl.name });
          added += 1;
        }
        if (added) await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
        App.toast(added ? `已应用 ${added} 项` : '当天已有全部事项');
      }
    } catch (e) {
      App.toast('应用失败：' + ((e && e.message) || e));
    }
    await this.render();
  },

  async deleteTemplate(domain, tplId) {
    if (!confirm('确定删除该模板？已派生的历史数据不受影响。')) return;
    await window.api.store.remove(domain, tplId);
    App.toast('已删除模板');
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
    document.getElementById('planTemplatesView').classList.toggle('hidden', btn.dataset.m !== 'templates');
    DailyPlan.render();
  });

  // 模板面板操作：应用 / 删除
  document.getElementById('planTemplatesView').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const item = e.target.closest('.plan-tpl-item');
    if (!btn || !item) return;
    const tplId = item.dataset.tpl;
    const domain = item.dataset.domain;
    if (btn.dataset.act === 'apply') await DailyPlan.applyTemplateToToday(domain, tplId);
    else if (btn.dataset.act === 'del') await DailyPlan.deleteTemplate(domain, tplId);
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
    const id = item.dataset.id;
    const act = btn.dataset.act;
    if (act === 'toggle') await DailyPlan.toggleItem(id);
    else if (act === 'del') { if (confirm('确定删除该计划项？')) await DailyPlan.removeItem(id); }
    else if (act === 'totask') await DailyPlan.toTask(id);
    else if (act === 'goto') App.navigate('tasks');
  });

  document.getElementById('planWeekPrev').addEventListener('click', () => { DailyPlan.state.weekOffset -= 1; DailyPlan.render(); });
  document.getElementById('planWeekNext').addEventListener('click', () => { DailyPlan.state.weekOffset += 1; DailyPlan.render(); });
  document.getElementById('planWeekToday').addEventListener('click', () => { DailyPlan.state.weekOffset = 0; DailyPlan.render(); });
});
