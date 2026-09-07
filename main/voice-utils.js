'use strict';

/**
 * 语音链路中的纯函数：既供主进程使用，也便于 node:test 独立验证。
 * 这里不接触 Electron、磁盘或网络，确保输入净化与播报策略可回归。
 */

// “别”不能按单字搜索，否则“分别解析”也会被误判为否定表达。
const NEGATION_RE = /(?:不需要|不必|不用|不要|无需|无须|没有|没能|不能|不可|禁止|拒绝|取消|停止|(?<!分)别|不|没)/g;
const NUMBER_RE = /\d+(?:[.:：/-]\d+)*/g;
const DATE_WORD_RE = /(?:今日|今天|明日|明天|后日|后天|大后天|本周|这周|下周|周[一二三四五六日天])/g;
const DATE_ALIASES = new Map([
  ['今日', 'today'], ['今天', 'today'],
  ['明日', 'tomorrow'], ['明天', 'tomorrow'],
  ['后日', 'day-after-tomorrow'], ['后天', 'day-after-tomorrow'],
  ['本周', 'this-week'], ['这周', 'this-week']
]);
const SELF_CORRECTION_RE = /(?:不对|更正|改成|应该是|我说错了|算了|还是|改主意|不是.+(?:而是|是))/;
const POLARITY_CORRECTION_RE = /(?:不要|别|不|没有?|取消|停止)[^，。；！？,;!?\n]{0,20}[，。；,;]\s*(?:不对|算了|改成|还是|应该是|我说错了)/;
const RETRACTION_RE = /(?:(?:这个|这项|这条|前面(?:这个|这项|这条)?)[^，。；！？,;!?\n]{0,12})?(?:不需要了|不用了|不要了|取消掉?)/;
const SPEECH_NOISE_RE = /(?:嗯+|呃+|啊+|额+|那个|就是说|怎么说呢|我想想|这个这个)/g;

function stripJsonFence(text) {
  return String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function parseNormalizeResponse(content) {
  const raw = stripJsonFence(content);
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!obj || typeof obj.cleanedText !== 'string') return null;
    return {
      cleanedText: obj.cleanedText.trim(),
      semanticRisk: obj.semanticRisk === true || obj.safeToUse === false,
      safeToUse: obj.safeToUse !== false && obj.semanticRisk !== true,
      intent: ['command', 'question', 'note', 'message', 'brainstorm', 'schedule', 'list', 'todo_list', 'other'].includes(obj.intent) ? obj.intent : 'other',
      format: ['sentence', 'paragraphs', 'bullets', 'numbered', 'checklist'].includes(obj.format) ? obj.format : 'sentence',
      changes: Array.isArray(obj.changes) ? obj.changes.map(String).slice(0, 12) : [],
      corrections: Array.isArray(obj.corrections) ? obj.corrections.slice(0, 20).map((item) => ({
        from: String(item?.from || '').slice(0, 80),
        to: String(item?.to || '').slice(0, 80),
        reason: String(item?.reason || '').slice(0, 80)
      })).filter((item) => item.from || item.to) : [],
      discardedSpans: Array.isArray(obj.discardedSpans)
        ? obj.discardedSpans.map((item) => ({
          text: String(typeof item === 'object' ? item?.text || '' : item || '').trim(),
          reason: String(typeof item === 'object' ? item?.reason || '' : '').trim().slice(0, 80)
        })).filter((item) => item.text).slice(0, 12)
        : [],
      items: Array.isArray(obj.items) ? obj.items.slice(0, 40).map((item) => ({
        title: String(item?.title || '').trim().slice(0, 160),
        details: Array.isArray(item?.details) ? item.details.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 12) : [],
        constraints: Array.isArray(item?.constraints) ? item.constraints.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 12) : []
      })).filter((item) => item.title) : [],
      ambiguities: Array.isArray(obj.ambiguities) ? obj.ambiguities.map(String).map((v) => v.trim()).filter(Boolean).slice(0, 12) : []
    };
  } catch (e) {
    return null;
  }
}

function countMatches(text, re) {
  return (String(text || '').match(re) || []).length;
}

function semanticNegationCount(text) {
  return countMatches(String(text || '').replace(/(?:不对|我说错了|更正)/g, ''), NEGATION_RE);
}

function canonicalDates(text) {
  return (String(text || '').match(DATE_WORD_RE) || []).map((word) => DATE_ALIASES.get(word) || word);
}

function compactInformation(text) {
  return String(text || '')
    .replace(SPEECH_NOISE_RE, '')
    .replace(/(?:不对|更正|我说错了|改成|应该是|算了|改主意)/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 长口述是编辑而不是摘要；用字符 bigram 防止模型静默丢掉整段内容。 */
function informationRetentionScore(original, cleaned) {
  const source = compactInformation(original);
  const target = compactInformation(cleaned);
  if (!source) return 1;
  if (source.length < 24) return Math.min(1, target.length / source.length);
  const grams = new Set();
  for (let i = 0; i < source.length - 1; i += 1) grams.add(source.slice(i, i + 2));
  let retained = 0;
  grams.forEach((gram) => { if (target.includes(gram)) retained += 1; });
  return grams.size ? retained / grams.size : 1;
}

function validateNormalizedText(original, cleaned, options = {}) {
  const source = String(original || '').trim();
  const target = String(cleaned || '').trim();
  if (!source || !target) return { ok: false, reason: 'empty' };
  const minimumRatio = source.length >= 120 ? 0.34 : 0.16;
  if (target.length < Math.max(2, Math.floor(source.length * minimumRatio)) || target.length > source.length * 2.5 + 24) {
    return { ok: false, reason: 'length' };
  }
  if (source.length >= 120) {
    const retention = informationRetentionScore(source, target);
    const threshold = SELF_CORRECTION_RE.test(source) ? 0.24 : 0.38;
    if (retention < threshold) return { ok: false, reason: `information-loss:${retention.toFixed(2)}` };
  }
  const sourceNumbers = source.match(NUMBER_RE) || [];
  const targetNumbers = target.match(NUMBER_RE) || [];
  const addedNumber = targetNumbers.find((n) => !sourceNumbers.includes(n));
  const glossary = Array.isArray(options.glossary) ? options.glossary.map(String) : [];
  const numberComesFromKnownTerm = addedNumber && glossary.some((term) => term.includes(addedNumber) && target.includes(term));
  if (addedNumber && !numberComesFromKnownTerm) return { ok: false, reason: `number-added:${addedNumber}` };
  if (sourceNumbers.length && !targetNumbers.length) return { ok: false, reason: 'number-all-removed' };
  const missingNumber = sourceNumbers.find((n) => !targetNumbers.includes(n));
  if (missingNumber && !SELF_CORRECTION_RE.test(source)) return { ok: false, reason: `number:${missingNumber}` };
  const sourceDates = canonicalDates(source);
  const targetDates = canonicalDates(target);
  const addedDate = targetDates.find((n) => !sourceDates.includes(n));
  if (addedDate) return { ok: false, reason: `date-added:${addedDate}` };
  if (sourceDates.length && !targetDates.length) return { ok: false, reason: 'date-all-removed' };
  const missingDate = sourceDates.find((n) => !targetDates.includes(n));
  if (missingDate && !SELF_CORRECTION_RE.test(source)) return { ok: false, reason: `date:${missingDate}` };
  const sourceNegations = semanticNegationCount(source);
  const targetNegations = semanticNegationCount(target);
  const explicitPolarityCorrection = POLARITY_CORRECTION_RE.test(source);
  const abandonedDraftWithFinalConstraint = RETRACTION_RE.test(source) && targetNegations > 0;
  if (sourceNegations > targetNegations && !explicitPolarityCorrection && !abandonedDraftWithFinalConstraint) {
    return { ok: false, reason: 'negation' };
  }
  return { ok: true };
}

/**
 * 通用听写只做“输出能否使用”的形态检查。
 * 不检查待办字段、标题、日期、数字、否定或其他语义内容；语义由编辑 Agent
 * 负责，并由发送前的人工确认最终验收。
 */
function validateEditorResult(original, result) {
  if (!result || typeof result.cleanedText !== 'string') return { ok: false, reason: 'invalid-json' };
  const cleaned = result.cleanedText.trim();
  if (!cleaned) return { ok: false, reason: 'empty-output' };
  const sourceLength = String(original || '').trim().length;
  if (cleaned.length > Math.max(2000, sourceLength * 8 + 500)) return { ok: false, reason: 'output-too-large' };
  // 仅检查模型自己声明的版式是否真正落在正文中，不判断内容属于哪种意图。
  const formatPatterns = {
    numbered: /^\s*1[.、)]\s+\S+/m,
    bullets: /^\s*[-*•]\s+\S+/m,
    checklist: /^\s*[-*]\s*\[[ xX]\]\s+\S+/m
  };
  if (formatPatterns[result.format] && !formatPatterns[result.format].test(cleaned)) {
    return { ok: false, reason: `format-mismatch:${result.format}` };
  }
  const warnings = [];
  if (result.semanticRisk || result.safeToUse === false) warnings.push('semantic-risk');
  if (Array.isArray(result.ambiguities) && result.ambiguities.length) warnings.push('ambiguities');
  return { ok: true, warnings };
}

function editorRepairInstruction(reason) {
  const detail = String(reason || 'validation-failed');
  const hints = {
    'invalid-json': '输出不是可解析的完整 JSON，请严格按要求重新输出。',
    'empty-output': 'cleanedText 为空，请保留用户表达并重新输出。',
    'output-too-large': '输出异常膨胀，请只整理原始口述，不回答、不续写。',
    'format-mismatch:numbered': '你声明了 numbered，但 cleanedText 没有真正排成“1. 2. 3.”有序列表。请保留引导句，并将并列内容逐项编号。',
    'format-mismatch:bullets': '你声明了 bullets，但 cleanedText 没有真正使用项目符号分行。',
    'format-mismatch:checklist': '你声明了 checklist，但 cleanedText 没有真正使用复选列表分行。'
  };
  return `输出形态检查未通过（${detail}）：${hints[detail] || '请按指定结构重新输出。'}\n只修复指出的问题，重新输出完整 JSON；不要解释，不要执行任务。`;
}

function sanitizeSpeechText(input) {
  let text = String(input || '');
  text = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|file:)[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:[A-Za-z]:\\|\/(?:Users|home|tmp|var|private)\/)[^\s，。；！？]+/g, '')
    .replace(/^\s*>\s?.*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)、]\s*/gm, '')
    .replace(/[|*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function firstSpeechSentence(text, maxChars = 96) {
  const clean = sanitizeSpeechText(text);
  if (!clean) return '';
  const sentence = clean.split(/(?<=[。！？!?])\s*/)[0] || clean;
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars)}。` : sentence;
}

function speechTextForEvent(type, content = '') {
  switch (type) {
    case 'tool_confirmation': return '好的，我已经为您整理好安排，请确认。';
    case 'tool_result': return '已经为您处理完成。';
    case 'cancelled': return '好的，已取消。';
    case 'error': return '抱歉，处理失败了，请查看详细信息。';
    case 'clarify': return firstSpeechSentence(content, 110) || '还需要您补充一点信息。';
    case 'chat_text':
    default: {
      const clean = sanitizeSpeechText(content);
      if (!clean) return '';
      if (clean.length <= 140) return clean;
      const first = firstSpeechSentence(clean, 100);
      return `${first}${/[。！？!?]$/.test(first) ? '' : '。'}详细内容已显示在对话中。`;
    }
  }
}

module.exports = {
  parseNormalizeResponse,
  validateNormalizedText,
  validateEditorResult,
  editorRepairInstruction,
  sanitizeSpeechText,
  speechTextForEvent,
  firstSpeechSentence,
  informationRetentionScore
};
