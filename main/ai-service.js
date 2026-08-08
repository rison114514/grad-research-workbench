'use strict';

/**
 * AI 服务层
 * - OpenAI 兼容 /v1/chat/completions 调用（主流大厂模型均可接入）
 * - 内置模型预设模板：OpenAI / DeepSeek / 通义千问 / 智谱 / Kimi / Ollama(本地)
 * - 未配置 API Key 时自动降级为本地规则模板，保证功能可用
 */
const https = require('https');
const http = require('http');

/* ---------------- 模型预设模板 ---------------- */

const PROVIDERS = [
  {
    id: 'deepseek', name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    desc: '性价比高，推理能力出色，适合中文场景'
  },
  {
    id: 'openai', name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    desc: '通用能力均衡，生态最成熟'
  },
  {
    id: 'qwen', name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',
    desc: '阿里云大模型，中文长文本能力好'
  },
  {
    id: 'zhipu', name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash',
    desc: '免费额度友好，flash 模型响应快'
  },
  {
    id: 'kimi', name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k',
    desc: '长上下文，适合文献与文档处理'
  },
  {
    id: 'ollama', name: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b',
    desc: '完全离线，数据不出本机（需本地已装 Ollama）'
  }
];

function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

function resolvedSettings(settings = {}) {
  let { aiProvider, aiBaseUrl, aiModel, aiApiKey } = settings;
  if (aiProvider && aiProvider !== 'custom') {
    const p = getProvider(aiProvider);
    if (p) {
      aiBaseUrl = aiBaseUrl || p.baseUrl;
      aiModel = aiModel || p.model;
    }
  }
  return { aiBaseUrl: (aiBaseUrl || '').replace(/\/+$/, ''), aiModel: aiModel || 'gpt-4o-mini', aiApiKey: aiApiKey || '' };
}

function isConfigured(settings) {
  const s = resolvedSettings(settings);
  return !!(s.aiBaseUrl && s.aiModel && s.aiApiKey);
}

/* ---------------- HTTP 请求 ---------------- */

function postJson(url, payload, apiKey, timeoutMs = 60000) {
  const u = new URL(url);
  const mod = u.protocol === 'http:' ? http : https;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------------- 核心对话 ---------------- */

async function chat(messages, settings, { temperature = 0.7, maxTokens = 2000, system } = {}) {
  const s = resolvedSettings(settings);
  if (!isConfigured(settings)) {
    return { ok: false, source: 'local', error: '未配置 AI 服务，请到「设置」页填写 Base URL 与 API Key' };
  }
  const finalMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const payload = { model: s.aiModel, messages: finalMessages, temperature, max_tokens: maxTokens };
  try {
    const res = await postJson(`${s.aiBaseUrl}/chat/completions`, payload, s.aiApiKey);
    if (res.status !== 200) {
      let detail = res.body;
      try { detail = JSON.parse(res.body).error?.message || detail; } catch (e) { /* ignore */ }
      return { ok: false, source: 'ai', error: `AI 接口错误(${res.status}): ${String(detail).slice(0, 300)}` };
    }
    const json = JSON.parse(res.body);
    const content = json.choices?.[0]?.message?.content || '';
    return { ok: true, source: 'ai', content };
  } catch (e) {
    return { ok: false, source: 'ai', error: `AI 请求失败: ${e.message}` };
  }
}

async function testConnection(settings) {
  const result = await chat([{ role: 'user', content: '请回复"连接成功"四个字' }], settings, { maxTokens: 10 });
  return result;
}

/* ---------------- 原生 function calling（Agent 工具路由） ---------------- */

/**
 * 解析 OpenAI 兼容 /chat/completions 响应，提取 content / tool_calls / finish_reason。
 * 纯函数，独立可测。
 */
function parseChatResponse(json) {
  const choice = json?.choices?.[0] || {};
  const msg = choice.message || {};
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.map((tc) => {
    const fn = tc.function || {};
    let args = {};
    try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = { __raw: String(fn.arguments || '') }; }
    return { id: tc.id || null, name: fn.name || '', arguments: args };
  }) : [];
  return {
    content: msg.content || '',
    toolCalls,
    finishReason: choice.finish_reason || 'stop',
    usage: json.usage || null
  };
}

/**
 * 带工具调用的对话（OpenAI 兼容 function calling）。
 * tools: [{ type:'function', function:{ name, description, parameters } }]
 * 返回 { ok, source, content, toolCalls, finishReason }；响应解析失败视为纯文本 chat（零副作用）。
 */
async function chatWithTools(messages, tools, settings, { temperature = 0.7, maxTokens = 3000, system } = {}) {
  const s = resolvedSettings(settings);
  if (!isConfigured(settings)) {
    return { ok: false, source: 'local', error: '未配置 AI 服务，请到「设置」页填写 Base URL 与 API Key' };
  }
  const finalMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const payload = { model: s.aiModel, messages: finalMessages, temperature, max_tokens: maxTokens };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;
  try {
    const res = await postJson(`${s.aiBaseUrl}/chat/completions`, payload, s.aiApiKey);
    if (res.status !== 200) {
      let detail = res.body;
      try { detail = JSON.parse(res.body).error?.message || detail; } catch (e) { /* ignore */ }
      return { ok: false, source: 'ai', error: `AI 接口错误(${res.status}): ${String(detail).slice(0, 300)}` };
    }
    const json = JSON.parse(res.body);
    const parsed = parseChatResponse(json);
    return { ok: true, source: 'ai', ...parsed };
  } catch (e) {
    return { ok: false, source: 'ai', error: `AI 请求失败: ${e.message}` };
  }
}

/* ---------------- 领域功能（AI + 本地降级） ---------------- */

/** 文献结构化摘要 */
async function summarizeLiterature(meta, settings) {
  const sourceText = String(meta.fullText || meta.abstract || '').slice(0, 24000);
  const prompt = `你是科研助理。请严格基于提供的文献正文或摘要生成结构化中文笔记。必须包含：1)一句话概述；2)研究问题；3)核心方法；4)数据与实验设计；5)主要结论；6)局限性；7)对当前研究的启发；8)关键词。不得编造来源中不存在的实验、数字或结论；证据不足时明确写“原文信息不足”。
文献信息：
标题：${meta.title || '-'}
作者：${meta.authors || '-'}
期刊/会议：${meta.venue || '-'}，${meta.year || '-'}
DOI：${meta.doi || '-'}
依据类型：${meta.fullText ? 'PDF 正文' : meta.abstract ? '原文摘要' : '仅元数据'}
正文或摘要：${sourceText || '（无）'}`;
  if (isConfigured(settings)) {
    const r = await chat([{ role: 'user', content: prompt }], settings, { maxTokens: 1800, temperature: 0.2 });
    if (r.ok) return { ok: true, source: 'ai', content: r.content };
    return { ok: false, source: 'ai', error: r.error };
  }
  // 本地模板降级
  const summary = [
    `## ${meta.title || '未命名文献'}`,
    '',
    `- **作者**：${meta.authors || '未知'}`,
    `- **出处**：${meta.venue || '未知'}${meta.year ? ` (${meta.year})` : ''}${meta.doi ? `  · DOI: ${meta.doi}` : ''}`,
    '',
    '### 一句话概述',
    meta.abstract ? meta.abstract.split('。')[0] + '。' : '（待补充）',
    '',
    '### 研究问题',
    '（待补充）',
    '',
    '### 核心方法',
    '（待补充）',
    '',
    '### 数据与实验设计',
    '（待补充）',
    '',
    '### 主要结论',
    '（待补充）',
    '',
    '### 局限性',
    '（待补充）',
    '',
    '### 对当前研究的启发',
    '（待补充）',
    '',
    '### 关键词',
    '（待补充）',
    '',
    '> 提示：在设置页配置 AI 服务后可自动生成完整摘要。'
  ].join('\n');
  return { ok: true, source: 'local', content: summary };
}

/** 报告润色 */
async function polishReport(markdown, settings, typeLabel) {
  const prompt = `你是科研助理。请对下面的${typeLabel}进行润色与优化，要求：1)保持事实不变；2)语言专业、简洁、有条理；3)适当补充结构化小标题；4)输出 Markdown 格式，不要输出多余解释。
原始内容：
"""${markdown}"""`;
  if (isConfigured(settings)) {
    const r = await chat([{ role: 'user', content: prompt }], settings, { maxTokens: 2000, temperature: 0.4 });
    if (r.ok) return { ok: true, source: 'ai', content: r.content.trim() };
    return { ok: false, source: 'ai', error: r.error };
  }
  return { ok: true, source: 'local', content: markdown, note: '未配置 AI，返回原稿。配置后可自动润色。' };
}

/** 任务拆解 */
async function splitTask(task, settings) {
  const prompt = `你是项目管理助手。请把任务「${task}」拆解为 3-6 个可执行步骤。每一步必须包含清晰动作和可判断的完成结果，按 Markdown 无序列表输出，不要输出其他内容。`;
  if (isConfigured(settings)) {
    const r = await chat([{ role: 'user', content: prompt }], settings, { maxTokens: 600, temperature: 0.3 });
    if (r.ok) return {
      ok: true, source: 'ai',
      goal: `完成「${task}」并形成可验收结果`,
      deliverable: `${task}的完整交付成果与检查记录`,
      items: extractList(r.content)
    };
    return { ok: false, source: 'ai', error: r.error };
  }
  const items = [
    `明确「${task}」的目标与验收标准`,
    '收集所需资料与前置条件',
    '拆分为更小的时间块并安排优先级',
    '执行并记录进展',
    '检查结果，复盘改进'
  ];
  return {
    ok: true, source: 'local',
    goal: `完成「${task}」并形成可验收结果`,
    deliverable: `${task}的完整交付成果与检查记录`,
    items
  };
}

/** 自然语言解析任务（本地规则优先，AI 增强） */
function parseNaturalTask(text) {
  const out = { title: text, dueDate: null, priority: 'medium' };
  // 日期提取：明天 / 今天 / 后天 / X月X日 / YYYY-MM-DD / 周X
  const today = new Date();
  let m;
  if ((m = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/))) {
    out.dueDate = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  } else if ((m = text.match(/(\d{1,2})月(\d{1,2})日/))) {
    out.dueDate = `${today.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  } else if (text.includes('明天')) {
    out.dueDate = fmt(shift(today, 1));
  } else if (text.includes('后天')) {
    out.dueDate = fmt(shift(today, 2));
  } else if (text.includes('今天')) {
    out.dueDate = fmt(today);
  } else if ((m = text.match(/周([一二三四五六日天])/))) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    let target = map[m[1]];
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    out.dueDate = fmt(shift(today, diff));
  }
  // 优先级提取
  if (/紧急|重要|加急|优先/.test(text)) out.priority = 'high';
  else if (/有空|不急|随便|有空再/.test(text)) out.priority = 'low';
  // 清理标题中的时间词
  out.title = text
    .replace(/(明天|后天|今天)\s*/g, '')
    .replace(/(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{1,2}月\d{1,2}日|周[一二三四五六日天])\s*/g, '')
    .replace(/^[：:，,\s]+|[，,\s]+$/g, '')
    .trim() || text;
  return out;
}

function extractList(content) {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l && /^[-*•\d.]/.test(l));
  return lines.map((l) => l.replace(/^[-*•\d.、\s]+/, ''));
}

function pad(n) { return String(n).padStart(2, '0'); }
function shift(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

module.exports = {
  PROVIDERS, getProvider, chat, chatWithTools, parseChatResponse, testConnection,
  summarizeLiterature, polishReport, splitTask, parseNaturalTask, isConfigured
};
