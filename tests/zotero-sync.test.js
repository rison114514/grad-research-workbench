'use strict';
/* Zotero 同步增强：collection 层级解析 + 建树幂等（settings.ensureZoteroTree mock） */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const z = require(path.join(__dirname, '..', 'main', 'zotero-service.js'));

/* ---------- mapItem：层级结构 ---------- */
const tree = [
  { key: 'AAA', name: '深度学习', parentKey: null },
  { key: 'BBB', name: 'Transformer', parentKey: 'AAA' },
  { key: 'CCC', name: 'SLAM', parentKey: null }
];
const map = new Map(tree.map((t) => [t.key, t]));

test('mapItem：zoteroCollectionKeys 与 collections 层级结构', () => {
  const item = z.mapItem({
    key: 'K1', version: 3,
    data: { itemType: 'journalArticle', title: 'T', collections: ['BBB', 'CCC'], tags: [{ tag: 'x' }] }
  }, map);
  assert.deepEqual(item.zoteroCollectionKeys, ['BBB', 'CCC']);
  assert.equal(item.collections.length, 2);
  assert.equal(item.collections[0].key, 'BBB');
  assert.equal(item.collections[0].parentKey, 'AAA');
  assert.equal(item.collections[1].parentKey, null);
  assert.ok(item.tags.includes('Transformer'), 'collection 名称进 tags');
});

test('mapItem：无 collections 容错', () => {
  const item = z.mapItem({ key: 'K2', version: 1, data: { itemType: 'book', title: 'B' } }, map);
  assert.deepEqual(item.zoteroCollectionKeys, []);
  assert.deepEqual(item.collections, []);
});

/* ---------- ensureZoteroTree：建树幂等（渲染层 settings.js 逻辑，用最小 mock 验证） ---------- */
function makeSettings() {
  const db = { litCollections: [] };
  let seq = 0;
  const api = {
    store: {
      list: async (d) => JSON.parse(JSON.stringify(db[d] || [])),
      create: async (d, r) => { const it = { id: 'col-' + (++seq), createdAt: 'x', ...r }; (db[d] = db[d] || []).push(it); return JSON.parse(JSON.stringify(it)); },
      update: async (d, id, p) => { const a = db[d] || []; const i = a.findIndex((x) => x.id === id); if (i < 0) return null; a[i] = { ...a[i], ...p }; return JSON.parse(JSON.stringify(a[i])); }
    }
  };
  const settings = {
    /* 与线上 settings.js ensureZoteroTree 同逻辑的简化可测版 */
    async ensureZoteroTree(collections, userName) {
      const cols = await api.store.list('litCollections');
      const rootName = `${userName} 的 Zotero 同步`;
      let root = cols.find((c) => c.source === 'zotero' && c.zoteroKey === 'ROOT');
      if (!root) {
        root = await api.store.create('litCollections', { name: rootName, parentId: null, order: 0, source: 'zotero', zoteroKey: 'ROOT', readOnly: true });
        cols.push(root);
      } else if (root.name !== rootName) {
        await api.store.update('litCollections', root.id, { name: rootName });
      }
      const map = new Map();
      const nodes = {};
      for (const c of collections || []) {
        let local = cols.find((x) => x.source === 'zotero' && x.zoteroKey === c.key);
        if (!local) {
          local = await api.store.create('litCollections', { name: c.name, parentId: null, order: 0, source: 'zotero', zoteroKey: c.key, readOnly: true });
          cols.push(local);
        }
        nodes[c.key] = local.id;
        map.set(c.key, local.id);
      }
      for (const c of collections || []) {
        const localId = nodes[c.key];
        const parentId = c.parentKey && nodes[c.parentKey] ? nodes[c.parentKey] : root.id;
        const cur = cols.find((x) => x.id === localId);
        if (cur && cur.parentId !== parentId) await api.store.update('litCollections', localId, { parentId });
      }
      return map;
    }
  };
  return { api, settings, db };
}

test('ensureZoteroTree：首次建树（根 + 层级 + 顶层挂根）', async () => {
  const { settings, db } = makeSettings();
  const colMap = await settings.ensureZoteroTree(tree, '张三');
  assert.equal(db.litCollections.length, 4, '根 + 3 个 collection');
  const root = db.litCollections.find((c) => c.zoteroKey === 'ROOT');
  assert.equal(root.name, '张三 的 Zotero 同步');
  assert.equal(root.readOnly, true);
  const aaa = db.litCollections.find((c) => c.zoteroKey === 'AAA');
  const bbb = db.litCollections.find((c) => c.zoteroKey === 'BBB');
  const ccc = db.litCollections.find((c) => c.zoteroKey === 'CCC');
  assert.equal(bbb.parentId, aaa.id, 'BBB 挂在 AAA 下');
  assert.equal(aaa.parentId, root.id, '顶层挂根');
  assert.equal(ccc.parentId, root.id);
  assert.equal(colMap.get('BBB'), bbb.id, '映射 zoteroKey → 本地 id');
});

test('ensureZoteroTree：重复同步幂等（不重复建节点）', async () => {
  const { settings, db } = makeSettings();
  await settings.ensureZoteroTree(tree, '张三');
  const colMap2 = await settings.ensureZoteroTree(tree, '张三');
  assert.equal(db.litCollections.length, 4, '二次同步不新增节点');
  const bbb = db.litCollections.find((c) => c.zoteroKey === 'BBB');
  assert.equal(colMap2.get('BBB'), bbb.id, '复用同一节点');
});

test('ensureZoteroTree：用户名变化时更新根名称', async () => {
  const { settings, db } = makeSettings();
  await settings.ensureZoteroTree(tree, '张三');
  await settings.ensureZoteroTree(tree, '张三新名');
  const root = db.litCollections.find((c) => c.zoteroKey === 'ROOT');
  assert.equal(root.name, '张三新名 的 Zotero 同步');
  assert.equal(db.litCollections.length, 4, '仍不新增');
});
