'use strict';

/* ============ 时间规划：番茄钟 + 时间分布 ============ */

const Time = {
  state: {
    phase: 'idle',        // idle | focus | break
    running: false,
    remainingSec: 0,
    focusMin: 25,
    breakMin: 5,
    category: 'focus',
    timerId: null,
    endAt: null
  },
  charts: {},
  categoryLabels: { focus: '专注', work: '工作', study: '学习', life: '生活', rest: '休息', sport: '运动', reading: '阅读', writing: '写作' },
  categoryColors: { focus: '#fff44f', work: '#f5a623', study: '#3b82f6', life: '#8eef5b', rest: '#9b9fa5', sport: '#ff625d', reading: '#7a5cf8', writing: '#10b981' },

  /* ---------- 生命周期 ---------- */
  async render() {
    const today = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];
    document.getElementById('timeDate').textContent = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 · 周${week}`;

    // 恢复番茄钟配置
    const settings = await window.api.store.getSettings();
    if (settings.pomodoroFocusMin) {
      this.state.focusMin = settings.pomodoroFocusMin;
      document.getElementById('pomoFocusMin').value = settings.pomodoroFocusMin;
    }
    if (settings.pomodoroBreakMin) {
      this.state.breakMin = settings.pomodoroBreakMin;
      document.getElementById('pomoBreakMin').value = settings.pomodoroBreakMin;
    }
    this.syncPomoUi();
    this.renderStats();
    this.renderCharts();
    this.renderLogs();
  },

  /* ---------- 番茄钟 ---------- */
  start() {
    const focusMin = Math.max(1, parseInt(document.getElementById('pomoFocusMin').value, 10) || 25);
    const breakMin = Math.max(1, parseInt(document.getElementById('pomoBreakMin').value, 10) || 5);
    this.state.focusMin = focusMin;
    this.state.breakMin = breakMin;
    window.api.store.saveSettings({ pomodoroFocusMin: focusMin, pomodoroBreakMin: breakMin }).catch(() => {});

    if (this.state.phase === 'idle') {
      this.state.phase = 'focus';
      this.state.remainingSec = focusMin * 60;
    }
    this.state.running = true;
    this.state.endAt = Date.now() + this.state.remainingSec * 1000;
    this.tick();
    this.startInterval();
    this.syncPomoUi();
  },

  pause() {
    if (!this.state.running) return;
    this.state.remainingSec = Math.max(0, Math.round((this.state.endAt - Date.now()) / 1000));
    this.state.running = false;
    this.clearInterval();
    this.syncPomoUi();
  },

  reset() {
    this.clearInterval();
    this.state.phase = 'idle';
    this.state.running = false;
    this.state.remainingSec = this.state.focusMin * 60;
    this.state.endAt = null;
    this.syncPomoUi();
  },

  startInterval() {
    this.clearInterval();
    this.state.timerId = setInterval(() => this.tick(), 1000);
  },

  clearInterval() {
    if (this.state.timerId) {
      clearInterval(this.state.timerId);
      this.state.timerId = null;
    }
  },

  tick() {
    if (!this.state.endAt) return;
    const remaining = Math.max(0, Math.round((this.state.endAt - Date.now()) / 1000));
    this.state.remainingSec = remaining;
    this.syncPomoUi();
    if (remaining <= 0) {
      if (this.state.phase === 'focus') this.completeFocus();
      else this.completeBreak();
    }
  },

  async completeFocus() {
    this.clearInterval();
    const date = App.todayStr();
    await window.api.store.create('timeLogs', {
      date,
      category: this.state.category,
      minutes: this.state.focusMin,
      source: 'pomodoro',
      note: '番茄钟完成'
    });
    App.toast(`✅ 专注 ${this.state.focusMin} 分钟完成，休息一下吧`, 'ok');
    // 自动进入休息
    this.state.phase = 'break';
    this.state.remainingSec = this.state.breakMin * 60;
    this.state.running = true;
    this.state.endAt = Date.now() + this.state.remainingSec * 1000;
    this.startInterval();
    this.renderStats();
    this.renderCharts();
  },

  async completeBreak() {
    this.clearInterval();
    App.toast('休息结束，可以开始下一轮专注', 'info');
    this.state.phase = 'idle';
    this.state.running = false;
    this.state.remainingSec = this.state.focusMin * 60;
    this.state.endAt = null;
    this.syncPomoUi();
  },

  syncPomoUi() {
    const min = Math.floor(this.state.remainingSec / 60);
    const sec = this.state.remainingSec % 60;
    const timeEl = document.getElementById('pomoTime');
    const statusEl = document.getElementById('pomoStatus');
    const progressEl = document.getElementById('pomoRingProgress');
    const startBtn = document.getElementById('pomoStart');
    const pauseBtn = document.getElementById('pomoPause');
    const resetBtn = document.getElementById('pomoReset');

    if (timeEl) timeEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    if (statusEl) {
      if (this.state.phase === 'focus') statusEl.textContent = this.state.running ? 'FOCUS / 专注中' : 'FOCUS / 已暂停';
      else if (this.state.phase === 'break') statusEl.textContent = this.state.running ? 'BREAK / 休息中' : 'BREAK / 休息暂停';
      else statusEl.textContent = 'READY / 待开始';
    }
    if (progressEl) {
      const total = (this.state.phase === 'break' ? this.state.breakMin : this.state.focusMin) * 60 || 1;
      const pct = total ? this.state.remainingSec / total : 0;
      const circ = 2 * Math.PI * 96;
      progressEl.style.strokeDasharray = `${(pct * circ).toFixed(1)} ${circ.toFixed(1)}`;
    }
    if (startBtn) {
      startBtn.disabled = this.state.running;
      startBtn.textContent = this.state.phase === 'break' ? '跳过休息' : '开始';
    }
    if (pauseBtn) pauseBtn.disabled = !this.state.running;
    if (resetBtn) resetBtn.disabled = this.state.phase === 'idle' && !this.state.running;
  },

  /* ---------- 统计 ---------- */
  async renderStats() {
    const logs = await window.api.store.list('timeLogs');
    const today = App.todayStr();
    const weekStart = this.weekStart();
    const todayLogs = logs.filter((l) => l.date === today);
    const weekLogs = logs.filter((l) => l.date >= weekStart && l.date <= today);
    const doneCount = todayLogs.filter((l) => l.source === 'pomodoro').length;
    const doneMin = todayLogs.filter((l) => l.source === 'pomodoro').reduce((s, l) => s + (l.minutes || 0), 0);
    const weekMin = weekLogs.reduce((s, l) => s + (l.minutes || 0), 0);
    const totalMin = logs.reduce((s, l) => s + (l.minutes || 0), 0);
    document.getElementById('timeStatStrip').innerHTML = `
      <div class="stat-card"><div class="lbl">今日番茄</div><div class="num">${doneCount}</div></div>
      <div class="stat-card"><div class="lbl">今日专注</div><div class="num">${doneMin}<small style="font-size:14px"> 分</small></div></div>
      <div class="stat-card"><div class="lbl">本周时间</div><div class="num">${weekMin}<small style="font-size:14px"> 分</small></div></div>
      <div class="stat-card"><div class="lbl">累计时间</div><div class="num">${Math.round(totalMin / 60)}<small style="font-size:14px"> 时</small></div></div>`;
    const countEl = document.getElementById('pomoDoneCount');
    const minEl = document.getElementById('pomoDoneMin');
    if (countEl) countEl.textContent = doneCount;
    if (minEl) minEl.textContent = doneMin;
  },

  weekStart() {
    const d = new Date();
    const dow = d.getDay() || 7;
    d.setDate(d.getDate() - dow + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /* ---------- 时间分布图 ---------- */
  async renderCharts() {
    const logs = await window.api.store.list('timeLogs');
    const today = App.todayStr();
    const weekStart = this.weekStart();

    const dailyData = this.aggregate(logs.filter((l) => l.date === today));
    const weeklyData = this.aggregate(logs.filter((l) => l.date >= weekStart && l.date <= today));

    if (this.charts.daily) this.charts.daily.dispose();
    if (this.charts.weekly) this.charts.weekly.dispose();
    this.charts.daily = echarts.init(document.getElementById('distDaily'));
    this.charts.weekly = echarts.init(document.getElementById('distWeekly'));
    this.charts.daily.setOption(this.pieOption('今日时间分布', dailyData));
    this.charts.weekly.setOption(this.pieOption('本周时间分布', weeklyData));
  },

  aggregate(logs) {
    const map = {};
    logs.forEach((l) => {
      const key = this.categoryLabels[l.category] || l.category || '其他';
      map[key] = (map[key] || 0) + (l.minutes || 0);
    });
    return Object.entries(map).map(([name, value]) => ({
      name,
      value,
      itemStyle: { color: this.categoryColors[Object.keys(this.categoryLabels).find((k) => this.categoryLabels[k] === name)] || '#9b9fa5' }
    })).sort((a, b) => b.value - a.value);
  },

  pieOption(title, data) {
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} 分钟 ({d}%)' },
      title: { text: title, left: 'center', top: 0, textStyle: { fontSize: 12, color: '#0a0b0d', fontWeight: 700, fontFamily: 'HarmonyOS Sans SC' } },
      series: [{
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['50%', '56%'],
        label: { formatter: '{b}\n{c}分', fontSize: 10, color: '#0a0b0d' },
        labelLine: { length: 8, length2: 6 },
        data: data.length ? data : [{ name: '暂无记录', value: 1, itemStyle: { color: '#e2e2dd' } }]
      }]
    };
  },

  /* ---------- 手动时间块 ---------- */
  async saveLog() {
    const category = document.getElementById('timeLogCategory').value;
    const minutes = parseInt(document.getElementById('timeLogMinutes').value, 10);
    const note = document.getElementById('timeLogNote').value.trim();
    if (!minutes || minutes <= 0) {
      App.toast('请输入有效时长', 'error');
      return;
    }
    await window.api.store.create('timeLogs', {
      date: App.todayStr(),
      category,
      minutes,
      source: 'manual',
      note
    });
    document.getElementById('timeLogMinutes').value = '';
    document.getElementById('timeLogNote').value = '';
    App.toast('时间块已记录', 'ok');
    this.renderStats();
    this.renderCharts();
    this.renderLogs();
  },

  async renderLogs() {
    const logs = await window.api.store.list('timeLogs');
    const today = App.todayStr();
    const list = logs
      .filter((l) => l.date === today)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 20);
    const box = document.getElementById('timeLogList');
    if (!list.length) {
      box.innerHTML = `<div class="empty-tip" style="padding:20px 0">今天还没有时间记录，番茄钟完成后会自动计入「专注」</div>`;
      return;
    }
    box.innerHTML = list.map((l) => {
      const label = this.categoryLabels[l.category] || l.category;
      const color = this.categoryColors[l.category] || '#9b9fa5';
      return `
        <div class="time-log-item">
          <span class="time-log-dot" style="background:${color}"></span>
          <span class="time-log-label">${App.esc(label)}</span>
          <span class="time-log-min">${l.minutes} 分钟</span>
          <span class="time-log-src">${l.source === 'pomodoro' ? '番茄钟' : '手动'}</span>
          ${l.note ? `<span class="time-log-note">${App.esc(l.note)}</span>` : ''}
        </div>`;
    }).join('');
  }
};

window.Time = Time;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pomoStart').addEventListener('click', () => {
    if (Time.state.phase === 'break' && Time.state.running) {
      // 跳过休息，回到专注准备
      Time.clearInterval();
      Time.state.phase = 'idle';
      Time.state.remainingSec = Time.state.focusMin * 60;
      Time.state.running = false;
      Time.state.endAt = null;
      Time.syncPomoUi();
      return;
    }
    Time.start();
  });
  document.getElementById('pomoPause').addEventListener('click', () => Time.pause());
  document.getElementById('pomoReset').addEventListener('click', () => Time.reset());

  document.getElementById('pomoCategory').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#pomoCategory .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    Time.state.category = btn.dataset.c;
  });

  document.getElementById('timeLogSave').addEventListener('click', () => Time.saveLog());
  document.getElementById('timeLogMinutes').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Time.saveLog();
  });

  // 页面隐藏时校正计时（防休眠漂移）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Time.state.running && Time.state.endAt) Time.tick();
  });
});
