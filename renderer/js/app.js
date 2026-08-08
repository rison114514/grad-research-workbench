'use strict';

/* ============ 核心工具与导航 ============ */

const App = {
  state: {
    settings: null,
    projects: [],
    activePage: 'tasks'
  },

  /* ---------- 通用工具 ---------- */
  el(id) { return document.getElementById(id); },

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  toast(msg, type = 'info', ms = 3200) {
    const root = this.el('toastRoot');
    const t = document.createElement('div');
    t.className = `toast ${type === 'error' ? 'err' : type === 'ok' ? 'ok' : ''}`;
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, ms - 300);
    setTimeout(() => t.remove(), ms);
  },

  todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  fmtDate(input) {
    if (!input) return '';
    // 兼容 Date 对象与 YYYY-MM-DD 字符串；非法输入原样返回
    let s = input instanceof Date
      ? `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, '0')}-${String(input.getDate()).padStart(2, '0')}`
      : String(input);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const d = new Date(s.slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return s;
    const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    const [, m, day] = s.slice(0, 10).split('-');
    return `${Number(m)}月${Number(day)}日 周${w}`;
  },

  priorityLabel(p) { return { high: '高', medium: '中', low: '低' }[p] || '中'; },

  /* ---------- Markdown 渲染（轻量） ---------- */
  markdown(text) {
    if (!text) return '';
    let s = this.esc(text);
    // 代码块（``` 围栏，优先于行内代码处理；esc 已转义 < > &，lang 为纯标识符）
    s = s.replace(/```([\w+-]*)\s*\n?([\s\S]*?)```/g, (m, lang, code) => `<pre class="code-block">${lang ? `<span class="code-lang">${lang}</span>` : ''}${code}</pre>`);
    // 代码行
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 标题
    s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    // 引用
    s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
    // 无序列表
    s = s.replace(/^[-*] (.*)$/gm, '<li>$1</li>');
    // 有序列表
    s = s.replace(/^\d+[.、] (.*)$/gm, '<li>$1</li>');
    // 粗体
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 链接
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // 分割线
    s = s.replace(/^---$/gm, '<hr>');
    // 段落换行
    const lines = s.split('\n');
    let html = '';
    let inList = false;
    let listType = null;
    for (const line of lines) {
      if (line.startsWith('<li>')) {
        const type = /^\d+[.、]/.test(line.replace(/<[^>]+>/g, '')) ? 'ol' : 'ul';
        if (!inList || listType !== type) {
          if (inList) html += `</${listType}>`;
          html += `<${type}>`;
          inList = true;
          listType = type;
        }
        html += line;
      } else {
        if (inList) { html += `</${listType}>`; inList = false; listType = null; }
        if (line === '' || line === '<hr>') html += line;
        else if (/^<(h1|h2|h3|blockquote|hr)>/.test(line)) html += line;
        else html += `<p>${line}</p>`;
      }
    }
    if (inList) html += `</${listType}>`;
    // 提取 li 里的纯文本用于有序/无序判断时已处理，这里修正 ul/ol 标签
    html = html.replace(/<ol><li/g, '<ul><li').replace(/<\/li><\/ol>/g, '</li></ul>');
    return html;
  },

  /* ---------- 导航 ---------- */
  sinkNavItem(item) {
    if (!item) return;
    clearTimeout(item._projectionTimer);
    item.classList.remove('hologram', 'departing');
    void item.offsetWidth;
    item.classList.add('departing');
    item._projectionTimer = setTimeout(() => item.classList.remove('departing'), 360);
  },

  liftNavItem(item) {
    if (!item || this.projectedNavItem === item) return;
    const items = [...document.querySelectorAll('.nav-item')];
    const previous = this.projectedNavItem;

    this.sinkNavItem(previous);
    items.forEach((navItem) => {
      const isMutedActive = navItem.classList.contains('active') && navItem !== item;
      navItem.classList.toggle('projection-muted', isMutedActive);
      if (navItem !== item && navItem !== previous) navItem.classList.remove('hologram');
    });

    clearTimeout(item._projectionTimer);
    item.classList.remove('departing', 'projection-muted');
    void item.offsetWidth;
    item.classList.add('hologram');
    this.projectedNavItem = item;
  },

  resetNavProjection() {
    const items = [...document.querySelectorAll('.nav-item')];
    const active = items.find((item) => item.classList.contains('active'));
    const previous = this.projectedNavItem;

    if (previous && previous !== active) this.sinkNavItem(previous);
    items.forEach((item) => {
      item.classList.remove('projection-muted');
      if (item !== active && item !== previous) item.classList.remove('hologram');
    });
    if (active) {
      clearTimeout(active._projectionTimer);
      active.classList.remove('departing');
      active.classList.add('hologram');
    }
    this.projectedNavItem = active || null;
  },

  initNavProjection() {
    const nav = document.getElementById('nav');
    const items = [...document.querySelectorAll('.nav-item')];
    items.forEach((item) => {
      item.tabIndex = 0;
      item.addEventListener('pointerenter', () => this.liftNavItem(item));
      item.addEventListener('focus', () => this.liftNavItem(item));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          item.click();
        }
      });
    });
    nav.addEventListener('pointerleave', () => this.resetNavProjection());
    nav.addEventListener('focusout', (event) => {
      if (!nav.contains(event.relatedTarget)) this.resetNavProjection();
    });
    this.resetNavProjection();
  },

  async init() {
    const settings = await window.api.store.getSettings();
    this.state.settings = settings;
    this.state.projects = await window.api.store.list('projects');
    this.updateAiStatus();

    // nav 点击采用容器级事件委托（见文件底部 bindNav），此处不再逐项绑定，避免双重触发
    this.initSidebarToggle();
    this.initNavProjection();
    const assistantToggle = document.getElementById('assistantToggle');
    assistantToggle.addEventListener('click', () => window.Assistant.open());
    assistantToggle.addEventListener('pointermove', (e) => {
      const rect = assistantToggle.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width - .5) * 2;
      const py = ((e.clientY - rect.top) / rect.height - .5) * 2;
      assistantToggle.style.setProperty('--assistant-rx', `${(-py * 4.5).toFixed(2)}deg`);
      assistantToggle.style.setProperty('--assistant-ry', `${(px * 7).toFixed(2)}deg`);
      assistantToggle.style.setProperty('--avatar-x', `${(px * 6).toFixed(2)}px`);
      assistantToggle.style.setProperty('--avatar-y', `${(py * 4).toFixed(2)}px`);
    });
    assistantToggle.addEventListener('pointerleave', () => {
      assistantToggle.style.removeProperty('--assistant-rx');
      assistantToggle.style.removeProperty('--assistant-ry');
      assistantToggle.style.removeProperty('--avatar-x');
      assistantToggle.style.removeProperty('--avatar-y');
    });
    document.getElementById('assistantClose').addEventListener('click', () => window.Assistant.close());
    document.getElementById('assistantMask').addEventListener('click', () => window.Assistant.close());

    this.navigate('tasks');
  },

  initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    let collapsed = false;
    try { collapsed = localStorage.getItem('research-workbench.sidebar-collapsed') === '1'; } catch (error) { /* ignore */ }
    const apply = () => {
      sidebar.classList.toggle('collapsed', collapsed);
      document.querySelector('.app').classList.toggle('sidebar-collapsed', collapsed);
      toggle.setAttribute('aria-label', collapsed ? '展开侧边栏' : '收起侧边栏');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    };
    apply();
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      apply();
      try { localStorage.setItem('research-workbench.sidebar-collapsed', collapsed ? '1' : '0'); } catch (error) { /* ignore */ }
      setTimeout(() => window.dispatchEvent(new Event('resize')), 280);
    });
  },

  animatePage(page) {
    if (!page) return;
    clearTimeout(page._entryTimer);
    page.classList.remove('page-entering');
    void page.offsetWidth;
    page.classList.add('page-entering');
    page._entryTimer = setTimeout(() => page.classList.remove('page-entering'), 760);
  },

  navigate(page) {
    this.state.activePage = page;
    const main = document.querySelector('.main');
    const lightWorkspaces = new Set(['tasks', 'literature', 'inspirations', 'reports', 'github', 'settings', 'time', 'dailyPlan', 'fitness']);
    main.dataset.workspace = page;
    main.classList.toggle('workspace-light', lightWorkspaces.has(page));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
    this.resetNavProjection();
    const routers = { tasks: 'Tasks', board: 'Board', literature: 'Literature', projects: 'Projects', inspirations: 'Inspirations', reports: 'Reports', github: 'Github', time: 'Time', dailyPlan: 'DailyPlan', fitness: 'Fitness', settings: 'Settings' };
    const fn = window[routers[page]];
    const activePage = document.getElementById(`page-${page}`);
    if (fn && typeof fn.render === 'function') {
      Promise.resolve(fn.render())
        .then(() => this.animatePage(activePage))
        .catch((error) => {
          console.error(`页面加载失败 (${page}):`, error);
          this.toast(`页面加载失败：${error.message}`, 'error');
        });
    } else {
      this.animatePage(activePage);
    }
  },

  async updateAiStatus() {
    const on = await window.api.ai.isConfigured();
    document.getElementById('aiStatusDot').classList.toggle('on', !!on);
  },

  projectName(id) {
    const p = this.state.projects.find((x) => x.id === id);
    return p ? p.name : null;
  }
};

/* ---------- 弹窗通用 ---------- */
const Modal = {
  open(elId) { document.getElementById(elId).classList.remove('hidden'); },
  close(elId) { document.getElementById(elId).classList.add('hidden'); }
};

/* 挂载到 window，供各模块使用 */
window.App = App;
window.Modal = Modal;

/*
 * 导航容器级事件委托
 * 脚本加载即绑定，不依赖 App.init() 完成（前置 await/异步失败不影响导航可用）。
 * 通过 closest() 命中 .nav-item，preventDefault 阻止 <a> 默认导航/刷新，
 * 再调用 App.navigate 切换功能区域。
 */
(function bindNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.addEventListener('click', (event) => {
    const item = event.target.closest('.nav-item');
    if (!item) return;
    event.preventDefault();
    App.navigate(item.dataset.page);
  });
})();
