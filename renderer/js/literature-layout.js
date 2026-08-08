'use strict';

/* ============ 文献三栏布局：拖拽调宽 + 折叠 + 字号三档（持久化 settings.literatureLayout） ============ */

const LiteratureLayout = {
  defaults: { widths: { tree: 210, detail: 40 }, collapsed: { tree: false, list: false, detail: false }, fontSize: 'medium' },
  state: null,
  _saveTimer: null,

  async load() {
    const s = await window.api.store.getSettings();
    const stored = (s && s.literatureLayout) || {};
    this.state = {
      widths: { ...this.defaults.widths, ...(stored.widths || {}) },
      collapsed: { ...this.defaults.collapsed, ...(stored.collapsed || {}) },
      fontSize: stored.fontSize || this.defaults.fontSize
    };
    this.apply();
  },

  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      try {
        await window.api.store.saveSettings({ literatureLayout: this.state });
      } catch (e) { /* 忽略持久化失败 */ }
    }, 300);
  },

  apply() {
    const root = document.getElementById('litSplit3');
    if (!root) return;
    const w = this.state.widths;
    const c = this.state.collapsed;
    // 折叠时该栏收缩为窄条（42px），展开恢复用户宽度——为其他栏释放空间
    root.style.setProperty('--lit-tree-w', c.tree ? '42px' : `${w.tree}px`);
    root.style.setProperty('--lit-list-w', c.list ? '42px' : '1fr');
    root.style.setProperty('--lit-detail-w', c.detail ? '42px' : `${w.detail}%`);
    // 折叠状态
    document.querySelectorAll('#litSplit3 .lit-col').forEach((col) => {
      const which = col.dataset.col;
      const collapsed = c[which];
      col.classList.toggle('collapsed', !!collapsed);
      const btn = col.querySelector('.lit-collapse-btn');
      if (btn) btn.textContent = collapsed ? '▶' : '◀';
    });
    // 折叠时不隐藏 divider（保留拖拽能力，避免折叠后无法调宽/展开）
    document.querySelectorAll('#litSplit3 .lit-divider').forEach((d) => { d.style.display = ''; });
    // 字号
    const page = document.getElementById('page-literature');
    if (page) page.dataset.litFont = this.state.fontSize;
  },

  /* ---------- 拖拽 ---------- */
  initDrag() {
    document.querySelectorAll('#litSplit3 .lit-divider').forEach((divider) => {
      divider.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const which = divider.dataset.divider;
        const root = document.getElementById('litSplit3');
        const containerW = root.clientWidth || 900;
        const startX = e.clientX;
        const isTree = which === 'tree';
        // 起始宽度：树=px；详情=容器宽 * %
        const startTree = this.state.widths.tree;
        const startDetailPct = this.state.widths.detail;
        const startDetail = (startDetailPct / 100) * containerW;
        document.body.classList.add('lit-resizing');
        const onMove = (ev) => {
          const delta = ev.clientX - startX;
          let px = isTree ? startTree + delta : startDetail + delta;
          px = Math.max(160, Math.min(420, px)); // clamp 160-420px
          if (isTree) {
            this.state.widths.tree = Math.round(px);
            root.style.setProperty('--lit-tree-w', `${this.state.widths.tree}px`);
          } else {
            const pct = Math.round((px / containerW) * 100);
            this.state.widths.detail = Math.max(20, Math.min(60, pct));
            root.style.setProperty('--lit-detail-w', `${this.state.widths.detail}%`);
          }
        };
        const onUp = () => {
          document.body.classList.remove('lit-resizing');
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          this.save();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      // 双击复位
      divider.addEventListener('dblclick', () => {
        const which = divider.dataset.divider;
        if (which === 'tree') this.state.widths.tree = this.defaults.widths.tree;
        else this.state.widths.detail = this.defaults.widths.detail;
        this.apply();
        this.save();
      });
    });
  },

  /* ---------- 折叠 ---------- */
  toggleCollapse(which) {
    this.state.collapsed[which] = !this.state.collapsed[which];
    this.apply();
    this.save();
  },

  /* ---------- 字号 ---------- */
  async setFontSize(size) {
    const s = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
    this.state.fontSize = s;
    this.apply();
    this.save();
  },

  /* ---------- 初始化 ---------- */
  async init() {
    try {
      await this.load();
    } catch (e) {
      // 单点失败不阻断：回退默认布局，拖拽/折叠仍可用
      this.state = JSON.parse(JSON.stringify(this.defaults));
    }
    this.initDrag();
    // 折叠按钮
    document.querySelectorAll('#litSplit3 .lit-collapse-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleCollapse(btn.dataset.col));
    });
  }
};

window.LiteratureLayout = LiteratureLayout;

if (typeof module !== 'undefined' && module.exports) module.exports = { LiteratureLayout };

document.addEventListener('DOMContentLoaded', () => {
  if (window.LiteratureLayout) LiteratureLayout.init();
});
