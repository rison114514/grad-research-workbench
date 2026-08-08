'use strict';
/* 文献分类树 + 关联关系：纯逻辑测试（store mock） */
const { test } = require('node:test');
const assert = require('node:assert');

/* ---------- 分类过滤逻辑（与 literature.js filteredItems 同逻辑） ---------- */
function filterByCollection(items, activeCollection) {
  if (activeCollection === '__uncat__') return items.filter((l) => !(l.collectionIds || []).length);
  if (activeCollection) return items.filter((l) => (l.collectionIds || []).includes(activeCollection));
  return items;
}

const LITS = [
  { id: 'L1', title: 'A', collectionIds: ['c1', 'c2'] },
  { id: 'L2', title: 'B', collectionIds: ['c1'] },
  { id: 'L3', title: 'C', collectionIds: [] },
  { id: 'L4', title: 'D' }  // 旧数据无字段
];

test('分类过滤：全部/未分类/多分类命中', () => {
  assert.equal(filterByCollection(LITS, null).length, 4, '全部');
  const uncat = filterByCollection(LITS, '__uncat__');
  assert.deepEqual(uncat.map((l) => l.id), ['L3', 'L4'], '未分类含旧数据无字段');
  const c1 = filterByCollection(LITS, 'c1');
  assert.deepEqual(c1.map((l) => l.id), ['L1', 'L2'], '多分类命中');
  const c2 = filterByCollection(LITS, 'c2');
  assert.deepEqual(c2.map((l) => l.id), ['L1']);
});

/* ---------- litRelations 三元组去重（与 assistant-actions buildLiteratureRelations 同逻辑） ---------- */
function upsertRelations(existing, rels, idMap) {
  let created = 0, updated = 0;
  for (const rel of rels) {
    const a = Number(rel.a), b = Number(rel.b);
    if (!idMap.has(a) || !idMap.has(b) || a === b) continue;
    const [s, t] = a < b ? [a, b] : [b, a];
    const sourceId = idMap.get(s), targetId = idMap.get(t);
    const type = ['cites', 'correlated', 'extends', 'contrasts', 'topic-similar'].includes(rel.type) ? rel.type : 'correlated';
    const strength = Math.min(Math.max(Number(rel.strength) || 0.5, 0), 1);
    const reason = String(rel.reason || '').slice(0, 120);
    const exist = existing.find((x) => x.sourceId === sourceId && x.targetId === targetId && x.relationType === type);
    if (exist) { exist.strength = strength; exist.reason = reason; updated++; }
    else { existing.push({ sourceId, targetId, relationType: type, strength, reason, source: 'ai' }); created++; }
  }
  return { created, updated };
}

test('litRelations：三元组去重（重复生成覆盖不新增）', () => {
  const existing = [];
  const idMap = new Map([[0, 'L1'], [1, 'L2'], [2, 'L3']]);
  const r1 = upsertRelations(existing, [
    { a: 0, b: 1, type: 'topic-similar', strength: 0.8, reason: '同为 AI 领域' },
    { a: 0, b: 2, type: 'cites', strength: 0.6, reason: '引用' }
  ], idMap);
  assert.equal(r1.created, 2, '首轮新增 2 条');
  assert.equal(existing.length, 2);
  const r2 = upsertRelations(existing, [
    { a: 1, b: 0, type: 'topic-similar', strength: 0.95, reason: '主题一致（方向归一）' },
    { a: 2, b: 0, type: 'cites', strength: 0.7, reason: '扩展引用' }
  ], idMap);
  assert.equal(r2.created, 0, '重复不新增');
  assert.equal(r2.updated, 2, '覆盖刷新');
  assert.equal(existing.length, 2);
  assert.equal(existing[0].strength, 0.95, 'strength 已刷新');
  const self = upsertRelations(existing, [{ a: 0, b: 0, type: 'cites', strength: 1 }], idMap);
  assert.equal(self.created, 0, '自环忽略');
  const bad = upsertRelations(existing, [{ a: 0, b: 99, type: 'cites', strength: 1 }], idMap);
  assert.equal(bad.created, 0, '越界索引忽略');
});

test('litRelations：非法 type 收敛 + strength 截断', () => {
  const existing = [];
  const idMap = new Map([[0, 'L1'], [1, 'L2']]);
  const r = upsertRelations(existing, [{ a: 0, b: 1, type: 'evil', strength: 5 }], idMap);
  assert.equal(existing[0].relationType, 'correlated', '非法 type 收敛为 correlated');
  assert.equal(existing[0].strength, 1, 'strength 上限截断');
});

/* ---------- 关系 JSON 解析（literature.js parseRelationJson 同逻辑） ---------- */
function parseRelationJson(content) {
  const s = String(content || '').trim();
  const fenced = s.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  const candidate = fenced ? fenced[1] : (s.match(/\[[\s\S]*\]/) || [s])[0];
  try { const arr = JSON.parse(candidate); return Array.isArray(arr) ? arr : []; }
  catch (e) { return []; }
}

test('parseRelationJson：纯数组 / 围栏 / 损坏容错', () => {
  assert.equal(parseRelationJson('[{"a":0,"b":1,"type":"cites"}]').length, 1);
  assert.equal(parseRelationJson('以下是结果：```json\n[{"a":0,"b":1}]\n```').length, 1);
  assert.equal(parseRelationJson('无法分析').length, 0);
});
