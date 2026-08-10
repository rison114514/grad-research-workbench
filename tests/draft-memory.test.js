'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const DraftMemory = require('../renderer/js/agent/draft-memory.js');

const DETAILED_PLAN = `每日计划草案（工作日版）
07:00–07:30 起床、洗漱、喝一杯水（唤醒生理节律）
07:30–08:00 轻度运动（拉伸或快走）
08:00–08:30 早餐 + 浏览当日要闻
08:30–10:30 深度工作/学习
10:30–10:50 休息散步，补水
10:50–11:50 深度工作第二段
11:50–12:30 午餐 + 离开屏幕休息
12:30–13:00 午休
13:00–15:00 日常工作
15:00–15:15 下午茶休息
15:15–17:00 工作收尾 + 次日任务清单整理
17:00–18:00 健身/运动
18:00–19:00 晚餐
19:00–20:00 轻量学习
20:00–21:00 自由时间
21:00–21:30 当日复盘 + 明日计划预览
21:30–22:00 洗漱、准备入睡`;

test('详细自然语言日程会同步形成结构化每日模板草案', () => {
  const draft = DraftMemory.extractDailyTemplateDraft(DETAILED_PLAN);
  assert.ok(draft);
  assert.equal(draft.kind, 'structured_draft');
  assert.equal(draft.action, 'createDailyTemplate');
  assert.equal(draft.params.frequency, 'weekdays');
  assert.equal(draft.params.items.length, 17);
  assert.deepEqual(draft.params.items[0], {
    startTime: '07:00', endTime: '07:30', title: '起床、洗漱、喝一杯水', type: 'rest', note: '起床、洗漱、喝一杯水（唤醒生理节律）'
  });
  assert.equal(draft.params.items.at(-1).endTime, '22:00');
});

test('普通文字和少量时间示例不会误判成结构化草案', () => {
  assert.equal(DraftMemory.extractDailyTemplateDraft('建议每天早睡早起，多注意休息。'), null);
  assert.equal(DraftMemory.extractDailyTemplateDraft('每日计划：\n09:00–10:00 写论文'), null);
});

test('“由你保存”命中草案引用，否定保存不会命中', () => {
  assert.equal(DraftMemory.isSaveReference('可以，由你来保存'), true);
  assert.equal(DraftMemory.isSaveReference('就按这个'), true);
  assert.equal(DraftMemory.isSaveReference('先不要保存'), false);
});

test('旧草案仅在明确指代时进入上下文，问候和新规划不会引用', () => {
  assert.equal(DraftMemory.shouldReferenceDraft('保存它'), true);
  assert.equal(DraftMemory.shouldReferenceDraft('把刚才那份计划改成八点开始'), true);
  assert.equal(DraftMemory.shouldReferenceDraft('你好'), false);
  assert.equal(DraftMemory.shouldReferenceDraft('根据我的个人资料，帮我规划每日计划'), false);
  assert.equal(DraftMemory.isPlanningRequest('根据我的个人资料，帮我规划每日计划'), true);
  assert.equal(DraftMemory.isCasualGreeting('你好'), true);
});

test('仅返回最近一个仍开放的结构化草案', () => {
  const oldDraft = { role: 'ai', kind: 'structured_draft', action: 'createDailyTemplate', params: { name: '旧' }, confirmed: true };
  const current = { role: 'ai', kind: 'structured_draft', action: 'createDailyTemplate', params: { name: '新' }, draftStatus: 'open' };
  assert.equal(DraftMemory.latestOpenDraft([oldDraft, current, { role: 'user', content: '保存它' }]), current);
});

test('升级前保存的纯文本计划也能在最近会话中恢复', () => {
  const recovered = DraftMemory.latestDraftOrExtract([
    { id: 'old-text', role: 'ai', kind: 'text', content: DETAILED_PLAN },
    { role: 'user', kind: 'text', content: '可以，由你来保存' }
  ]);
  assert.ok(recovered && recovered.recoveredFromText);
  assert.equal(recovered.id, 'old-text');
  assert.equal(recovered.params.items.length, 17);
});

test('用户资料只在主动授权后以字段白名单进入上下文', () => {
  const settings = {
    aiApiKey: 'SECRET_KEY', githubToken: 'SECRET_TOKEN',
    agentProfile: { enabled: true, preferredName: '泊舟', role: '研究生', wakeTime: '07:00', notes: '午后休息' }
  };
  const context = DraftMemory.authorizedProfileContext(settings);
  assert.ok(context.includes('泊舟') && context.includes('研究生'));
  assert.ok(!context.includes('SECRET_KEY') && !context.includes('SECRET_TOKEN'));
  assert.equal(DraftMemory.authorizedProfileContext({ agentProfile: { enabled: false, preferredName: '泊舟' } }), '');
});

test('主界面和独立桌面宠物都在 assistant.js 前加载草案模块', () => {
  for (const file of ['index.html', 'pet-floating.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8');
    assert.ok(html.indexOf('js/agent/draft-memory.js') < html.indexOf('js/assistant.js'), `${file} 加载顺序正确`);
  }
});

test('设置页提供上下文、输出和 DeepSeek thinking 自定义项', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="setAgentContextTokens"'));
  assert.ok(html.includes('max="800000"'));
  assert.ok(html.includes('id="setAgentOutputTokens"'));
  assert.ok(html.includes('id="setAgentThinkingMode"'));
});
