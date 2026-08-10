'use strict';

/**
 * 日报/周报服务
 * 按日期聚合任务完成、文献阅读、项目动态等记录，生成 Markdown 报告
 */
const store = require('./store');
const ai = require('./ai-service');

function pad(n) { return String(n).padStart(2, '0'); }

/** 兼容 Date 对象 / 'YYYY-MM-DD' 字符串 / 非法值 → 统一返回 Date（非法回退今天） */
function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10) + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function fmtCn(d) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}

/** 生成报告草稿（本地模板），返回 { content, dateRange }
 * 数据源：任务 + 每日计划（dailyPlans）+ 每日/每周模板（dailyTemplates/weeklyTemplates）+ 健身打卡（fitnessLogs）+ 灵感（inspirations）
 * 注意：不读取文献管理数据（文献≠今日工作），避免把上传/阅读文献误认为当日产出
 */
const FIT_TYPE_LABEL = { running: '跑步', strength: '力量', yoga: '瑜伽', ball: '球类', other: '其他' };

function generateDraft(type, date) {
  const tasks = store.list('tasks');
  const projects = store.list('projects');
  const dailyPlans = store.list('dailyPlans');
  const dailyTemplates = store.list('dailyTemplates');
  const weeklyTemplates = store.list('weeklyTemplates');
  const fitnessLogs = store.list('fitnessLogs');
  const inspirations = store.list('inspirations');

  const range = { start: null, end: null, label: '' };
  if (type === 'daily') {
    const d = toDate(date);
    range.start = fmtDate(d);
    range.end = fmtDate(d);
    range.label = fmtCn(d);
  } else {
    const d = toDate(date);
    const monday = new Date(d);
    const dow = monday.getDay() || 7;
    monday.setDate(d.getDate() - dow + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    range.start = fmtDate(monday);
    range.end = fmtDate(sunday);
    range.label = `${monday.getMonth() + 1}月${monday.getDate()}日 - ${sunday.getMonth() + 1}月${sunday.getDate()}日`;
  }

  const inRange = (iso) => iso && iso.slice(0, 10) >= range.start && iso.slice(0, 10) <= range.end;

  // 任务
  const doneTasks = tasks.filter((t) => t.status === 'done' && inRange(t.completedAt));
  const doingTasks = tasks.filter((t) => t.status === 'doing');
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  // 每日计划（dailyPlans.date 在范围内；items 平铺）
  const plans = dailyPlans.filter((p) => inRange(p.date));
  const planItems = plans.flatMap((p) => (p.items || []).map((it) => ({ ...it, date: p.date })));
  const doneItems = planItems.filter((it) => it.done);
  // 健身打卡
  const fitDone = fitnessLogs.filter((l) => inRange(l.date) && l.done);
  const fitMinutes = fitDone.reduce((s, l) => s + (l.durationMin || 0), 0);
  // 灵感
  const ideas = inspirations.filter((l) => inRange(l.createdAt));

  const lines = [];
  lines.push(`# ${type === 'daily' ? '日报' : '周报'} · ${range.label}`);
  lines.push('');
  lines.push('## 一、今日/本周概述');
  lines.push(`- 完成任务 **${doneTasks.length}** 项，进行中 **${doingTasks.length}** 项，待办 **${todoTasks.length}** 项`);
  lines.push(`- ${type === 'daily' ? '今日' : '本周'}每日计划 **${planItems.length}** 项（完成 **${doneItems.length}** 项）`);
  lines.push(`- 每日模板 **${dailyTemplates.length}** 个（每周模板 **${weeklyTemplates.length}** 个），固定安排已就绪`);
  lines.push(`- 健身打卡 **${fitDone.length}** 次（累计 **${fitMinutes}** 分钟）`);
  lines.push(`- 记录灵感 **${ideas.length}** 条`);
  lines.push('');
  lines.push('## 二、完成任务');
  if (doneTasks.length === 0) lines.push('（无）');
  doneTasks.forEach((t) => {
    const p = t.projectId ? projects.find((x) => x.id === t.projectId) : null;
    lines.push(`- [x] ${t.title}${p ? `（${p.name}）` : ''}`);
  });
  lines.push('');
  lines.push('## 三、每日计划');
  if (planItems.length === 0) lines.push('（无每日计划记录）');
  planItems.forEach((it) => {
    const time = [it.startTime, it.endTime].filter(Boolean).join('-');
    lines.push(`- [${it.done ? 'x' : ' '}] ${time ? `${time} ` : ''}${it.title}${it.note ? `（${it.note}）` : ''}`);
  });
  lines.push('');
  lines.push('## 四、健身打卡');
  if (fitDone.length === 0) lines.push('（无打卡记录）');
  fitDone.forEach((l) => {
    lines.push(`- ${FIT_TYPE_LABEL[l.type] || l.type || '健身'}${l.durationMin ? ` ${l.durationMin} 分钟` : ''}${l.note ? `（${l.note}）` : ''}`);
  });
  lines.push('');
  lines.push('## 五、灵感记录');
  if (ideas.length === 0) lines.push('（无灵感记录）');
  ideas.forEach((l) => {
    const brief = String(l.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    lines.push(`- ${l.title || '未命名灵感'}${brief ? `：${brief}` : ''}`);
  });
  lines.push('');
  lines.push('## 六、进行中 / 待办');
  const open = [...todoTasks, ...doingTasks];
  if (open.length === 0) lines.push('（无）');
  open.slice(0, 15).forEach((t) => {
    lines.push(`- [ ] ${t.title}${t.dueDate ? `（截止 ${t.dueDate}）` : ''}`);
  });
  lines.push('');
  lines.push('## 七、思考与计划');
  lines.push('- （待补充：遇到的问题、' + (type === 'daily' ? '明日' : '下周') + '计划、实验安排等）');
  lines.push('');
  lines.push('---');
  lines.push('> 由「科研工作台」自动生成 · 数据本地存储');

  return { content: lines.join('\n'), dateRange: { start: range.start, end: range.end, label: range.label } };
}

/** 生成报告（可选 AI 润色），并存入 reports */
async function generate(type, date, { polish = false } = {}) {
  const draft = generateDraft(type, date);
  let content = draft.content;
  let source = 'local';
  let aiNote = null;

  if (polish) {
    const settings = store.getSettings();
    const r = await ai.polishReport(content, settings, type === 'daily' ? '日报' : '周报');
    if (r.ok) {
      content = r.content;
      source = r.source;
      aiNote = r.note || null;
    }
  }

  const report = store.create('reports', {
    type,
    dateRange: draft.dateRange,
    content,
    source,
    aiNote,
    generatedAt: new Date().toISOString()
  });
  return { report, draftContent: draft.content };
}

module.exports = { generate, generateDraft };
