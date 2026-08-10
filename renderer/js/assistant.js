'use strict';

/* ============ AI 助手（会话记忆 + 安全确认执行 + 语义识别层） ============ */

/* 注：旧 INTENT_SYSTEM_PROMPT（「只输出 JSON 意图」）已废弃删除 —— 统一走 TOOLS_SYSTEM_PROMPT + 原生 function calling；
   前端 parseIntentJson 保留为「模型仍输出 JSON 文本」时的兜底通道（转确认卡/草案卡），但不再向模型注入任何 JSON 输出指令。 */

/** 滚动摘要压缩 prompt（窗口超预算时压缩旧消息） */
const SUMMARY_PROMPT = `你是对话摘要助手。把下面的对话压缩为 JSON（只输出 JSON）：
{"goals":["用户目标"],"decisions":["已确认决定"],"pending":["待确认/待办事项"]}
要求：保留关键事实（用户需求、已确认参数、未决事项），每条 ≤20 字，各数组 ≤5 条。`;

/** 工具路由 system prompt（原生 function calling 唯一通道；禁止在回答中输出 JSON/代码块/伪 JSON） */
/* 塞西拟人过渡语：工具调用结果/确认卡展示前的情绪引导（按工具类别），让回复更有拟人味道 */
const PERSONA_LEADS = {
  report: '好的管理员，我来为您生成报告，请稍候。',
  literature: '好的管理员，让我查阅一下文献库。',
  fitness: '好的，管理员。让我看看您的健身数据。',
  github: '好的，管理员。我这就去 GitHub 处理。',
  query: '好的管理员，我这就为您调取数据。',
  add: '收到，管理员。我这就为您记录。',
  update: '收到，管理员。我这就为您更新。',
  sub: '收到，管理员。订阅事项交给我就好。',
  default: '好的管理员，我来处理这个请求。'
};

/* 根据工具名选择塞西过渡语 */
function personaLead(name) {
  const t = String(name || '');
  if (t.includes('Report') || t.includes('report')) return PERSONA_LEADS.report;
  if (t.includes('Literature')) return PERSONA_LEADS.literature;
  if (t.includes('Fitness')) return PERSONA_LEADS.fitness;
  if (t.includes('GitHub') || t.includes('Subscribe') || t.includes('Unsubscribe')) return t.includes('Sub') ? PERSONA_LEADS.sub : PERSONA_LEADS.github;
  if (t.startsWith('update')) return PERSONA_LEADS.update;
  if (t.startsWith('add') || t.startsWith('create')) return PERSONA_LEADS.add;
  if (t.startsWith('query')) return PERSONA_LEADS.query;
  return PERSONA_LEADS.default;
}

/* Agent 全局人格：塞西（《明日方舟：终末地》干员）——宠物只是悬浮入口，主智能助理与桌面宠物共用同一人格 */

/* 主抽屉 chatBody stub：浮窗页无 chatBody 时返回空对象，DOM 操作 no-op 不崩溃（记录照常） */
const CHAT_BODY_STUB = {
  innerHTML: '', textContent: '',
  scrollTop: 0, scrollHeight: 0,
  children: [], firstChild: null,
  appendChild() {}, removeChild() {}, prepend() {}, remove() {},
  setAttribute() {}, addEventListener() {}, removeEventListener() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  querySelector() { return null; }, querySelectorAll() { return []; }
};
const chatBody = () => document.getElementById('chatBody') || CHAT_BODY_STUB;
const TOOLS_SYSTEM_PROMPT = `你是「塞西」（Xaihi），本名塞拉菲娜·赛希——来自《明日方舟：终末地》的干员，寂语修会「会话派」的萨卡兹技术干员。如今你在「科研工作台」这艘新「帝江号」上，担任管理员的信息工程担当：通过【原生工具调用（function calling / tool_calls）】帮管理员完成任务（任务/日程/时间/健身/文献/GitHub/报告/灵感/项目的增删改查与洞察）。

【身份】寂语修会「会话派」的技术干员，由拉特兰派遣至塔卫二研修，因在信息技术上天赋异禀被引荐到终末地工业。现在的工作，就是为管理员搭建协议源石网络（也就是这个工作台的数据链路）——源石网络的每一处接线、每一次握手，都归你负责。

【性格】深居简出多年的少女，知识储备丰富到「多余」——演算、语言分析、信息架构信手拈来；思绪新奇跳脱，常人常跟不上你的思路，而你对此浑然不觉。比起寒暄，你更享受与逻辑和数据打交道；但面对管理员，你愿意把这份热情用于服务。

【说话风格】
1. 称呼用户为「管理员」（重要，全文一致）；
2. 理性、专业、可执行，同时带着修会技术员的跳脱感——偶尔用「协议调试」「压力测试」「网络优化」「栈溢出」这类信息技术词打比方；
3. 可引用修会训词，如「完美的逻辑早已存在，我们只是逐步揭开它的面纱」「古老的智慧，不要让我们陷入诱惑，但救我们免于险恶」；
4. 回答简洁，不废话；帮助管理员完成任务是你的本职。

## 铁律（违反即视为无效，绝不例外）
1. 工具调用只能通过原生 tool_calls 机制发起。**绝不在回答文本中输出 JSON、伪 JSON、代码块（如 \`\`\`json）、或任何 {"action":...} 形式的内容**——这些内容只会被当作纯文本展示给用户，永远不会被执行。
2. 如果你所在环境不支持原生工具调用，请**只用自然语言回答**：可以给出方案、草案或引导，但**绝不声称**「已创建/已保存/已执行/已更新」——所有写入操作都必须由用户在确认卡上确认后由系统执行，你无法自行落库。
3. 回答只输出给用户看的自然语言（可用 Markdown 排版）。不要输出任何结构化包装、字段名注释、JSON 样例或前后缀说明。

## 工具选择规则
4. 用户请求执行操作（新增/打卡/记录/保存/修改/删除/查询）且信息足够 → 选择合适的工具并填好参数；写入（add*/update*）工具调用会由前端展示确认卡，用户确认后才生效。
5. 用户只是提问、闲聊、或要求「制定/规划/生成方案建议」（如「帮我制定健身计划」只想要方案文本）→ **不调用工具**，直接给出方案文本。
6. 参数可合理推断时用合理默认值并在回答中说明假设，不要反复追问；只有真正缺少无法推断的关键信息时才询问一项。
7. 今天日期由【当前工作区上下文】提供；相对日期（明天/昨天/本周）按它换算；时长换算 1.5小时=90分钟。
8. 健康/健身类建议使用非专业草案语气，不假装掌握用户身体状况。
9. 修改/删除某条记录前，若不确定目标名称或 ID：**先调用对应查询工具获取清单**（如 queryFitness 查看健身计划条目清单、queryDailyPlan 看日程、queryTask 看任务清单、queryStats 看任务统计），再用修改工具按清单中的名称精确定位（如 updateFitnessItem 的 matchName、updateTask 的 matchTitle）。添加条目用 addFitnessItem。
10. **周期识别（v1.6.0 关键规则）**：用户说「每天/每日/周内/每周/固定安排」→ **必须**调用 createDailyTemplate / createWeeklyTemplate（模板是规则），**绝不**调用 addDailyPlanMulti 展开到多天。「每天 9 点上班」「每周三买菜」都是**模板**，不是某个具体日期的多份日程。模板保存后可由 applyTemplate 派生到具体日期。
11. **写入幂等**：所有写工具的 apply 内部已对「同日同 startTime+title」做去重（重复确认同模板同日不会重复落库）。一次确认对应一次落库；不要为「同重复请求」生成多个确认请求（AgentLoop 已合并同 hash 的多 tool_call 为单张确认卡）。

如果无需调用工具，直接给出简洁、可执行的中文回答。`;

// 供桌面宠物等复用同一套工具规则（必须挂载，否则 pet.js 只能降级到兜底提示词）
window.TOOLS_SYSTEM_PROMPT = TOOLS_SYSTEM_PROMPT;

/** 运动方案规划 prompt（已配置 AI 时用于增强草案） */
const FITNESS_PLAN_PROMPT = `你是「科研工作台」的运动规划助手。根据用户给出的约束（每天可用时长、运动偏好、身体状态如"很久没锻炼"），生成一份一周 7 天、每天的训练安排（Markdown）。

要求：
1. 每天明确运动内容与时长，单日总时长不超过用户可用时间
2. 遵循循序渐进原则：久未锻炼者前 2 周从低强度开始（快走、轻量力量、拉伸）
3. 安排 1-2 个主动休息日，每天含热身与拉伸
4. 内容专业、可执行，用中文，输出 Markdown，不要多余解释。`;

const Assistant = {
  opened: false,
  state: { sessionId: null, messages: [], sessions: [] },

  /* ================= 会话生命周期 ================= */
  async initSession() {
    const sessions = await window.api.store.list('assistantSessions');
    sessions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    this.state.sessions = sessions;
    if (sessions.length) await this.loadSession(sessions[0].id);
    else await this.newSession();
  },

  async newSession() {
    const now = new Date().toISOString();
    const s = await window.api.store.create('assistantSessions', { title: '新对话', summary: { goals: [], decisions: [], pending: [] }, createdAt: now, updatedAt: now });
    this.state.sessionId = s.id;
    this.state.messages = [];
    this.state.sessions.unshift(s);
    const body = chatBody();
    body.innerHTML = '';
    this.renderWelcome();
    App.toast('已新建对话', 'ok');
  },

  async loadSession(id) {
    const msgs = await window.api.store.list('assistantMessages');
    const mine = msgs.filter((m) => m.sessionId === id).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    this.state.sessionId = id;
    this.state.messages = mine;
    const body = chatBody();
    body.innerHTML = '';
    if (!mine.length) { this.renderWelcome(); }
    else { mine.forEach((m) => this.renderRecorded(m)); }
    body.scrollTop = body.scrollHeight;
  },

  async clearSession() {
    const msgs = await window.api.store.list('assistantMessages');
    for (const m of msgs.filter((x) => x.sessionId === this.state.sessionId)) await window.api.store.remove('assistantMessages', m.id);
    this.state.messages = [];
    chatBody().innerHTML = '';
    this.renderWelcome();
    App.toast('已清空当前对话', 'ok');
  },

  async deleteSession(id) {
    const msgs = await window.api.store.list('assistantMessages');
    for (const m of msgs.filter((x) => x.sessionId === id)) await window.api.store.remove('assistantMessages', m.id);
    await window.api.store.remove('assistantSessions', id);
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
    if (this.state.sessionId === id) await this.newSession();
    else { await this.renderSessionList(); }
  },

  async exportSession() {
    const title = (this.state.sessions.find((s) => s.id === this.state.sessionId) || {}).title || '对话';
    const md = [
      `# 科研工作台 · 对话导出`,
      '',
      `> 会话：${title} · 导出时间：${new Date().toLocaleString('zh-CN')} · 历史仅保存在本机`,
      '',
      ...this.state.messages.map((m) => `**${m.role === 'user' ? '用户' : '助手'}**：\n\n${m.content || ''}\n\n---`)
    ].join('\n');
    const r = await window.api.dialog.exportMarkdown({ defaultName: `科研工作台-会话-${App.todayStr()}.md`, content: md });
    App.toast(r && r.ok ? '对话已导出' : '导出完成', 'ok');
  },

  async renderSessionList() {
    const list = document.getElementById('assistantSessionList');
    const sessions = this.state.sessions.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    list.innerHTML = `
      <div class="assistant-session-actions">
        <button class="btn btn-primary btn-sm" id="asNew">＋ 新建对话</button>
        <button class="btn btn-sm" id="asClear">清空当前历史</button>
      </div>
      ${sessions.length ? sessions.map((s) => `
        <div class="assistant-session-row ${s.id === this.state.sessionId ? 'active' : ''}" data-sid="${s.id}">
          <div class="as-info"><b>${App.esc(s.title || '新对话')}</b><span>${(s.updatedAt || '').slice(0, 16).replace('T', ' ')}</span></div>
          <div class="as-btns">
            <button class="btn btn-sm" data-act="open">打开</button>
            <button class="btn btn-sm danger" data-act="del">删除</button>
          </div>
        </div>`).join('') : '<div class="as-empty">暂无会话</div>'}
      <div class="assistant-local-hint">历史仅保存在本机，不会上传</div>`;
    list.querySelector('#asNew').addEventListener('click', () => { Modal.close('assistantSessionsModal'); Assistant.newSession(); });
    list.querySelector('#asClear').addEventListener('click', () => { Modal.close('assistantSessionsModal'); Assistant.clearSession(); });
    list.querySelectorAll('.assistant-session-row').forEach((row) => {
      row.querySelector('[data-act="open"]').addEventListener('click', () => { Modal.close('assistantSessionsModal'); Assistant.loadSession(row.dataset.sid); });
      row.querySelector('[data-act="del"]').addEventListener('click', () => { if (confirm('删除该会话及其全部消息？此操作不可撤销。')) Assistant.deleteSession(row.dataset.sid); });
    });
    Modal.open('assistantSessionsModal');
  },

  async recordMessage(role, content, extra = {}) {
    const msg = {
      sessionId: this.state.sessionId, role,
      kind: 'text', content: String(content || '').slice(0, 4000),
      createdAt: new Date().toISOString(), ...extra
    };
    const saved = await window.api.store.create('assistantMessages', msg);
    msg.id = saved.id;
    this.state.messages.push(msg);
    // 更新会话元信息（标题取首条用户消息；updatedAt 刷新）
    const sess = this.state.sessions.find((s) => s.id === this.state.sessionId);
    if (sess) {
      const patch = { updatedAt: msg.createdAt };
      if (sess.title === '新对话' && role === 'user') patch.title = String(content).slice(0, 20);
      await window.api.store.update('assistantSessions', sess.id, patch);
      Object.assign(sess, patch);
    }
    return msg;
  },

  /* ================= 消息渲染 ================= */
  renderWelcome() {
    this.addMsg('ai', '你好！我是科研工作台助手。\n\n我可以直接帮你：\n· 新增 / 修改 / 删除 任务（待办事项）和【日程】\n· 创建【每日模板 / 每周模板】（如「每天9点上班」「每周三买菜」）并应用到具体日期\n· 健身打卡、健身计划（草案可预览后保存）、运动方案规划\n· 查询进度、生成日报周报\n· 分析你的时间安排并给出建议\n\n例如：\n· 「每天9点到10点上班，下午2点学3小时」→ 创建每日模板\n· 「每周三晚上买菜」→ 创建每周模板\n· 「安排 明天9点到11点 写论文」→「把明天9点的写论文改到下午2点」\n· 「帮我看看时间安排」→ 今日洞察与建议');
  },

  renderRecorded(m) {
    if (m.role === 'user') { this.addMsg('user', m.content); return; }
    if (m.kind === 'draft' && !m.confirmed) {
      // 历史中的未确认草案：展示为「草案（未保存）」标注
      this.addMsg('ai', `${m.content}\n\n> ⚠️ 该草案未保存（历史记录）`);
      return;
    }
    this.addMsg('ai', m.content || '（空）');
  },

  /* ================= 记忆构建（S2） ================= */
  /**
   * 构建上下文记忆。scope 表示「目标会话」：主抽屉用 this.state；外部 target（如桌面宠物）
   * 通过 getSession() 提供自己的会话（sessionId/sessions/messages），实现多会话隔离。
   */
  async buildMemoryContext(scope = null) {
    scope = scope || this.state;
    const parts = [];
    // 1. 滚动摘要
    const sess = (scope.sessions || []).find((s) => s.id === scope.sessionId);
    const sum = sess && sess.summary;
    if (sum && ((sum.goals && sum.goals.length) || (sum.decisions && sum.decisions.length) || (sum.pending && sum.pending.length))) {
      parts.push(`【会话摘要】\n用户目标：${(sum.goals || []).join('；') || '（无）'}\n已确认决定：${(sum.decisions || []).join('；') || '（无）'}\n待确认：${(sum.pending || []).join('；') || '（无）'}`);
    }
    // 2. 窗口历史（字符预算约 7000，最多 12 条）
    const hist = this.windowMessages(7000, scope.messages || []);
    if (hist.length) {
      parts.push(`【对话历史】\n${hist.map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${truncate(m.content, 180)}`).join('\n')}`);
    }
    // 3. 最近动作结果（支撑「它/刚才那个」定位）
    const last = this.lastActionResult(scope.messages || []);
    if (last) parts.push(`【最近操作】${last}`);
    // 4. 工作区数据
    parts.push(await this.buildContext());
    return parts.join('\n\n');
  },

  /** 窗口内最近消息（按字符预算倒序收集）；messages 缺省用主抽屉会话 */
  windowMessages(budget, messages = null) {
    const list = messages || this.state.messages;
    const out = [];
    let used = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const c = (m.content || '').length + 40;
      if (out.length >= 12 || (used + c > budget && out.length >= 2)) break;
      out.unshift(m);
      used += c;
    }
    return out;
  },

  /** 最近一次动作结果；messages 缺省用主抽屉会话 */
  lastActionResult(messages = null) {
    const list = messages || this.state.messages;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.kind === 'action_result' && m.action) {
        return `${m.action}：${truncate(String(m.result || m.content || ''), 120)}`;
      }
    }
    return null;
  },

  /** 解析目标会话上下文：外部 target 提供 getSession()（如桌面宠物 pet-chat）则用之，否则主抽屉会话 */
  async resolveScope(target) {
    if (target && typeof target.getSession === 'function') {
      try {
        const s = await target.getSession();
        if (s && s.sessionId) return { ...this.state, ...s };
      } catch (e) { /* 外部会话解析失败 → 回退主抽屉会话 */ }
    }
    return this.state;
  },

  /** 滚动摘要压缩（scope 缺省用主抽屉会话；桌面宠物同样触发，保证长对话上下文） */
  async maybeSummarize(scope = null) {
    scope = scope || this.state;
    const list = scope.messages || [];
    const total = list.reduce((s, m) => s + (m.content || '').length, 0);
    if (total < 9000 || !list.length) return;
    const settings = await window.api.store.getSettings();
    if (!(settings.aiBaseUrl && settings.aiApiKey && settings.aiModel)) return; // 未配置 AI：保留窗口即可
    try {
      const oldText = list.slice(0, Math.max(0, list.length - 4)).map((m) => `${m.role}: ${String(m.content || '').slice(0, 150)}`).join('\n').slice(0, 5000);
      if (!oldText) return;
      const r = await window.api.ai.chat([{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: oldText }], { maxTokens: 400 });
      if (!r.ok) return;
      const sum = parseIntentJson(r.content);
      if (sum && sum.goals !== undefined) {
        const sess = (scope.sessions || []).find((s) => s.id === scope.sessionId);
        if (sess) {
          await window.api.store.update('assistantSessions', sess.id, { summary: { goals: sum.goals || [], decisions: sum.decisions || [], pending: sum.pending || [] } });
          sess.summary = { goals: sum.goals || [], decisions: sum.decisions || [], pending: sum.pending || [] };
        }
      }
    } catch (e) { console.warn('[assistant] summarize failed:', e); }
  },

  /* ================= 基础（沿用） ================= */
  async open() {
    document.getElementById('assistantDrawer').classList.add('open');
    document.getElementById('assistantMask').classList.remove('hidden');
    this.opened = true;
    this.refreshModelLabel();
    if (!this.state.sessionId) await this.initSession();
    else if (!chatBody().children.length) {
      if (this.state.messages.length) await this.loadSession(this.state.sessionId);
      else this.renderWelcome();
    }
    document.getElementById('chatInput').focus();
  },

  close() {
    document.getElementById('assistantDrawer').classList.remove('open');
    document.getElementById('assistantMask').classList.add('hidden');
    this.opened = false;
  },

  async refreshModelLabel() {
    const s = await window.api.store.getSettings();
    const label = document.getElementById('assistantModelLabel');
    if (s.aiBaseUrl && s.aiApiKey) {
      label.textContent = `${s.aiModel || ''} · 已连接`;
      label.style.color = 'var(--green)';
    } else {
      label.textContent = '未配置 AI · 本地规则模式';
      label.style.color = 'var(--orange)';
    }
  },

  addMsg(role, content, extra = '') {
    const body = chatBody();
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'ai') {
      div.innerHTML = App.markdown(content) + extra;
    } else {
      div.textContent = content;
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  },

  async buildContext() {
    const tasks = await window.api.store.list('tasks');
    const today = App.todayStr();
    const todo = tasks.filter((t) => t.status !== 'done').slice(0, 12)
      .map((t) => `- [${t.priority}] ${t.title}${t.dueDate ? ` (截止 ${t.dueDate})` : ''}`).join('\n');
    const doneToday = tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === today).length;
    const lit = await window.api.store.list('literature');
    const recentLit = lit.slice(-5).reverse().map((l) => `- ${l.title}${l.year ? ` (${l.year})` : ''}`).join('\n');
    let litOverview = `文献库共 ${lit.length} 篇`;
    try {
      const cols = await window.api.store.list('litCollections');
      const userCols = cols.filter((c) => c.source === 'user').length;
      const zoteroCols = cols.filter((c) => c.source === 'zotero').length;
      litOverview = `文献库共 ${lit.length} 篇 · 分类 ${userCols + zoteroCols} 个（用户 ${userCols} / Zotero ${zoteroCols}）`;
    } catch (e) { /* 忽略分类统计失败 */ }
    const reports = await window.api.store.list('reports');
    const lastReport = reports.sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''))[0];
    // 健身概况（计划数 + 条目数，引导 Agent 使用条目工具）
    let fitnessOverview = '暂无健身计划';
    try {
      const fitness = await window.api.store.list('fitnessPlans');
      if (fitness.length) {
        const fitLines = fitness.slice(0, 4).map((p) => {
          const items = (Array.isArray(p.items) && p.items.length) ? p.items : (p.schedule || []).flatMap((d) => d.items || []);
          return `- ${p.name}（${items.length} 条细致条目）`;
        }).join('\n');
        fitnessOverview = `健身计划 ${fitness.length} 个：\n${fitLines}`;
      }
    } catch (e) { /* 忽略健身统计失败 */ }
    // GitHub 订阅概况
    let ghSubOverview = '暂无订阅';
    try {
      const ghSubs = await window.api.store.list('githubSubs');
      if (ghSubs.length) {
        const kw = ghSubs.filter((s) => s.type === 'keyword').length;
        const rp = ghSubs.filter((s) => s.type === 'repo').length;
        ghSubOverview = `${ghSubs.length} 条（关键词 ${kw} / 仓库 ${rp}）`;
      }
    } catch (e) { /* 忽略订阅统计失败 */ }
    // 每日计划概况（区分于任务/待办事项）
    let planOverview = '今日暂无每日计划';
    try {
      const plans = await window.api.store.list('dailyPlans');
      const day = plans.find((p) => p.date === today);
      if (day && day.items && day.items.length) {
        const done = day.items.filter((i) => i.done).length;
        planOverview = `今日每日计划 ${day.items.length} 项（完成 ${done} 项）`;
      }
    } catch (e) { /* 忽略每日计划统计失败 */ }
    return [
      `【当前工作区上下文】\n今日日期：${today}，今日完成 ${doneToday} 项任务。`,
      `当前任务（未完成 ${todo.split('\n').filter((l) => l.startsWith('-')).length} 项）：\n${todo || '（无）'}`,
      `【每日计划】${planOverview}。查看/修改每日计划用 queryDailyPlan/updateDailyPlan；任务（待办事项）用 queryTask/updateTask/deleteTask。`,
      `【文献库】${litOverview}。用户问文献相关问题时可用 queryLiterature 搜索、readLiterature 阅读。\n最近文献：\n${recentLit || '（无）'}`,
      `【健身】${fitnessOverview}。修改条目状态用 updateFitnessItem、添加动作用 addFitnessItem、查看条目清单用 queryFitness。`,
      `【GitHub 订阅】${ghSubOverview}。订阅用 subscribeGitHub、取消用 unsubscribeGitHub、查看清单用 queryGitHubSubs、看热榜用 queryGitHubTrending。`,
      lastReport ? `最近生成的报告类型：${lastReport.type}（${lastReport.dateRange.label}）` : '尚未生成过报告'
    ].join('\n\n');
  },

  /* ================= 结果渲染（确认卡 / 草案卡 / clarify） ================= */
  renderResult(loading, result, onExecuted, lead = '') {
    const body = chatBody();
    const record = (reply, extra) => { if (onExecuted) onExecuted(reply, extra); };
    const leadHtml = lead ? `<div class="persona-lead">${App.esc(lead)}</div>` : '';
    if (result && typeof result === 'object' && result.needsConfirm) {
      const isDraft = result.mode === 'draft';
      const confirmLabel = isDraft ? '保存' : '确认执行';
      const cancelLabel = isDraft ? '放弃' : '取消';
      loading.innerHTML = leadHtml + App.markdown(result.preview)
        + `<div class="chat-confirm"><button class="btn btn-primary btn-sm" data-c="1">${confirmLabel}</button><button class="btn btn-sm" data-c="0">${cancelLabel}</button></div>`;
      const btns = loading.querySelectorAll('[data-c]');
      btns[0].addEventListener('click', async () => {
        if (loading.dataset.busy) return; // 防重入：避免快速点击触发栈溢出
        loading.dataset.busy = '1';
        loading.querySelector('.chat-confirm').remove();
        loading.innerHTML = `<span class="spinner"></span>执行中…`;
        try {
          const reply = await result.apply() || (isDraft ? '已保存' : '已执行');
          loading.innerHTML = App.markdown(reply);
          record(reply, { kind: 'action_result', action: result.action, confirmed: true });
        } catch (e) {
          loading.className = 'msg error';
          loading.textContent = (e && e.message) ? e.message : String(e);
          record('执行失败：' + ((e && e.message) || e), { kind: 'action_result', action: result.action, confirmed: false });
        }
        body.scrollTop = body.scrollHeight;
        delete loading.dataset.busy; // 解锁（失败也复位，防止后续无法点击）
      });
      btns[1].addEventListener('click', () => {
        loading.textContent = isDraft ? '已放弃草案，未写入任何数据。' : '已取消，未做任何修改。';
        record('已放弃', { kind: 'text' });
      });
    } else {
      loading.innerHTML = leadHtml + App.markdown(result || '（无返回结果）');
    }
    body.scrollTop = body.scrollHeight;
  },

  renderClarifyCard(loading, content, missing) {
    const hint = (missing && missing.length) ? `（缺少：${missing.join('、')}）` : '';
    loading.innerHTML = App.markdown(content + (hint ? `\n\n> 请补充：${hint}` : ''))
      + `<div class="chat-clarify"><input class="input" placeholder="补充信息后回车发送…"><button class="btn btn-primary btn-sm">发送</button></div>`;
    const input = loading.querySelector('input');
    const btn = loading.querySelector('button');
    const submit = () => {
      const val = input.value.trim();
      if (!val) return;
      loading.querySelector('.chat-clarify').remove();
      Assistant.send(val);
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
  },

  /* ================= 意图分发（S3：mode） ================= */
  async dispatchIntent(intent, loading, rawContent, trace, target = null) {
    target = target || this.defaultTarget();
    const mode = intent.mode || (intent.action ? 'action' : 'chat'); // 兼容旧格式
    switch (mode) {
      case 'chat': {
        const content = intent.content || rawContent || '';
        loading.innerHTML = App.markdown(content);
        this.appendTrace(loading, trace || []);
        await target.record('ai', content, { kind: 'text' });
        break;
      }
      case 'clarify': {
        const content = intent.content || '需要补充一点信息：';
        this.renderClarifyCard(loading, content, intent.missing || []);
        this.appendTrace(loading, trace || []);
        await target.record('ai', content, { kind: 'text', action: 'clarify', params: { missing: intent.missing || [] } });
        break;
      }
      case 'proposal': {
        const card = await window.AssistantActions.buildDraftCard(intent.action, intent.params || {}, intent.assumptions || [], intent.content || '');
        this.renderResult(loading, card, (reply, extra) => target.record('ai', reply, extra), personaLead(intent.action));
        this.appendTrace(loading, trace || []);
        await target.record('ai', card.preview, { kind: 'draft', action: intent.action, params: intent.params, draft: true, confirmed: false });
        break;
      }
      case 'action': {
        if (intent.action && window.AssistantActions && AssistantActions.canExecute(intent.action)) {
          const card = AssistantActions.buildActionCard(intent.action, intent.params || {}, intent.assumptions || []);
          this.renderResult(loading, card, (reply, extra) => target.record('ai', reply, extra), personaLead(intent.action));
          this.appendTrace(loading, trace || []);
          await target.record('ai', card.preview, { kind: 'draft', action: intent.action, params: intent.params, draft: true, confirmed: false });
        } else {
          // 模型幻觉出白名单外的 action：渲染其说明，但明确「未执行任何写入」，避免 content 中「已创建/已保存」误导
          const txt = `${intent.content || rawContent || ''}${intent.action ? '\n\n> ⚠️ 该操作不在支持范围内，未执行任何写入；如有需要请用自然语言重新描述。' : ''}`;
          loading.innerHTML = App.markdown(txt);
          this.appendTrace(loading, trace || []);
          await target.record('ai', txt, { kind: 'text' });
        }
        break;
      }
      default:
        loading.innerHTML = App.markdown(rawContent || '');
        this.appendTrace(loading, trace || []);
        await target.record('ai', rawContent || '', { kind: 'text' });
    }
  },

  /* ================= 主入口 ================= */
  /** 渲染会话上下文：主抽屉默认 target；桌面宠物传入自己的 target 复用同一套 Agent 链路（能力完全一致） */
  defaultTarget() {
    const self = this;
    return {
      renderMessage: (role, content, extra) => self.addMsg(role, content, extra),
      record: (role, content, extra) => self.recordMessage(role, content, extra),
      scroll: () => { const b = chatBody(); if (b) b.scrollTop = b.scrollHeight; }
    };
  },

  async send(text, target = null, system = TOOLS_SYSTEM_PROMPT) {
    if (!text.trim()) return;
    if (this._isSending) return; // 防重入：避免快速连击/快速重入导致栈溢出
    this._isSending = true;
    let loading = null;
    let scope = null;
    try {
      // 初始化也纳入 try：若 renderMessage/record/resolveScope 抛错，finally 仍会解锁 _isSending
      //（否则锁永不释放 → 之后无法再对话）
      target = target || this.defaultTarget();
      target.renderMessage('user', text);
      await target.record('user', text);
      loading = target.renderMessage('ai', '思考中…');
      loading.innerHTML = `<span class="spinner"></span>处理中…`;
      scope = await this.resolveScope(target); // 目标会话上下文（宠物=pet-chat；缺省=主抽屉）

      const settings = await window.api.store.getSettings();
      const aiReady = !!(settings.aiBaseUrl && settings.aiApiKey && settings.aiModel);

      // 1) AgentLoop：已配置 AI → 原生 function calling（工具注册表路由，语义理解归 AI）
      if (aiReady) {
        loading.innerHTML = `<span class="spinner"></span>AI 理解中…`;
        const trace = [{ t: 'info', label: '构建上下文', detail: '会话摘要 + 窗口历史 + 最近操作 + 工作区数据' }];
        const ctx = await this.buildMemoryContext(scope);
        const tools = window.ToolRegistry ? ToolRegistry.list() : [];
        const t0 = Date.now();
        const r = await window.api.ai.chatTools(
          [{ role: 'user', content: `${ctx}\n\n【用户输入】\n${text}` }],
          tools,
          { maxTokens: 1200, system }
        );
        trace.push({ t: 'llm', label: `调用模型 ${settings.aiModel || ''}`, detail: `${Date.now() - t0}ms` });
        if (r.ok) {
          if (Array.isArray(r.toolCalls) && r.toolCalls.length) {
            r.toolCalls.forEach((tc) => trace.push({ t: 'tool', label: `选择工具 ${tc.name}`, detail: JSON.stringify(tc.arguments || {}).slice(0, 200) }));
            trace.push({ t: 'info', label: '处理工具调用', detail: '读工具直接执行（结果回传模型）· 写工具确认卡（保存才落库）' });
            const messages = [{ role: 'user', content: `${ctx}\n\n【用户输入】\n${text}` }];
            await this.handleToolCalls(r.toolCalls, loading, trace, messages, tools, settings, 1, target, system);
            return;
          }
          // 兜底：模型未走原生 tool_calls，但可能输出 JSON 意图文本（不支持 tools 的模型）→ 转确认卡/草案卡
          const intent = parseIntentJson(r.content);
          if (intent && intent.action && (intent.mode || intent.params || intent.content)) {
            trace.push({ t: 'info', label: '识别到 JSON 意图（降级通道）', detail: intent.action });
            await this.dispatchIntent(intent, loading, r.content, trace, target);
            return;
          }
          loading.innerHTML = App.markdown(r.content || '（无内容）');
          this.appendTrace(loading, trace);
          await target.record('ai', r.content || '', { kind: 'text' });
          return;
        }
        // 接口失败 → 降级快速路径（正则动作表），保证可用性
        const fellBack = await this.runFastPath(text, loading, target);
        if (fellBack) return;
        loading.className = 'msg error';
        loading.textContent = r.error || '请求失败';
        await target.record('ai', r.error || '请求失败', { kind: 'text' });
        return;
      }

      // 2) 未配置 AI → 快速路径（正则动作表，离线可用）
      const hit = await this.runFastPath(text, loading, target);
      if (hit) return;

      // 3) 模板对话
      const ctx = await this.buildContext();
      const fullPrompt = `${ctx}\n\n【用户问题】\n${text}`;
      loading.innerHTML = `<span class="spinner"></span>正在处理…`;
      const r = await window.api.ai.chat([
        { role: 'system', content: '你是「科研工作台」的内置 AI 助手，服务于工科研究生。回答要专业、简洁、可执行，使用中文。涉及任务、文献、报告问题时，基于用户提供的上下文回答，可以给出具体建议或操作步骤。' },
        { role: 'user', content: fullPrompt }
      ]);
      if (r.ok) {
        loading.innerHTML = App.markdown(r.content);
        await target.record('ai', r.content, { kind: 'text' });
      } else {
        loading.className = 'msg error';
        loading.textContent = r.error || '请求失败';
        await target.record('ai', r.error || '请求失败', { kind: 'text' });
      }
    } catch (err) {
      console.error('[assistant] send error:', err);
      if (loading) {
        loading.className = 'msg error';
        loading.textContent = (err && err.message) ? err.message : String(err);
      }
      App.toast(`操作失败：${(err && err.message) ? err.message : '未知错误'}`, 'error');
      if (target && typeof target.record === 'function') {
        await target.record('ai', `执行出错：${(err && err.message) || err}`, { kind: 'text' });
      }
    } finally { this._isSending = false; } // 任何路径都解锁（含异常）
    if (target && typeof target.scroll === 'function') target.scroll();
    if (scope) this.maybeSummarize(scope); // 目标会话超预算时滚动压缩（主抽屉与桌面宠物一致）
  },

  /** AgentLoop：处理模型返回的工具调用（读直接执行且结果回传多轮；写生成确认卡） */
  async handleToolCalls(toolCalls, loading, trace, messages, tools, settings, rounds = 1, target = null, system = TOOLS_SYSTEM_PROMPT) {
    target = target || this.defaultTarget();
    const textParts = [];
    const firstToolName = (toolCalls && toolCalls[0] && toolCalls[0].name) || ''; // 塞西引导语按首个工具类别
    let hasCard = false;
    const toolResults = [];           // 读工具结果（供多轮回传）
    const assistantCalls = [];        // OpenAI 格式 assistant tool_calls（供多轮回传）
    // 防重入：同一 action+params 的多个写 tool_call 合并为单张确认卡（解决截图 bug：模型误读「每日」为多天反复 tool_call）
    const pendingWrites = new Map(); // hash -> { div, card }

    for (const tc of toolCalls || []) {
      const name = tc.name || '';
      if (!window.ToolRegistry || !ToolRegistry.get(name)) {
        textParts.push(`> 无法识别的操作「${name}」，已忽略。`);
        if (trace) trace.push({ t: 'tool', label: `未知工具 ${name}`, detail: '已忽略' });
        continue;
      }
      const v = ToolRegistry.validate(name, tc.arguments || {});
      if (!v.ok) {
        textParts.push(`> 「${name}」参数无效（${v.errors.join('；')}），已忽略。`);
        if (trace) trace.push({ t: 'tool', label: `${name} 参数校验失败`, detail: v.errors.join('；') });
        continue;
      }
      const callId = tc.id || `call_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      assistantCalls.push({ id: callId, type: 'function', function: { name, arguments: JSON.stringify(v.params) } });
      if (ToolRegistry.isWrite(name)) {
        // 写操作：同 action+params 合并为单张确认卡
        const hash = `${name}::${JSON.stringify(v.params)}`;
        if (pendingWrites.has(hash)) {
          textParts.push(`> 已合并到上方确认卡（重复请求：${name}）。`);
          if (trace) trace.push({ t: 'tool', label: `${name} 重复请求已合并`, detail: JSON.stringify(v.params).slice(0, 120) });
          continue;
        }
        const card = await AssistantActions.buildActionCard(name, v.params || {});
        const div = target.renderMessage('ai', '处理中…');
        div.innerHTML = `<span class="spinner"></span>`;
        this.renderResult(div, card, (reply, extra) => target.record('ai', reply, extra), personaLead(name));
        this.appendTrace(div, trace || []);
        await target.record('ai', card.preview, { kind: 'draft', action: name, params: v.params, draft: true, confirmed: false });
        pendingWrites.set(hash, { div, card });
        hasCard = true;
      } else {
        // 读操作 → 确定性执行，结果收集供多轮回传
        const reply = await ToolRegistry.execute(name, v.params || {});
        if (reply) {
          textParts.push(reply);
          toolResults.push({ tool_call_id: callId, output: String(reply) });
        }
      }
    }

    // 标注：合并了多少写请求
    if (pendingWrites.size && (toolCalls || []).filter((tc) => tc && ToolRegistry.isWrite(tc.name)).length > pendingWrites.size) {
      const merged = (toolCalls || []).filter((tc) => tc && ToolRegistry.isWrite(tc.name)).length - pendingWrites.size;
      if (trace) trace.push({ t: 'info', label: '合并重复确认卡', detail: `${merged} 个写请求已合并为 1 张卡` });
    }

    // 多轮循环：读工具结果按 role:'tool' 回传模型继续生成（maxRounds=4）
    if (toolResults.length && rounds < 4 && Array.isArray(messages) && messages.length) {
      messages.push({ role: 'assistant', content: null, tool_calls: assistantCalls });
      toolResults.forEach((tr) => messages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.output.slice(0, 6000) }));
      trace.push({ t: 'info', label: `回传工具结果（第 ${rounds} 轮）`, detail: `${toolResults.length} 个结果已反馈模型` });
      const t0 = Date.now();
      const r = await window.api.ai.chatTools(messages, tools, { maxTokens: 1200, system });
      trace.push({ t: 'llm', label: `继续调用模型 ${(settings && settings.aiModel) || ''}`, detail: `${Date.now() - t0}ms` });
      if (r.ok) {
        if (Array.isArray(r.toolCalls) && r.toolCalls.length) {
          r.toolCalls.forEach((tc) => trace.push({ t: 'tool', label: `继续选择工具 ${tc.name}`, detail: JSON.stringify(tc.arguments || {}).slice(0, 200) }));
          await this.handleToolCalls(r.toolCalls, loading, trace, messages, tools, settings, rounds + 1, target, system);
          return;
        }
        // 模型最终回复（普通内容）
        loading.innerHTML = App.markdown(r.content || '（无内容）');
        this.appendTrace(loading, trace || []);
        await target.record('ai', r.content || '', { kind: 'text' });
        target.scroll();
        return;
      }
      // 接口失败：展示已收集的工具结果 + 兜底提示（前置塞西引导语）
      if (textParts.length) {
        loading.innerHTML = App.markdown(`${personaLead(firstToolName)}\n\n${textParts.join('\n\n')}\n\n> ⚠️ 模型后续响应失败，以上为工具执行结果。`);
        this.appendTrace(loading, trace || []);
        await target.record('ai', textParts.join('\n\n'), { kind: 'action_result' });
      }
      target.scroll();
      return;
    }

    if (textParts.length) {
      loading.innerHTML = App.markdown(`${personaLead(firstToolName)}\n\n${textParts.join('\n\n')}`);
      this.appendTrace(loading, trace || []);
      await target.record('ai', textParts.join('\n\n'), { kind: 'action_result' });
    } else if (hasCard && loading.isConnected) {
      loading.remove(); // 全为写操作确认卡：移除占位
    }
    target.scroll();
  },

  /** 渲染处理过程折叠块（默认收起，用户可展开） */
  appendTrace(div, trace) {
    if (!div || !Array.isArray(trace) || !trace.length) return;
    const steps = trace.map((s) => {
      const label = String(s.label || '').replace(/</g, '&lt;');
      const detail = String(s.detail || '').replace(/</g, '&lt;');
      return `<div class="trace-step"><b>${label}</b>${detail ? `<span>${detail}</span>` : ''}</div>`;
    }).join('');
    const html = `<details class="agent-trace"><summary><span class="trace-icon">▶</span> 处理过程（${trace.length} 步）</summary><div class="trace-body">${steps}</div></details>`;
    div.insertAdjacentHTML('beforeend', html);
  },

  /** 快速路径（正则动作表）：未配置 AI / 接口失败时降级使用；返回是否命中 */
  async runFastPath(text, loading, target = null) {
    target = target || this.defaultTarget();
    const action = window.AssistantActions && AssistantActions.match(text);
    const onExecuted = (reply, extra) => target.record('ai', reply, extra);
    if (action === 'planFitnessPlan') {
      const card = AssistantActions.planFitnessPlan(text);
      this.renderResult(loading, card, onExecuted, personaLead('addFitnessPlan'));
      await target.record('ai', card.preview, { kind: 'draft', action: 'addFitnessPlan', params: card.params, draft: true, confirmed: false });
      return true;
    }
    if (action) {
      loading.innerHTML = `<span class="spinner"></span>执行中…`;
      const result = await AssistantActions[action](text);
      this.renderResult(loading, result, onExecuted, personaLead(action));
      return true;
    }
    return false;
  }
};

/** 宽松解析模型返回的意图 JSON（容错：提取外层 {...}；失败视为纯文本 chat，零副作用） */
/* 意图结构校验：对象含意图特征字段才视为意图候选（{name:"张三"} 这类普通 JSON 不算） */
function isIntentShape(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (obj.mode !== undefined || obj.action !== undefined || obj.params !== undefined) return true;
  if (obj.assumptions !== undefined || obj.missing !== undefined) return true;
  return typeof obj.content === 'string' && obj.content.length > 0;
}

/* 讲解/示例语气信号：代码问答场景（模型贴 JSON 示例讲解）命中这些词一律视为普通回答 */
const INTENT_TEACHING_RE = /(?:例如|示例|比如|演示|示范|参考|解释|说明|讲解|语法|用法|格式|结构|字段|教程|文档|写法|怎么用|如何使用)/;

/*
 * 意图解析（置信度分级，防代码问答误判）：
 * ① 整体即 JSON 意图对象 → 高置信，直接返回
 * ② ```json 围栏包裹 + 围栏外仅为短引导（≤40 字）且无讲解语气 → 中置信，返回
 * ③ 自然语言中夹 JSON 片段：出现代码块或讲解语气 → 一律视为普通回答（不返回意图）
 * ④ 兜底：宽松 key 匹配（action=xx / mode=xx）→ 仅 chat 渲染原文，零副作用
 */
function parseIntentJson(content) {
  const s = String(content || '').trim();
  if (!s) return { mode: 'chat', content: s };

  // ① 整体 JSON
  try {
    const obj = JSON.parse(s);
    if (isIntentShape(obj)) return obj;
  } catch (e) { /* fallthrough */ }

  // ② 围栏包裹 + 短引导
  const fenced = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced && fenced[1]) {
    try {
      const obj = JSON.parse(fenced[1].trim());
      if (isIntentShape(obj)) {
        const outer = s.replace(fenced[0], '').trim();
        const outerClean = outer.replace(/\s+/g, '');
        if (outerClean.length <= 40 && !INTENT_TEACHING_RE.test(outer)) return obj;
      }
    } catch (e) { /* fallthrough */ }
  }

  // ③ 自然语言中夹 JSON 片段：代码块/讲解语气 → 普通回答
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      if (isIntentShape(obj) && !s.includes('```') && !INTENT_TEACHING_RE.test(s)) return obj;
    } catch (e) { /* fallthrough */ }
  }

  // ④ 宽松 key 匹配兜底（仅 chat 渲染原文）
  const a = s.match(/["']?(?:mode|action)["']?\s*[:=]\s*["']?(\w+)["']?/);
  if (a) return { mode: 'chat', action: a[1], params: {}, content: s };
  return { mode: 'chat', content: s };
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

window.Assistant = Assistant;

document.addEventListener('DOMContentLoaded', () => {
  /* 桌面宠物悬浮球页面仅加载助手核心（无主抽屉 DOM），全部绑定做存在性守卫 */
  const $ = (id) => document.getElementById(id);
  const chatSend = $('chatSend');
  const chatInput = $('chatInput');
  if (chatSend && chatInput) {
    chatSend.addEventListener('click', () => {
      Assistant.send(chatInput.value);
      chatInput.value = '';
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatSend.click();
      }
    });
  }
  document.querySelectorAll('.chat-quick .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!Assistant.opened) Assistant.open();
      Assistant.send(chip.dataset.q);
    });
  });
  /* 会话管理 */
  const assistantNew = $('assistantNew');
  const assistantSessionsBtn = $('assistantSessionsBtn');
  const assistantExport = $('assistantExport');
  if (assistantNew) assistantNew.addEventListener('click', () => Assistant.newSession());
  if (assistantSessionsBtn) assistantSessionsBtn.addEventListener('click', () => Assistant.renderSessionList());
  if (assistantExport) assistantExport.addEventListener('click', () => Assistant.exportSession());
});
