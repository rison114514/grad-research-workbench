'use strict';

/* ============ 桌面宠物（塞西）：设置开关 + 点击聊天 ============ */

const Pet = {
  state: {
    enabled: false,
    config: { avatar: 'xaihi-half', customPath: '', position: 'bottom-right' },
    sessionId: 'pet-chat',
    messages: [],                   // pet-chat 全部消息（内存态，供上下文构建）
    sessions: [],                   // pet-chat 会话记录（含滚动摘要 summary）
    desktop: false   // 桌面版 = 系统级悬浮球接管；浏览器预览 = 应用内浮窗
  },

  async init() {
    const s = await window.api.store.getSettings();
    this.state.enabled = !!s.petEnabled;
    this.state.config = { ...this.state.config, ...(s.petConfig || {}) };
    // 桌面版：宠物 = Agent 的悬浮入口，由系统级悬浮球窗口承载，应用内浮窗隐藏
    if (window.api.pet && typeof window.api.pet.isDesktop === 'function') {
      try { this.state.desktop = await window.api.pet.isDesktop(); } catch (e) { /* 忽略 */ }
    }
    if (this.state.desktop) {
      document.querySelectorAll('.pet-fab, .pet-chat').forEach((el) => { if (el) el.style.display = 'none'; });
      return;
    }
    await this.initSession(); // 加载 pet-chat 历史 + 会话记录（与悬浮球同源）
    const fab = document.getElementById('petFab');
    if (!fab) return;
    fab.addEventListener('click', () => this.openChat());
    document.getElementById('petChatClose').addEventListener('click', () => this.closeChat());
    document.getElementById('petSend').addEventListener('click', () => this.send());
    document.getElementById('petInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    this.applyConfig();
  },

  /* ---------- 宠物会话（与智能助手一致：assistantSessions + assistantMessages 同源存储） ---------- */
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
    } catch (e) { /* 历史加载失败不阻断 */ }
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
    const sess = this.state.sessions[0];
    if (sess) {
      const patch = { updatedAt: msg.createdAt };
      if ((sess.title === '宠物对话' || !sess.title) && role === 'user') patch.title = `宠物对话 · ${String(content).slice(0, 16)}`;
      try { await window.api.store.update('assistantSessions', sess.id, patch); } catch (e) { /* 忽略 */ }
      Object.assign(sess, patch);
    }
    return msg;
  },

  /** 打开浮窗时回放历史（仅一次，之后消息走增量渲染） */
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
    this.state.messages.forEach((m) => {
      if (m.role === 'user') { this.appendMsg('user', m.content); return; }
      if (m.kind === 'draft' && !m.confirmed) { this.appendMsg('ai', `${m.content}\n\n> ⚠️ 该草案未保存（历史记录）`); return; }
      this.appendMsg('ai', m.content || '（空）');
    });
    body.scrollTop = body.scrollHeight;
  },

  applyConfig() {
    if (this.state.desktop) return; // 系统级悬浮球由浮窗页自行渲染
    const fab = document.getElementById('petFab');
    if (!fab) return;
    fab.classList.toggle('hidden', !this.state.enabled);
    fab.classList.toggle('left', this.state.config.position === 'bottom-left');
    const chat = document.getElementById('petChat');
    if (chat) chat.classList.toggle('left', this.state.config.position === 'bottom-left');
    this.loadAvatar();
  },

  async loadAvatar() {
    const fab = document.getElementById('petFab');
    if (!fab) return;
    const cfg = this.state.config;
    if (cfg.avatar === 'custom' && cfg.customPath) {
      const r = await window.api.fs.readImage(cfg.customPath);
      if (r && r.ok) { fab.style.backgroundImage = `url("${r.dataUri}")`; return; }
    }
    const src = cfg.avatar === 'xaihi-full' ? 'assets/pet/xaihi-full.png' : 'assets/pet/xaihi-half.png';
    fab.style.backgroundImage = `url("${src}")`;
  },

  openChat() {
    document.getElementById('petChat').classList.remove('hidden');
    this.renderHistory(); // 首次打开回放历史
    document.getElementById('petInput').focus();
  },

  closeChat() {
    document.getElementById('petChat').classList.add('hidden');
  },

  appendMsg(role, content) {
    const body = document.getElementById('petChatBody');
    const div = document.createElement('div');
    div.className = `msg ${role}`;   // 与智能助理对话框同一套 .msg 样式（深色工业风）
    if (role === 'ai') div.innerHTML = App.markdown(content);
    else div.textContent = content;  // 用户消息纯文本（防 XSS，与主助理一致）
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  },

  async send() {
    const input = document.getElementById('petInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    // 渲染/记录到宠物浮窗（'pet-chat' 独立会话），但能力链路与智能助理完全一致
    const petTarget = {
      renderMessage: (role, content) => this.appendMsg(role, content),
      record: (role, content, extra) => this.recordMsg(role, content, extra),
      scroll: () => { const b = document.getElementById('petChatBody'); if (b) b.scrollTop = b.scrollHeight; },
      // 关键：把宠物自己的会话（pet-chat 历史 + 摘要）交给 Agent 上下文系统，与主智能助手行为一致
      getSession: () => ({ sessionId: this.state.sessionId, sessions: this.state.sessions, messages: this.state.messages })
    };
    try {
      // 桌面宠物 = Agent 的悬浮入口：人格与工具规则在 Agent 全局提示词中，这里直接复用
      await window.Assistant.send(text, petTarget);
    } catch (err) {
      const b = document.getElementById('petChatBody');
      if (b) b.appendChild(this.appendMsg('ai', `> ⚠️ ${App.esc((err && err.message) || '请求失败')}`));
    }
  },

};

window.Pet = Pet;
if (typeof module !== 'undefined' && module.exports) module.exports = { Pet };

document.addEventListener('DOMContentLoaded', () => {
  if (window.Pet) Pet.init();
});
