'use strict';

/* ============ 工作进度看板 ============ */

const Board = {
  charts: {},
  tasks: [],

  invalidate() { /* 数据变更后下次 render 重新加载 */ },

  async render() {
    this.tasks = await window.api.store.list('tasks');
    this.tasks = [...this.tasks];
    this.renderKanban();
    await this.renderCharts();
    this.bindDrag();
  },

  kanTasks(status) {
    return this.tasks.filter((t) => t.status === status)
      .sort((a, b) => {
        const pr = { high: 0, medium: 1, low: 2 };
        if (pr[a.priority] !== pr[b.priority]) return pr[a.priority] - pr[b.priority];
        return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1;
      });
  },

  renderKanban() {
    const today = App.todayStr();
    const cols = { todo: 'kanTodo', doing: 'kanDoing', done: 'kanDone' };
    ['todo', 'doing', 'done'].forEach((s) => {
      const items = this.kanTasks(s);
      document.getElementById(`cnt${s[0].toUpperCase() + s.slice(1)}`).textContent = items.length;
      const box = document.getElementById(cols[s]);
      if (items.length === 0) {
        box.innerHTML = `<div class="kan-col-hint">拖拽任务到这里</div>`;
        return;
      }
      box.innerHTML = items.map((t) => {
        const overdue = t.dueDate && t.dueDate < today && s !== 'done';
        const pName = App.projectName(t.projectId);
        const rarity = { high: 6, medium: 4, low: 2 }[t.priority] || 2;
        const rarityStars = Array.from({ length: rarity }, () => '<i></i>').join('');
        return `
        <div class="kan-card priority-${t.priority}" draggable="true" data-id="${t.id}">
          <div class="k-title">${App.esc(t.title)}</div>
          <div class="k-meta">
            <span class="tag ${t.priority}">${App.priorityLabel(t.priority)}</span>
            <span class="rarity-stars compact" title="${rarity}星优先级" aria-label="${rarity}星优先级">${rarityStars}</span>
            ${t.dueDate ? `<span class="due ${overdue ? 'over' : ''}">DUE ${App.fmtDate(t.dueDate)}</span>` : ''}
            ${pName ? `<span class="tag project">📁 ${App.esc(pName)}</span>` : ''}
          </div>
        </div>`;
      }).join('');
    });
  },

  bindDrag() {
    const cards = document.querySelectorAll('.kan-card');
    const cols = document.querySelectorAll('.kanban-col');

    cards.forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    cols.forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        const status = col.dataset.status;
        const t = this.tasks.find((x) => x.id === id);
        if (!t || t.status === status) return;
        await window.api.store.update('tasks', id, {
          status,
          completedAt: status === 'done' ? new Date().toISOString() : (status === 'doing' ? t.completedAt : null)
        });
        if (status === 'done') {
          await window.api.store.create('activity', { date: App.todayStr(), taskId: id, action: '完成', content: `完成任务：${t.title}` });
        }
        App.toast(`已移至「${status === 'todo' ? '待办' : status === 'doing' ? '进行中' : '已完成'}」`, 'ok');
        this.render();
      });
    });
  },

  async renderCharts() {
    const stats = await window.api.store.taskStats();
    // 完成率环形图
    if (this.charts.doneRate) this.charts.doneRate.dispose();
    const c1 = echarts.init(document.getElementById('chartDoneRate'));
    this.charts.doneRate = c1;
    c1.setOption({
      tooltip: { formatter: '{b}: {c} ({d}%)' },
      series: [{
        type: 'pie', radius: ['62%', '82%'], center: ['50%', '52%'],
        avoidLabelOverlap: false,
        label: { show: true, position: 'center', formatter: `${stats.doneRate}%`, fontSize: 24, fontWeight: 700, color: '#1c2433' },
        labelLine: { show: false },
        emphasis: { label: { show: true, fontSize: 26, fontWeight: 700 } },
        data: [
          { value: stats.done, name: '已完成', itemStyle: { color: '#22a06b' } },
          { value: stats.todo + stats.doing, name: '未完成', itemStyle: { color: '#e3e8f2' } }
        ]
      }],
      graphic: [{ type: 'text', left: 'center', top: '78%', style: { text: `共 ${stats.total} 项`, fill: '#8b95ab', fontSize: 11 } }]
    });

    // 优先级分布
    if (this.charts.priority) this.charts.priority.dispose();
    const c2 = echarts.init(document.getElementById('chartPriority'));
    this.charts.priority = c2;
    c2.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} 项 ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'], center: ['50%', '52%'],
        label: { formatter: '{b}\n{c} 项', fontSize: 11 },
        data: [
          { value: stats.byPriority.high, name: '高优先级', itemStyle: { color: '#d64545' } },
          { value: stats.byPriority.medium, name: '中优先级', itemStyle: { color: '#e8890c' } },
          { value: stats.byPriority.low, name: '低优先级', itemStyle: { color: '#3b6ef5' } }
        ]
      }]
    });

    // 近 7 天趋势
    if (this.charts.trend) this.charts.trend.dispose();
    const c3 = echarts.init(document.getElementById('chartTrend'));
    this.charts.trend = c3;
    const days = stats.last7Days.map((d) => d.date.slice(5).replace('-', '/'));
    c3.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['完成任务', '新建任务'], top: 0, right: 0 },
      grid: { left: 36, right: 16, top: 32, bottom: 24 },
      xAxis: { type: 'category', data: days, axisLine: { lineStyle: { color: '#d3dbe9' } }, axisLabel: { color: '#8b95ab' } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#8b95ab' }, splitLine: { lineStyle: { color: '#eef1f8' } } },
      series: [
        { name: '完成任务', type: 'bar', data: stats.last7Days.map((d) => d.done), itemStyle: { color: '#22a06b', borderRadius: [4, 4, 0, 0] }, barWidth: 18 },
        { name: '新建任务', type: 'line', data: stats.last7Days.map((d) => d.created), smooth: true, itemStyle: { color: '#3b6ef5' }, lineStyle: { color: '#3b6ef5' } }
      ]
    });
  }
};

window.Board = Board;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('boardRefresh').addEventListener('click', () => Board.render());
});
