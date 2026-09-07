'use strict';

/* ============ 设置 ============ */

const Settings = {
  providers: [],

  async render() {
    this.providers = await window.api.ai.providers();
    const s = await window.api.store.getSettings();
    let appInfo = null;
    try { appInfo = await window.api.app.getVersion(); } catch (error) { /* browser */ }
    const voiceCard = document.getElementById('setVoiceCard');
    if (voiceCard) voiceCard.classList.toggle('hidden', !(appInfo && appInfo.platform === 'darwin'));

    const sel = document.getElementById('setProvider');
    sel.innerHTML = `
      <option value="custom">自定义服务商</option>
      ${this.providers.map((p) => `<option value="${p.id}">${App.esc(p.name)} — ${App.esc(p.desc)}</option>`).join('')}`;
    sel.value = s.aiProvider && s.aiProvider !== 'custom' ? s.aiProvider : 'custom';

    document.getElementById('setBaseUrl').value = s.aiBaseUrl || '';
    document.getElementById('setModel').value = s.aiModel || '';
    document.getElementById('setApiKey').value = s.aiApiKey || '';
    document.getElementById('setAgentContextTokens').value = s.agentContextTokens || 32000;
    document.getElementById('setAgentOutputTokens').value = s.agentMaxOutputTokens || 4096;
    document.getElementById('setAgentThinkingMode').value = s.aiThinkingMode || 'disabled';
    document.getElementById('setGhToken').value = s.githubToken || '';
    document.getElementById('setZoteroType').value = s.zoteroLibraryType || 'users';
    document.getElementById('setZoteroLibraryId').value = s.zoteroLibraryId || '';
    document.getElementById('setZoteroApiKey').value = s.zoteroApiKey || '';
    document.getElementById('setZoteroCollection').value = s.zoteroCollectionKey || '';
    const profile = s.agentProfile || {};
    document.getElementById('setAgentProfileEnabled').checked = !!profile.enabled;
    document.getElementById('setAgentName').value = profile.preferredName || '';
    document.getElementById('setAgentRole').value = profile.role || '';
    document.getElementById('setAgentWake').value = profile.wakeTime || '';
    document.getElementById('setAgentSleep').value = profile.sleepTime || '';
    document.getElementById('setAgentWorkHours').value = profile.workHours || '';
    document.getElementById('setAgentFocus').value = profile.focusPeriod || '';
    document.getElementById('setAgentNotes').value = profile.notes || '';

    const dir = await window.api.store.getDataDir();
    document.getElementById('setDataDir').textContent = dir;

    // 文献字号回填
    const litFont = ((s.literatureLayout || {}).fontSize) || 'medium';
    document.querySelectorAll('#setLitFont .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.f === litFont));

    // 桌面宠物回填
    document.getElementById('setPetEnabled').checked = !!s.petEnabled;
    const petCfg = s.petConfig || {};
    document.getElementById('setPetAvatar').value = petCfg.avatar || 'xaihi-half';
    document.getElementById('setPetPosition').value = petCfg.position || 'bottom-right';
    await this.renderVoice(s);
  },

  async renderVoice(settings) {
    const cfg = settings.voiceConfig || {};
    const asr = cfg.asr || {};
    const tts = cfg.tts || {};
    document.getElementById('setVoiceEnabled').checked = cfg.enabled !== false;
    document.getElementById('setVoiceCleanup').checked = cfg.cleanupEnabled !== false;
    document.getElementById('setVoiceAsrProvider').value = asr.provider || 'local';
    document.getElementById('setVoiceAsrLocalModel').value = asr.localModel === 'ggml-large-v3-turbo-q5_0.bin'
      ? 'ggml-large-v3-turbo-q5_0.bin' : 'ggml-small-q5_1.bin';
    document.getElementById('setVoiceAsrFallback').checked = asr.fallbackEnabled !== false;
    document.getElementById('setVoiceAsrLanguage').value = asr.language || 'zh';
    document.getElementById('setVoiceAsrBase').value = asr.remoteBaseUrl || '';
    document.getElementById('setVoiceAsrKey').value = asr.remoteApiKey || '';
    document.getElementById('setVoiceAsrModel').value = asr.remoteModel || 'gpt-4o-mini-transcribe';
    document.getElementById('setVoiceGlossary').value = Array.isArray(cfg.glossary) ? cfg.glossary.join('、') : '';
    const learnedCount = Array.isArray(cfg.learnedGlossary) ? cfg.learnedGlossary.length : 0;
    document.getElementById('setVoiceLearnedGlossaryStatus').textContent = learnedCount
      ? `本地已学习 ${learnedCount} 个专有词。` : '尚未学习专有词。';
    document.getElementById('setVoiceTtsProvider').value = tts.provider || 'cosy';
    document.getElementById('setVoiceAgentTts').checked = tts.agentReplyEnabled === true;
    document.getElementById('setVoiceTtsFallback').checked = tts.fallbackEnabled !== false;
    document.getElementById('setVoiceCosyKey').value = tts.cosyApiKey || '';
    document.getElementById('setVoiceCosyWorkspace').value = tts.cosyWorkspaceId || '';
    document.getElementById('setVoiceTtsBase').value = tts.customBaseUrl || '';
    document.getElementById('setVoiceTtsKey').value = tts.customApiKey || '';
    document.getElementById('setVoiceTtsModel').value = `${tts.customModel || 'tts-1'} / ${tts.customVoice || 'alloy'}`;
    document.getElementById('setVoiceLocalModel').value = tts.localModel || 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit';
    document.getElementById('setVoiceLocalMode').value = tts.localMode || 'zero_shot';
    document.getElementById('setVoiceLocalSpeaker').value = tts.localSpeaker || 'Xaihi';
    document.getElementById('setVoiceLocalInstruct').value = tts.localInstruct || '沉稳、温柔、清晰的中文女声';
    document.getElementById('setVoiceVolume').value = tts.volume ?? .9;
    document.getElementById('setVoiceSpeed').value = tts.speed ?? 1;
    const statusCount = Object.values(tts.statusAudio || {}).filter(Boolean).length;
    document.getElementById('setVoiceStatusAudioHint').textContent = statusCount
      ? `已配置 ${statusCount}/4 条预制状态语音；其余状态使用当前塞西声线生成。`
      : '未提供时，会用当前塞西声线生成一次并缓存。';
    const builtinProfile = { id: 'builtin-Xaihi', name: 'Xaihi · 塞西内置参考音色', provider: 'local' };
    let profiles = [];
    try { profiles = await window.api.store.list('voiceProfiles'); } catch (error) { /* new domain may be empty */ }
    profiles = [builtinProfile, ...profiles.filter((profile) => profile.id !== builtinProfile.id)];
    this.voiceProfiles = profiles;
    const select = document.getElementById('setVoiceProfile');
    select.innerHTML = '<option value="">尚未选择</option>' + profiles.map((profile) => `<option value="${App.esc(profile.id)}">${App.esc(profile.name)} · ${App.esc(profile.provider)}</option>`).join('');
    select.value = tts.profileId || builtinProfile.id;
    this.toggleVoiceProviderFields();
    await this.refreshVoiceRuntime();
  },

  voiceConfigFromForm(existing = {}) {
    const providerModel = document.getElementById('setVoiceTtsModel').value.split('/').map((part) => part.trim());
    return {
      ...existing,
      enabled: document.getElementById('setVoiceEnabled').checked,
      cleanupEnabled: document.getElementById('setVoiceCleanup').checked,
      confirmBeforeSend: true,
      glossary: document.getElementById('setVoiceGlossary').value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 120),
      asr: {
        ...(existing.asr || {}), provider: document.getElementById('setVoiceAsrProvider').value,
        fallbackEnabled: document.getElementById('setVoiceAsrFallback').checked,
        fallbackProvider: 'remote',
        localModel: document.getElementById('setVoiceAsrLocalModel').value,
        language: document.getElementById('setVoiceAsrLanguage').value,
        remoteBaseUrl: document.getElementById('setVoiceAsrBase').value.trim(),
        remoteApiKey: document.getElementById('setVoiceAsrKey').value.trim(),
        remoteModel: document.getElementById('setVoiceAsrModel').value.trim() || 'gpt-4o-mini-transcribe'
      },
      tts: {
        ...(existing.tts || {}), enabled: true,
        agentReplyEnabled: document.getElementById('setVoiceAgentTts').checked,
        provider: document.getElementById('setVoiceTtsProvider').value,
        fallbackEnabled: document.getElementById('setVoiceTtsFallback').checked,
        fallbackProvider: 'local',
        profileId: document.getElementById('setVoiceProfile').value,
        volume: Math.max(0, Math.min(1, Number(document.getElementById('setVoiceVolume').value) || 0)),
        speed: Math.max(.6, Math.min(1.6, Number(document.getElementById('setVoiceSpeed').value) || 1)),
        cosyApiKey: document.getElementById('setVoiceCosyKey').value.trim(),
        cosyWorkspaceId: document.getElementById('setVoiceCosyWorkspace').value.trim(),
        customBaseUrl: document.getElementById('setVoiceTtsBase').value.trim(),
        customApiKey: document.getElementById('setVoiceTtsKey').value.trim(),
        customModel: providerModel[0] || 'tts-1', customVoice: providerModel[1] || 'alloy',
        localModel: document.getElementById('setVoiceLocalModel').value.trim() || 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit',
        localMode: document.getElementById('setVoiceLocalMode').value,
        localSpeaker: document.getElementById('setVoiceLocalSpeaker').value.trim() || 'Xaihi',
        localInstruct: document.getElementById('setVoiceLocalInstruct').value.trim()
      }
    };
  },

  async saveVoice(showToast = true) {
    const settings = await window.api.store.getSettings();
    const voiceConfig = this.voiceConfigFromForm(settings.voiceConfig || {});
    await window.api.store.saveSettings({ voiceConfig });
    App.state.settings = await window.api.store.getSettings();
    if (showToast) App.toast('塞西语音配置已保存', 'ok');
    return voiceConfig;
  },

  async clearLearnedVoiceGlossary() {
    const settings = await window.api.store.getSettings();
    const voiceConfig = { ...(settings.voiceConfig || {}), learnedGlossary: [] };
    await window.api.store.saveSettings({ voiceConfig });
    App.state.settings = await window.api.store.getSettings();
    document.getElementById('setVoiceLearnedGlossaryStatus').textContent = '尚未学习专有词。';
    App.toast('已清空语音整理的本地学习词典', 'ok');
  },

  toggleVoiceProviderFields() {
    const asr = document.getElementById('setVoiceAsrProvider').value;
    const tts = document.getElementById('setVoiceTtsProvider').value;
    document.getElementById('setVoiceAsrRemote').classList.remove('hidden');
    document.getElementById('setVoiceCosyFields').classList.toggle('hidden', tts !== 'cosy');
    document.getElementById('setVoiceCustomFields').classList.toggle('hidden', tts !== 'custom');
    document.getElementById('setVoiceLocalFields').classList.remove('hidden');
  },

  async pickVoiceModel() {
    const modelPath = await window.api.dialog.pickVoiceModelFolder();
    if (!modelPath) return;
    document.getElementById('setVoiceLocalModel').value = modelPath;
    await this.validateVoiceModel();
  },

  async validateVoiceModel() {
    const resultEl = document.getElementById('setVoiceLocalModelResult');
    const response = await window.api.voice.validateLocalModel({
      model: document.getElementById('setVoiceLocalModel').value.trim(),
      mode: document.getElementById('setVoiceLocalMode').value
    });
    resultEl.textContent = response?.ok
      ? `模型接口可用 · ${response.type === 'path' ? response.path : response.model} · ${response.mode}`
      : (response?.error || '本地模型校验失败');
    resultEl.style.color = response?.ok ? 'var(--green)' : 'var(--red)';
    return response;
  },

  async pickVoiceReference() {
    const path = await window.api.dialog.pickAudio();
    if (path) document.getElementById('setVoiceReferencePath').value = path;
  },

  async enrollVoice() {
    const provider = document.getElementById('setVoiceEnrollProvider').value;
    if (provider === 'cosy' && !confirm('这会将你填写的 HTTPS 参考音频地址提交给阿里云 CosyVoice，用于创建云端音色。是否继续？')) return;
    await this.saveVoice(false);
    const resultEl = document.getElementById('setVoiceEnrollResult');
    resultEl.textContent = '正在创建声音档案…';
    const response = await window.api.voice.enroll({
      name: document.getElementById('setVoiceProfileName').value.trim() || '塞西',
      referencePath: document.getElementById('setVoiceReferencePath').value.trim(),
      referenceText: document.getElementById('setVoiceReferenceText').value.trim(),
      audioUrl: document.getElementById('setVoiceRemoteUrl').value.trim(),
      prefix: document.getElementById('setVoiceProfileName').value.trim() || 'xaihi'
    }, provider);
    if (!response?.ok) { resultEl.textContent = response?.error || '创建失败'; resultEl.style.color = 'var(--red)'; return; }
    resultEl.textContent = '声音档案已创建'; resultEl.style.color = 'var(--green)';
    const settings = await window.api.store.getSettings();
    settings.voiceConfig = this.voiceConfigFromForm(settings.voiceConfig || {});
    settings.voiceConfig.tts.profileId = response.profile.id;
    await window.api.store.saveSettings({ voiceConfig: settings.voiceConfig });
    await this.renderVoice(await window.api.store.getSettings());
  },

  async autoConfigureCosy() {
    const resultEl = document.getElementById('setVoiceAutoCosyResult');
    const button = document.getElementById('setVoiceAutoCosy');
    const apiKey = document.getElementById('setVoiceCosyKey').value.trim();
    if (!apiKey) {
      resultEl.textContent = '请先填写 CosyVoice API Key。';
      resultEl.style.color = 'var(--red)';
      return;
    }
    if (!confirm('将使用内置 Xaihi 参考音频连接阿里云，并在没有可复用音色时创建新的 Voice ID。云端处理受阿里云数据政策与计费规则约束，是否继续？')) return;
    button.disabled = true;
    resultEl.style.color = '';
    resultEl.textContent = '正在检测连接与已有 Xaihi 音色…';
    try {
      const cfg = await this.saveVoice(false);
      const selected = (this.voiceProfiles || []).find((item) => item.id === cfg.tts.profileId);
      const response = await window.api.voice.autoConfigureCosy({
        sourceProfileId: cfg.tts.profileId || 'builtin-Xaihi',
        name: selected?.name || 'Xaihi',
        audioUrl: document.getElementById('setVoiceRemoteUrl').value.trim()
      });
      if (!response?.configured) {
        resultEl.textContent = response?.error || '自动配置失败';
        resultEl.style.color = 'var(--red)';
        return;
      }
      await this.renderVoice(await window.api.store.getSettings());
      if (!response.ok) {
        resultEl.textContent = `Voice ID 已保存，但试听失败：${response.error || '未返回音频'}`;
        resultEl.style.color = 'var(--red)';
        return;
      }
      const audio = new Audio(`data:${response.mimeType || 'audio/wav'};base64,${response.audioBase64}`);
      audio.volume = cfg.tts.volume;
      audio.playbackRate = cfg.tts.speed;
      await audio.play();
      resultEl.textContent = `${response.reused ? '已复用' : '已创建'} Xaihi Voice ID 并完成试听 · ${response.elapsedMs}ms`;
      resultEl.style.color = 'var(--green)';
    } catch (error) {
      resultEl.textContent = error?.message || '自动配置失败';
      resultEl.style.color = 'var(--red)';
    } finally {
      button.disabled = false;
    }
  },

  async pickVoiceStatusAudio(statusType) {
    const referencePath = await window.api.dialog.pickAudio();
    if (!referencePath) return;
    const response = await window.api.voice.enroll({ name: `塞西状态短句 · ${statusType}`, referencePath, statusType }, 'status');
    if (!response?.ok) { App.toast(response?.error || '状态短句导入失败', 'error'); return; }
    const settings = await window.api.store.getSettings();
    const voiceConfig = this.voiceConfigFromForm(settings.voiceConfig || {});
    voiceConfig.tts.statusAudio = { ...(settings.voiceConfig?.tts?.statusAudio || {}), [statusType]: response.profile.referencePath };
    await window.api.store.saveSettings({ voiceConfig });
    App.toast('预制状态短句已保存到本地声音档案', 'ok');
    await this.renderVoice(await window.api.store.getSettings());
  },

  async refreshVoiceRuntime() {
    const el = document.getElementById('setVoiceRuntimeStatus');
    if (!el || !window.api.voice) return;
    const status = await window.api.voice.runtimeStatus();
    if (!status?.appleSilicon) { el.textContent = '本地语音运行环境仅支持 Apple Silicon macOS；远程服务仍可配置。'; return; }
    const asr = status.asr || {};
    const tts = status.tts || {};
    const size = asr.modelSize ? `${(asr.modelSize / 1024 / 1024).toFixed(1)} MB` : '0 MB';
    const modelName = asr.selectedModel === 'ggml-large-v3-turbo-q5_0.bin' ? 'LARGE-V3-TURBO Q5' : 'SMALL Q5';
    const checksum = asr.modelSha256 ? asr.modelSha256.slice(0, 16) + '…' : '待校验';
    const modelState = tts.modelValidation?.ok ? 'MODEL INTERFACE READY' : 'MODEL INTERFACE INVALID';
    el.textContent = `WHISPER ${modelName} · ${asr.executableReady ? 'BIN READY' : 'BIN MISSING'} · ${asr.modelReady ? `MODEL READY ${size}` : 'MODEL MISSING'} · SHA-256 ${checksum} · ${asr.vadReady ? 'VAD READY' : 'VAD MISSING'}\nMLX TTS  ${tts.environmentReady ? 'ENV READY' : 'ENV NOT READY'} · ${modelState} · UV ${tts.uv ? 'READY' : 'MISSING'} · ${tts.workerRunning ? 'RUNNING' : 'STOPPED'}`;
  },

  async prepareVoiceRuntime() {
    const result = document.getElementById('setVoiceResult');
    // Persist the model selector before asking the main process to prepare it.
    // Otherwise a user can switch models and immediately click this button,
    // while the main process still sees the previously saved model.
    await this.saveVoice(false);
    result.textContent = '准备中，请勿退出应用…';
    const response = await window.api.voice.prepareRuntime({ asr: true, tts: true, preloadTts: true });
    result.textContent = response?.ok ? '本地环境已准备' : (response?.error || '准备失败');
    result.style.color = response?.ok ? 'var(--green)' : 'var(--red)';
    await this.refreshVoiceRuntime();
  },

  async testVoice(providerOverride = '') {
    const cfg = await this.saveVoice(false);
    const result = document.getElementById('setVoiceResult');
    let provider = providerOverride || cfg.tts.provider;
    if (provider === 'remote') provider = cfg.tts.provider === 'local' ? 'cosy' : cfg.tts.provider;
    const providerProfile = (this.voiceProfiles || []).find((item) => item.provider === provider);
    const profileId = providerProfile?.id || cfg.tts.profileId;
    result.textContent = `正在生成 ${provider === 'local' ? 'A / 本地' : 'B / 远程'} 试听样本…`;
    const response = await window.api.voice.test(provider, profileId);
    if (!response?.ok) { result.textContent = response?.error || '试听失败'; result.style.color = 'var(--red)'; return; }
    const audio = new Audio(`data:${response.mimeType || 'audio/wav'};base64,${response.audioBase64}`);
    audio.volume = cfg.tts.volume;
    audio.playbackRate = cfg.tts.speed;
    await audio.play();
    result.textContent = `${provider === 'local' ? 'A / 本地' : 'B / 远程'} 已播放 · 首包 ${response.firstPacketMs}ms / 整体 ${response.elapsedMs}ms`;
    result.style.color = 'var(--green)';
  },

  /* 文献字号三档 */
  async saveLitFont(size) {
    const s = await window.api.store.getSettings();
    const layout = s.literatureLayout || {};
    layout.fontSize = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
    await window.api.store.saveSettings({ literatureLayout: layout });
    if (window.LiteratureLayout) LiteratureLayout.setFontSize(layout.fontSize);
  },

  /* 桌面宠物：开关/头像/位置（同步 Pet 内存态，立即生效） */
  async savePet(patch) {
    const s = await window.api.store.getSettings();
    const cfg = { ...(s.petConfig || {}), ...(patch.petConfig || {}) };
    await window.api.store.saveSettings({ petEnabled: patch.enabled, petConfig: cfg });
    // 桌面版：联动系统级悬浮球窗口（创建/销毁）；浏览器预览降级应用内浮窗
    if (window.api.pet && typeof window.api.pet.setEnabled === 'function') {
      await window.api.pet.setEnabled(!!patch.enabled);
    }
    if (window.Pet) {
      Pet.state.enabled = !!patch.enabled;
      Pet.state.config = { ...(Pet.state.config || {}), ...cfg };
      Pet.applyConfig();
    }
  },

  /* 桌面宠物：选择自定义图片 */
  async pickPetImage() {
    const r = await window.api.dialog.pickImage();
    if (!r || !r.ok) { if (r && r.error) App.toast(r.error, 'error'); return; }
    let dataUri = r.dataUri || '';
    if (!dataUri && r.path) {
      const img = await window.api.fs.readImage(r.path);
      if (!img.ok) { App.toast(img.error || '读取图片失败', 'error'); return; }
      dataUri = img.dataUri;
    }
    await this.savePet({ enabled: document.getElementById('setPetEnabled').checked, petConfig: { avatar: 'custom', customPath: dataUri } });
    document.getElementById('setPetAvatar').value = 'custom';
    App.toast('自定义头像已应用', 'ok');
  },

  async applyProvider() {
    const id = document.getElementById('setProvider').value;
    const p = this.providers.find((x) => x.id === id);
    if (p) {
      document.getElementById('setBaseUrl').value = p.baseUrl;
      document.getElementById('setModel').value = p.model;
      document.getElementById('setApiKey').value = document.getElementById('setApiKey').value; // 保留已填 Key
    }
  },

  async saveAI() {
    const provider = document.getElementById('setProvider').value;
    const contextTokens = Math.max(4000, Math.min(800000, Number(document.getElementById('setAgentContextTokens').value) || 32000));
    const outputTokens = Math.max(1024, Math.min(32768, Number(document.getElementById('setAgentOutputTokens').value) || 4096));
    await window.api.store.saveSettings({
      aiProvider: provider === 'custom' ? 'custom' : provider,
      aiBaseUrl: document.getElementById('setBaseUrl').value.trim(),
      aiModel: document.getElementById('setModel').value.trim(),
      aiApiKey: document.getElementById('setApiKey').value.trim(),
      agentContextTokens: Math.round(contextTokens),
      agentMaxOutputTokens: Math.round(outputTokens),
      aiThinkingMode: document.getElementById('setAgentThinkingMode').value === 'enabled' ? 'enabled' : 'disabled'
    });
    App.state.settings = await window.api.store.getSettings();
    await App.updateAiStatus();
    App.toast('AI 配置已保存', 'ok');
  },

  async testAI() {
    await this.saveAI();
    const result = document.getElementById('setTestResult');
    result.textContent = '测试中…';
    const r = await window.api.ai.test(await window.api.store.getSettings());
    if (r.ok) {
      result.textContent = '✅ 连接成功';
      result.style.color = 'var(--green)';
    } else {
      result.textContent = `❌ ${r.error}`;
      result.style.color = 'var(--red)';
    }
  },

  async saveGh() {
    await window.api.store.saveSettings({ githubToken: document.getElementById('setGhToken').value.trim() });
    App.state.settings = await window.api.store.getSettings();
    App.toast('GitHub 配置已保存', 'ok');
  },

  async saveAgentProfile() {
    const agentProfile = {
      enabled: document.getElementById('setAgentProfileEnabled').checked,
      preferredName: document.getElementById('setAgentName').value.trim(),
      role: document.getElementById('setAgentRole').value.trim(),
      wakeTime: document.getElementById('setAgentWake').value,
      sleepTime: document.getElementById('setAgentSleep').value,
      workHours: document.getElementById('setAgentWorkHours').value.trim(),
      focusPeriod: document.getElementById('setAgentFocus').value.trim(),
      notes: document.getElementById('setAgentNotes').value.trim().slice(0, 240)
    };
    await window.api.store.saveSettings({ agentProfile });
    App.state.settings = await window.api.store.getSettings();
    App.toast(agentProfile.enabled ? 'Agent 个性化资料已启用' : '资料已保存，当前未授权给 Agent', 'ok');
  },

  zoteroConfig() {
    return {
      libraryType: document.getElementById('setZoteroType').value,
      libraryId: document.getElementById('setZoteroLibraryId').value.trim(),
      apiKey: document.getElementById('setZoteroApiKey').value.trim(),
      collectionKey: document.getElementById('setZoteroCollection').value.trim()
    };
  },

  async saveZotero() {
    const config = this.zoteroConfig();
    await window.api.store.saveSettings({
      zoteroLibraryType: config.libraryType,
      zoteroLibraryId: config.libraryId,
      zoteroApiKey: config.apiKey,
      zoteroCollectionKey: config.collectionKey
    });
    return config;
  },

  async testZotero() {
    const result = document.getElementById('setZoteroResult');
    const config = await this.saveZotero();
    result.textContent = '正在测试只读连接…';
    const response = await window.api.zotero.test(config);
    if (response.ok) {
      result.textContent = `连接成功 · ${response.total} 条记录`;
      result.style.color = '#278a4f';
    } else {
      result.textContent = response.error || '连接失败';
      result.style.color = 'var(--red)';
    }
  },

  async syncZotero() {
    const config = await this.saveZotero();
    const taskId = await AgentTasks.start('Zotero 只读同步', '验证文献库读取权限', {
      kind: 'zotero-sync', goal: '将 Zotero 文献条目安全地只读同步到文献中心',
      steps: ['验证读取权限', '获取文献条目与分类层级', '构建 Zotero 同步分类树', '按 DOI、标题与 Zotero Key 去重', '写入本地文献中心', '验证同步结果']
    });
    const result = document.getElementById('setZoteroResult');
    result.textContent = '正在同步…';
    try {
      await AgentTasks.update(taskId, 20, '获取文献条目与分类层级');
      const response = await window.api.zotero.sync(config);
      if (!response.ok) throw new Error(response.error || 'Zotero 同步失败');
      await AgentTasks.update(taskId, 38, '构建 Zotero 同步分类树');
      // 1) 建树（幂等）：根分类「{用户名} 的 Zotero 同步」+ 按 zoteroKey 建 collection 层级
      const colMap = await this.ensureZoteroTree(response.collections || [], response.userName || String(config.libraryId || ''));
      await AgentTasks.update(taskId, 52, '按 DOI、标题与 Zotero Key 去重');
      // 2) 条目去重 + 分类关联 + 批量写入
      const local = await window.api.store.list('literature');
      const toCreate = [];
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      for (const remote of response.items || []) {
        const doi = this.normalizeDoi(remote.doi);
        const title = this.normalizeTitle(remote.title);
        const existing = local.find((item) =>
          (remote.zoteroKey && item.zoteroKey === remote.zoteroKey) ||
          (doi && this.normalizeDoi(item.doi) === doi) ||
          (title && this.normalizeTitle(item.title) === title)
        );
        const collectionIds = (remote.zoteroCollectionKeys || []).map((k) => colMap.get(k)).filter(Boolean);
        const payload = {
          title: remote.title, authors: remote.authors, venue: remote.venue, year: remote.year,
          doi: remote.doi, abstract: remote.abstract, tags: (remote.tags || []).join(', '),
          zoteroKey: remote.zoteroKey, zoteroVersion: remote.zoteroVersion,
          zoteroCollections: remote.collections || [], zoteroCollectionKeys: remote.zoteroCollectionKeys || [],
          collectionIds, source: 'zotero', zoteroReadOnly: true
        };
        if (existing) {
          if (existing.zoteroVersion === remote.zoteroVersion && existing.zoteroKey === remote.zoteroKey) { skipped += 1; continue; }
          await window.api.store.update('literature', existing.id, payload);
          Object.assign(existing, payload);
          updated += 1;
        } else {
          toCreate.push({ ...payload, summary: null });
        }
      }
      if (toCreate.length) {
        const created = await window.api.store.batchCreate('literature', toCreate);
        local.push(...created);
        imported = created.length;
      }
      await AgentTasks.update(taskId, 86, '验证同步结果');
      const validation = [
        { label: '未向 Zotero 发起写入请求', passed: true },
        { label: '完成重复条目检查', passed: true },
        { label: '本地导入结果可追踪', passed: imported + updated + skipped === (response.items || []).length }
      ];
      const summary = `新增 ${imported} 条，更新 ${updated} 条，跳过 ${skipped} 条重复或未变化记录。`;
      await window.api.store.saveSettings({ zoteroLastSyncAt: new Date().toISOString(), zoteroLibraryVersion: response.libraryVersion || null });
      await AgentTasks.complete(taskId, 'Zotero 只读同步完成', { summary }, validation);
      result.textContent = summary;
      result.style.color = '#278a4f';
      if (window.Literature) await window.Literature.render();
      App.toast(`Zotero 同步完成：${summary}`, 'ok');
    } catch (error) {
      await AgentTasks.needsInput(taskId, 'Zotero 同步需要处理', error.message);
      result.textContent = error.message;
      result.style.color = 'var(--red)';
      App.toast(error.message, 'error');
    }
  },

  /** 构建 Zotero 同步分类树（幂等：重复同步不重复建节点），返回 zoteroKey → 本地分类 id */
  async ensureZoteroTree(collections, userName) {
    const cols = await window.api.store.list('litCollections');
    const rootName = `${userName} 的 Zotero 同步`;
    let root = cols.find((c) => c.source === 'zotero' && c.zoteroKey === 'ROOT');
    if (!root) {
      root = await window.api.store.create('litCollections', { name: rootName, parentId: null, order: 0, source: 'zotero', zoteroKey: 'ROOT', readOnly: true });
      cols.push(root);
    } else if (root.name !== rootName) {
      await window.api.store.update('litCollections', root.id, { name: rootName });
    }
    const map = new Map();
    const nodes = {};
    // 第一轮：按 zoteroKey 幂等建节点（parentId 暂不设置）
    for (const c of collections || []) {
      let local = cols.find((x) => x.source === 'zotero' && x.zoteroKey === c.key);
      if (!local) {
        local = await window.api.store.create('litCollections', { name: c.name, parentId: null, order: 0, source: 'zotero', zoteroKey: c.key, readOnly: true });
        cols.push(local);
      } else if (local.name !== c.name) {
        await window.api.store.update('litCollections', local.id, { name: c.name });
      }
      nodes[c.key] = local.id;
      map.set(c.key, local.id);
    }
    // 第二轮：设置父子关系（顶层挂根分类下）
    for (const c of collections || []) {
      const localId = nodes[c.key];
      const parentId = c.parentKey && nodes[c.parentKey] ? nodes[c.parentKey] : root.id;
      const cur = cols.find((x) => x.id === localId);
      if (cur && cur.parentId !== parentId) {
        await window.api.store.update('litCollections', localId, { parentId });
      }
    }
    return map;
  },

  normalizeDoi(value) {
    return String(value || '').toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').trim();
  },

  normalizeTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }
};

window.Settings = Settings;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('setProvider').addEventListener('change', () => Settings.applyProvider());
  document.getElementById('setSave').addEventListener('click', () => Settings.saveAI());
  document.getElementById('setTest').addEventListener('click', () => Settings.testAI());
  document.getElementById('setGhSave').addEventListener('click', () => Settings.saveGh());
  document.getElementById('setAgentProfileSave').addEventListener('click', () => Settings.saveAgentProfile());
  document.getElementById('setZoteroTest').addEventListener('click', () => Settings.testZotero());
  document.getElementById('setZoteroSync').addEventListener('click', () => Settings.syncZotero());
  document.getElementById('setOpenDir').addEventListener('click', () => window.api.store.openDataDir());
  document.getElementById('setBackup').addEventListener('click', async () => {
    const dir = await window.api.store.backup();
    App.toast(`备份完成：${dir}`, 'ok');
  });
  document.getElementById('setLitFont').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#setLitFont .seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    Settings.saveLitFont(btn.dataset.f);
  });
  /* 桌面宠物事件 */
  document.getElementById('setPetEnabled').addEventListener('change', (e) => {
    Settings.savePet({ enabled: e.target.checked });
    App.toast(e.target.checked ? '桌面宠物已启用' : '桌面宠物已关闭', e.target.checked ? 'ok' : 'info');
  });
  document.getElementById('setPetAvatar').addEventListener('change', (e) => {
    if (e.target.value === 'custom') { Settings.pickPetImage(); return; }
    Settings.savePet({ enabled: document.getElementById('setPetEnabled').checked, petConfig: { avatar: e.target.value } });
  });
  document.getElementById('setPetPosition').addEventListener('change', (e) => {
    Settings.savePet({ enabled: document.getElementById('setPetEnabled').checked, petConfig: { position: e.target.value } });
  });
  document.getElementById('setPetPick').addEventListener('click', () => Settings.pickPetImage());
  /* 塞西语音 Agent */
  document.getElementById('setVoiceAsrProvider').addEventListener('change', () => Settings.toggleVoiceProviderFields());
  document.getElementById('setVoiceTtsProvider').addEventListener('change', () => Settings.toggleVoiceProviderFields());
  document.getElementById('setVoicePickRef').addEventListener('click', () => Settings.pickVoiceReference());
  document.getElementById('setVoicePickModel').addEventListener('click', () => Settings.pickVoiceModel());
  document.getElementById('setVoiceValidateModel').addEventListener('click', () => Settings.validateVoiceModel());
  document.getElementById('setVoiceLocalMode').addEventListener('change', () => Settings.validateVoiceModel());
  document.getElementById('setVoiceEnroll').addEventListener('click', () => Settings.enrollVoice());
  document.getElementById('setVoiceAutoCosy').addEventListener('click', () => Settings.autoConfigureCosy());
  document.getElementById('setVoiceSave').addEventListener('click', () => Settings.saveVoice());
  document.getElementById('setVoiceClearLearnedGlossary').addEventListener('click', () => Settings.clearLearnedVoiceGlossary());
  document.getElementById('setVoicePrepare').addEventListener('click', () => Settings.prepareVoiceRuntime());
  document.getElementById('setVoiceTest').addEventListener('click', () => Settings.testVoice());
  document.getElementById('setVoiceTestLocal').addEventListener('click', () => Settings.testVoice('local'));
  document.getElementById('setVoiceTestRemote').addEventListener('click', () => Settings.testVoice('remote'));
  document.querySelectorAll('[data-voice-status]').forEach((button) => button.addEventListener('click', () => Settings.pickVoiceStatusAudio(button.dataset.voiceStatus)));
  if (window.api.voice?.onRuntimeProgress) {
    window.api.voice.onRuntimeProgress((progress) => {
      const el = document.getElementById('setVoiceResult');
      if (!el) return;
      const percent = Number.isFinite(progress?.progress) ? ` ${progress.progress}%` : '';
      el.textContent = `${progress?.detail || progress?.stage || '处理中'}${percent}`;
    });
  }
});
