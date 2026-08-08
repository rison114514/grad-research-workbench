'use strict';
/* 报告服务：日期兼容修复测试（report:generate 的 getFullYear bug 回归） */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

/* mock electron（纯 node 环境下 require('electron') 返回路径字符串，store 解构 app 会挂） */
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  exports: { app: { getPath: () => path.join(require('node:os').tmpdir(), 'workbench-test-userdata') } }
};

const { generateDraft } = require(path.join(__dirname, '..', 'main', 'report-service.js'));

test('日报：字符串日期（reports.js 传的 input.value）不再崩溃', () => {
  const r = generateDraft('daily', '2026-08-08');
  assert.equal(r.dateRange.start, '2026-08-08');
  assert.equal(r.dateRange.end, '2026-08-08');
  assert.ok(r.dateRange.label.includes('8月8日'), 'label 中文格式');
  assert.ok(r.content.startsWith('# 日报'), '内容为日报模板');
});

test('周报：字符串日期正确计算周区间', () => {
  const r = generateDraft('weekly', '2026-08-08');
  assert.ok(r.dateRange.start < '2026-08-08' && r.dateRange.end > '2026-08-08', '周区间包含该日期');
  assert.ok(r.dateRange.label.includes('月'), 'label 周区间');
  assert.ok(r.content.startsWith('# 周报'));
});

test('Date 对象与非法值兼容', () => {
  const d = generateDraft('daily', new Date('2026-08-08T10:00:00'));
  assert.equal(d.dateRange.start, '2026-08-08');
  const bad = generateDraft('daily', 'not-a-date');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(bad.dateRange.start), '非法值回退今天');
  const empty = generateDraft('daily', '');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(empty.dateRange.start), '空值回退今天');
  const none = generateDraft('daily');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(none.dateRange.start), 'undefined 回退今天');
});

test('日报：数据源为计划/健身/灵感（不含文献），章节完整', () => {
  // mock store 数据注入：计划/健身/灵感有数据，文献再多也不进报告
  const store = require('./../main/store.js');
  const orig = {
    tasks: store.list('tasks'),
    dailyPlans: store.list('dailyPlans'),
    fitnessLogs: store.list('fitnessLogs'),
    inspirations: store.list('inspirations'),
    literature: store.list('literature')
  };
  // 注入当日数据
  const today = new Date().toISOString().slice(0, 10);
  store.batchCreate('dailyPlans', [{ date: today, items: [{ id: 'it1', startTime: '09:00', endTime: '10:00', title: '实验设计', done: true }, { id: 'it2', startTime: '14:00', title: '写论文', done: false }] }]);
  store.batchCreate('fitnessLogs', [{ date: today, type: 'running', durationMin: 30, done: true, note: '晨跑' }]);
  store.batchCreate('inspirations', [{ title: '灵感A', content: '关于视觉测量的新想法', createdAt: new Date().toISOString() }]);
  // 文献（不应进入报告）
  store.batchCreate('literature', [{ title: '不应出现的文献', createdAt: new Date().toISOString() }]);
  try {
    const { generateDraft } = require('./../main/report-service.js');
    const r = generateDraft('daily', today);
    assert.ok(r.content.includes('今日计划 **2** 项（完成 **1** 项）'), '计划统计');
    assert.ok(r.content.includes('健身打卡 **1** 次'), '健身统计');
    assert.ok(r.content.includes('灵感 **1** 条'), '灵感统计');
    assert.ok(r.content.includes('实验设计'), '计划条目');
    assert.ok(r.content.includes('晨跑'), '健身条目');
    assert.ok(r.content.includes('灵感A'), '灵感条目');
    assert.ok(!r.content.includes('不应出现的文献'), '文献不进日报');
    assert.ok(!r.content.includes('## 四、文献阅读'), '无文献章节');
  } finally {
    // 清理注入数据
    store.list('dailyPlans').forEach((x) => store.remove('dailyPlans', x.id));
    store.list('fitnessLogs').forEach((x) => store.remove('fitnessLogs', x.id));
    store.list('inspirations').forEach((x) => store.remove('inspirations', x.id));
    store.list('literature').forEach((x) => store.remove('literature', x.id));
  }
});
