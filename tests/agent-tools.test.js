'use strict';
/* Agent 框架：function calling 解析 + ToolRegistry 工具注册表测试 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

/* ---------------- ai-service parseChatResponse ---------------- */
const { parseChatResponse, resolvedSettings, applyModelSpecificOptions } = require(path.join(__dirname, '..', 'main', 'ai-service.js'));

test('parseChatResponse：普通回复', () => {
  const r = parseChatResponse({ choices: [{ message: { content: '好的' }, finish_reason: 'stop' }] });
  assert.equal(r.content, '好的');
  assert.equal(r.toolCalls.length, 0);
  assert.equal(r.finishReason, 'stop');
});

test('parseChatResponse：tool_calls 提取（原生 function calling）', () => {
  const r = parseChatResponse({
    choices: [{
      message: { content: null, tool_calls: [{ id: 't1', function: { name: 'addTask', arguments: '{"title":"写论文","priority":"high"}' } }] },
      finish_reason: 'tool_calls'
    }]
  });
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].name, 'addTask');
  assert.deepEqual(r.toolCalls[0].arguments, { title: '写论文', priority: 'high' });
  assert.equal(r.finishReason, 'tool_calls');
});

test('parseChatResponse：损坏 arguments 容错（不产生副作用）', () => {
  const r = parseChatResponse({ choices: [{ message: { tool_calls: [{ function: { name: 'x', arguments: 'not-json' } }] } }] });
  assert.equal(r.toolCalls[0].arguments.__raw, 'not-json');
});

test('parseChatResponse：空响应容错', () => {
  const r = parseChatResponse({});
  assert.equal(r.content, '');
  assert.equal(r.toolCalls.length, 0);
});

test('DeepSeek Agent：默认关闭 thinking，用户可显式开启', () => {
  const defaults = resolvedSettings({ aiProvider: 'deepseek', aiApiKey: 'x' });
  assert.equal(defaults.aiModel, 'deepseek-v4-flash');
  assert.equal(defaults.aiThinkingMode, 'disabled');
  const p1 = applyModelSpecificOptions({ model: defaults.aiModel }, defaults);
  assert.deepEqual(p1.thinking, { type: 'disabled' });
  const enabled = resolvedSettings({ aiBaseUrl: 'https://api.deepseek.com/v1', aiModel: 'deepseek-v4-pro', aiApiKey: 'x', aiThinkingMode: 'enabled' });
  assert.deepEqual(applyModelSpecificOptions({}, enabled).thinking, { type: 'enabled' });
  const openai = resolvedSettings({ aiBaseUrl: 'https://api.openai.com/v1', aiModel: 'gpt-5', aiApiKey: 'x' });
  assert.equal(applyModelSpecificOptions({}, openai).thinking, undefined, '其他兼容服务不发送 DeepSeek 专属字段');
});

/* ---------------- ToolRegistry ---------------- */
const { ToolRegistry } = require(path.join(__dirname, '..', 'renderer', 'js', 'agent', 'tool-registry.js'));

/* 最小 window mock（assistant-actions.js 加载与工具执行需要） */
global.window = {
  api: {
    store: { list: async () => [], create: async () => ({}), update: async () => ({}), remove: async () => true },
    github: { trending: async () => ({ ok: true, items: [] }) }
  },
  App: { todayStr: () => '2026-08-08', esc: (s) => String(s) }
};
global.App = global.window.App; // assistant-actions 内部引用全局 App
const A = require(path.join(__dirname, '..', 'renderer', 'js', 'assistant-actions.js'));

test('ToolRegistry：37 个工具（任务侧 4 + 模板侧 7），OpenAI 兼容格式', () => {
  const list = ToolRegistry.list();
  assert.equal(list.length, 37);
  assert.equal(list[0].type, 'function');
  assert.ok(list[0].function.name && list[0].function.description && list[0].function.parameters);
  const names = list.map((t) => t.function.name);
  assert.ok(names.includes('queryTask') && names.includes('updateTask') && names.includes('deleteTask') && names.includes('splitTask'), '任务侧 4 工具已注册');
  assert.ok(names.includes('createDailyTemplate') && names.includes('createWeeklyTemplate') && names.includes('applyTemplate') && names.includes('listDailyTemplates') && names.includes('listWeeklyTemplates') && names.includes('updateTemplate') && names.includes('deleteTemplate'), '模板侧 7 工具已注册');
});

test('ToolRegistry：写/读分类（安全边界依据）', () => {
  assert.equal(ToolRegistry.isWrite('addTask'), true);
  assert.equal(ToolRegistry.isWrite('addDailyPlanMulti'), true);
  assert.equal(ToolRegistry.isWrite('updateDailyPlan'), true);
  assert.equal(ToolRegistry.isWrite('queryStats'), false);
  assert.equal(ToolRegistry.isWrite('queryFitness'), false);
  assert.equal(ToolRegistry.isWrite('suggestInsights'), false);
  assert.equal(ToolRegistry.isWrite('queryGitHubTrending'), false, '热榜工具是只读');
  assert.equal(ToolRegistry.isWrite('queryLiterature'), false, '文献搜索只读');
  assert.equal(ToolRegistry.isWrite('readLiterature'), false, '文献阅读只读');
  assert.equal(ToolRegistry.isWrite('buildLiteratureRelations'), true, '关系生成是写入（走确认卡）');
  assert.equal(ToolRegistry.isWrite('generateReport'), true, '报告生成是写入（走确认卡）');
  assert.equal(ToolRegistry.isWrite('updateFitnessItem'), true, '健身条目状态是写入');
  assert.equal(ToolRegistry.isWrite('addFitnessItem'), true, '添加条目是写入');
  assert.equal(ToolRegistry.isWrite('addInspiration'), true, '记录灵感是写入');
  assert.equal(ToolRegistry.isWrite('queryInspirations'), false, '查灵感只读');
  assert.equal(ToolRegistry.isWrite('queryProjects'), false, '查项目只读');
  assert.equal(ToolRegistry.isWrite('subscribeGitHub'), true, '订阅是写入');
  assert.equal(ToolRegistry.isWrite('unsubscribeGitHub'), true, '取消订阅是写入');
  assert.equal(ToolRegistry.isWrite('queryGitHubSubs'), false, '查订阅只读');
});

test('ToolRegistry：schema 校验（必填/enum/类型收敛）', () => {
  const v1 = ToolRegistry.validate('addTask', { title: '', priority: 'urgent' });
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some((e) => e.includes('title')));
  assert.ok(v1.errors.some((e) => e.includes('priority')));
  const v2 = ToolRegistry.validate('addTimeLog', { category: 'study', minutes: '90' });
  assert.equal(v2.ok, true);
  assert.equal(v2.params.minutes, 90, '数字类型收敛');
  const v3 = ToolRegistry.validate('addDailyPlanMulti', {});
  assert.equal(v3.ok, false, 'items 必填');
  const daily = ToolRegistry.validate('createDailyTemplate', {});
  assert.equal(daily.ok, false, '每日模板的 name/items 必须保持严格校验');
  assert.ok(daily.errors.some((e) => e.includes('name')) && daily.errors.some((e) => e.includes('items')));
  const v4 = ToolRegistry.validate('unknownTool', {});
  assert.equal(v4.ok, false);
});

test('ToolRegistry：未知/无效工具调用零副作用', () => {
  const v = ToolRegistry.validate('evilTool', { x: 1 });
  assert.equal(v.ok, false);
});

/* ---------------- 快速路径（正则动作表）回归 ---------------- */
test('快速路径回归：动作表仍可命中（降级场景）', () => {
  assert.equal(A.match('打卡 跑步 30分钟'), 'addFitnessLog');
  assert.equal(A.match('帮我新增每日任务'), 'addTask');
  assert.equal(A.match('看看今天的计划'), 'queryDailyPlan');
  assert.equal(A.match('你能帮我制定一个健身计划吗'), 'planFitnessPlan');
  assert.equal(A.match('我不想做日报'), null);
});

/* ---------------- System Prompt 防护（防 JSON 裸显类 BUG 回归） ---------------- */

/* 提取 assistant.js 线上 TOOLS_SYSTEM_PROMPT 与 parseIntentJson（与渲染层同源） */
function loadAssistant() {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'assistant.js'), 'utf-8');
  const pm = src.match(/const TOOLS_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  // 同作用域提取：isIntentShape + INTENT_TEACHING_RE + parseIntentJson（线上定义依赖前两者）
  let parseIntentJson = null;
  const shapeSrc = src.match(/function isIntentShape[\s\S]*?\n}/);
  const teachRe = src.match(/const INTENT_TEACHING_RE = (.+);/);
  const fnSrc = src.match(/function parseIntentJson\(content\) \{[\s\S]*?\n\}/);
  if (shapeSrc && teachRe && fnSrc) {
    parseIntentJson = eval('(function(){ ' + shapeSrc[0] + '\nconst INTENT_TEACHING_RE = ' + teachRe[1] + ';\n' + fnSrc[0] + '\nreturn parseIntentJson; })()');
  }
  const historyStart = src.indexOf('function formatHistoryForContext');
  const historyEnd = src.indexOf('/** 把已知工具的参数校验失败', historyStart);
  const historySource = src.slice(historyStart, historyEnd);
  const formatHistoryForContext = eval(`(function(){
    function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
    ${historySource}
    return formatHistoryForContext;
  })()`);
  const repairStart = src.indexOf('function buildToolValidationRepair');
  const repairEnd = src.indexOf('/* Agent 全局人格', repairStart);
  const repairSource = src.slice(repairStart, repairEnd);
  const buildToolValidationRepair = eval(`(function(){ ${repairSource}; return buildToolValidationRepair; })()`);
  return { prompt: pm ? pm[1] : '', parseIntentJson, formatHistoryForContext, buildToolValidationRepair, src };
}

test('TOOLS_SYSTEM_PROMPT：铁律防 JSON 裸显（禁止 JSON/代码块/伪工具）', () => {
  const { prompt } = loadAssistant();
  assert.ok(prompt.includes('## 铁律'), '含铁律段');
  assert.ok(prompt.includes('绝不在回答文本中输出 JSON'), '禁止 JSON 文本输出');
  assert.ok(prompt.includes('json'), '禁止代码块');
  assert.ok(prompt.includes('原生 tool_calls'), '工具调用唯一通道');
  assert.ok(prompt.includes('绝不声称'), '不得自称已落库');
  assert.ok(prompt.includes('不支持原生工具调用'), '无工具环境用自然语言');
  assert.ok(prompt.includes('承接上一轮草案') && prompt.includes('由你保存'), '明确支持跨轮确认保存');
});

test('跨轮上下文：上一轮详细计划不会再被截断为 180 字', () => {
  const { formatHistoryForContext } = loadAssistant();
  const detailedPlan = `每日计划草案\n${'07:00–07:30 起床洗漱\n'.repeat(20)}22:00 断网熄灯`;
  const text = formatHistoryForContext([
    { role: 'assistant', content: detailedPlan },
    { role: 'user', content: '可以，由你来保存' }
  ]);
  assert.ok(text.includes('22:00 断网熄灯'), '保留上一轮计划尾部条目');
  assert.ok(text.includes('可以，由你来保存'), '保留当前确认指令');
});

test('上下文预算：默认提升至 32K，允许 4K–800K 且不再限制 12 条', () => {
  const { src } = loadAssistant();
  assert.ok(src.includes('DEFAULT_AGENT_CONTEXT_TOKENS = 32000'));
  assert.ok(src.includes('800000'));
  assert.ok(!src.includes('out.length >= 12'));
  assert.ok(!src.includes('truncate(m.content, 180)'));
});

test('无效工具参数：构造 role=tool 反馈供模型补参重试', () => {
  const { buildToolValidationRepair } = loadAssistant();
  const repair = buildToolValidationRepair(
    { id: 'call_empty', arguments: {} },
    'createDailyTemplate',
    ['缺少必填参数 name', '缺少必填参数 items']
  );
  assert.equal(repair.assistantCall.id, 'call_empty');
  assert.equal(repair.toolResult.tool_call_id, 'call_empty');
  assert.ok(repair.toolResult.output.includes('上一轮完整草案'));
  assert.ok(repair.toolResult.output.includes('不得再次提交空参数'));
});

test('旧 INTENT_SYSTEM_PROMPT（只输出 JSON 指令）已删除，避免模型被训练成输出 JSON 文本', () => {
  const { src } = loadAssistant();
  assert.ok(!/const INTENT_SYSTEM_PROMPT = `/.test(src), '无 INTENT 定义');
});

test('parseIntentJson：```json 代码块包裹的意图也能解析（不裸显）', () => {
  const { parseIntentJson } = loadAssistant();
  const r = parseIntentJson('好的，安排如下：\n```json\n{"mode":"action","action":"addDailyPlanMulti","params":{"items":[{"startTime":"09:00","title":"教研室打卡"}]}}\n```\n请确认。');
  assert.equal(r.mode, 'action');
  assert.equal(r.action, 'addDailyPlanMulti');
  assert.ok(Array.isArray(r.params.items));
});

test('parseIntentJson：普通回答零副作用（含 action: 字样也不触发）', () => {
  const { parseIntentJson } = loadAssistant();
  const plain = parseIntentJson('这周实验数据不错，下午2点组会，记得带电脑。');
  assert.equal(plain.mode, 'chat');
  assert.equal(plain.action, undefined);
  const loose = parseIntentJson('关于 action: 上架的问题，我认为应该先做回归测试。');
  assert.equal(loose.mode, 'chat', '降级为 chat 渲染原文');
  assert.ok(loose.content.includes('上架'), '原文保留，零副作用');
});

test('parseIntentJson：损坏 JSON 落 chat 兜底（绝不产生副作用）', () => {
  const { parseIntentJson } = loadAssistant();
  const r = parseIntentJson('{"mode":"action","action":"addTask","params":{ 未闭合');
  assert.equal(r.mode, 'chat');
});

/* ---------------- 意图置信度分级（防代码问答误判） + Markdown 代码块渲染 ---------------- */

test('parseIntentJson：整体 JSON 意图 → 直接解析', () => {
  const { parseIntentJson } = loadAssistant();
  const r = parseIntentJson('{"mode":"action","action":"addDailyPlanMulti","params":{"items":[{"startTime":"09:00","title":"教研室打卡"}]},"content":"已安排"}');
  assert.equal(r.mode, 'action');
  assert.equal(r.action, 'addDailyPlanMulti');
});

test('parseIntentJson：围栏+短引导意图 → 解析；讲解长文不误判', () => {
  const { parseIntentJson } = loadAssistant();
  const intent = parseIntentJson('好的：\n```json\n{"mode":"action","action":"addTask","params":{"title":"写论文"}}\n```');
  assert.equal(intent.mode, 'action');
  assert.equal(intent.action, 'addTask');
  // 代码问答场景：讲解 + json 示例代码块 → chat 不弹卡
  const teach = parseIntentJson('JSON 的 action 字段用法示例：\n```json\n{"action":"addTask","params":{"title":"x"}}\n```\n这样配置即可。');
  assert.equal(teach.mode, 'chat', '代码问答不误判');
  assert.ok(teach.content.includes('action'), '原文保留');
});

test('parseIntentJson：讲解语气+JSON 片段 → chat 零副作用', () => {
  const { parseIntentJson } = loadAssistant();
  const r = parseIntentJson('比如 addTask 的参数：{"action":"addTask","params":{"title":"x"}} 就这样');
  assert.equal(r.mode, 'chat');
});

test('parseIntentJson：普通 JSON 对象（非意图）→ chat 不弹卡', () => {
  const { parseIntentJson } = loadAssistant();
  const r = parseIntentJson('{"name":"张三","age":25}');
  assert.equal(r.mode, 'chat');
  assert.equal(r.action, undefined);
});

test('App.markdown：多行代码块渲染（``` 围栏 → pre.code-block）', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'app.js'), 'utf-8');
  const mdSrc = src.match(/markdown\(text\) \{[\s\S]*?\n  \},/)[0];
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const mdFn = eval('(' + mdSrc.replace(/^markdown\(text\) \{/, 'function(text) {').replace(/\n  \},$/, '\n}') + ')');
  const md = mdFn.bind({ esc });
  const html = md('解析 JSON 示例：\n```json\n{"name":"张三","age":25}\n```\n这样可以读取。');
  assert.ok(html.includes('<pre class="code-block">'), '代码块 pre 渲染');
  assert.ok(html.includes('code-lang'), '语言标签');
  assert.ok(html.includes('&quot;'), '内容转义');
  assert.ok(!html.includes('```'), '围栏字符不残留');
  const inline = md('行内 `code` 与 **粗体**');
  assert.ok(inline.includes('<code>code</code>') && inline.includes('<strong>粗体</strong>'), '行内语法不回归');
});

/* ---------------- GitHub 官网热榜工具（queryGitHubTrending） ---------------- */
test('ToolRegistry：queryGitHubTrending schema 校验', () => {
  const v1 = ToolRegistry.validate('queryGitHubTrending', { language: 'Python', since: 'weekly' });
  assert.equal(v1.ok, true);
  assert.equal(v1.params.language, 'Python');
  const v2 = ToolRegistry.validate('queryGitHubTrending', { since: 'yearly' });
  assert.equal(v2.ok, false, 'since 非法值拦截');
  const v3 = ToolRegistry.validate('queryGitHubTrending', {});
  assert.equal(v3.ok, true, '无参数合法（全领域）');
});

test('assistant-actions：queryGitHubTrending 白名单与分支（mock 官网返回）', async () => {
  // 复用测试文件的 window mock，补 github.trending
  window.api.github = window.api.github || {};
  window.api.github.trending = async (opts) => ({
    ok: true, source: 'GitHub 官网',
    languageName: opts && opts.language ? opts.language : '全部', since: 'weekly',
    items: [
      { fullName: 'langchain-ai/langchain', stars: 98765, language: 'Python', description: 'Build context-aware reasoning', url: 'https://github.com/langchain-ai/langchain' },
      { fullName: 'pytorch/pytorch', stars: 87000, language: 'Python', description: 'Tensors and Dynamic neural networks', url: 'https://github.com/pytorch/pytorch' }
    ]
  });
  assert.equal(A.canExecute('queryGitHubTrending'), true, '白名单放行');
  const r = await A.executeStructured('queryGitHubTrending', { language: 'Python' });
  assert.ok(r.includes('GitHub 官网热榜'), '含标题');
  assert.ok(r.includes('langchain-ai/langchain') && r.includes('pytorch/pytorch'), '含仓库');
  assert.ok(r.includes('Python'), '含语言');
  const r2 = await A.queryGitHubTrending({});
  assert.ok(r2.includes('全部'), '无参数走全领域（全部）');
});

test('assistant-actions：queryGitHubTrending 失败/降级（mock 报错）', async () => {
  window.api.github.trending = async () => ({ ok: false, error: 'GitHub 官网限流（429），请稍后重试' });
  const r = await A.queryGitHubTrending({ language: 'Python' });
  assert.ok(r.includes('抓取 GitHub 官网热榜失败'), '错误透出');
  assert.ok(r.includes('429'), '含错误详情');
});

/* ---------------- 文献库 Agent 工具（queryLiterature / readLiterature / buildLiteratureRelations） ---------------- */
test('ToolRegistry：文献工具 schema 校验', () => {
  const v1 = ToolRegistry.validate('queryLiterature', { query: 'SLAM', limit: 5 });
  assert.equal(v1.ok, true);
  assert.equal(v1.params.limit, 5);
  const v2 = ToolRegistry.validate('queryLiterature', {});
  assert.equal(v2.ok, false, 'query 必填');
  const v3 = ToolRegistry.validate('queryLiterature', { query: 'x', limit: 999 });
  assert.equal(v3.ok, false, 'limit 上限拦截');
  const v4 = ToolRegistry.validate('readLiterature', { title: '综述' });
  assert.equal(v4.ok, true);
  const v5 = ToolRegistry.validate('buildLiteratureRelations', { scope: 'all' });
  assert.equal(v5.ok, true);
});

test('queryLiterature：搜索命中与空结果提示（mock store）', async () => {
  const orig = window.api.store.list;
  window.api.store.list = async (d) => (d === 'literature' ? [
    { id: 'L1', title: 'SLAM 综述', authors: 'Zhang', year: 2024, abstract: 'simultaneous localization and mapping', collectionIds: ['c1'] },
    { id: 'L2', title: 'Transformer 注意力', authors: 'Li', year: 2023, abstract: 'attention mechanism', collectionIds: [] }
  ] : (d === 'litRelations' ? [] : []));
  const hit = await A.queryLiterature({ query: 'SLAM' });
  assert.ok(hit.includes('SLAM 综述'));
  const miss = await A.queryLiterature({ query: '不存在的' });
  assert.ok(miss.includes('没有找到'));
  window.api.store.list = orig;
});

test('readLiterature：按 id/标题定位，返回摘要与正文片段', async () => {
  const orig = window.api.store.list;
  window.api.store.list = async (d) => (d === 'literature' ? [
    { id: 'L1', title: 'SLAM 综述', authors: 'Zhang', year: 2024, abstract: '关于 SLAM 的综述', pdfText: '第一章 引言...' }
  ] : []);
  const r1 = await A.readLiterature({ id: 'L1' });
  assert.ok(r1.includes('SLAM 综述'));
  const r2 = await A.readLiterature({ title: 'slam' });
  assert.ok(r2.includes('关于 SLAM 的综述'));
  const r3 = await A.readLiterature({ title: '不存在' });
  assert.ok(r3.includes('未找到'));
  window.api.store.list = orig;
});

test('buildLiteratureRelations：无 AI 配置降级提示', async () => {
  const orig = window.api.store.getSettings;
  window.api.store.getSettings = async () => ({});
  const r = await A.buildLiteratureRelations({ scope: 'all' });
  assert.ok(r.includes('配置'), '提示配置 AI');
  window.api.store.getSettings = orig;
});

test('parseRelationArray：损坏/围栏 JSON 容错', () => {
  assert.equal(A.parseRelationArray('[{"a":0,"b":1,"type":"cites","strength":0.9,"reason":"x"}]').length, 1);
  assert.equal(A.parseRelationArray('```json\n[{"a":0,"b":1,"type":"cites"}]\n```').length, 1);
  assert.equal(A.parseRelationArray('完全不是 JSON').length, 0);
  assert.equal(A.parseRelationArray('{"a":1}').length, 0, '对象非数组');
});

/* ---------------- 日报/周报 Agent 工具（generateReport） ---------------- */
test('ToolRegistry：generateReport schema 校验', () => {
  const v1 = ToolRegistry.validate('generateReport', { type: 'daily', date: '2026-08-08', polish: true });
  assert.equal(v1.ok, true);
  assert.equal(v1.params.type, 'daily');
  const v2 = ToolRegistry.validate('generateReport', { type: 'monthly' });
  assert.equal(v2.ok, false, 'type 非法值拦截');
  const v3 = ToolRegistry.validate('generateReport', {});
  assert.equal(v3.ok, true, '无参数合法（默认日报今天）');
});

test('generateReportStructured：mock 报告生成返回摘要', async () => {
  const orig = window.api.report;
  window.api.report = { generate: async (type, date, opts) => ({ report: { type, dateRange: { label: '8月8日 周五' }, content: '# 日报 · 8月8日 周五\n\n## 一、今日/本周概述\n- 完成任务 **2** 项\n（后略）', source: 'local' } }) };
  const r = await A.generateReportStructured({ type: 'daily', date: '2026-08-08' });
  assert.ok(r.includes('日报已生成'), '日报生成提示');
  assert.ok(r.includes('2026-08-08'), '含日期');
  assert.ok(r.includes('完成任务'), '含内容摘要');
  assert.ok(A.canExecute('generateReport'), '白名单放行');
  window.api.report = orig;
});

test('generateReportStructured：生成失败容错', async () => {
  const orig = window.api.report;
  window.api.report = { generate: async () => ({ report: null }) };
  const r = await A.generateReportStructured({});
  assert.ok(r.includes('生成失败'));
  window.api.report = orig;
});

/* ---------------- v1.4.3：健身细致条目工具（updateFitnessItem） ---------------- */
test('ToolRegistry：updateFitnessItem schema 校验', () => {
  const v1 = ToolRegistry.validate('updateFitnessItem', { status: 'done', matchName: '跑步' });
  assert.equal(v1.ok, true);
  assert.equal(v1.params.status, 'done');
  const v2 = ToolRegistry.validate('updateFitnessItem', { status: 'canceled' });
  assert.equal(v2.ok, false, 'status 非法值拦截');
  const v3 = ToolRegistry.validate('updateFitnessItem', {});
  assert.equal(v3.ok, false, 'status 必填');
});

test('updateFitnessItemStructured：itemId 精确 / matchName 模糊 / 备注保存', async () => {
  const orig = window.api.store.list;
  const plans = [
    { id: 'P1', name: '增肌计划', type: 'strength', weeklyGoal: 4, durationGoal: 40,
      schedule: [
        { day: '一', title: '上肢力量', items: [{ id: 'I1', name: '举哑铃', durationMin: 20, status: 'todo', customNote: '' }] },
        { day: '三', title: '有氧', items: [{ id: 'I2', name: '跑步', durationMin: 30, status: 'todo', customNote: '' }] }
      ] }
  ];
  window.api.store.list = async (d) => (d === 'fitnessPlans' ? JSON.parse(JSON.stringify(plans)) : []);
  window.api.store.update = async (d, id, patch) => { const p = plans.find((x) => x.id === id); if (p) Object.assign(p, patch); return p; };
  const r1 = await A.updateFitnessItemStructured({ planId: 'P1', itemId: 'I1', status: 'done' });
  assert.ok(r1.includes('举哑铃') && r1.includes('完成'));
  const r2 = await A.updateFitnessItemStructured({ planId: 'P1', matchName: '跑步', status: 'skipped', customNote: '今日感冒了' });
  assert.ok(r2.includes('跑步') && r2.includes('感冒'));
  assert.equal(plans[0].schedule[0].items[0].status, 'done', 'itemId 已落库');
  assert.equal(plans[0].schedule[1].items[0].status, 'skipped', 'matchName 已落库');
  assert.equal(plans[0].schedule[1].items[0].customNote, '今日感冒了');
  window.api.store.list = orig;
});

/* ---------------- v1.4.3：健身条目添加工具（addFitnessItem） ---------------- */
test('ToolRegistry：addFitnessItem schema 校验', () => {
  const v1 = ToolRegistry.validate('addFitnessItem', { planName: '增肌计划', name: '深蹲', durationMin: 20 });
  assert.equal(v1.ok, true);
  assert.equal(v1.params.name, '深蹲');
  const v2 = ToolRegistry.validate('addFitnessItem', { name: '跑步' });
  assert.equal(v2.ok, true, '仅 name 合法');
  const v3 = ToolRegistry.validate('addFitnessItem', {});
  assert.equal(v3.ok, false, 'name 必填');
  const v4 = ToolRegistry.validate('addFitnessItem', { name: 'x', durationMin: 9999 });
  assert.equal(v4.ok, false, 'durationMin 上限拦截');
});

test('addFitnessItemStructured：planId/planName 定位 + 追加条目落库', async () => {
  const orig = window.api.store.list;
  const plans = [
    { id: 'P1', name: '增肌计划', type: 'strength', weeklyGoal: 4, items: [{ id: 'I1', name: '举哑铃', status: 'todo' }] },
    { id: 'P2', name: '晨跑计划', type: 'running', weeklyGoal: 3, items: [] }
  ];
  window.api.store.list = async (d) => (d === 'fitnessPlans' ? JSON.parse(JSON.stringify(plans)) : []);
  window.api.store.update = async (d, id, patch) => { const p = plans.find((x) => x.id === id); if (p) Object.assign(p, patch); return p; };
  const r1 = await A.addFitnessItemStructured({ planId: 'P1', name: '深蹲', durationMin: 20 });
  assert.ok(r1.includes('增肌计划') && r1.includes('深蹲'), 'planId 定位 + 名称回显');
  assert.equal(plans[0].items.length, 2, '条目已追加');
  assert.equal(plans[0].items[1].name, '深蹲');
  assert.equal(plans[0].items[1].status, 'todo');
  assert.equal(plans[0].items[1].durationMin, 20);
  const r2 = await A.addFitnessItemStructured({ planName: '晨跑', name: '慢跑 5 公里' });
  assert.ok(r2.includes('晨跑计划'), 'planName 模糊定位');
  const r3 = await A.addFitnessItemStructured({ name: '深蹲' });
  assert.ok(r3.includes('未找到'), '无计划定位提示');
  const r4 = await A.addFitnessItemStructured({});
  assert.ok(r4.includes('缺少条目名称'), '无名称提示');
  assert.equal(A.canExecute('addFitnessItem'), true, '白名单放行');
  window.api.store.list = orig;
});

/* ---------------- 灵感/项目工具（addInspiration / queryInspirations / queryProjects） ---------------- */
test('ToolRegistry：灵感/项目工具 schema 校验', () => {
  const v1 = ToolRegistry.validate('addInspiration', { title: 'Transformer 改进', mood: 'research' });
  assert.equal(v1.ok, true);
  assert.equal(v1.params.mood, 'research');
  const v2 = ToolRegistry.validate('addInspiration', {});
  assert.equal(v2.ok, false, 'title 必填');
  const v3 = ToolRegistry.validate('addInspiration', { title: 'x', mood: 'invalid' });
  assert.equal(v3.ok, false, 'mood 非法拦截');
  const v4 = ToolRegistry.validate('queryInspirations', { limit: 5, keyword: '视觉' });
  assert.equal(v4.ok, true);
  const v5 = ToolRegistry.validate('queryInspirations', { limit: 999 });
  assert.equal(v5.ok, false, 'limit 上限拦截');
  const v6 = ToolRegistry.validate('queryProjects', { keyword: 'SLAM' });
  assert.equal(v6.ok, true);
});

test('addInspirationStructured：记录灵感落库（mood 默认 spark）', async () => {
  const orig = window.api.store.create;
  const created = [];
  window.api.store.create = async (d, r) => { created.push({ ...r }); return { id: 'I1', ...r }; };
  const r1 = await A.addInspirationStructured({ title: '视觉测量新方法', content: '基于多视图', mood: 'topic' });
  assert.ok(r1.includes('视觉测量新方法'), '标题回显');
  assert.equal(created[0].mood, 'topic');
  const r2 = await A.addInspirationStructured({ title: '无类型' });
  assert.equal(created[1].mood, 'spark', '默认 spark');
  const r3 = await A.addInspirationStructured({});
  assert.ok(r3.includes('缺少灵感标题'), '无标题提示');
  window.api.store.create = orig;
});

test('queryInspirationsStructured：关键词过滤 + 排序 + 空提示', async () => {
  const orig = window.api.store.list;
  window.api.store.list = async (d) => (d === 'inspirations' ? [
    { id: 'A', title: 'SLAM 改进', content: '视觉里程计', mood: 'spark', createdAt: '2026-08-07T10:00:00Z' },
    { id: 'B', title: '论文选题', content: 'Transformer 在视觉', mood: 'research', createdAt: '2026-08-08T10:00:00Z' }
  ] : []);
  const r1 = await A.queryInspirationsStructured({ keyword: 'SLAM' });
  assert.ok(r1.includes('SLAM 改进') && !r1.includes('论文选题'), '关键词过滤');
  const r2 = await A.queryInspirationsStructured({});
  assert.ok(r2.includes('论文选题') && r2.includes('SLAM 改进'), '按时间倒序全部');
  const r3 = await A.queryInspirationsStructured({ keyword: '不存在' });
  assert.ok(r3.includes('没有找到'), '空结果提示');
  window.api.store.list = orig;
});

test('queryProjectsStructured：项目列表 + 任务进度统计', async () => {
  const orig = window.api.store.list;
  window.api.store.list = async (d) => (d === 'projects' ? [
    { id: 'P1', name: 'SLAM 项目', description: '视觉测量' }
  ] : (d === 'tasks' ? [
    { id: 'T1', projectId: 'P1', status: 'done' },
    { id: 'T2', projectId: 'P1', status: 'doing' },
    { id: 'T3', projectId: 'P1', status: 'todo' }
  ] : []));
  const r1 = await A.queryProjectsStructured({});
  assert.ok(r1.includes('SLAM 项目'), '项目名');
  assert.ok(r1.includes('任务 3 项，完成 1 项'), '任务统计');
  assert.ok(r1.includes('33%'), '进度百分比');
  const r2 = await A.queryProjectsStructured({ keyword: '不存在' });
  assert.ok(r2.includes('没有找到'), '无项目提示');
  window.api.store.list = orig;
});

/* ---------------- GitHub 订阅管理工具（subscribeGitHub / unsubscribeGitHub / queryGitHubSubs） ---------------- */
test('ToolRegistry：GitHub 订阅工具 schema 校验', () => {
  const v1 = ToolRegistry.validate('subscribeGitHub', { keyword: 'robotics' });
  assert.equal(v1.ok, true);
  const v2 = ToolRegistry.validate('subscribeGitHub', { repo: 'langchain-ai/langchain' });
  assert.equal(v2.ok, true);
  const v3 = ToolRegistry.validate('subscribeGitHub', { keyword: 'a', repo: 'b' });
  assert.equal(v3.ok, true, 'keyword+repo 同时给合法（方法内优先 keyword）');
  const v4 = ToolRegistry.validate('unsubscribeGitHub', { keyword: 'robotics' });
  assert.equal(v4.ok, true);
  const v5 = ToolRegistry.validate('queryGitHubSubs', { type: 'keyword' });
  assert.equal(v5.ok, true);
  const v6 = ToolRegistry.validate('queryGitHubSubs', { type: 'bad' });
  assert.equal(v6.ok, false, 'type 非法拦截');
});

test('subscribeGitHubStructured：关键词/仓库订阅 + 去重 + 元数据', async () => {
  const origList = window.api.store.list, origCreate = window.api.store.create;
  const subs = [
    { id: 'S1', type: 'keyword', keyword: 'robotics' },
    { id: 'S2', type: 'repo', keyword: 'langchain-ai/langchain', fullName: 'langchain-ai/langchain', starCount: 100 }
  ];
  window.api.store.list = async (d) => (d === 'githubSubs' ? JSON.parse(JSON.stringify(subs)) : []);
  window.api.store.create = async (d, r) => { subs.push({ id: 'N' + subs.length, ...r }); return subs[subs.length - 1]; };
  window.api.github = { repoInfo: async () => ({ ok: true, repo: { fullName: 'pytorch/pytorch', stars: 80000, description: 'Tensors', language: 'Python', htmlUrl: 'https://github.com/pytorch/pytorch', pushedAt: '2026-08-01T00:00:00Z' } }) };
  const r1 = await A.subscribeGitHubStructured({ keyword: 'robotics' });
  assert.ok(r1.includes('无需重复添加'), '重复关键词去重');
  const r2 = await A.subscribeGitHubStructured({ keyword: 'slam' });
  assert.ok(r2.includes('slam'), '新关键词订阅');
  assert.equal(subs.filter((s) => s.type === 'keyword').length, 2);
  const r3 = await A.subscribeGitHubStructured({ repo: 'https://github.com/pytorch/pytorch' });
  assert.ok(r3.includes('pytorch/pytorch') && r3.includes('★ 80000'), '仓库链接解析+元数据');
  assert.equal(subs[subs.length - 1].starCount, 80000, '元数据落库');
  const r4 = await A.subscribeGitHubStructured({});
  assert.ok(r4.includes('二选一'), '无参数提示');
  window.api.store.list = origList; window.api.store.create = origCreate;
});

test('unsubscribeGitHubStructured：精确匹配删除 / queryGitHubSubsStructured：清单过滤', async () => {
  const origList = window.api.store.list, origRemove = window.api.store.remove;
  const subs = [
    { id: 'S1', type: 'keyword', keyword: 'robotics' },
    { id: 'S2', type: 'repo', keyword: 'pytorch/pytorch', fullName: 'pytorch/pytorch' }
  ];
  window.api.store.list = async (d) => (d === 'githubSubs' ? JSON.parse(JSON.stringify(subs)) : []);
  window.api.store.remove = async (d, id) => { const i = subs.findIndex((x) => x.id === id); if (i >= 0) subs.splice(i, 1); return true; };
  const r1 = await A.unsubscribeGitHubStructured({ keyword: 'robotics' });
  assert.ok(r1.includes('已取消'), '取消关键词');
  assert.equal(subs.length, 1);
  const r2 = await A.unsubscribeGitHubStructured({ repo: 'pytorch/pytorch' });
  assert.ok(r2.includes('已取消'), '取消仓库');
  assert.equal(subs.length, 0);
  const r3 = await A.unsubscribeGitHubStructured({ keyword: '不存在' });
  assert.ok(r3.includes('未找到'), '未找到提示');
  const q = await A.queryGitHubSubsStructured({});
  assert.ok(q.includes('没有任何'), '空清单提示');
  window.api.store.list = origList; window.api.store.remove = origRemove;
});
