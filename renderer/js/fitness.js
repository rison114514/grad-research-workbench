'use strict';

/* ============ 运动健身：计划 + 打卡 ============ */

const Fitness = {
  typeLabels: { running: '跑步', strength: '力量', yoga: '瑜伽', ball: '球类', other: '其他' },
  typeColors: { running: '#ff625d', strength: '#f5a623', yoga: '#8eef5b', ball: '#3b82f6', other: '#9b9fa5' },
  expanded: new Set(),   // 展开的条目区：`${planId}:${dayIdx}`

  async render() {
    const today = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];
    document.getElementById('fitDate').textContent = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 · 周${week}`;
    await this.renderStats();
    await this.renderPlans();
    await this.renderRecent();
  },

  weekStart() {
    const d = new Date();
    const dow = d.getDay() || 7;
    d.setDate(d.getDate() - dow + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /* ---------- 统计 ---------- */
  async renderStats() {
    const plans = await window.api.store.list('fitnessPlans');
    const logs = await window.api.store.list('fitnessLogs');
    const today = App.todayStr();
    const weekStart = this.weekStart();
    const doneLogs = logs.filter((l) => l.done);
    const weekLogs = doneLogs.filter((l) => l.date >= weekStart && l.date <= today);
    // 近 7 天（用 YYYY-MM-DD 字符串比较；勿传 Date 对象给 fmtDate）
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const weekAgoStr = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
    const recentLogs = doneLogs.filter((l) => l.date > weekAgoStr);

    // 连续打卡天数
    let streak = 0;
    const doneDates = new Set(doneLogs.map((l) => l.date));
    let cursor = new Date(today + 'T00:00:00');
    while (doneDates.has(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    // 计划完成率：本周已有打卡的计划数 / 计划总数
    const activePlans = plans.filter((p) => p.weeklyGoal > 0);
    const plannedIds = new Set(activePlans.map((p) => p.id));
    const weekPlanLogs = weekLogs.filter((l) => l.planId && plannedIds.has(l.planId));
    const rate = activePlans.length ? Math.round((new Set(weekPlanLogs.map((l) => l.planId)).size / activePlans.length) * 100) : 0;

    document.getElementById('fitStatStrip').innerHTML = `
      <div class="stat-card"><div class="lbl">本周打卡</div><div class="num">${weekLogs.length}</div></div>
      <div class="stat-card"><div class="lbl">计划完成率</div><div class="num">${rate}<small style="font-size:14px">%</small></div></div>
      <div class="stat-card"><div class="lbl">连续打卡</div><div class="num">${streak}<small style="font-size:14px"> 天</small></div></div>
      <div class="stat-card"><div class="lbl">近 7 天</div><div class="num">${recentLogs.length}</div></div>`;
  },

  /* ---------- 计划列表 ---------- */
  async renderPlans() {
    const plans = await window.api.store.list('fitnessPlans');
    const logs = await window.api.store.list('fitnessLogs');
    const today = App.todayStr();
    const box = document.getElementById('fitPlanList');
    if (!plans.length) {
      box.innerHTML = `<div class="empty-tip" style="padding:30px 0">还没有健身计划，点击「新增计划」设定本周目标</div>`;
      return;
    }
    const weekStart = this.weekStart();
    const weekLogs = logs.filter((l) => l.date >= weekStart && l.date <= today && l.done);
    // 模板计划迁移：schedule items → 顶层 items（一次性落库）
    plans.forEach((p) => this.ensurePlanItems(p));
    for (const p of plans) {
      if (p._migrated) { delete p._migrated; await window.api.store.update('fitnessPlans', p.id, { items: p.items }); }
    }
    box.innerHTML = plans.map((p) => {
      const todayLog = logs.find((l) => l.date === today && l.planId === p.id);
      const weekCount = weekLogs.filter((l) => l.planId === p.id).length;
      const color = this.typeColors[p.type] || '#9b9fa5';
      const goalHit = weekCount >= (p.weeklyGoal || 0);
      return `
        <div class="fit-plan-item" data-id="${p.id}">
          <div class="fit-plan-head">
            <span class="fit-plan-name">${App.esc(p.name)}</span>
            <span class="tag" style="background:${color};color:#fff;border:none">${this.typeLabels[p.type] || p.type}</span>
          </div>
          <div class="fit-plan-meta">
            <span>周目标 <b>${p.weeklyGoal || 0}</b> 次</span>
            <span>单次 <b>${p.durationGoal || 0}</b> 分钟</span>
            <span>本周已完成 <b class="${goalHit ? 'ok' : ''}">${weekCount}</b> 次</span>
          </div>
          ${p.note ? `<div class="fit-plan-note">${App.esc(p.note)}</div>` : ''}
          ${this.renderItemsBlock(p)}
          <div class="fit-plan-actions">
            ${todayLog
              ? `<button class="btn" data-act="uncheck">✓ 今日已打卡（点击取消）</button>`
              : `<button class="btn btn-primary" data-act="check">今日打卡</button>`}
            <button class="icon-btn" data-act="del" title="删除计划">✕</button>
          </div>
        </div>`;
    }).join('');
  },

  /* ---------- 细致条目（顶层 items：手动添加 + schedule 迁移，用户/Agent 均可编辑状态） ---------- */
  /** 确保计划有条目：无 items 时把 schedule[].items 迁移到顶层（模板计划）；返回条目数组 */
  ensurePlanItems(plan) {
    let items = plan.items;
    if (!Array.isArray(items)) items = [];
    if (!items.length) {
      const scheduleItems = (plan.schedule || []).flatMap((d) => (d.items || []));
      if (scheduleItems.length) {
        items = scheduleItems.map((it) => ({ ...it }));
        plan.items = items;
        plan._migrated = true; // 标记待落库
      }
    }
    return items;
  },

  renderItemsBlock(p) {
    const items = this.ensurePlanItems(p);
    const statusLabel = { done: '完成', todo: '待做', skipped: '跳过' };
    const rows = items.map((it) => {
      const st = it.status || 'todo';
      const note = st === 'skipped'
        ? `<input class="fit-item-note" data-plan="${p.id}" data-item="${it.id}" value="${App.esc(it.customNote || '')}" placeholder="备注，如：今日感冒了">`
        : '';
      return `
        <div class="fit-item-row" data-plan="${p.id}" data-item="${it.id}">
          <span class="fit-item-dot ${st}"></span>
          <span class="fit-item-name">${App.esc(it.name)}</span>
          <span class="fit-item-min">${it.durationMin || ''}分</span>
          <span class="fit-item-btns">
            <button class="fit-item-btn ${st === 'done' ? 'on' : ''}" data-st="done" title="完成">✓</button>
            <button class="fit-item-btn ${st === 'todo' ? 'on' : ''}" data-st="todo" title="待做">○</button>
            <button class="fit-item-btn ${st === 'skipped' ? 'on' : ''}" data-st="skipped" title="跳过（可备注原因）">⏭</button>
          </span>
          ${note}
          <span class="fit-item-status">${statusLabel[st] || st}</span>
        </div>`;
    }).join('');
    return `
      <div class="fit-plan-schedule">
        <div class="fit-plan-schedule-title">细致条目 <small>点击状态切换 · 跳过可填备注 · 用户与 AI 均可编辑</small></div>
        <div class="fit-items-box">${rows || '<div class="empty-tip" style="padding:12px">暂无条目，点击下方「＋ 添加条目」</div>'}</div>
        <div class="fit-item-add">
          <input class="input fit-item-add-name" data-plan="${p.id}" placeholder="动作名称，如：跑步 / 举哑铃">
          <input class="input fit-item-add-min" data-plan="${p.id}" placeholder="分钟" type="number" style="width:76px">
          <button class="btn btn-sm" data-add="${p.id}">＋ 添加条目</button>
        </div>
      </div>`;
  },

  /** 手动添加条目（无 schedule 的手动计划也能有细致条目） */
  async addPlanItem(planId, name, durationMin) {
    const n = String(name || '').trim();
    if (!n) { App.toast('请输入条目名称', 'error'); return; }
    const plans = await window.api.store.list('fitnessPlans');
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const items = this.ensurePlanItems(plan);
    items.push({
      id: `it-${planId}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: n, durationMin: Number(durationMin) || 0,
      status: 'todo', customNote: '', updatedAt: new Date().toISOString()
    });
    await window.api.store.update('fitnessPlans', planId, { items });
    await this.renderPlans();
    App.toast(`已添加条目：${n}`, 'ok');
  },

  /** 条目状态切换（顶层 items） */
  async setItemStatus(planId, itemId, status, customNote) {
    const plans = await window.api.store.list('fitnessPlans');
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const items = this.ensurePlanItems(plan);
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    it.status = status;
    if (customNote !== undefined) it.customNote = customNote;
    it.updatedAt = new Date().toISOString();
    await window.api.store.update('fitnessPlans', planId, { items });
    await this.renderPlans();
  },

  /** 条目自定义备注保存 */
  async saveItemNote(planId, itemId, note) {
    const plans = await window.api.store.list('fitnessPlans');
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const items = this.ensurePlanItems(plan);
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    it.customNote = String(note || '');
    it.updatedAt = new Date().toISOString();
    await window.api.store.update('fitnessPlans', planId, { items });
    await this.renderPlans();
  },

  /* ---------- 近 7 天记录 ---------- */
  async renderRecent() {
    const logs = await window.api.store.list('fitnessLogs');
    const box = document.getElementById('fitRecentList');
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86400000);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const dayLogs = days.map((date) => ({
      date,
      items: logs.filter((l) => l.date === date && l.done)
    }));
    if (!dayLogs.some((d) => d.items.length)) {
      box.innerHTML = `<div class="empty-tip" style="padding:30px 0">最近 7 天没有打卡记录</div>`;
      return;
    }
    box.innerHTML = dayLogs.map((d) => {
      if (!d.items.length) {
        return `<div class="fit-day-row empty"><span>${d.date.slice(5).replace('-', '/')}</span><span class="muted">未打卡</span></div>`;
      }
      const total = d.items.reduce((s, l) => s + (l.durationMin || 0), 0);
      const names = d.items.map((l) => {
        const plan = l.planId ? null : null;
        return (this.typeLabels[l.type] || l.type);
      }).join(' · ');
      return `
        <div class="fit-day-row">
          <span>${d.date.slice(5).replace('-', '/')}</span>
          <span class="fit-day-info">${App.esc(names)} · ${total} 分钟</span>
        </div>`;
    }).join('');
  },

  /* ---------- 打卡 ---------- */
  async checkIn(planId) {
    const plans = await window.api.store.list('fitnessPlans');
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const today = App.todayStr();
    await window.api.store.create('fitnessLogs', {
      date: today,
      planId: plan.id,
      type: plan.type,
      durationMin: plan.durationGoal || 30,
      done: true,
      note: `计划：${plan.name}`
    });
    App.toast(`已打卡：${plan.name}`, 'ok');
    await this.render();
  },

  async uncheck(planId) {
    const logs = await window.api.store.list('fitnessLogs');
    const today = App.todayStr();
    const log = logs.find((l) => l.date === today && l.planId === planId);
    if (!log) return;
    await window.api.store.remove('fitnessLogs', log.id);
    App.toast('已取消今日打卡', 'info');
    await this.render();
  },

  async addPlan() {
    const name = document.getElementById('fitPlanName').value.trim();
    if (!name) { App.toast('请填写计划名称', 'error'); return; }
    const weeklyGoal = parseInt(document.getElementById('fitPlanWeekly').value, 10) || 0;
    const durationGoal = parseInt(document.getElementById('fitPlanDuration').value, 10) || 0;
    await window.api.store.create('fitnessPlans', {
      name,
      type: document.getElementById('fitPlanType').value,
      weeklyGoal,
      durationGoal,
      note: document.getElementById('fitPlanNote').value.trim()
    });
    Modal.close('fitPlanModal');
    document.getElementById('fitPlanName').value = '';
    document.getElementById('fitPlanNote').value = '';
    App.toast('健身计划已创建', 'ok');
    await this.render();
  },

  async removePlan(planId) {
    if (!confirm('确定删除该健身计划？相关打卡记录会保留')) return;
    await window.api.store.remove('fitnessPlans', planId);
    App.toast('计划已删除', 'ok');
    await this.render();
  },

  async addLog() {
    const date = document.getElementById('fitLogDate').value || App.todayStr();
    const durationMin = parseInt(document.getElementById('fitLogDuration').value, 10);
    if (!durationMin || durationMin <= 0) { App.toast('请输入有效时长', 'error'); return; }
    const planId = document.getElementById('fitLogPlan').value || null;
    const type = planId ? '' : document.getElementById('fitLogType').value;
    await window.api.store.create('fitnessLogs', {
      date,
      planId,
      type: planId ? null : type,
      durationMin,
      done: true,
      note: document.getElementById('fitLogNote').value.trim()
    });
    Modal.close('fitLogModal');
    document.getElementById('fitLogDuration').value = '';
    document.getElementById('fitLogNote').value = '';
    App.toast('打卡已记录', 'ok');
    await this.render();
  }
};

window.Fitness = Fitness;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fitAddPlanBtn').addEventListener('click', () => {
    Modal.open('fitPlanModal');
    document.getElementById('fitPlanName').focus();
  });
  document.getElementById('fitPlanCancel').addEventListener('click', () => Modal.close('fitPlanModal'));
  document.getElementById('fitPlanSave').addEventListener('click', () => Fitness.addPlan());

  document.getElementById('fitLogBtn').addEventListener('click', async () => {
    const plans = await window.api.store.list('fitnessPlans');
    const select = document.getElementById('fitLogPlan');
    select.innerHTML = `<option value="">不关联计划</option>` + plans.map((p) => `<option value="${p.id}">${App.esc(p.name)}</option>`).join('');
    document.getElementById('fitLogDate').value = App.todayStr();
    Modal.open('fitLogModal');
    document.getElementById('fitLogDuration').focus();
  });
  document.getElementById('fitLogCancel').addEventListener('click', () => Modal.close('fitLogModal'));
  document.getElementById('fitLogSave').addEventListener('click', () => Fitness.addLog());

  document.getElementById('fitPlanList').addEventListener('click', async (e) => {
    // 细致条目：添加条目
    const addBtn = e.target.closest('[data-add]');
    if (addBtn) {
      const box = addBtn.closest('.fit-plan-item');
      const nameInput = box.querySelector('.fit-item-add-name');
      const minInput = box.querySelector('.fit-item-add-min');
      await Fitness.addPlanItem(addBtn.dataset.add, nameInput.value, minInput.value);
      return;
    }
    // 细致条目：状态按钮
    const itemBtn = e.target.closest('.fit-item-btn');
    if (itemBtn) {
      const row = itemBtn.closest('.fit-item-row');
      if (row) {
        await Fitness.setItemStatus(row.dataset.plan, row.dataset.item, itemBtn.dataset.st);
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    const item = e.target.closest('.fit-plan-item');
    if (!btn || !item) return;
    const act = btn.dataset.act;
    if (act === 'check') await Fitness.checkIn(item.dataset.id);
    else if (act === 'uncheck') await Fitness.uncheck(item.dataset.id);
    else if (act === 'del') await Fitness.removePlan(item.dataset.id);
  });

  /* 细致条目：自定义备注失焦保存 */
  document.getElementById('fitPlanList').addEventListener('change', async (e) => {
    const note = e.target.closest('.fit-item-note');
    if (!note) return;
    await Fitness.saveItemNote(note.dataset.plan, note.dataset.item, note.value);
  });
});
