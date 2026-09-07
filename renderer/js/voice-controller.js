'use strict';

/* 塞西语音控制器：录音仅驻留内存；人工点击“发送”后才进入 Assistant.send 与历史。 */
const VoiceController = {
  state: 'idle',
  settings: {},
  chunks: [],
  stream: null,
  context: null,
  processor: null,
  source: null,
  maxTimer: null,
  pendingStop: false,
  audio: null,
  action: null,
  pendingNormalization: null,
  cycle: 0,
  permissionReady: false,

  async init() {
    this.bind('petVoiceClose', () => this.cancel());
    this.bind('petVoiceCancel', () => this.cancel());
    this.bind('petVoiceRetry', () => this.startRecording());
    this.bind('petVoiceRecordingStop', () => this.requestStop());
    this.bind('petVoiceRecordingCancel', () => this.cancel());
    this.bind('petVoiceSend', () => this.sendConfirmed());
    this.bind('petVoiceOpenChat', () => { this.stopPlayback(); window.PetFloat.openChat(); });
    this.bind('petVoiceConfirm', () => this.confirmAction());
    this.bind('petVoiceReject', () => this.rejectAction());
    try { this.permissionReady = localStorage.getItem('voice.microphone.granted') === '1'; } catch (error) { /* no persistent cache */ }
    try { this.settings = await window.api.store.getSettings(); } catch (error) { this.settings = {}; }
  },

  bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  },

  config() {
    const cfg = this.settings.voiceConfig || {};
    return {
      enabled: cfg.enabled !== false,
      cleanupEnabled: cfg.cleanupEnabled !== false,
      ...cfg,
      asr: { provider: 'local', fallbackEnabled: true, fallbackProvider: 'remote', language: 'zh', ...(cfg.asr || {}) },
      tts: { enabled: true, agentReplyEnabled: false, provider: 'cosy', fallbackEnabled: true, fallbackProvider: 'local', volume: .9, speed: 1, ...(cfg.tts || {}) }
    };
  },

  async refreshSettings() {
    try { this.settings = await window.api.store.getSettings(); } catch (error) { /* keep last */ }
    return this.settings;
  },

  setState(state, label) {
    this.state = state;
    const status = document.getElementById('petVoiceStatus');
    const wave = document.getElementById('petVoiceWave');
    const processing = document.getElementById('petVoiceProcessing');
    const review = document.getElementById('petVoiceReview');
    const agent = document.getElementById('petVoiceAgent');
    const error = document.getElementById('petVoiceError');
    const reviewActions = document.getElementById('petVoiceReviewActions');
    const recordingActions = document.getElementById('petVoiceRecordingActions');
    const agentActions = document.getElementById('petVoiceAgentActions');
    if (status) status.textContent = label || state.toUpperCase();
    [review, agent, error, reviewActions, recordingActions, agentActions].forEach((el) => el && el.classList.add('hidden'));
    if (wave) wave.classList.toggle('idle', !['recording', 'speaking'].includes(state));
    if (processing) processing.classList.toggle('hidden', !['requesting', 'recording', 'transcribing', 'normalizing', 'processing', 'speaking'].includes(state));
    if (state === 'review') { review?.classList.remove('hidden'); reviewActions?.classList.remove('hidden'); }
    if (state === 'recording') recordingActions?.classList.remove('hidden');
    if (state === 'agent' || state === 'speaking') { agent?.classList.remove('hidden'); agentActions?.classList.remove('hidden'); }
    if (state === 'error') { error?.classList.remove('hidden'); reviewActions?.classList.remove('hidden'); }
    const labels = {
      requesting: '正在请求麦克风权限…', recording: '正在聆听，松开结束', transcribing: 'Whisper 正在转写…',
      normalizing: '正在整理转写…', processing: 'Agent 正在处理…', speaking: '塞西正在回复…'
    };
    if (processing) processing.textContent = labels[state] || '';
    document.getElementById('petBall')?.classList.toggle('recording', state === 'recording');
  },

  showError(message) {
    this.stopCapture();
    this.setState('error', '语音链路失败');
    const box = document.getElementById('petVoiceError');
    if (box) box.textContent = String(message || '语音处理失败');
  },

  async startRecording() {
    this.cycle += 1;
    this.pendingStop = false;
    this.stopPlayback();
    await window.api.voice.stop().catch(() => {});
    this.action = null;
    this.pendingNormalization = null;
    const textBox = document.getElementById('petVoiceText');
    const rawBox = document.getElementById('petVoiceRaw');
    if (textBox) textBox.value = '';
    if (rawBox) rawBox.textContent = '';
    this.renderEditSummary(null);
    await this.refreshSettings();
    if (!this.config().enabled) {
      window.PetFloat.openVoice();
      this.showError('语音对话尚未开启，请先在工作台设置中开启。');
      return;
    }
    window.PetFloat.openVoice();
    this.setState('requesting', this.permissionReady ? '正在启动麦克风' : '正在检查麦克风权限');
    try {
      if (!this.permissionReady) {
        const permission = await window.api.voice.permission();
        if (!permission?.ok) throw new Error('麦克风权限未开启。请前往“系统设置 → 隐私与安全性 → 麦克风”允许科研工作台使用麦克风。');
        this.permissionReady = true;
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.permissionReady = true;
      try { localStorage.setItem('voice.microphone.granted', '1'); } catch (error) { /* memory cache still works */ }
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioCtx();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.chunks = [];
      this.processor.onaudioprocess = (event) => this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);
      this.setState('recording', '录音中 · 松开结束');
      this.maxTimer = setTimeout(() => this.stopRecording(), 90000);
      if (this.pendingStop) await this.stopRecording();
    } catch (error) {
      if (/permission|denied|notallowed|权限/i.test(`${error?.name || ''} ${error?.message || ''}`)) {
        this.permissionReady = false;
        try { localStorage.removeItem('voice.microphone.granted'); } catch (storageError) { /* ignore */ }
      }
      this.showError(error.message || '无法开始录音');
    }
  },

  requestStop() {
    if (this.state === 'requesting') { this.pendingStop = true; return; }
    if (this.state === 'recording') this.stopRecording();
  },

  stopCapture() {
    clearTimeout(this.maxTimer); this.maxTimer = null;
    try { this.processor?.disconnect(); } catch (error) { /* ignore */ }
    try { this.source?.disconnect(); } catch (error) { /* ignore */ }
    try { this.stream?.getTracks().forEach((track) => track.stop()); } catch (error) { /* ignore */ }
    try { this.context?.close(); } catch (error) { /* ignore */ }
    this.processor = null; this.source = null; this.stream = null; this.context = null;
  },

  async stopRecording() {
    if (this.state !== 'recording') return;
    const cycle = this.cycle;
    const rate = this.context?.sampleRate || 48000;
    const chunks = this.chunks.slice();
    this.stopCapture();
    try {
      const samples = this.merge(chunks);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length));
      if (samples.length < rate * .25 || rms < .004) throw new Error('没有检测到有效人声，请靠近麦克风后重试。');
      const pcm16k = this.resample(samples, rate, 16000);
      const wav = this.encodeWav(pcm16k, 16000);
      this.setState('transcribing', this.config().asr?.provider === 'remote' ? '远程 ASR 转写中' : '本地 Whisper 转写中');
      const glossary = await this.buildGlossary();
      const asr = await window.api.voice.transcribe(wav, undefined, { glossary });
      if (cycle !== this.cycle) return;
      if (!asr?.ok) throw new Error(asr?.error || '语音转写失败');
      const original = String(asr.text || '').trim();
      if (!original) throw new Error('没有检测到有效人声');
      this.setState('normalizing', '正在净化输入');
      const normalized = await window.api.voice.normalize(original, glossary);
      if (cycle !== this.cycle) return;
      const cleaned = String(normalized?.text || original).trim();
      document.getElementById('petVoiceText').value = cleaned;
      document.getElementById('petVoiceRaw').textContent = original;
      this.pendingNormalization = normalized || null;
      this.renderEditSummary(normalized);
      const timing = Number.isFinite(asr.elapsedMs) ? ` · ASR ${asr.elapsedMs}ms` : '';
      const route = asr.fallbackUsed ? ` · 已回退${asr.provider === 'remote' ? '远程' : '本地'}` : '';
      this.setState('review', `${normalized?.fallback ? '请确认原始转写' : '请确认智能整理结果'}${route}${timing}`);
      setTimeout(() => document.getElementById('petVoiceText')?.focus(), 80);
    } catch (error) { this.showError(error.message || '语音处理失败'); }
  },

  merge(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Float32Array(total);
    let offset = 0;
    chunks.forEach((chunk) => { result.set(chunk, offset); offset += chunk.length; });
    return result;
  },

  resample(input, sourceRate, targetRate) {
    if (sourceRate === targetRate) return input;
    const ratio = sourceRate / targetRate;
    const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
    for (let i = 0; i < output.length; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += input[j];
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  },

  encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const word = (offset, value) => view.setUint16(offset, value, true);
    const dword = (offset, value) => view.setUint32(offset, value, true);
    const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    ascii(0, 'RIFF'); dword(4, 36 + samples.length * 2); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    dword(16, 16); word(20, 1); word(22, 1); dword(24, sampleRate); dword(28, sampleRate * 2); word(32, 2); word(34, 16);
    ascii(36, 'data'); dword(40, samples.length * 2);
    samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
    return buffer;
  },

  async buildGlossary() {
    const words = [];
    for (const domain of ['projects', 'tasks', 'literature']) {
      try {
        const rows = await window.api.store.list(domain);
        rows.slice(-80).forEach((row) => {
          words.push(row.name || row.title);
          if (domain === 'literature' && row.authors) words.push(...String(row.authors).split(/[,;、，]/));
        });
      } catch (error) { /* ignore */ }
    }
    const cfg = this.config();
    const custom = cfg.glossary;
    if (Array.isArray(custom)) words.push(...custom);
    if (Array.isArray(cfg.learnedGlossary)) words.push(...cfg.learnedGlossary);
    const profile = this.settings.agentProfile || {};
    if (profile.preferredName) words.push(profile.preferredName);
    if (profile.role) words.push(profile.role);
    const seen = new Set();
    return words.map((word) => String(word || '').trim()).filter((word) => {
      if (word.length < 2 || word.length > 48) return false;
      const key = word.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 160);
  },

  renderEditSummary(normalized) {
    const box = document.getElementById('petVoiceEditSummary');
    if (!box) return;
    box.textContent = '';
    if (!normalized) { box.classList.add('hidden'); return; }
    const add = (text, className = '') => {
      const chip = document.createElement('span');
      chip.textContent = text;
      if (className) chip.className = className;
      box.appendChild(chip);
    };
    if (normalized.fallback) {
      const reason = String(normalized.reason || 'validation-failed');
      const labels = {
        disabled: '智能整理未开启',
        'ai-not-configured': '未配置整理模型',
        'invalid-json': '模型输出格式异常',
        'semantic-risk': '模型判断语义存在歧义',
        'items-empty': '待办结构不完整',
        'constraints-missing': '否定约束未进入结构字段',
        negation: '否定关系校验未通过',
        length: '整理结果长度异常'
      };
      const detail = labels[reason] || (reason.startsWith('date') ? '日期校验未通过'
        : reason.startsWith('number') ? '数字校验未通过'
          : reason.startsWith('information-loss') ? '有效信息保留不足' : '模型整理未通过审校');
      add(`安全回退 · ${detail}`, 'fallback');
    } else if (normalized.needsReview) add('存在歧义 · 请重点核对', 'fallback');
    box.classList.toggle('hidden', box.childElementCount === 0);
  },

  async rememberConfirmedCorrections(confirmedText) {
    const corrections = this.pendingNormalization?.fallback ? [] : (this.pendingNormalization?.corrections || []);
    const candidates = corrections.filter((item) =>
      item.to && item.to.length >= 2 && item.to.length <= 40 && String(confirmedText || '').includes(item.to) &&
      /(?:词表|专名|术语|人名|项目|任务|错别字|同音|拼写)/.test(item.reason || '')
    ).map((item) => item.to.trim());
    if (!candidates.length) return;
    const settings = await window.api.store.getSettings();
    const voiceConfig = settings.voiceConfig || {};
    const existing = Array.isArray(voiceConfig.learnedGlossary) ? voiceConfig.learnedGlossary : [];
    const learnedGlossary = [...new Set([...existing, ...candidates])].slice(-80);
    await window.api.store.saveSettings({ voiceConfig: { ...voiceConfig, learnedGlossary } });
    this.settings = await window.api.store.getSettings();
  },

  async sendConfirmed() {
    const text = document.getElementById('petVoiceText')?.value.trim();
    if (!text) { this.showError('确认文本不能为空'); return; }
    this.setState('processing', 'Agent 正在处理');
    this.action = null;
    try {
      await this.rememberConfirmedCorrections(text);
      // 确认后的内容进入既有桌宠会话；语音页只承担录音与转写确认，不另设 Agent 结果栏。
      window.PetFloat.openChat();
      await window.PetFloat.sendText(text, true, this.cycle);
    }
    catch (error) { this.onAgentEvent({ type: 'error', text: error.message || 'Agent 处理失败' }); }
  },

  onAgentEvent(event, cycle = this.cycle) {
    if (cycle !== this.cycle) return;
    if (!event || !event.type) return;
    const type = event.type;
    // 发送后已经回到原有桌宠会话：结果和确认卡由聊天栏唯一呈现，语音层仅负责播报。
    if (window.PetFloat?.mode === 'chat') {
      this.action = null;
      this.speak(event.text || '', type, false);
      return;
    }
    this.action = type === 'tool_confirmation' ? { confirm: event.confirm, cancel: event.cancel } : null;
    document.getElementById('petVoiceAgentType').textContent = String(type).replace(/_/g, ' ').toUpperCase();
    document.getElementById('petVoiceAgentText').textContent = this.displayText(event.text) || this.defaultEventText(type);
    this.setState('agent', type === 'tool_confirmation' ? '等待人工确认' : 'Agent 已返回');
    const confirm = document.getElementById('petVoiceConfirm');
    const reject = document.getElementById('petVoiceReject');
    confirm?.classList.toggle('hidden', type !== 'tool_confirmation');
    reject?.classList.toggle('hidden', type !== 'tool_confirmation');
    this.speak(event.text || '', type);
  },

  displayText(value) {
    return String(value || '')
      .replace(/```[\s\S]*?```/g, '[代码内容请在对话中查看]')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/[*_~`]/g, '')
      .trim();
  },

  defaultEventText(type) {
    return ({ tool_confirmation: '操作草案已经准备好，请确认。', tool_result: '操作已经完成。', cancelled: '操作已取消。', error: '处理失败，请查看对话详情。' })[type] || '详细内容已显示在对话中。';
  },

  async confirmAction() {
    const fn = this.action?.confirm;
    this.action = null;
    if (typeof fn === 'function') { this.setState('processing', '正在执行已确认操作'); await fn(); }
  },

  async rejectAction() {
    const fn = this.action?.cancel;
    this.action = null;
    if (typeof fn === 'function') await fn();
    else this.onAgentEvent({ type: 'cancelled', text: '已取消。' });
  },

  async speak(text, type, showVoiceState = true) {
    const cycle = this.cycle;
    const cfg = this.config();
    if (!cfg.enabled || cfg.tts?.enabled === false || cfg.tts?.agentReplyEnabled !== true) return;
    try {
      const result = await window.api.voice.synthesize(text, { type }, cfg.tts?.provider, cfg.tts?.profileId);
      if (cycle !== this.cycle) return;
      if (!result?.ok || !result.audioBase64) {
        if (showVoiceState) this.setState('agent', '文字已返回 · 语音播报不可用');
        return;
      }
      this.stopPlayback(false);
      this.audio = new Audio(`data:${result.mimeType || 'audio/wav'};base64,${result.audioBase64}`);
      this.audio.volume = Math.max(0, Math.min(1, Number(cfg.tts?.volume ?? .9)));
      this.audio.playbackRate = Math.max(.6, Math.min(1.6, Number(cfg.tts?.speed ?? 1)));
      if (showVoiceState) this.setState('speaking', `塞西正在播报${result.fallbackUsed ? ' · 已回退本地' : ''}`);
      this.audio.addEventListener('ended', () => {
        this.audio = null;
        if (showVoiceState && this.state === 'speaking') this.setState('agent', '播报完成');
      }, { once: true });
      await this.audio.play();
    } catch (error) { /* TTS 失败不影响文字结果与工具安全链路 */ }
  },

  stopPlayback(notifyMain = true) {
    if (this.audio) { this.audio.pause(); this.audio.src = ''; this.audio = null; }
    if (notifyMain) window.api.voice.stop().catch(() => {});
  },

  cancel() {
    this.cycle += 1;
    this.pendingStop = false;
    this.stopCapture();
    this.stopPlayback();
    this.action = null;
    this.pendingNormalization = null;
    document.getElementById('petVoiceText').value = '';
    document.getElementById('petVoiceRaw').textContent = '';
    this.renderEditSummary(null);
    this.setState('idle', '等待输入');
    window.PetFloat.closeVoice();
  }
};

window.VoiceController = VoiceController;
if (typeof module !== 'undefined' && module.exports) module.exports = { VoiceController };
