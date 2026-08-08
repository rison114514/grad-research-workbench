'use strict';

/* ============ 桌面宠物悬浮球（系统级独立窗口） ============
 * 悬浮球 = Agent 的悬浮入口：页面仅渲染与输入，能力全在
 * Assistant.send(text, target) —— 与主智能助理完全同一套链路。
 */

const PetFloat = {
  mode: 'ball',           // 'ball' | 'chat'
  state: {
    enabled: false,
    config: { avatar: 'xaihi-half', customPath: '', position: 'bottom-right' },
    sessionId: 'pet-chat',          // 宠物独立会话（与主智能助手会话隔离，历史落同一张表）
    messages: [],                   // pet-chat 全部消息（内存态，供上下文构建）
    sessions: [],                   // pet-chat 会话记录（含滚动摘要 summary）
    loaded: false                   // 历史是否已加载
  },

  async init() {
    // 设置（头像/位置/开关）
    try {
      const s = await window.api.store.getSettings();
      this.state.enabled = !!s.petEnabled;
      this.state.config = { ...this.state.config, ...(s.petConfig || {}) };
    } catch (e) { /* 读取失败用默认 */ }
    // 宠物会话：加载历史 + 会话记录（与智能助手同源存储，重新打开窗口可回放）
    await this.initSession();
    // 头像
    this.loadAvatar();
    // 模式初始化
    try {
      const st = await window.api.pet.getState();
      if (st && st.mode === 'chat') this.setMode('chat');
    } catch (e) { /* 忽略 */ }
    // 主进程模式切换通知
    if (window.api.pet.onModeChanged) {
      window.api.pet.onModeChanged((m) => this.setMode(m));
    }
    // 事件：手动拖动 + 点击/拖动区分（替代 -webkit-app-region:drag，透明窗口卡死修复）
    this.initDrag(document.getElementById('petBall'), { click: () => this.openChat(), dblclick: () => window.api.pet.focusMain() });
    this.initDrag(document.getElementById('petChatHead'), { click: null, dblclick: null });
    // 聊天态整体也可拖（消息区空白处）：initDrag 内部已对 input/button/.msg 跳过
    this.initDrag(document.getElementById('petChat'), { click: null, dblclick: null });
    document.getElementById('petChatMin').addEventListener('click', () => this.closeChat());
    const clearBtn = document.getElementById('petChatClear');
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearHistory());
    document.getElementById('petSend').addEventListener('click', () => this.send());
    const input = document.getElementById('petInput');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    // 进入聊天态时聚焦输入框
    if (this.mode === 'chat') input.focus();
  },

  /* ---------- 宠物会话（与智能助手一致：assistantSessions + assistantMessages 同源存储） ---------- */
  /** 加载 pet-chat 会话：全部消息 + 会话记录（含摘要）；无会话记录则幂等创建 */
  async initSession() {
    try {
      const msgs = await window.api.store.list('assistantMessages');
      this.state.messages = msgs.filter((m) => m.sessionId === 'pet-chat')
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      const sessions = await window.api.store.list('assistantSessions');
      this.state.sessions = sessions.filter((s) => s.id === 'pet-chat' || s.sessionId === 'pet-chat');
      if (!this.state.sessions.length) {
        const now = new Date().toISOString();
        const s = await window.api.store.create('assistantSessions', { id: 'pet-chat', sessionId: 'pet-chat', title: '宠物对话', summary: { goals: [], decisions: [], pending: [] }, createdAt: now, updatedAt: now });
        this.state.sessions = [s];
      }
    } catch (e) { /* 历史加载失败不阻断（窗口仍可用，上下文从空开始） */ }
    this.state.loaded = true;
  },

  /** 记录消息：与智能助手 recordMessage 同格式（支持 kind/action/draft 等 extra），并同步内存态 */
  async recordMsg(role, content, extra = {}) {
    const msg = {
      sessionId: this.state.sessionId, role,
      kind: 'text', content: String(content || '').slice(0, 4000),
      createdAt: new Date().toISOString(), ...extra
    };
    try {
      const saved = await window.api.store.create('assistantMessages', msg);
      msg.id = saved.id;
    } catch (e) { /* 落库失败仍保留内存态 */ }
    this.state.messages.push(msg);
    // 刷新会话元信息（updatedAt；首条用户消息命名）
    const sess = this.state.sessions[0];
    if (sess) {
      const patch = { updatedAt: msg.createdAt };
      if ((sess.title === '宠物对话' || !sess.title) && role === 'user') patch.title = `宠物对话 · ${String(content).slice(0, 16)}`;
      try { await window.api.store.update('assistantSessions', sess.id, patch); } catch (e) { /* 忽略 */ }
      Object.assign(sess, patch);
    }
    return msg;
  },

  /** 回放单条历史（与智能助手 renderRecorded 一致：草案未保存标注） */
  renderRecorded(m) {
    if (m.role === 'user') { this.appendMsg('user', m.content); return; }
    if (m.kind === 'draft' && !m.confirmed) {
      this.appendMsg('ai', `${m.content}\n\n> ⚠️ 该草案未保存（历史记录）`);
      return;
    }
    this.appendMsg('ai', m.content || '（空）');
  },

  /** 打开聊天态时回放历史（仅一次，之后消息走增量渲染） */
  renderHistory() {
    if (this._historyRendered) return;
    this._historyRendered = true;
    const body = document.getElementById('petChatBody');
    if (!body) return;
    body.innerHTML = '';
    if (!this.state.messages.length) {
      body.innerHTML = '<div class="pet-chat-welcome">管理员，我是塞西。源石网络已就绪——<br>例如：「帮我生成今天的日报」「把跑步标记为完成」</div>';
      return;
    }
    this.state.messages.forEach((m) => this.renderRecorded(m));
    body.scrollTop = body.scrollHeight;
  },

  /** 清空宠物对话历史（消息 + 摘要重置） */
  async clearHistory() {
    if (!confirm('清空宠物对话的全部历史？此操作不可撤销。')) return;
    try {
      const msgs = await window.api.store.list('assistantMessages');
      for (const m of msgs.filter((x) => x.sessionId === 'pet-chat')) await window.api.store.remove('assistantMessages', m.id);
    } catch (e) { /* 忽略 */ }
    this.state.messages = [];
    this._historyRendered = false;
    const body = document.getElementById('petChatBody');
    if (body) body.innerHTML = '<div class="pet-chat-welcome">管理员，我是塞西。源石网络已就绪——<br>例如：「帮我生成今天的日报」「把跑步标记为完成」</div>';
    const sess = this.state.sessions[0];
    if (sess) {
      sess.summary = { goals: [], decisions: [], pending: [] };
      try { await window.api.store.update('assistantSessions', sess.id, { summary: sess.summary }); } catch (e) { /* 忽略 */ }
    }
    App.toast('已清空宠物对话历史', 'ok');
  },

  /* 手动拖动：mousedown 记录起点 → 移动超阈值视为拖动（IPC 增量移动窗口）→ 未移动视为点击/双击 */
  initDrag(el, { click, dblclick }) {
    if (!el) return;
    let down = false, moved = false, sx = 0, sy = 0, lastUp = 0, clickTimer = null;
    const MOVE_THRESHOLD = 5;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // 交互元素（输入框/按钮/消息卡片）不触发拖动，让用户能选文本/点按钮
      if (e.target.closest && e.target.closest('input, textarea, button, .msg, .persona-lead, select')) return;
      down = true; moved = false;
      sx = e.screenX; sy = e.screenY;
      el.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!down) return;
      const dx = e.screenX - sx, dy = e.screenY - sy;
      if (!moved && (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD)) moved = true;
      if (moved) {
        window.api.pet.move(dx, dy);   // 增量移动（主进程 setPosition）
        sx = e.screenX; sy = e.screenY;
      }
    });
    window.addEventListener('mouseup', () => {
      if (!down) return;
      down = false;
      el.classList.remove('dragging');
      if (moved || !click) return;      // 拖动过或无需点击处理
      const now = Date.now();
      if (now - lastUp < 320) {         // 双击
        clearTimeout(clickTimer);
        lastUp = 0;
        if (dblclick) dblclick();
      } else {                          // 单击（延迟等双击判断）
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { if (click) click(); }, 300);
        lastUp = now;
      }
    });
  },

  setMode(mode) {
    this.mode = mode === 'chat' ? 'chat' : 'ball';
    document.getElementById('petBall').classList.toggle('hidden', this.mode !== 'ball');
    document.getElementById('petChat').classList.toggle('hidden', this.mode !== 'chat');
    if (this.mode === 'chat') {
      const input = document.getElementById('petInput');
      setTimeout(() => input && input.focus(), 120);
      this.renderHistory(); // 首次进入聊天态回放历史
      const body = document.getElementById('petChatBody');
      if (body) body.scrollTop = body.scrollHeight;
    }
  },

  openChat() {
    this.setMode('chat'); // 本地乐观切换（立即响应）
    if (window.api.pet && window.api.pet.openChat) {
      window.api.pet.openChat().catch(() => {}); // 主进程 resize 窗口（fire-and-forget）
    }
  },

  closeChat() {
    this.setMode('ball');
    if (window.api.pet && window.api.pet.closeChat) {
      window.api.pet.closeChat().catch(() => {});
    }
  },

  async loadAvatar() {
    const cfg = this.state.config;
    const targets = [document.getElementById('petBallAvatar'), document.getElementById('petChatAvatar')];
    const apply = (src) => targets.forEach((el) => { if (el) el.src = src; });
    if (cfg.avatar === 'custom' && cfg.customPath && window.api.fs && window.api.fs.readImage) {
      const r = await window.api.fs.readImage(cfg.customPath);
      if (r && r.ok) { apply(r.dataUri); return; }
    }
    const src = cfg.avatar === 'xaihi-full' ? 'assets/pet/xaihi-full.png' : 'assets/pet/xaihi-half.png';
    apply(src);
  },

  /* ---------- 聊天（与 pet.js 应用内浮窗同构，能力完全一致） ---------- */
  appendMsg(role, content) {
    const body = document.getElementById('petChatBody');
    if (!body) return null; // 极端情况防护（DOM 销毁等）
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'ai') div.innerHTML = App.markdown(content);
    else div.textContent = content;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  },

  async send() {
    const input = document.getElementById('petInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const petTarget = {
      renderMessage: (role, content) => this.appendMsg(role, content),
      record: (role, content, extra) => this.recordMsg(role, content, extra),
      scroll: () => { const b = document.getElementById('petChatBody'); if (b) b.scrollTop = b.scrollHeight; },
      // 关键：把宠物自己的会话（pet-chat 历史 + 摘要）交给 Agent 上下文系统，与主智能助手行为一致
      getSession: () => ({ sessionId: this.state.sessionId, sessions: this.state.sessions, messages: this.state.messages })
    };
    try {
      await window.Assistant.send(text, petTarget);
    } catch (err) {
      this.appendMsg('ai', `> ⚠️ ${App.esc((err && err.message) || '请求失败')}`);
    }
  }
};

window.PetFloat = PetFloat;
if (typeof module !== 'undefined' && module.exports) module.exports = { PetFloat };

document.addEventListener('DOMContentLoaded', () => {
  if (window.PetFloat) PetFloat.init();
});
