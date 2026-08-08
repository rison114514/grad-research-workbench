'use strict';

/* ============ 日报 / 周报（生成 · 查看 · 编辑 · 多选导出） ============ */

const Reports = {
  type: 'daily',
  current: null,
  editing: false,
  selected: new Set(),   // 选中的历史报告 id
  history: [],           // 历史报告列表

  async render() {
    this.current = null;
    this.editing = false;
    document.getElementById('reportDate').value = App.todayStr();
    this.history = await window.api.store.list('reports');
    this.renderHistory();
    this.renderPreview('');
  },

  renderHistory() {
    const list = document.getElementById('reportList');
    const sorted = [...this.history].sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
    if (sorted.length === 0) {
      list.innerHTML = `<div class="empty-tip">暂无生成记录</div>`;
      this.updateSelCount();
      return;
    }
    list.innerHTML = sorted.map((r) => `
      <div class="report-item ${this.selected.has(r.id) ? 'selected' : ''}" data-id="${r.id}">
        <label class="check report-check" title="选择用于导出">
          <input type="checkbox" data-sel="${r.id}" ${this.selected.has(r.id) ? 'checked' : ''}>
        </label>
        <div class="report-item-body">
          <div class="r-title">${r.type === 'daily' ? 'DAILY 日报' : 'WEEKLY 周报'} · ${App.esc(r.dateRange.label)}</div>
          <div class="r-meta">${(r.generatedAt || '').slice(0, 16).replace('T', ' ')}${r.source === 'ai' ? ' · AI 润色' : ''}</div>
        </div>
      </div>`).join('');
    this.updateSelCount();
  },

  updateSelCount() {
    const countEl = document.getElementById('reportSelCount');
    if (countEl) countEl.textContent = this.selected.size;
  },

  renderPreview(content) {
    const box = document.getElementById('reportPreview');
    if (this.editing && this.current) {
      box.innerHTML = `
        <div class="report-edit-head">
          <h3>编辑报告 · ${App.esc(this.current.dateRange.label || '')}</h3>
          <div class="row">
            <button class="btn btn-primary btn-sm" id="reportEditSave">保存修改</button>
            <button class="btn btn-sm" id="reportEditCancel">取消</button>
          </div>
        </div>
        <textarea class="summary-edit report-edit-area" id="reportEditArea"></textarea>`;
      document.getElementById('reportEditArea').value = this.current.content || '';
      document.getElementById('reportEditSave').addEventListener('click', () => this.saveEdit());
      document.getElementById('reportEditCancel').addEventListener('click', () => { this.editing = false; this.renderPreview(this.current.content); });
      return;
    }
    if (!content) {
      box.innerHTML = `<div class="empty-tip">选择类型与日期后点击「生成报告」<br/><br/>报告将自动汇总：完成任务 · 文献阅读 · 项目动态</div>`;
      return;
    }
    box.innerHTML = `
      <div class="report-view-head">
        <div class="row">
          <button class="btn btn-sm" id="reportEditBtn">✎ 编辑</button>
          <button class="btn btn-sm" id="reportDeleteBtn">删除</button>
        </div>
      </div>
      <div class="markdown">${App.markdown(content)}</div>`;
    document.getElementById('reportEditBtn').addEventListener('click', () => { this.editing = true; this.renderPreview(this.current.content); });
    document.getElementById('reportDeleteBtn').addEventListener('click', () => this.deleteCurrent());
  },

  /* ---------- 生成 ---------- */
  async generate() {
    const date = document.getElementById('reportDate').value || App.todayStr();
    const polish = document.getElementById('reportPolish').checked;
    App.toast('正在生成报告…');
    const { report } = await window.api.report.generate(this.type, date, { polish });
    this.current = report;
    this.history = await window.api.store.list('reports');
    this.renderPreview(report.content);
    this.renderHistory();
    App.toast(`报告已生成${report.source === 'ai' ? '（AI 润色）' : ''}`, 'ok');
  },

  /* ---------- 编辑 / 删除 ---------- */
  async saveEdit() {
    if (!this.current) return;
    const content = document.getElementById('reportEditArea').value;
    await window.api.store.update('reports', this.current.id, { content, editedAt: new Date().toISOString() });
    this.current.content = content;
    this.editing = false;
    this.history = await window.api.store.list('reports');
    this.renderPreview(content);
    App.toast('报告已更新', 'ok');
  },

  async deleteCurrent() {
    if (!this.current) return;
    if (!confirm('确定删除该报告？')) return;
    await window.api.store.remove('reports', this.current.id);
    this.selected.delete(this.current.id);
    this.current = null;
    this.history = await window.api.store.list('reports');
    this.renderHistory();
    this.renderPreview('');
    App.toast('报告已删除', 'ok');
  },

  /* ---------- 导出（单选 / 多选） ---------- */
  async exportMd() {
    if (!this.current) { App.toast('请先生成报告或选择历史报告', 'error'); return; }
    const res = await window.api.dialog.exportMarkdown({
      defaultName: `${this.current.type === 'daily' ? '日报' : '周报'}-${this.current.dateRange.label}`,
      content: this.current.content
    });
    if (res.ok) App.toast(`已导出：${res.filePath}`, 'ok');
  },

  async exportSelected() {
    if (this.selected.size === 0) { App.toast('请先勾选要导出的历史报告', 'error'); return; }
    const selected = this.history.filter((r) => this.selected.has(r.id));
    if (selected.length === 1) {
      // 单个：走保存对话框
      const r = selected[0];
      const res = await window.api.dialog.exportMarkdown({
        defaultName: `${r.type === 'daily' ? '日报' : '周报'}-${r.dateRange.label}`,
        content: r.content
      });
      if (res.ok) App.toast(`已导出：${res.filePath}`, 'ok');
      return;
    }
    // 多个：选择目录批量写入
    const files = selected.map((r) => ({
      name: `${r.type === 'daily' ? '日报' : '周报'}-${String(r.dateRange.label).replace(/[\\/:*?"<>|]/g, '-')}`,
      content: r.content
    }));
    const res = await window.api.dialog.exportMarkdowns({ files });
    if (res.ok && Array.isArray(res.files)) {
      App.toast(`已导出 ${res.files.length} 份报告`, 'ok');
    } else if (res.ok) {
      App.toast('已触发下载（浏览器预览）', 'ok');
    }
  },

  toggleSelect(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.renderHistory();
  },

  selectAll(checked) {
    const sorted = [...this.history].sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));
    if (checked) sorted.forEach((r) => this.selected.add(r.id));
    else this.selected.clear();
    this.renderHistory();
  }
};

window.Reports = Reports;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('reportType').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#reportType .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    Reports.type = btn.dataset.t;
  });

  document.getElementById('reportGenerate').addEventListener('click', () => Reports.generate());
  document.getElementById('reportExport').addEventListener('click', () => Reports.exportMd());
  document.getElementById('reportExportSelected').addEventListener('click', () => Reports.exportSelected());
  document.getElementById('reportSelectAll').addEventListener('change', (e) => Reports.selectAll(e.target.checked));

  document.getElementById('reportList').addEventListener('click', async (e) => {
    const check = e.target.closest('input[type="checkbox"]');
    if (check && check.dataset.sel) {
      e.stopPropagation();
      Reports.toggleSelect(check.dataset.sel);
      return;
    }
    const item = e.target.closest('.report-item');
    if (!item) return;
    const r = Reports.history.find((x) => x.id === item.dataset.id);
    if (r) {
      Reports.current = r;
      Reports.editing = false;
      Reports.renderPreview(r.content);
    }
  });
});
