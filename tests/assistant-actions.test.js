'use strict';
/* AI 助手动作框架测试（node --test tests/ 运行，无需任何依赖） */
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ACTIONS_PATH = path.join(__dirname, '..', 'renderer', 'js', 'assistant-actions.js');

/* ---------------- mock 环境 ---------------- */
const db = {
  tasks: [], activity: [], dailyPlans: [], timeLogs: [], fitnessPlans: [], fitnessLogs: [],
  reports: [], settings: [{}]
};
let seq = 0;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const tomorrow = () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function mockParseNaturalTask(text) {
  const out = { title: text, dueDate: null, priority: 'medium' };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  let m;
  if ((m = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/))) out.dueDate = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  else if ((m = text.match(/(\d{1,2})月(\d{1,2})日/))) out.dueDate = `${now.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  else if (text.includes('明天')) out.dueDate = fmt(shift(now, 1));
  else if (text.includes('后天')) out.dueDate = fmt(shift(now, 2));
  else if (text.includes('今天')) out.dueDate = fmt(now);
  if (/紧急|重要|加急|优先/.test(text)) out.priority = 'high';
  else if (/有空|不急|随便/.test(text)) out.priority = 'low';
  out.title = text
    .replace(/(明天|后天|今天)\s*/g, '')
    .replace(/(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{1,2}月\d{1,2}日|周[一二三四五六日天])\s*/g, '')
    .replace(/^[：:，,\s]+|[，,\s]+$/g, '')
    .trim() || text;
  return out;
}

global.window = {
  api: {
    store: {
      list: async (domain) => JSON.parse(JSON.stringify(db[domain] || [])),
      create: async (domain, record) => {
        const item = { id: `m-${++seq}`, createdAt: new Date().toISOString(), ...JSON.parse(JSON.stringify(record)) };
        (db[domain] = db[domain] || []).push(item);
        return JSON.parse(JSON.stringify(item));
      },
      update: async (domain, id, patch) => {
        const items = db[domain] || [];
        const idx = items.findIndex((i) => i.id === id);
        if (idx < 0) return null;
        items[idx] = { ...items[idx], ...JSON.parse(JSON.stringify(patch)) };
        return JSON.parse(JSON.stringify(items[idx]));
      },
      remove: async (domain, id) => {
        const items = db[domain] || [];
        const idx = items.findIndex((i) => i.id === id);
        if (idx < 0) return false;
        items.splice(idx, 1);
        return true;
      }
    },
    ai: {
      parseNaturalTask: async (t) => mockParseNaturalTask(t),
      splitTask: async (title) => ({ ok: true, goal: `完成「${title}」`, deliverable: `${title}的交付`, items: ['明确目标', '收集资料', '执行并记录', '检查复盘'] })
    },
    report: {
      generate: async (type, date) => {
        db.reports.push({ id: `rep-${++seq}`, type, dateRange: { label: date }, content: `# ${type === 'weekly' ? '周报' : '日报'} · ${date}\n\n- 已完成 1 项`, generatedAt: new Date().toISOString() });
        return { report: db.reports[db.reports.length - 1], draftContent: '' };
      }
    }
  },
  Tasks: { render() { global.__tasksRendered = (global.__tasksRendered || 0) + 1; } },
  Board: { invalidate() { global.__boardInvalidated = (global.__boardInvalidated || 0) + 1; } },
  DailyPlan: { state: { date: '' }, async render() { global.__dailyPlanRendered = (global.__dailyPlanRendered || 0) + 1; } },
  Time: { async render() { global.__timeRendered = (global.__timeRendered || 0) + 1; } },
  Fitness: { async render() { global.__fitnessRendered = (global.__fitnessRendered || 0) + 1; } }
};
global.App = { todayStr: () => today(), esc: (s) => String(s), markdown: (s) => s };

let A;
before(() => { A = require(ACTIONS_PATH); });

function reset() {
  ['tasks', 'activity', 'dailyPlans', 'timeLogs', 'fitnessPlans', 'fitnessLogs', 'reports'].forEach((d) => { db[d] = []; });
  global.__tasksRendered = 0; global.__boardInvalidated = 0; global.__dailyPlanRendered = 0; global.__timeRendered = 0; global.__fitnessRendered = 0;
}

/* ---------------- 意图匹配 ---------------- */
test('正例：任务/计划/时间/健身/拆解/报告/帮助 命中对应动作', () => {
  assert.equal(A.match('帮我新增每日任务'), 'addTask');
  assert.equal(A.match('帮我添加任务 明天下午 完成实验设计（高优先级）'), 'addTask');
  assert.equal(A.match('记一下 整理实验数据'), 'addTask');
  assert.equal(A.match('安排 明天9点到11点 写论文'), 'addDailyPlan');
  assert.equal(A.match('记录 学习 2小时'), 'addTimeLog');
  assert.equal(A.match('打卡 跑步 30分钟'), 'addFitnessLog');
  assert.equal(A.match('帮我拆解 撰写论文第二章'), 'splitTask');
  assert.equal(A.match('总结我的任务进度'), 'queryStats');
  assert.equal(A.match('看看今天的计划'), 'queryDailyPlan');
  assert.equal(A.match('今天时间都花哪了'), 'queryTimeLog');
  assert.equal(A.match('我的健身进度'), 'queryFitness');
  assert.equal(A.match('帮我生成今天的日报'), 'generateReport');
  assert.equal(A.match('你能做什么'), 'help');
});

test('健身计划：新建/规划/查询 三类意图正确区分', () => {
  // 用户报告的两个误判场景：新建/规划运动计划不应被查询吞掉
  assert.equal(A.match('帮我新建一个运动计划并保存'), 'addFitnessPlan');
  assert.equal(A.match('你帮我规划一个运动计划，我每天有大概半小时时间锻炼，最近很久没锻炼了'), 'planFitnessPlan');
  assert.equal(A.match('新建一个跑步计划 每周5次 每次30分钟'), 'addFitnessPlan');
  assert.equal(A.match('你帮我添加任务 明天 写论文'), 'addTask');
  assert.equal(A.match('你帮我安排 明天9点到11点 写论文'), 'addDailyPlan');
  assert.equal(A.match('我的健身进度'), 'queryFitness');
  assert.equal(A.match('本周健身情况'), 'queryFitness');
  assert.equal(A.match('打卡 跑步 30分钟'), 'addFitnessLog');
});

test('负例：非任务/文献/闲聊 不误命中；否定与疑问回退 AI', () => {
  assert.equal(A.match('帮我添加文献'), null);
  assert.equal(A.match('帮我写论文摘要'), null);
  assert.equal(A.match('记一下笔记'), null);
  assert.equal(A.match('今天天气如何'), null);
  assert.equal(A.match('帮我删除任务'), null);
  assert.equal(A.match('hello'), null);
  // 审查 P1-4：否定句 / 疑问句不触发副作用动作
  assert.equal(A.match('我不想做日报'), null, '否定句不生成报告');
  assert.equal(A.match('你能帮助我分析这篇论文吗'), null, '疑问句不命中帮助菜单');
  assert.equal(A.match('写日报需要准备什么'), null, '疑问句不生成报告');
  assert.equal(A.match('别加任务'), null, '否定句不新增任务');
});

test('查询不受弱疑问影响（无副作用）', () => {
  assert.equal(A.match('今天有什么计划'), 'queryDailyPlan');
});

/* ---------------- 审查 P1-2：每日任务标题 ---------------- */
test('「帮我新增每日任务：背单词」→ 标题为「背单词」，无「任务：」残留', async () => {
  reset();
  const r = await A.addTask('帮我新增每日任务：背单词');
  assert.equal(db.tasks.length, 1, '应创建 1 条任务');
  assert.equal(db.tasks[0].title, '背单词', `实际标题: ${db.tasks[0].title}`);
  assert.equal(db.tasks[0].dueDate, today(), '每日任务截止今天');
  assert.ok(r.includes('已按单次记录'), '回复注明单次记录');
});

test('「帮我新增每日任务」无具体内容 → 拒建并引导', async () => {
  reset();
  const r = await A.addTask('帮我新增每日任务');
  assert.equal(db.tasks.length, 0, '不应创建');
  assert.ok(/没能|缺少/.test(r), `有拒建提示: ${r.slice(0, 60)}`);
});

/* ---------------- 审查 P1-3：包含「和」的单一任务 ---------------- */
test('「添加任务：整理实验数据和图表」→ 1 条完整标题（不按「和」拆分）', async () => {
  reset();
  await A.addTask('添加任务：整理实验数据和图表');
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].title, '整理实验数据和图表');
});

test('顿号列表 + 上限：预览确认后最多创建 3 条', async () => {
  reset();
  const result = await A.addTask('添加任务：写论文、读文献、健身、买菜');
  assert.ok(result && result.needsConfirm, '多任务走预览确认');
  const r = await result.apply();
  assert.equal(db.tasks.length, 3, `应 3 条，实际 ${db.tasks.length}`);
  assert.ok(r.includes('上限'), '回复提示超出上限');
});

test('编号列表可拆多任务（确认后创建）', async () => {
  reset();
  const result = await A.addTask('添加任务：1. 写论文 2. 读文献 3. 健身');
  assert.ok(result && result.needsConfirm);
  await result.apply();
  assert.equal(db.tasks.length, 3);
});

/* ---------------- 落库与刷新 ---------------- */
test('单条明确任务直接创建并刷新任务页/看板', async () => {
  reset();
  const r = await A.addTask('帮我添加任务 明天下午 完成实验设计（高优先级）');
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].title, '完成实验设计');
  assert.equal(db.tasks[0].priority, 'high');
  assert.equal(db.tasks[0].dueDate, tomorrow());
  assert.equal(db.activity.length, 1, '写入活动记录');
  assert.equal(global.__tasksRendered, 1, '刷新任务页');
  assert.equal(global.__boardInvalidated, 1, '刷新看板');
  assert.ok(r.includes('完成实验设计'));
});

test('多任务 → 返回 needsConfirm 预览，确认后落库', async () => {
  reset();
  const result = await A.addTask('添加任务：整理实验数据、阅读综述');
  assert.ok(result && result.needsConfirm, '歧义输入应返回确认卡片');
  assert.ok(result.preview.includes('整理实验数据'));
  const reply = await result.apply();
  assert.equal(db.tasks.length, 2, '确认后创建 2 条');
  assert.ok(reply.includes('已创建任务'));
});

test('重复发送同一指令：两条均正常创建', async () => {
  reset();
  await A.addTask('添加任务 写实验报告');
  await A.addTask('添加任务 写实验报告');
  assert.equal(db.tasks.length, 2);
  assert.deepEqual(db.tasks.map((t) => t.title), ['写实验报告', '写实验报告']);
});

/* ---------------- 审查 P2-7：API 报错不产生半条数据 ---------------- */
test('store.create 抛错 → 返回错误，不落半条、activity 不写', async () => {
  reset();
  const orig = window.api.store.create;
  window.api.store.create = async (domain, record) => {
    if (domain === 'tasks') throw new Error('磁盘写入失败');
    return orig(domain, record);
  };
  let reply = '';
  try { reply = await A.addTask('添加任务 写论文'); } catch (e) { reply = `ERR:${e.message}`; }
  window.api.store.create = orig;
  assert.equal(db.tasks.length, 0, '无半条任务');
  assert.equal(db.activity.length, 0, 'activity 不写');
  assert.ok(/ERR|没能创建|失败/.test(reply), `应有错误反馈: ${reply}`);
});

test('activity 写入失败不阻断任务创建', async () => {
  reset();
  const orig = window.api.store.create;
  window.api.store.create = async (domain, record) => {
    if (domain === 'activity') throw new Error('activity 失败');
    return orig(domain, record);
  };
  const reply = await A.addTask('添加任务 写论文');
  window.api.store.create = orig;
  assert.equal(db.tasks.length, 1, '任务仍创建成功');
  assert.ok(reply.includes('已创建任务'));
});

/* ---------------- 审查 P2-6：报告不意外重复生成 ---------------- */
test('否定句不生成报告；明确命令只生成一次', async () => {
  reset();
  assert.equal(A.match('我不想做日报'), null);
  assert.equal(db.reports.length, 0);
  await A.generateReport('帮我生成今天的日报');
  assert.equal(db.reports.length, 1, '明确命令生成一次');
});

/* ---------------- 三模块动作 ---------------- */
test('addDailyPlan：安排 明天9点到11点 写论文 → 落库并刷新', async () => {
  reset();
  const r = await A.addDailyPlan('安排 明天9点到11点 写论文');
  assert.equal(db.dailyPlans.length, 1);
  const plan = db.dailyPlans[0];
  assert.equal(plan.date, tomorrow());
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].title, '写论文');
  assert.equal(plan.items[0].startTime, '09:00');
  assert.equal(plan.items[0].endTime, '11:00');
  assert.equal(plan.items[0].type, 'study');
  assert.equal(window.DailyPlan.state.date, tomorrow(), '刷新时同步选中日期');
  assert.equal(global.__dailyPlanRendered, 1);
  assert.ok(r.includes('已加入计划'));
});

test('queryDailyPlan：查看今天的计划', async () => {
  reset();
  await A.createDailyPlanStructured({ date: today(), startTime: '09:00', endTime: '10:00', title: '晨会', type: 'meeting' });
  const r = await A.queryDailyPlan('看看今天的计划');
  assert.ok(r.includes('晨会'));
  assert.ok(r.includes('会议'));
});

test('addTimeLog：记录 学习 2小时 → 120 分钟 study', async () => {
  reset();
  const r = await A.addTimeLog('记录 学习 2小时');
  assert.equal(db.timeLogs.length, 1);
  assert.equal(db.timeLogs[0].category, 'study');
  assert.equal(db.timeLogs[0].minutes, 120);
  assert.equal(global.__timeRendered, 1);
  assert.ok(r.includes('2 小时'));
});

test('queryTimeLog：时间分布聚合', async () => {
  reset();
  await A.createTimeLogStructured({ date: today(), category: 'study', minutes: 120 });
  await A.createTimeLogStructured({ date: today(), category: 'sport', minutes: 30 });
  const r = await A.queryTimeLog('今天时间都花哪了');
  assert.ok(r.includes('学习') && r.includes('运动'));
});

test('addFitnessLog：打卡 跑步 30分钟 → running/30', async () => {
  reset();
  const r = await A.addFitnessLog('打卡 跑步 30分钟');
  assert.equal(db.fitnessLogs.length, 1);
  assert.equal(db.fitnessLogs[0].type, 'running');
  assert.equal(db.fitnessLogs[0].durationMin, 30);
  assert.equal(global.__fitnessRendered, 1);
  assert.ok(r.includes('跑步'));
});

test('queryFitness：计划完成率与连续天数', async () => {
  reset();
  db.fitnessPlans.push({ id: 'fp-1', name: '晨跑', type: 'running', weeklyGoal: 3, durationGoal: 30 });
  await A.createFitnessLogStructured({ date: today(), type: 'running', durationMin: 30 });
  const r = await A.queryFitness();
  assert.ok(r.includes('本周打卡'), `含本周打卡: ${r.slice(0, 80)}`);
  assert.ok(r.includes('晨跑'));
  assert.ok(r.includes('连续'), '含连续天数统计');
});

test('addFitnessPlan：新建运动计划并保存 → 落库并刷新', async () => {
  reset();
  const r = await A.addFitnessPlan('帮我新建一个运动计划并保存');
  assert.equal(db.fitnessPlans.length, 1, '创建 1 条健身计划');
  assert.equal(db.fitnessPlans[0].weeklyGoal, 3);
  assert.equal(db.fitnessPlans[0].durationGoal, 30);
  assert.equal(global.__fitnessRendered, 1, '刷新健身页');
  assert.ok(r.includes('已创建健身计划'));
});

test('addFitnessPlan：解析每周次数与单次时长', async () => {
  reset();
  await A.addFitnessPlan('新建一个跑步计划 每周5次 每次30分钟');
  const p = db.fitnessPlans[0];
  assert.equal(p.type, 'running');
  assert.equal(p.weeklyGoal, 5);
  assert.equal(p.durationGoal, 30);
});

test('addFitnessPlan：每天锻炼 → 每周 7 次，恢复期备注', async () => {
  reset();
  await A.createFitnessPlanStructured({ name: '恢复训练', type: 'running', weeklyGoal: 7, durationGoal: 30, note: '恢复期，循序渐进' });
  const p = db.fitnessPlans[0];
  assert.equal(p.weeklyGoal, 7);
  assert.ok(p.note.includes('恢复'));
});

test('planFitnessPlan：返回草案卡（不落库，含一周安排）', async () => {
  const r = A.planFitnessPlan('帮我规划一个运动计划 每天半小时');
  assert.ok(r && r.needsConfirm && r.mode === 'draft' && r.action === 'addFitnessPlan', '返回草案卡');
  assert.ok(r.preview.includes('周一') && r.preview.includes('周日'), '一周 7 天安排');
  assert.ok(r.preview.includes('保存后才写入'), '明确不默认落库');
  const params = r.params;
  assert.ok(Array.isArray(params.schedule) && params.schedule.length === 7, '草案含 7 天 schedule');
  assert.equal(params.durationGoal, 30);
});

/* ---------------- 语义层结构化执行（白名单） ---------------- */
test('executeStructured：addTask 参数化创建（语义层入口）', async () => {
  reset();
  const r = await A.executeStructured('addTask', { title: '写毕业论文第二章', priority: 'high', dueDate: tomorrow() });
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].title, '写毕业论文第二章');
  assert.ok(r.includes('已创建任务'));
});

test('executeStructured：参数校验（非法日期/空标题被拒绝）', async () => {
  reset();
  const r1 = await A.executeStructured('addTask', { title: '', priority: 'high' });
  assert.equal(db.tasks.length, 0);
  assert.ok(r1.includes('未能创建'));
  const r2 = await A.executeStructured('addDailyPlan', { date: '2026-13-99', title: 'x' });
  assert.ok(r2.includes('未能加入计划') || db.dailyPlans.length === 0);
});

test('canExecute 白名单：拆解不在白名单（防副作用滥用）；报告已按需求接入', () => {
  assert.equal(A.canExecute('addTask'), true);
  assert.equal(A.canExecute('addDailyPlan'), true);
  assert.equal(A.canExecute('addTimeLog'), true);
  assert.equal(A.canExecute('addFitnessLog'), true);
  assert.equal(A.canExecute('addFitnessPlan'), true);
  assert.equal(A.canExecute('splitTask'), false, '拆解仍不在白名单（人工确认流程）');
  assert.equal(A.canExecute('generateReport'), true, '日报生成已接入 Agent（用户需求，走确认卡）');
  assert.equal(A.canExecute('evil'), false);
});

/* ---------------- 修改/删除/建议（每日计划 + 时间记录） ---------------- */
test('updateDailyPlan：把明天9点的写论文改到下午2点', async () => {
  reset();
  await A.createDailyPlanStructured({ date: tomorrow(), startTime: '09:00', endTime: '10:00', title: '写论文', type: 'study' });
  const r = await A.updateDailyPlan('把明天9点的写论文改到下午2点');
  const plan = db.dailyPlans[0];
  assert.equal(plan.items[0].startTime, '14:00', `actual: ${plan.items[0].startTime}`);
  assert.equal(plan.items[0].title, '写论文');
  assert.ok(r.includes('已修改计划项'));
  assert.equal(window.DailyPlan.state.date, tomorrow(), '刷新同步日期');
});

test('updateDailyPlan：删除明天的组会', async () => {
  reset();
  await A.createDailyPlanStructured({ date: tomorrow(), startTime: '15:00', endTime: '16:00', title: '课题组会', type: 'meeting' });
  await A.createDailyPlanStructured({ date: tomorrow(), startTime: '09:00', endTime: '10:00', title: '写论文', type: 'study' });
  const r = await A.updateDailyPlan('删除明天的组会');
  assert.equal(db.dailyPlans[0].items.length, 1);
  assert.equal(db.dailyPlans[0].items[0].title, '写论文');
  assert.ok(r.includes('已删除'));
});

test('updateDailyPlan：目标不存在 → 友好提示且不改数据', async () => {
  reset();
  await A.createDailyPlanStructured({ date: tomorrow(), startTime: '09:00', endTime: '10:00', title: '写论文', type: 'study' });
  const r = await A.updateDailyPlan('删除明天的晨跑');
  assert.equal(db.dailyPlans[0].items.length, 1);
  assert.ok(r.includes('没有找到'));
});

test('updateTimeLog：把今天的学习记录改成 1小时', async () => {
  reset();
  await A.createTimeLogStructured({ date: today(), category: 'study', minutes: 120 });
  const r = await A.updateTimeLog('把今天的学习记录改成 1小时');
  assert.equal(db.timeLogs[0].minutes, 60);
  assert.equal(global.__timeRendered, 2, '修改后刷新时间页');
  assert.ok(r.includes('已修改时间记录'));
});

test('updateTimeLog：删除今天的学习记录', async () => {
  reset();
  await A.createTimeLogStructured({ date: today(), category: 'study', minutes: 90 });
  const r = await A.updateTimeLog('删除今天的学习记录');
  assert.equal(db.timeLogs.length, 0);
  assert.ok(r.includes('已删除时间记录'));
});

test('updateTimeLogStructured：语义层参数化修改', async () => {
  reset();
  await A.createTimeLogStructured({ date: today(), category: 'sport', minutes: 30 });
  const r = await A.updateTimeLogStructured({ date: today(), matchCategory: 'sport', minutes: 45 });
  assert.equal(db.timeLogs[0].minutes, 45);
  assert.ok(r.includes('已修改'));
});

test('updateDailyPlanStructured：语义层删除', async () => {
  reset();
  await A.createDailyPlanStructured({ date: today(), startTime: '10:00', endTime: '11:00', title: '晨会', type: 'meeting' });
  const r = await A.updateDailyPlanStructured({ date: today(), matchTitle: '晨会', delete: true });
  assert.equal(db.dailyPlans[0].items.length, 0);
  assert.ok(r.includes('已删除'));
});

test('suggestInsights：生成洞察建议（逾期/计划/时间/健身）', async () => {
  reset();
  const d = new Date(); d.setDate(d.getDate() - 2);
  db.tasks.push({ id: 't-ov', title: '交实验报告', status: 'todo', dueDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` });
  db.dailyPlans.push({ id: 'dp-1', date: today(), items: [{ id: 'i1', startTime: '09:00', endTime: '10:00', title: '写论文', type: 'study', done: true }, { id: 'i2', startTime: '14:00', endTime: '15:00', title: '组会', type: 'meeting', done: false }] });
  db.timeLogs.push({ id: 'tl-1', date: today(), category: 'rest', minutes: 240 });
  const r = await A.suggestInsights();
  assert.ok(r.includes('洞察'));
  assert.ok(r.includes('已逾期') || r.includes('任务已逾期'));
  assert.ok(r.includes('待办事项完成'));
  assert.ok(r.includes('休息'));
  assert.ok(r.includes('健身'));
});

test('suggestInsights：数据为空时给出引导', async () => {
  reset();
  const r = await A.suggestInsights();
  assert.ok(r.includes('今天还没有日程安排'));
  assert.ok(r.includes('时间记录'));
});

/* ---------------- S4-S6：草案卡 / 确认卡 / 礼貌请求 / schedule ---------------- */
test('S5：礼貌请求识别（你能帮我X吗 → 动作路由）', () => {
  assert.equal(A.match('你能帮我制定一个健身计划吗'), 'planFitnessPlan');
  assert.equal(A.match('你能帮我添加一个任务吗'), 'addTask');
  assert.equal(A.match('你能帮我新建一个健身计划吗'), 'addFitnessPlan');
  assert.equal(A.match('这个计划合理吗'), null, '查询句不触发动作');
  assert.equal(A.match('你知道怎么制定计划吗'), null, '能力询问交语义层');
  assert.equal(A.match('不要帮我制定计划好吗'), null, '否定句不触发');
});

test('S6：createFitnessPlanDraft 不落库，含 7 天 schedule', async () => {
  reset();
  const draft = A.createFitnessPlanDraft({ type: 'running', durationGoal: 30, weeklyGoal: 3 });
  assert.equal(db.fitnessPlans.length, 0, '草案不落库');
  assert.ok(Array.isArray(draft.schedule) && draft.schedule.length === 7);
  assert.equal(draft.schedule[0].day, '一');
  assert.equal(draft.schedule[0].type, 'running', '第 1 天运动');
  assert.equal(draft.schedule[3].type, 'rest', '第 4 天为休息日（周目标 3）');
});

test('S4：buildDraftCard 确认后落库（含 schedule）', async () => {
  reset();
  const draft = A.createFitnessPlanDraft({ type: 'running', durationGoal: 30, weeklyGoal: 3 });
  const card = A.buildDraftCard('addFitnessPlan', draft, ['低强度']);
  assert.ok(card.needsConfirm && card.mode === 'draft');
  assert.equal(db.fitnessPlans.length, 0, '未确认前不落库');
  const reply = await card.apply();
  assert.equal(db.fitnessPlans.length, 1, '确认后落库');
  assert.ok(Array.isArray(db.fitnessPlans[0].schedule), 'schedule 一并保存');
  assert.ok(reply.includes('已创建健身计划'));
});

test('S4：buildActionCard 确认后执行', async () => {
  reset();
  const card = A.buildActionCard('addTimeLog', { date: today(), category: 'study', minutes: 60 }, []);
  assert.ok(card.needsConfirm && card.mode === 'action');
  assert.equal(db.timeLogs.length, 0, '未确认前不落库');
  const reply = await card.apply();
  assert.equal(db.timeLogs.length, 1);
  assert.ok(reply.includes('已记录'));
});

test('S4：formatActionPreview 参数可读', () => {
  const p = A.formatActionPreview('addFitnessPlan', { name: '晨跑计划', weeklyGoal: 5, durationGoal: 30 });
  assert.ok(p.includes('每周 5 次'));
  const d = A.formatActionPreview('updateDailyPlan', { date: tomorrow(), matchTitle: '组会', delete: true });
  assert.ok(d.includes('删除'));
});

test('S4：AI 推断动作默认走确认卡（不直落库）', async () => {
  reset();
  // 模拟语义层输出 action → buildActionCard 而非直接 executeStructured
  const intent = { mode: 'action', action: 'addTask', params: { title: '写综述', priority: 'high' }, assumptions: [] };
  const card = A.buildActionCard(intent.action, intent.params, intent.assumptions);
  assert.equal(db.tasks.length, 0, '动作卡创建不落库');
  await card.apply();
  assert.equal(db.tasks.length, 1, '确认后落库');
});

test('S3：parseIntentJson 损坏 JSON 落 chat 零副作用', () => {
  // 从 assistant.js 提取线上同函数验证（同作用域：isIntentShape + INTENT_TEACHING_RE + parseIntentJson）
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'assistant.js'), 'utf-8');
  const shapeSrc = src.match(/function isIntentShape[\s\S]*?\n}/);
  const teachRe = src.match(/const INTENT_TEACHING_RE = (.+);/);
  const fnSrc = src.match(/function parseIntentJson\(content\) \{[\s\S]*?\n\}/);
  const fn = eval('(function(){ ' + shapeSrc[0] + '\nconst INTENT_TEACHING_RE = ' + teachRe[1] + ';\n' + fnSrc[0] + '\nreturn parseIntentJson; })()');
  assert.equal(fn('完全不是 JSON 的文本').mode, 'chat', '损坏内容 → chat');
  const broken = fn('{"mode":"action","action":"addTask","params":{ 未闭合');
  assert.equal(broken.mode, 'chat', '未闭合 JSON → chat 兜底');
  const ok = fn('{"mode":"proposal","action":"addFitnessPlan","params":{"type":"running"},"assumptions":["每周3次"],"content":"草案"}');
  assert.equal(ok.mode, 'proposal');
  assert.equal(ok.action, 'addFitnessPlan');
});

/* ---------------- 每日计划批量安排（addDailyPlanMulti） ---------------- */
test('用户长文本不再误建任务 → addDailyPlanMulti', () => {
  const input = '帮我新增一个每日计划，我每天九点要到教研室打卡，然后需要做自媒体内容，需要做老师的学术内容，还需要做兼职，去推特刷新闻发帖子，帮我安排每日的计划';
  assert.equal(A.match(input), 'addDailyPlanMulti', '多事项每日计划不误建任务');
});

test('多时间段文本 → addDailyPlanMulti；单时间段范围仍 → addDailyPlan', () => {
  assert.equal(A.match('帮我安排明天上午9点开组会 下午2点写论文'), 'addDailyPlanMulti');
  assert.equal(A.match('安排 明天9点到11点 写论文'), 'addDailyPlan', '时间段范围是单条');
});

test('「计划」语境不再归任务；任务对象词不受影响', () => {
  assert.equal(A.match('帮我新增每日任务'), 'addTask');
  assert.equal(A.match('帮我添加任务 明天下午 完成实验设计（高优先级）'), 'addTask');
  assert.equal(A.match('帮我新增一个每日计划，九点打卡'), 'addDailyPlanMulti');
});

test('addDailyPlanMulti：解析多事项 + 中文数字时间 + 草案卡不落库', async () => {
  reset();
  const card = A.addDailyPlanMulti('帮我新增一个每日计划，我每天九点要到教研室打卡，然后需要做自媒体内容，还需要做兼职，帮我安排每日的计划');
  assert.ok(card && card.needsConfirm && card.mode === 'draft', '返回草案卡');
  assert.equal(db.dailyPlans.length, 0, '未确认不落库');
  const items = card.params.items;
  assert.ok(items.length >= 3, `解析 ≥3 项，实际 ${items.length}`);
  assert.equal(items[0].startTime, '09:00', '九点 → 09:00');
  assert.ok(items[0].title.includes('教研室打卡') && !items[0].title.includes('九点'), '标题清洗无时间词');
  const reply = await card.apply();
  assert.equal(db.dailyPlans.length, 1, '确认后落库');
  assert.ok(reply.includes('已加入每日计划'));
});

test('addDailyPlanMulti：下午两点 → 14:00（12 小时制）', () => {
  const card = A.addDailyPlanMulti('帮我安排计划，下午两点开组会，然后四点写论文');
  assert.equal(card.params.items[0].startTime, '14:00');
  assert.ok(!card.params.items[0].title.includes('两点'));
});

test('addDailyPlanMulti：createDailyPlanMultiStructured 语义层入口', async () => {
  reset();
  const r = await A.createDailyPlanMultiStructured({ date: tomorrow(), items: [{ startTime: '09:00', endTime: '10:00', title: '组会', type: 'meeting' }, { startTime: '14:00', endTime: '16:00', title: '写论文', type: 'study' }] });
  assert.equal(db.dailyPlans.length, 1);
  assert.equal(db.dailyPlans[0].items.length, 2);
  assert.ok(r.includes('已加入每日计划'));
});

test('addDailyPlanMulti：无事项 → 引导补充', () => {
  const r = A.addDailyPlanMulti('帮我新增一个每日计划');
  assert.ok(typeof r === 'string' && r.includes('没识别出'), '无事项引导补充');
});
