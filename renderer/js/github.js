'use strict';

/* ============ GitHub 热点追踪 ============ */

/* 语言表（镜像主进程 github-service.js LANGUAGES，用于 datalist 与本地映射预判） */
const GH_LANGUAGES = [
  { slug: 'python', name: 'Python', aliases: ['python', 'py', '蟒蛇', '蟒'] },
  { slug: 'javascript', name: 'JavaScript', aliases: ['javascript', 'js'] },
  { slug: 'typescript', name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { slug: 'java', name: 'Java', aliases: ['java'] },
  { slug: 'go', name: 'Go', aliases: ['go', 'golang'] },
  { slug: 'rust', name: 'Rust', aliases: ['rust', 'rs'] },
  { slug: 'c++', name: 'C++', aliases: ['c++', 'cpp', 'c加加'] },
  { slug: 'c', name: 'C', aliases: ['c'] },
  { slug: 'c#', name: 'C#', aliases: ['c#', 'csharp'] },
  { slug: 'ruby', name: 'Ruby', aliases: ['ruby'] },
  { slug: 'php', name: 'PHP', aliases: ['php'] },
  { slug: 'swift', name: 'Swift', aliases: ['swift'] },
  { slug: 'kotlin', name: 'Kotlin', aliases: ['kotlin'] },
  { slug: 'shell', name: 'Shell', aliases: ['shell', 'bash', 'zsh'] },
  { slug: 'jupyter-notebook', name: 'Jupyter Notebook', aliases: ['jupyter', 'notebook', 'ipynb'] },
  { slug: 'vue', name: 'Vue', aliases: ['vue', 'vue.js'] },
  { slug: 'react', name: 'React', aliases: ['react'] },
  { slug: 'vimscript', name: 'Vim script', aliases: ['vim', 'vimscript'] },
  { slug: 'html', name: 'HTML', aliases: ['html'] },
  { slug: 'css', name: 'CSS', aliases: ['css'] },
  { slug: 'dart', name: 'Dart', aliases: ['dart', 'flutter'] },
  { slug: 'r', name: 'R', aliases: ['r'] },
  { slug: 'perl', name: 'Perl', aliases: ['perl'] }
];

const Github = {
  subs: [],
  activeTab: 'all',
  search: '',
  activeId: null,

  parseRepoInput(value) {
    let input = String(value || '').trim();
    if (!input) return null;
    input = input
      .replace(/^git@github\.com:/i, '')
      .replace(/^(?:git\+)?https?:\/\/(?:www\.)?github\.com\//i, '')
      .replace(/^github\.com\//i, '')
      .split(/[?#]/)[0]
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    try { input = decodeURIComponent(input); } catch (error) { /* keep original */ }
    const parts = input.split('/').filter(Boolean).slice(0, 2);
    if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) return null;
    return `${parts[0]}/${parts[1]}`;
  },

  async render() {
    this.subs = await window.api.store.list('githubSubs');
    this.renderLangDatalist();
    this.renderSubsList();
    this.renderSubsDetail();
  },

  /* ---------- 语言 datalist（热榜输入提示） ---------- */
  renderLangDatalist() {
    const box = document.getElementById('ghLangList');
    if (!box || box.dataset.ready) return;
    box.innerHTML = GH_LANGUAGES.map((l) => `<option value="${App.esc(l.name)}">`).join('');
    box.dataset.ready = '1';
  },

  /* ---------- 订阅列表（tab + 搜索过滤） ---------- */
  filteredSubs() {
    const q = this.search.trim().toLowerCase();
    return this.subs.filter((s) => {
      if (this.activeTab !== 'all' && s.type !== this.activeTab) return false;
      if (!q) return true;
      const hay = `${s.keyword || ''} ${s.fullName || ''} ${s.language || ''} ${s.description || ''}`.toLowerCase();
      return hay.includes(q);
    });
  },

  renderSubsList() {
    const box = document.getElementById('ghSubList');
    const items = this.filteredSubs();
    if (items.length === 0) {
      box.innerHTML = `<div class="empty-tip">${this.subs.length === 0 ? '尚未订阅，可在下方输入关键词或仓库地址添加' : '没有匹配的订阅'}</div>`;
      return;
    }
    box.innerHTML = items.map((s) => {
      if (s.type === 'repo') {
        const meta = [s.starCount ? `★ ${s.starCount}` : '', s.language || '', (s.description || '').slice(0, 60)].filter(Boolean).join(' · ');
        return `<div class="lit-item ${this.activeId === s.id ? 'active' : ''}" data-id="${s.id}" data-type="repo">
          <div class="lit-title">${App.esc(s.keyword)}<span class="lit-del" data-del="${s.id}">✕</span></div>
          <div class="lit-sub">${App.esc(meta || '仓库')}</div>
        </div>`;
      }
      return `<div class="lit-item ${this.activeId === s.id ? 'active' : ''}" data-id="${s.id}" data-type="keyword">
        <div class="lit-title"><span class="tag low">KEYWORD</span> ${App.esc(s.keyword)}<span class="lit-del" data-del="${s.id}">✕</span></div>
        <div class="lit-sub">领域关键词 · 用于官网热榜语言映射</div>
      </div>`;
    }).join('');
  },

  /* ---------- 订阅详情（右侧分栏） ---------- */
  renderSubsDetail() {
    const box = document.getElementById('ghSubDetail');
    const sub = this.subs.find((s) => s.id === this.activeId);
    if (!sub) {
      box.innerHTML = `<div class="gh-detail-empty">← 点击左侧订阅查看详情</div>`;
      return;
    }
    if (sub.type === 'keyword') {
      const lang = this.mapLang(sub.keyword);
      box.innerHTML = `
        <div class="gh-detail-head"><span class="tag low">KEYWORD</span><h3>${App.esc(sub.keyword)}</h3></div>
        <div class="gh-detail-body">
          <p>领域关键词订阅。可用于从 GitHub 官网抓取该领域的热门项目（自动映射为编程语言维度）。</p>
          ${lang ? `<p>语言映射：<b>${App.esc(lang.name)}</b>（${App.esc(lang.slug)}）</p>` : `<p class="muted">⚠️ 该关键词无法映射到编程语言，官网热榜仅支持语言维度；可直接抓取全领域热榜。</p>`}
        </div>
        <div class="gh-detail-actions">
          <button class="btn btn-primary btn-sm" id="ghKeywordTrend">按此抓取官网热榜</button>
          <button class="btn btn-sm danger" id="ghDelSub">删除订阅</button>
        </div>`;
      const trendBtn = box.querySelector('#ghKeywordTrend');
      if (trendBtn) {
        trendBtn.addEventListener('click', () => {
          const el = document.getElementById('ghTrendLang');
          el.value = lang ? lang.name : '';
          this.fetchOfficialTrending();
        });
      }
    } else {
      const meta = [
        sub.starCount ? `<span>★ <b>${sub.starCount}</b></span>` : '',
        sub.forks ? `<span>🍴 <b>${sub.forks}</b></span>` : '',
        sub.language ? `<span class="tag low">${App.esc(sub.language)}</span>` : '',
        sub.pushedAt ? `<span class="muted">UPDATED ${(sub.pushedAt || '').slice(0, 10)}</span>` : ''
      ].filter(Boolean).join(' ');
      box.innerHTML = `
        <div class="gh-detail-head"><span class="tag low">REPO</span><h3>${App.esc(sub.keyword)}</h3></div>
        <div class="gh-detail-meta">${meta || '<span class="muted">（订阅时未获取到元数据）</span>'}</div>
        <div class="gh-detail-body"><p>${App.esc(sub.description || '（无描述）')}</p></div>
        <div class="gh-detail-actions">
          ${sub.url ? `<button class="btn btn-sm" id="ghOpenUrl">在 GitHub 打开 ↗</button>` : ''}
          <button class="btn btn-sm danger" id="ghDelSub">删除订阅</button>
        </div>`;
      const openBtn = box.querySelector('#ghOpenUrl');
      if (openBtn) openBtn.addEventListener('click', () => window.api.shell.openExternal(sub.url));
    }
    const delBtn = box.querySelector('#ghDelSub');
    if (delBtn) delBtn.addEventListener('click', () => this.removeSub(sub.id));
  },

  /* ---------- 删除订阅 ---------- */
  async removeSub(id) {
    if (!confirm('确定删除该订阅？')) return;
    await window.api.store.remove('githubSubs', id);
    if (this.activeId === id) this.activeId = null;
    await this.render();
    App.toast('已删除订阅', 'ok');
  },

  /* ---------- 官网热榜 ---------- */
  mapLang(input) {
    const t = String(input || '').trim().toLowerCase();
    if (!t) return null;
    return GH_LANGUAGES.find((l) => l.aliases.includes(t) || l.slug === t || l.name.toLowerCase() === t) || null;
  },

  async fetchOfficialTrending() {
    const langInput = document.getElementById('ghTrendLang').value.trim();
    const since = document.getElementById('ghTrendSince').value || 'weekly';
    const lang = this.mapLang(langInput);
    let language = '';
    if (langInput && !lang) {
      App.toast('官网热榜仅支持语言维度，已按全领域抓取', 'error');
    } else if (lang) {
      language = lang.name;
    }
    const box = document.getElementById('ghTrendList');
    const summaryBox = document.getElementById('ghWeeklySummary');
    const sourceBox = document.getElementById('ghTrendSource');
    const taskId = await AgentTasks.start(`GitHub 官网热榜 · ${lang ? lang.name : '全部'}`, '抓取官网 trending 页面', {
      kind: 'github-weekly', steps: ['抓取 github.com/trending', '解析热门仓库', '生成热榜']
    });
    box.innerHTML = `<div class="loading"><span class="spinner"></span>正在抓取 GitHub 官网热榜…</div>`;
    summaryBox.innerHTML = '';
    sourceBox.textContent = '';
    const r = await window.api.github.trending({ language, since });
    if (!r.ok) {
      box.innerHTML = `<div class="empty-tip">${App.esc(r.error || '抓取失败')}</div>`;
      await AgentTasks.fail(taskId, r.error || '热榜抓取失败');
      return;
    }
    await AgentTasks.update(taskId, 66, '解析热门仓库');
    sourceBox.innerHTML = `<span class="source-badge ${r.mock ? 'mock' : ''}">${App.esc(r.source || 'GitHub 官网')}${r.cached ? ' · 缓存' : ''}${r.mock ? ' · 浏览器预览' : ''}</span>`;
    this.renderWeeklySummary(r.summary);
    if (!r.items || r.items.length === 0) {
      box.innerHTML = `<div class="empty-tip">未抓取到热榜数据，请稍后重试</div>`;
      await AgentTasks.complete(taskId, '热榜为空');
      return;
    }
    box.innerHTML = r.items.map((repo) => `
      <div class="repo-item">
        <div class="r-head">
          <span class="r-name" data-url="${App.esc(repo.url)}">${App.esc(repo.fullName)}</span>
          <span class="tag high">★ ${repo.stars}</span>
        </div>
        <div class="r-desc">${App.esc(repo.description || '（无描述）')}</div>
        <div class="r-meta">
          <span>🍴 ${repo.forks}</span>
          ${repo.language ? `<span>${App.esc(repo.language)}</span>` : ''}
          ${repo.todayStars ? `<span class="tag low">🔥 +${repo.todayStars} today</span>` : ''}
        </div>
      </div>`).join('');
    await AgentTasks.complete(taskId, `已抓取 ${r.items.length} 个热门仓库`);
  },

  renderWeeklySummary(summary) {
    const box = document.getElementById('ghWeeklySummary');
    if (!summary) { box.innerHTML = ''; return; }
    const languages = (summary.languages || []).map((item) => `${App.esc(item.name)} ${item.count}`).join(' · ') || '尚无语言数据';
    const leaders = (summary.leaders || []).map((item, index) => `<li><b>0${index + 1}</b><span>${App.esc(item.fullName)}</span><em>★ ${item.stars}</em></li>`).join('');
    box.innerHTML = `
      <div class="gh-summary-head"><span>HOT SIGNAL / ${App.esc(summary.keyword || '全部')}</span><small>${summary.start} — ${summary.end}</small></div>
      <div class="gh-summary-metrics">
        <div><b>${summary.repoCount}</b><span>热门仓库</span></div>
        <div><b>${summary.totalStars}</b><span>累计 Stars</span></div>
      </div>
      <p>主要语言：${languages}</p>
      ${leaders ? `<ol>${leaders}</ol>` : ''}`;
  },

  /* ---------- 更新动态 ---------- */
  async refreshReleases() {
    const repos = this.subs.filter((s) => s.type === 'repo');
    if (repos.length === 0) {
      App.toast('请先订阅仓库', 'error');
      return;
    }
    const box = document.getElementById('ghReleaseList');
    box.innerHTML = `<div class="loading"><span class="spinner"></span>正在拉取仓库更新动态…</div>`;
    let html = '';
    let hasError = false;
    for (const sub of repos) {
      const r = await window.api.github.repoReleases(sub.keyword, 3);
      if (!r.ok) { hasError = true; continue; }
      if (r.items.length === 0) continue;
      html += `<div class="chart-title" style="margin-top:12px">${App.esc(sub.keyword)}</div>`;
      html += r.items.map((rel) => `
        <div class="release-item">
          <div class="rv-head">
            <span class="rv-tag">TAG ${App.esc(rel.tag)}</span>
            <span class="rv-date">${(rel.publishedAt || '').slice(0, 10)}</span>
          </div>
          ${rel.name ? `<div class="rv-body" style="font-weight:600">${App.esc(rel.name)}</div>` : ''}
          ${rel.body ? `<div class="rv-body">${App.esc(rel.body.slice(0, 200))}${rel.body.length > 200 ? '…' : ''}</div>` : ''}
        </div>`).join('');
    }
    box.innerHTML = html || `<div class="empty-tip">${hasError ? '部分仓库拉取失败，请检查网络或 Token' : '暂无更新动态'}</div>`;
    if (hasError && html) App.toast('部分仓库拉取失败', 'error');
  }
};

window.Github = Github;

document.addEventListener('DOMContentLoaded', () => {
  /* 订阅新增：关键词 */
  document.getElementById('ghKeywordAdd').addEventListener('click', async () => {
    const input = document.getElementById('ghKeywordInput');
    const kw = input.value.trim();
    if (!kw) return;
    input.value = '';
    if (Github.subs.some((s) => s.type === 'keyword' && s.keyword.toLowerCase() === kw.toLowerCase())) {
      App.toast(`已订阅关键词：${kw}`);
      return;
    }
    await window.api.store.create('githubSubs', { type: 'keyword', keyword: kw });
    await Github.render();
    App.toast(`已订阅关键词：${kw}`, 'ok');
  });
  document.getElementById('ghKeywordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('ghKeywordAdd').click();
  });

  /* 订阅新增：仓库（repoInfo 元数据落库） */
  document.getElementById('ghRepoAdd').addEventListener('click', async () => {
    const input = document.getElementById('ghRepoInput');
    const repo = Github.parseRepoInput(input.value);
    if (!repo) { App.toast('请粘贴 GitHub 仓库链接或输入 owner/repo', 'error'); return; }
    if (Github.subs.some((s) => s.type === 'repo' && s.keyword.toLowerCase() === repo.toLowerCase())) {
      App.toast(`已订阅仓库：${repo}`);
      input.value = '';
      return;
    }
    input.value = '';
    const info = await window.api.github.repoInfo(repo);
    if (!info.ok || !info.repo) {
      App.toast(info.error ? `无法访问 ${repo}：${info.error}` : `仓库不存在或无法访问：${repo}`, 'error');
      return;
    }
    const r = info.repo;
    await window.api.store.create('githubSubs', {
      type: 'repo', keyword: repo,
      fullName: r.fullName || repo, description: r.description || '',
      starCount: r.stars, forks: r.forks, language: r.language || '',
      url: r.htmlUrl || `https://github.com/${repo}`, pushedAt: r.pushedAt || ''
    });
    await Github.render();
    App.toast(`已订阅仓库：${repo}（★ ${r.stars}）`, 'ok');
  });
  document.getElementById('ghRepoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('ghRepoAdd').click();
  });

  /* tab 切换 */
  document.querySelectorAll('.gh-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      Github.activeTab = tab.dataset.tab;
      document.querySelectorAll('.gh-tab').forEach((t) => t.classList.toggle('active', t === tab));
      Github.renderSubsList();
    });
  });

  /* 搜索 */
  document.getElementById('ghSubSearch').addEventListener('input', (e) => {
    Github.search = e.target.value;
    Github.renderSubsList();
  });

  /* 列表点击：选中详情 / 删除 */
  document.getElementById('ghSubList').addEventListener('click', async (e) => {
    const del = e.target.closest('.lit-del');
    if (del) { await Github.removeSub(del.dataset.del); return; }
    const item = e.target.closest('.lit-item');
    if (!item) return;
    Github.activeId = item.dataset.id;
    Github.renderSubsList();
    Github.renderSubsDetail();
  });

  /* 官网热榜抓取 */
  document.getElementById('ghFetchTrending').addEventListener('click', () => Github.fetchOfficialTrending());
  document.getElementById('ghTrendLang').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Github.fetchOfficialTrending();
  });

  /* 仓库动态 */
  document.getElementById('ghRefreshReleases').addEventListener('click', () => Github.refreshReleases());

  /* 热榜列表外链 */
  document.getElementById('ghTrendList').addEventListener('click', (e) => {
    const name = e.target.closest('.r-name');
    if (name && name.dataset.url) window.api.shell.openExternal(name.dataset.url);
  });
});
