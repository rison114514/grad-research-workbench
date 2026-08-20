'use strict';

/*
 * Browser preview compatibility layer.
 * Electron injects window.api from preload.js. A normal browser does not, so
 * this adapter provides the same public shape using localStorage and safe web
 * fallbacks. It is intentionally skipped inside the desktop application.
 */
(function installBrowserApi() {
  if (window.api && window.api.store) return;

  const STORAGE_KEY = 'research-workbench.browser-preview.v2';
  const DOMAINS = ['tasks', 'projects', 'literature', 'inspirations', 'reports', 'githubSubs', 'agentTasks', 'activity', 'settings', 'timeLogs', 'dailyPlans', 'dailyTemplates', 'weeklyTemplates', 'fitnessPlans', 'fitnessLogs', 'assistantSessions', 'assistantMessages', 'litCollections', 'litRelations'];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const iso = () => new Date().toISOString();
  const day = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const browserPdfFiles = new Map();

  function seedData() {
    const now = iso();
    return {
      tasks: [
        { id: 'preview-task-1', createdAt: now, title: '整理本周实验数据并完成误差分析', priority: 'high', dueDate: day(0), status: 'doing', note: '核对异常值与重复实验', projectId: null, aiSplit: ['清洗原始数据', '绘制误差分布', '记录异常点解释'] },
        { id: 'preview-task-2', createdAt: now, title: '阅读具身智能方向最新综述', priority: 'medium', dueDate: day(0), status: 'todo', note: '', projectId: null, aiSplit: null },
        { id: 'preview-task-3', createdAt: now, title: '更新论文方法章节结构', priority: 'high', dueDate: day(1), status: 'todo', note: '补充消融实验说明', projectId: null, aiSplit: null },
        { id: 'preview-task-4', createdAt: now, title: '课题组周会汇报材料', priority: 'medium', dueDate: day(-1), status: 'todo', note: '', projectId: null, aiSplit: null },
        { id: 'preview-task-5', createdAt: now, title: '完成仿真环境参数校准', priority: 'low', dueDate: day(-1), status: 'done', completedAt: now, note: '', projectId: null, aiSplit: null }
      ],
      projects: [],
      literature: [
        { id: 'preview-lit-1', createdAt: now, title: 'Embodied Intelligence: A Survey', authors: 'Research Group', venue: 'IEEE Review', year: '2026', doi: '', tags: '具身智能, 综述', abstract: '本文系统梳理具身智能的任务范式、学习方法与评测体系。', summary: '## 一句话概述\n\n系统整理具身智能研究中的感知、决策与行动闭环。' },
        { id: 'preview-lit-2', createdAt: now, title: 'Learning Generalizable Robot Policies', authors: 'Chen et al.', venue: 'Robotics Letters', year: '2025', doi: '', tags: '机器人, 策略学习', abstract: '研究面向跨场景泛化的机器人策略学习方法。', summary: '' }
      ],
      inspirations: [
        { id: 'preview-idea-1', createdAt: now, title: '把实验日志做成可视化时间线', content: '用节点强弱表现每次实验的关键变化，让失败记录也能成为下一轮设计的线索。', tags: ['研究', '可视化'], mood: 'research' },
        { id: 'preview-idea-2', createdAt: now, title: '工业终端式选题卡片', content: '选题不只显示标题，还显示证据强度、制作成本和预计传播场景。', tags: ['内容', 'UI'], mood: 'visual' }
      ],
      reports: [],
      githubSubs: [
        { id: 'preview-gh-1', createdAt: now, type: 'keyword', keyword: 'robotics' },
        { id: 'preview-gh-2', createdAt: now, type: 'repo', keyword: 'langchain-ai/langchain', fullName: 'langchain-ai/langchain', description: 'Build context-aware reasoning applications', starCount: 98765, forks: 15432, language: 'Python', url: 'https://github.com/langchain-ai/langchain', pushedAt: new Date().toISOString() }
      ],
      agentTasks: [],
      timeLogs: [],
      dailyPlans: [],
      dailyTemplates: [],
      weeklyTemplates: [],
      fitnessPlans: [],
      fitnessLogs: [],
      assistantSessions: [],
      assistantMessages: [],
      litCollections: [
        { id: 'preview-col-1', createdAt: now, name: '深度学习', parentId: null, order: 0, source: 'user', zoteroKey: null, readOnly: false }
      ],
      litRelations: [],
      activity: [
        { id: 'preview-act-1', createdAt: now, date: day(0), action: '完成', content: '完成任务：仿真环境参数校准' }
      ],
      settings: [{ id: 'settings', browserPreview: true }]
    };
  }

  function loadAll() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        DOMAINS.forEach((domain) => { if (!Array.isArray(parsed[domain])) parsed[domain] = []; });
        parsed.literature = parsed.literature.map((item) => ({
          ...item,
          tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '')
        }));
        return parsed;
      }
    } catch (error) {
      console.warn('[browser-preview] localStorage data was reset:', error);
    }
    const seeded = seedData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  let db = loadAll();
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  const listRef = (domain) => {
    if (!DOMAINS.includes(domain)) throw new Error(`未知数据域: ${domain}`);
    return db[domain];
  };
  const copy = (value) => value === undefined ? undefined : clone(value);
  const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const sameFieldState = (record, field, hadField, value) => {
    const hasField = Object.prototype.hasOwnProperty.call(record, field);
    return hasField === hadField && (!hadField || sameValue(record[field], value));
  };
  const appendRollbackOps = (taskId, operations) => {
    const task = db.agentTasks.find((item) => item.id === taskId);
    if (!task || ['canceled', 'done'].includes(task.state)) return false;
    task.rollbackOps = [...(task.rollbackOps || []), ...clone(operations || [])];
    task.rollback = { state: 'recording', operationCount: task.rollbackOps.length };
    save();
    return true;
  };

  const store = {
    async list(domain) { return clone(listRef(domain)); },
    async create(domain, record) {
      const item = { id: newId(), createdAt: iso(), ...clone(record) };
      listRef(domain).push(item);
      save();
      return clone(item);
    },
    async update(domain, id, patch) {
      const items = listRef(domain);
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      items[index] = { ...items[index], ...clone(patch), updatedAt: iso() };
      save();
      return clone(items[index]);
    },
    async remove(domain, id) {
      const items = listRef(domain);
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return false;
      items.splice(index, 1);
      save();
      return true;
    },
    async batchCreate(domain, records) {
      const created = (records || []).map((r) => {
        const item = { id: newId(), createdAt: iso(), ...clone(r) };
        listRef(domain).push(item);
        return item;
      });
      if (created.length) save();
      return clone(created);
    },
    async upsertBy(domain, keyField, record) {
      const items = listRef(domain);
      const key = record[keyField];
      const index = key !== undefined && key !== null && key !== '' ? items.findIndex((item) => item[keyField] === key) : -1;
      if (index >= 0) {
        items[index] = { ...items[index], ...clone(record), updatedAt: iso() };
        save();
        return clone({ item: items[index], created: false });
      }
      const item = { id: newId(), createdAt: iso(), ...clone(record) };
      items.push(item);
      save();
      return clone({ item, created: true });
    },
    async transactionCreate(taskId, domain, record) {
      const item = { id: newId(), createdAt: iso(), ...clone(record) };
      if (!appendRollbackOps(taskId, [{ type: 'create', domain, id: item.id }])) return null;
      listRef(domain).push(item);
      save();
      return clone(item);
    },
    async transactionUpdate(taskId, domain, id, patch) {
      const items = listRef(domain);
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const before = items[index];
      const next = { ...before, ...clone(patch), updatedAt: iso() };
      const fields = [...new Set([...Object.keys(patch || {}), 'updatedAt'])];
      const changes = fields.map((field) => ({
        field,
        beforeHad: Object.prototype.hasOwnProperty.call(before, field),
        before: copy(before[field]),
        afterHad: Object.prototype.hasOwnProperty.call(next, field),
        after: copy(next[field])
      }));
      if (!appendRollbackOps(taskId, [{ type: 'update', domain, id, changes }])) return null;
      items[index] = next;
      save();
      return clone(next);
    },
    async transactionBatchCreate(taskId, domain, records) {
      const created = (records || []).map((record) => ({ id: newId(), createdAt: iso(), ...clone(record) }));
      if (!created.length) return [];
      if (!appendRollbackOps(taskId, created.map((item) => ({ type: 'create', domain, id: item.id })))) return [];
      listRef(domain).push(...created);
      save();
      return clone(created);
    },
    async transactionSaveSettings(taskId, patch) {
      if (!db.settings.length) {
        const item = { id: 'settings', ...clone(patch) };
        if (!appendRollbackOps(taskId, [{ type: 'create', domain: 'settings', id: item.id }])) return null;
        db.settings.push(item);
        save();
        return clone(item);
      }
      return this.transactionUpdate(taskId, 'settings', db.settings[0].id, patch);
    },
    async rollbackTask(taskId) {
      const task = db.agentTasks.find((item) => item.id === taskId);
      if (!task || task.state !== 'canceled') return { ok: false, operationCount: 0, restoredFields: 0, removedRecords: 0, conflicts: 0 };
      const operations = clone(task.rollbackOps || []);
      let restoredFields = 0;
      let removedRecords = 0;
      let conflicts = 0;
      for (const operation of [...operations].reverse()) {
        const items = listRef(operation.domain);
        const index = items.findIndex((item) => item.id === operation.id);
        if (operation.type === 'create') {
          if (index >= 0) { items.splice(index, 1); removedRecords += 1; }
          continue;
        }
        if (operation.type !== 'update' || index < 0) { conflicts += 1; continue; }
        const current = items[index];
        for (const change of operation.changes || []) {
          if (sameFieldState(current, change.field, change.afterHad, change.after)) {
            if (change.beforeHad) current[change.field] = copy(change.before);
            else delete current[change.field];
            restoredFields += 1;
          } else if (change.field !== 'updatedAt' && !sameFieldState(current, change.field, change.beforeHad, change.before)) {
            conflicts += 1;
          }
        }
      }
      task.rollbackOps = [];
      const state = conflicts ? 'partial' : 'rolled_back';
      task.rollback = { state, operationCount: operations.length, restoredFields, removedRecords, conflicts, completedAt: iso() };
      save();
      return clone({ ok: conflicts === 0, state, operationCount: operations.length, restoredFields, removedRecords, conflicts });
    },
    async commitTask(taskId) {
      const task = db.agentTasks.find((item) => item.id === taskId);
      if (!task) return false;
      const operationCount = (task.rollbackOps || []).length;
      task.rollbackOps = [];
      task.rollback = { state: 'committed', operationCount, completedAt: iso() };
      save();
      return true;
    },
    async getSettings() { return clone(db.settings[0] || {}); },
    async saveSettings(patch) {
      db.settings[0] = { ...(db.settings[0] || { id: 'settings' }), ...clone(patch) };
      save();
      return clone(db.settings[0]);
    },
    async getDataDir() { return '浏览器本地存储 / Local Storage'; },
    async openDataDir() { return false; },
    async backup() {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `科研工作台-浏览器备份-${day(0)}.json`);
      return '浏览器下载目录';
    },
    async taskStats() { return taskStats(db.tasks); }
  };

  function taskStats(tasks) {
    const today = day(0);
    const stats = { total: tasks.length, todo: 0, doing: 0, done: 0, doneToday: 0, overdue: 0, byPriority: { high: 0, medium: 0, low: 0 }, last7Days: [] };
    const dayMap = {};
    for (let i = 6; i >= 0; i -= 1) dayMap[day(-i)] = { date: day(-i), done: 0, created: 0 };
    tasks.forEach((task) => {
      stats[task.status] = (stats[task.status] || 0) + 1;
      stats.byPriority[task.priority] = (stats.byPriority[task.priority] || 0) + 1;
      if (task.dueDate && task.dueDate < today && task.status !== 'done') stats.overdue += 1;
      if (task.status === 'done' && (task.completedAt || '').slice(0, 10) === today) stats.doneToday += 1;
      const created = (task.createdAt || '').slice(0, 10);
      const completed = (task.completedAt || '').slice(0, 10);
      if (dayMap[created]) dayMap[created].created += 1;
      if (task.status === 'done' && dayMap[completed]) dayMap[completed].done += 1;
    });
    stats.last7Days = Object.keys(dayMap).sort().map((key) => dayMap[key]);
    stats.doneRate = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    return clone(stats);
  }

  const providers = [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', desc: 'V4 · 1M 上下文，中文与 Agent 任务' },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', desc: '通用能力与工具生态' },
    { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', desc: '中文长文本任务' },
    { id: 'ollama', name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', desc: '桌面版离线模型' }
  ];

  const ai = {
    async providers() { return clone(providers); },
    async isConfigured() {
      const settings = db.settings[0] || {};
      return !!(settings.aiBaseUrl && settings.aiModel && settings.aiApiKey);
    },
    async test() { return { ok: false, source: 'browser', error: '浏览器预览使用本地模板；桌面版可测试真实模型连接' }; },
    async chat(messages) {
      const question = String((messages || []).slice(-1)[0]?.content || '');
      const openTasks = db.tasks.filter((task) => task.status !== 'done');
      return {
        ok: true,
        source: 'local',
        content: `## 工作建议\n\n当前共有 **${openTasks.length}** 项未完成任务。建议先处理高优先级且临近截止日期的任务，再为其余任务安排连续时间块。\n\n- 今天先完成一项可交付成果\n- 为复杂任务保留复盘记录\n- 浏览器预览中的回答来自本地模板\n\n> 你的问题：${question.split('【用户问题】').pop().trim().slice(0, 100)}`
      };
    },
    // 浏览器预览无真实模型：chatTools 降级为本地模板（无 tool_calls）
    async chatTools(messages, tools, opts) {
      return this.chat(messages, opts);
    },
    async summarizeLiterature(meta) {
      const source = meta.fullText || meta.abstract || '原文信息不足';
      return { ok: true, source: 'local', content: `## ${meta.title || '未命名文献'}\n\n### 一句话概述\n${source.slice(0, 160)}\n\n### 研究问题\n围绕文献提出的核心目标进行结构化整理。\n\n### 核心方法\n原文信息不足，需配置 AI 后进一步提取。\n\n### 数据与实验设计\n原文信息不足。\n\n### 主要结论\n${source.slice(0, 220)}\n\n### 局限性\n原文信息不足。\n\n### 对当前研究的启发\n需要结合当前课题进一步确认。\n\n### 关键词\n待补充` };
    },
    async polishReport(content) { return { ok: true, source: 'local', content, note: '浏览器预览保留原始报告' }; },
    async splitTask(title) {
      return {
        ok: true, source: 'local', goal: `完成「${title}」并形成可验收结果`, deliverable: `${title}的完整交付成果与检查记录`,
        items: [`明确「${title}」的交付标准并记录`, '收集执行所需资料并确认前置条件', '完成核心工作并保存阶段产物', '对照交付标准检查结果', '整理最终成果与复盘记录']
      };
    },
    async parseNaturalTask(text) {
      const high = /高优先|紧急|重要/.test(text);
      const low = /低优先|不急/.test(text);
      const dueDate = /明天/.test(text) ? day(1) : /今天|今日/.test(text) ? day(0) : null;
      return { title: text.replace(/高优先级|高优先|低优先级|低优先|今天|今日|明天/g, '').trim() || text, priority: high ? 'high' : low ? 'low' : 'medium', dueDate };
    }
  };

  async function githubFetch(path) {
    const settings = db.settings[0] || {};
    const headers = { Accept: 'application/vnd.github+json' };
    if (settings.githubToken) headers.Authorization = `Bearer ${settings.githubToken}`;
    const response = await fetch(`https://api.github.com${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub API 错误 ${response.status}`);
    return { response, data: await response.json() };
  }

  const githubRepoPath = (fullName) => String(fullName || '').split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');

  const github = {
    async searchTrending(keyword, perPage = 15) {
      try {
        const created = day(-7);
        const q = encodeURIComponent(`${keyword} created:>${created}`);
        const { response, data } = await githubFetch(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}`);
        const items = (data.items || []).map(mapRepo);
        return { ok: true, rate: { limit: response.headers.get('x-ratelimit-limit'), remaining: response.headers.get('x-ratelimit-remaining') }, items, summary: buildWeeklySummary(keyword, items) };
      } catch (error) { return { ok: false, error: error.message }; }
    },
    async repoInfo(fullName) {
      try { const { data } = await githubFetch(`/repos/${githubRepoPath(fullName)}`); return { ok: true, repo: mapRepo(data) }; }
      catch (error) { return { ok: false, error: error.message, repo: null }; }
    },
    async repoReleases(fullName, perPage = 3) {
      try {
        const { data } = await githubFetch(`/repos/${githubRepoPath(fullName)}/releases?per_page=${perPage}`);
        return { ok: true, items: data.map((release) => ({ id: release.id, tag: release.tag_name, name: release.name, body: release.body || '', publishedAt: release.published_at, htmlUrl: release.html_url })) };
      } catch (error) { return { ok: false, error: error.message, items: [] }; }
    },
    /* 官网 trending：浏览器预览无法抓取 github.com/trending，降级 mock（来源标注「浏览器预览」） */
    async trending() {
      const lang = 'Python';
      const mock = [
        { fullName: 'langchain-ai/langchain', name: 'langchain', owner: 'langchain-ai', description: 'Build context-aware reasoning applications (mock)', language: 'Python', stars: 98765, forks: 15432, todayStars: 1234, url: 'https://github.com/langchain-ai/langchain' },
        { fullName: 'huggingface/transformers', name: 'transformers', owner: 'huggingface', description: 'Transformers: State-of-the-art Machine Learning for PyTorch, TF, JAX (mock)', language: 'Python', stars: 138500, forks: 27600, todayStars: 890, url: 'https://github.com/huggingface/transformers' },
        { fullName: 'microsoft/typescript', name: 'typescript', owner: 'microsoft', description: 'TypeScript is a superset of JavaScript (mock)', language: 'TypeScript', stars: 99999, forks: 12345, todayStars: 567, url: 'https://github.com/microsoft/typescript' }
      ];
      return { ok: true, items: mock, source: '浏览器预览', languageName: lang, since: 'weekly', fetchedAt: iso(), mock: true };
    }
  };

  function mapRepo(repo) {
    return { id: repo.id, fullName: repo.full_name, description: repo.description, stars: repo.stargazers_count, forks: repo.forks_count, language: repo.language, htmlUrl: repo.html_url, topics: repo.topics || [], pushedAt: repo.pushed_at };
  }

  function buildWeeklySummary(keyword, items) {
    const languages = {};
    items.forEach((item) => { if (item.language) languages[item.language] = (languages[item.language] || 0) + 1; });
    return {
      keyword, start: day(-7), end: day(0), repoCount: items.length,
      totalStars: items.reduce((sum, item) => sum + (item.stars || 0), 0),
      languages: Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
      leaders: items.slice(0, 3).map((item) => ({ fullName: item.fullName, stars: item.stars }))
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reportDraft(type, dateValue) {
    const date = dateValue || day(0);
    const done = db.tasks.filter((task) => task.status === 'done');
    const open = db.tasks.filter((task) => task.status !== 'done');
    // 待办事项（浏览器预览简化：取最近计划）
    const planItems = (db.dailyPlans || []).flatMap((p) => (p.items || []).map((it) => ({ ...it, date: p.date })));
    const doneItems = planItems.filter((it) => it.done);
    const fitDone = (db.fitnessLogs || []).filter((l) => l.done);
    const fitMinutes = fitDone.reduce((s2, l) => s2 + (l.durationMin || 0), 0);
    const ideas = db.inspirations || [];
    const content = [
      `# ${type === 'daily' ? '日报' : '周报'} · ${date}`,
      '', '## 一、今日/本周概述',
      `- 已完成 **${done.length}** 项，未完成 **${open.length}** 项`,
      `- 计划 **${planItems.length}** 项（完成 **${doneItems.length}** 项）`,
      `- 健身打卡 **${fitDone.length}** 次（累计 **${fitMinutes}** 分钟）`,
      `- 记录灵感 **${ideas.length}** 条`,
      '', '## 二、完成任务',
      ...(done.length ? done.map((task) => `- [x] ${task.title}`) : ['（无）']),
      '', '## 三、待办事项',
      ...(planItems.length ? planItems.map((it) => `- [${it.done ? 'x' : ' '}] ${it.title}`) : ['（无计划记录）']),
      '', '## 四、健身打卡',
      ...(fitDone.length ? fitDone.map((l) => `- ${l.type || '健身'} ${l.durationMin || ''} 分钟`) : ['（无打卡记录）']),
      '', '## 五、灵感记录',
      ...(ideas.length ? ideas.map((l) => `- ${l.title || '未命名灵感'}`) : ['（无灵感记录）']),
      '', '## 六、进行中 / 待办',
      ...(open.length ? open.map((task) => `- [ ] ${task.title}${task.dueDate ? `（截止 ${task.dueDate}）` : ''}`) : ['（无）']),
      '', '## 七、思考与计划', '- （待补充）', '', '---', '> 浏览器预览模式 · 数据保存在当前浏览器'
    ].join('\n');
    return { content, dateRange: { start: date, end: date, label: date } };
  }

  async function browserZoteroRequest(input, testOnly) {
    try {
      const type = input.libraryType === 'groups' ? 'groups' : 'users';
      const libraryId = String(input.libraryId || '').trim();
      const collectionKey = String(input.collectionKey || '').trim();
      if (!/^\d+$/.test(libraryId)) throw new Error('请填写正确的 Zotero Library ID');
      const prefix = `https://api.zotero.org/${type}/${encodeURIComponent(libraryId)}`;
      const endpoint = collectionKey ? `${prefix}/collections/${encodeURIComponent(collectionKey)}/items/top` : `${prefix}/items/top`;
      const headers = { Accept: 'application/json', 'Zotero-API-Version': '3' };
      if (input.apiKey) headers['Zotero-API-Key'] = input.apiKey;
      const response = await fetch(`${endpoint}?limit=${testOnly ? 1 : 100}&sort=dateModified&direction=desc`, { headers });
      if (!response.ok) throw new Error(({ 401: 'API Key 无效', 403: '没有读取权限', 404: '未找到该文献库或分类' })[response.status] || `Zotero API 错误 ${response.status}`);
      const data = await response.json();
      if (testOnly) return { ok: true, libraryType: type, libraryId, total: Number(response.headers.get('total-results') || data.length), libraryVersion: response.headers.get('last-modified-version') };
      const items = data.filter((item) => !['attachment', 'note', 'annotation'].includes(item.data?.itemType)).map((item) => {
        const value = item.data || {};
        const creators = (value.creators || []).map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean);
        const year = String(value.date || '').match(/(?:19|20)\d{2}/)?.[0] || '';
        return {
          zoteroKey: item.key, zoteroVersion: item.version, itemType: value.itemType,
          title: value.title || '未命名 Zotero 条目', authors: creators.join('; '),
          venue: value.publicationTitle || value.proceedingsTitle || value.bookTitle || '', year,
          doi: value.DOI || value.url || '', abstract: value.abstractNote || '',
          tags: (value.tags || []).map((tag) => tag.tag).filter(Boolean), collections: value.collections || [],
          url: value.url || '', dateModified: value.dateModified || '', source: 'zotero'
        };
      });
      return { ok: true, items, total: items.length, libraryVersion: response.headers.get('last-modified-version'), collections: [] };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  window.api = {
    app: { getVersion: async () => 'browser-preview' },
    store,
    dialog: {
      pickProjectFolder: async () => null,
      pickPdf: async () => new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf,.pdf';
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (!file) { resolve(null); return; }
          const token = newId();
          browserPdfFiles.set(token, file);
          resolve({ path: `browser-file://${token}`, name: file.name, size: file.size, browser: true });
        }, { once: true });
        input.click();
      }),
      /* 桌面宠物：浏览器选图 → FileReader → dataURI */
      pickImage: async () => new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp,image/gif';
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (!file) { resolve({ ok: false, canceled: true }); return; }
          if (file.size > 5 * 1024 * 1024) { resolve({ ok: false, error: '图片过大（限 5MB）' }); return; }
          const reader = new FileReader();
          reader.onload = () => resolve({ ok: true, dataUri: reader.result });
          reader.onerror = () => resolve({ ok: false, error: '读取图片失败' });
          reader.readAsDataURL(file);
        }, { once: true });
        input.click();
      }),
      exportMarkdown: async ({ defaultName, content }) => {
        downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), `${defaultName || '科研工作台报告'}.md`);
        return { ok: true, filePath: '浏览器下载目录' };
      },
      /* 多文件导出：浏览器逐个触发下载 */
      exportMarkdowns: async ({ files }) => {
        (files || []).forEach((f) => {
          downloadBlob(new Blob([f.content || ''], { type: 'text/markdown;charset=utf-8' }), `${f.name || 'report'}.md`);
        });
        return { ok: true, files: (files || []).map((f) => `${f.name}.md`) };
      }
    },
    fs: {
      scanTree: async () => ({ ok: false, error: '浏览器预览不读取本地目录；请在桌面版使用此功能' }),
      buildGraph: async () => ({ ok: false, error: '浏览器预览不读取本地目录' }),
      readTextFile: async () => ({ ok: false, error: '浏览器预览不读取本地文件' }),
      readImage: async () => ({ ok: false, error: '浏览器预览请用「选择图片」直接读取' }),
      pathInfo: async () => ({ ok: false, error: '浏览器预览不读取本地文件' })
    },
    pdf: {
      extract: async (filePath) => {
        const token = String(filePath || '').replace('browser-file://', '');
        const file = browserPdfFiles.get(token);
        if (!file) return { ok: false, error: '浏览器临时文件已失效，请重新选择 PDF' };
        const bytes = new Uint8Array(await file.arrayBuffer());
        const raw = new TextDecoder('latin1').decode(bytes);
        const matches = [...raw.matchAll(/\(([^()]|\\[()\\]){3,}\)\s*Tj/g)].map((match) => match[0].replace(/^\(|\)\s*Tj$/g, '').replace(/\\([()\\])/g, '$1'));
        const text = matches.join(' ').replace(/\s+/g, ' ').trim();
        if (text.length < 80) return { ok: false, error: '浏览器预览无法解析该 PDF 的压缩正文；桌面版可使用完整解析器' };
        return { ok: true, text, chars: text.length, pages: (raw.match(/\/Type\s*\/Page\b/g) || []).length, truncated: false, previewParser: true };
      }
    },
    github,
    ai,
    report: {
      generate: async (type, dateValue, options = {}) => {
        const draft = reportDraft(type, dateValue);
        const report = await store.create('reports', { type, dateRange: draft.dateRange, content: draft.content, source: options.polish ? 'local' : 'local', generatedAt: iso() });
        return { report, draftContent: draft.content };
      }
    },
    zotero: {
      test: async (config) => browserZoteroRequest(config, true),
      sync: async (config) => browserZoteroRequest(config, false)
    },
    shell: { openExternal: async (url) => { window.open(url, '_blank', 'noopener,noreferrer'); return true; } },
    pet: {
      isDesktop: async () => false, // 浏览器预览不支持系统级悬浮球 → 应用内浮窗降级
      setEnabled: async () => ({ ok: true }),
      openChat: async () => ({ ok: false, error: '浏览器预览不支持系统级悬浮球' }),
      closeChat: async () => ({ ok: false, error: '浏览器预览不支持系统级悬浮球' }),
      getState: async () => ({ enabled: false, mode: 'ball', position: null }),
      focusMain: async () => ({ ok: false }),
      move: async () => ({ ok: false }),
      onModeChanged: () => {}
    }
  };

  window.__BROWSER_PREVIEW__ = true;
  document.documentElement.classList.add('browser-preview');
  document.addEventListener('DOMContentLoaded', () => {
    const state = document.querySelector('.system-state');
    if (state) state.textContent = 'BROWSER PREVIEW';
  });
})();
