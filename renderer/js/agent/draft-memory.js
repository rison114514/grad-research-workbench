'use strict';

/* 结构化草案与授权用户资料：浏览器/Electron 共用，Node 测试可直接 require。 */
(function installDraftMemory(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AgentDraftMemory = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const SAVE_REFERENCE_RE = /(?:保存|存下|记下来|采用|应用|就按这个|就这样|由你来保存)/;
  const SAVE_NEGATIVE_RE = /(?:不要|不用|别|取消|暂不|先不).{0,4}(?:保存|存下|采用|应用)/;

  function cleanLine(value) {
    return String(value || '')
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s*)/, '')
      .replace(/\*\*/g, '')
      .trim();
  }

  function toTime(hour, minute) {
    const h = Math.max(0, Math.min(23, Number(hour)));
    const m = Math.max(0, Math.min(59, Number(minute)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function itemType(title) {
    const text = String(title || '');
    if (/(?:会议|组会|沟通|协作)/.test(text)) return 'meeting';
    if (/(?:学习|阅读|论文|课程|外语|复盘|研究)/.test(text)) return 'study';
    if (/(?:工作|邮件|任务|项目|整理|汇报)/.test(text)) return 'work';
    if (/(?:休息|午休|自由|睡|洗漱|起床|早餐|午餐|晚餐|运动|健身|散步|娱乐)/.test(text)) return 'rest';
    return 'life';
  }

  function extractDailyTemplateDraft(content) {
    const text = String(content || '');
    if (!/(?:每日计划|作息|工作日版|时间安排)/.test(text)) return null;
    const items = [];
    const seen = new Set();
    const range = /^\s*(?:[-*+]\s*)?(\d{1,2}):(\d{2})\s*[–—－~～-]\s*(\d{1,2}):(\d{2})\s+(.+?)\s*$/gm;
    let match;
    while ((match = range.exec(text))) {
      const startTime = toTime(match[1], match[2]);
      const endTime = toTime(match[3], match[4]);
      const raw = cleanLine(match[5]);
      const title = raw.replace(/\s*[（(].*?[）)]\s*$/, '').trim() || raw;
      const key = `${startTime}|${title}`;
      if (!title || seen.has(key)) continue;
      seen.add(key);
      items.push({ startTime, endTime, title, type: itemType(title), ...(raw !== title ? { note: raw } : {}) });
    }
    // 至少三个明确时间块才视为可保存的每日模板，避免把普通回答误判成草案。
    if (items.length < 3) return null;
    const heading = text.split('\n').map(cleanLine).find((line) => /每日计划/.test(line) && line.length <= 40);
    const name = (heading || (/工作日/.test(text) ? '每日计划（工作日版）' : '每日计划')).replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, '');
    const frequency = /工作日|周一至周五|周内/.test(text) ? 'weekdays' : (/周末|周六日/.test(text) ? 'weekend' : 'everyday');
    return {
      kind: 'structured_draft', draftType: 'dailyTemplate', action: 'createDailyTemplate',
      params: { name, frequency, items }, draft: true, confirmed: false, draftStatus: 'open'
    };
  }

  function isSaveReference(text) {
    const value = String(text || '').replace(/[\s，。！？!?,、]/g, '');
    if (!value || value.length > 28 || SAVE_NEGATIVE_RE.test(value)) return false;
    return SAVE_REFERENCE_RE.test(value) || /^(?:可以|好的|确认|没问题)$/.test(value);
  }

  function shouldReferenceDraft(text) {
    const value = String(text || '');
    if (isSaveReference(value)) return true;
    return /(?:刚才|上一轮|上面|这份|这个|该草案|原计划)/.test(value)
      && /(?:计划|草案|修改|调整|改成|删掉|增加|保存|应用)/.test(value);
  }

  function isPlanningRequest(text) {
    const value = String(text || '');
    return /(?:规划|制定|设计|安排|生成).{0,10}(?:每日计划|日程|作息|方案)|(?:每日计划|日程|作息).{0,10}(?:规划|制定|设计|安排|生成)/.test(value)
      && !/(?:保存|创建模板|新增|写入|应用到)/.test(value);
  }

  function isCasualGreeting(text) {
    return /^(?:你好|您好|嗨|哈喽|hello|hi|在吗|早上好|下午好|晚上好)[！!。,.，\s]*$/i.test(String(text || '').trim());
  }

  function fromDailyTemplateParams(params) {
    const p = params && typeof params === 'object' ? params : {};
    const items = Array.isArray(p.items) ? p.items.filter((item) => item && item.startTime && item.title) : [];
    if (!String(p.name || '').trim() || items.length < 3) return null;
    return {
      kind: 'structured_draft', draftType: 'dailyTemplate', action: 'createDailyTemplate',
      params: { name: String(p.name).trim(), frequency: p.frequency || 'everyday', items },
      draft: true, confirmed: false, draftStatus: 'open'
    };
  }

  function latestOpenDraft(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const msg = list[i];
      if (msg && msg.role === 'ai' && msg.kind === 'structured_draft' && msg.action && msg.params
        && !msg.confirmed && msg.draftStatus !== 'discarded') return msg;
    }
    return null;
  }

  /** 兼容升级前的会话：仅扫描最近六条消息，把仍是纯文本的详细计划即时恢复为结构化草案。 */
  function latestDraftOrExtract(messages) {
    const open = latestOpenDraft(messages);
    if (open) return open;
    const recent = (Array.isArray(messages) ? messages : []).slice(-6);
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const msg = recent[i];
      if (!msg || msg.role !== 'ai' || msg.kind === 'action_result') continue;
      const extracted = extractDailyTemplateDraft(msg.content);
      if (extracted) return { ...msg, ...extracted, recoveredFromText: true };
    }
    return null;
  }

  function authorizedProfileContext(settings) {
    const profile = settings && settings.agentProfile;
    if (!profile || !profile.enabled) return '';
    const fields = [
      ['称呼', profile.preferredName], ['身份/角色', profile.role],
      ['通常起床', profile.wakeTime], ['通常入睡', profile.sleepTime],
      ['工作/学习时段', profile.workHours], ['高效时段', profile.focusPeriod],
      ['偏好与约束', profile.notes]
    ];
    const lines = fields
      .filter(([, value]) => String(value || '').trim())
      .map(([label, value]) => `${label}：${String(value).trim().slice(0, 240)}`);
    return lines.length ? `【用户主动授权的个人资料（只读）】\n${lines.join('\n')}\n仅在相关任务中使用这些信息，不要推断未提供的敏感信息。` : '';
  }

  return {
    extractDailyTemplateDraft, fromDailyTemplateParams, isSaveReference, shouldReferenceDraft,
    isPlanningRequest, isCasualGreeting, latestOpenDraft, latestDraftOrExtract, authorizedProfileContext
  };
});
