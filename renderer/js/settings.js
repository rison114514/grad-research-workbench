'use strict';

/* ============ 设置 ============ */

const Settings = {
  providers: [],

  async render() {
    this.providers = await window.api.ai.providers();
    const s = await window.api.store.getSettings();

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
});
