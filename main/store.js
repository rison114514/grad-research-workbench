'use strict';

/**
 * 本地数据存储层
 * 每个数据域一个 JSON 文件，保存在 Electron userData/data 目录下，
 * 全部数据严格本地存储。写入采用「临时文件 + 原子重命名」，避免损坏。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOMAINS = ['tasks', 'projects', 'literature', 'inspirations', 'reports', 'githubSubs', 'agentTasks', 'activity', 'settings', 'timeLogs', 'dailyPlans', 'dailyTemplates', 'weeklyTemplates', 'fitnessPlans', 'fitnessLogs', 'assistantSessions', 'assistantMessages', 'litCollections', 'litRelations'];

const memoryCache = {};

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(domain) {
  return path.join(dataDir(), `${domain}.json`);
}

function ensureDomain(domain) {
  if (!DOMAINS.includes(domain)) throw new Error(`未知数据域: ${domain}`);
}

function load(domain) {
  ensureDomain(domain);
  if (memoryCache[domain]) return memoryCache[domain];
  const fp = fileFor(domain);
  let data = [];
  if (fs.existsSync(fp)) {
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      data = raw.trim() ? JSON.parse(raw) : [];
    } catch (e) {
      console.error(`[store] 读取 ${domain} 失败，使用空数据:`, e.message);
      data = [];
    }
  }
  memoryCache[domain] = data;
  return data;
}

function persist(domain) {
  const data = memoryCache[domain] || [];
  const fp = fileFor(domain);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, fp);
}

function newId() {
  return crypto.randomUUID();
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameFieldState(record, field, hadField, value) {
  const hasField = Object.prototype.hasOwnProperty.call(record, field);
  return hasField === hadField && (!hadField || sameValue(record[field], value));
}

/* ---------------- 通用 CRUD ---------------- */

function list(domain) {
  return load(domain);
}

function get(domain, id) {
  return load(domain).find((x) => x.id === id) || null;
}

function create(domain, record) {
  const listRef = load(domain);
  const item = { id: newId(), createdAt: new Date().toISOString(), ...record };
  listRef.push(item);
  persist(domain);
  return item;
}

function update(domain, id, patch) {
  const listRef = load(domain);
  const idx = listRef.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  listRef[idx] = { ...listRef[idx], ...patch, updatedAt: new Date().toISOString() };
  persist(domain);
  return listRef[idx];
}

function remove(domain, id) {
  const listRef = load(domain);
  const idx = listRef.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  listRef.splice(idx, 1);
  persist(domain);
  return true;
}

/** 批量创建（单次持久化，降低 IPC 与磁盘写入次数） */
function batchCreate(domain, records) {
  const listRef = load(domain);
  const created = (records || []).map((r) => {
    const item = { id: newId(), createdAt: new Date().toISOString(), ...r };
    listRef.push(item);
    return item;
  });
  if (created.length) persist(domain);
  return created;
}

/** 按唯一键 upsert（如 zoteroKey）：存在则更新并返回 {created:false}，否则创建 */
function upsertBy(domain, keyField, record) {
  const listRef = load(domain);
  const key = record[keyField];
  const idx = key !== undefined && key !== null && key !== '' ? listRef.findIndex((x) => x[keyField] === key) : -1;
  if (idx >= 0) {
    listRef[idx] = { ...listRef[idx], ...record, updatedAt: new Date().toISOString() };
    persist(domain);
    return { item: listRef[idx], created: false };
  }
  const item = { id: newId(), createdAt: new Date().toISOString(), ...record };
  listRef.push(item);
  persist(domain);
  return { item, created: true };
}

/* ---------------- Agent 任务事务与回滚 ---------------- */

function agentTask(taskId) {
  return load('agentTasks').find((item) => item.id === taskId) || null;
}

function appendRollbackOps(taskId, operations) {
  const task = agentTask(taskId);
  if (!task || ['canceled', 'done'].includes(task.state)) return false;
  const next = [...(task.rollbackOps || []), ...clone(operations || [])];
  task.rollbackOps = next;
  task.rollback = { state: 'recording', operationCount: next.length };
  persist('agentTasks');
  return true;
}

/**
 * 任务专用写入：先把反向操作持久化到 agentTasks，再写业务数据。
 * 即使应用在两次落盘之间退出，之后执行回滚也不会漏掉已经发生的写入。
 */
function transactionCreate(taskId, domain, record) {
  ensureDomain(domain);
  if (domain === 'agentTasks') throw new Error('Agent 事务不能修改 agentTasks 数据域');
  const item = { id: newId(), createdAt: new Date().toISOString(), ...record };
  if (!appendRollbackOps(taskId, [{ type: 'create', domain, id: item.id }])) return null;
  load(domain).push(item);
  persist(domain);
  return item;
}

function transactionBatchCreate(taskId, domain, records) {
  ensureDomain(domain);
  if (domain === 'agentTasks') throw new Error('Agent 事务不能修改 agentTasks 数据域');
  const created = (records || []).map((record) => ({ id: newId(), createdAt: new Date().toISOString(), ...record }));
  if (!created.length) return [];
  const operations = created.map((item) => ({ type: 'create', domain, id: item.id }));
  if (!appendRollbackOps(taskId, operations)) return [];
  load(domain).push(...created);
  persist(domain);
  return created;
}

function transactionUpdate(taskId, domain, id, patch) {
  ensureDomain(domain);
  if (domain === 'agentTasks') throw new Error('Agent 事务不能修改 agentTasks 数据域');
  const listRef = load(domain);
  const idx = listRef.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  const before = listRef[idx];
  const next = { ...before, ...patch, updatedAt: new Date().toISOString() };
  const fields = [...new Set([...Object.keys(patch || {}), 'updatedAt'])];
  const changes = fields.map((field) => ({
    field,
    beforeHad: Object.prototype.hasOwnProperty.call(before, field),
    before: clone(before[field]),
    afterHad: Object.prototype.hasOwnProperty.call(next, field),
    after: clone(next[field])
  }));
  if (!appendRollbackOps(taskId, [{ type: 'update', domain, id, changes }])) return null;
  listRef[idx] = next;
  persist(domain);
  return next;
}

function transactionSaveSettings(taskId, patch) {
  const listRef = load('settings');
  if (!listRef.length) {
    const item = { id: 'settings', ...patch };
    if (!appendRollbackOps(taskId, [{ type: 'create', domain: 'settings', id: item.id }])) return null;
    listRef.push(item);
    persist('settings');
    return item;
  }
  return transactionUpdate(taskId, 'settings', listRef[0].id, patch);
}

/**
 * 逆序撤销任务写入。若同一字段在任务写入后又被用户修改，则保留用户的新值并记录冲突，
 * 避免为了回滚后台任务而覆盖并发的人工编辑。
 */
function rollbackTask(taskId) {
  const task = agentTask(taskId);
  if (!task) return { ok: false, error: '任务不存在', operationCount: 0, restoredFields: 0, removedRecords: 0, conflicts: 0 };
  if (task.state !== 'canceled') return { ok: false, error: '只有已取消的任务可以回滚', operationCount: 0, restoredFields: 0, removedRecords: 0, conflicts: 0 };

  const operations = clone(task.rollbackOps || []);
  const touchedDomains = new Set();
  let restoredFields = 0;
  let removedRecords = 0;
  let conflicts = 0;

  for (const operation of operations.reverse()) {
    if (!operation || !DOMAINS.includes(operation.domain) || operation.domain === 'agentTasks') {
      conflicts += 1;
      continue;
    }
    const listRef = load(operation.domain);
    const idx = listRef.findIndex((item) => item.id === operation.id);
    if (operation.type === 'create') {
      if (idx >= 0) {
        listRef.splice(idx, 1);
        touchedDomains.add(operation.domain);
        removedRecords += 1;
      }
      continue;
    }
    if (operation.type !== 'update' || idx < 0) {
      conflicts += 1;
      continue;
    }

    const current = listRef[idx];
    let changed = false;
    for (const change of operation.changes || []) {
      if (sameFieldState(current, change.field, change.afterHad, change.after)) {
        if (change.beforeHad) current[change.field] = clone(change.before);
        else delete current[change.field];
        restoredFields += 1;
        changed = true;
      } else if (change.field !== 'updatedAt' && !sameFieldState(current, change.field, change.beforeHad, change.before)) {
        conflicts += 1;
      }
    }
    if (changed) touchedDomains.add(operation.domain);
  }

  touchedDomains.forEach((domain) => persist(domain));
  const completedAt = new Date().toISOString();
  task.rollbackOps = [];
  const state = conflicts ? 'partial' : 'rolled_back';
  task.rollback = {
    state,
    operationCount: operations.length,
    restoredFields,
    removedRecords,
    conflicts,
    completedAt
  };
  persist('agentTasks');
  return { ok: conflicts === 0, state, operationCount: operations.length, restoredFields, removedRecords, conflicts, completedAt };
}

function commitTask(taskId) {
  const task = agentTask(taskId);
  if (!task) return false;
  const operationCount = (task.rollbackOps || []).length;
  task.rollbackOps = [];
  task.rollback = { state: 'committed', operationCount, completedAt: new Date().toISOString() };
  persist('agentTasks');
  return true;
}

/* ---------------- 设置 ---------------- */

function getSettings() {
  const s = load('settings');
  if (!s || s.length === 0) return {};
  return s[0];
}

function saveSettings(patch) {
  const cur = getSettings();
  const merged = { ...cur, ...patch };
  const listRef = load('settings');
  if (listRef.length === 0) {
    listRef.push({ id: 'settings', ...merged });
  } else {
    listRef[0] = { ...listRef[0], ...merged };
  }
  persist('settings');
  return listRef[0];
}

/* ---------------- 数据目录工具 ---------------- */

function getDataDirPath() {
  return dataDir();
}

function backupAll() {
  const dir = dataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(app.getPath('userData'), 'backups', `backup-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  DOMAINS.forEach((d) => {
    const fp = fileFor(d);
    if (fs.existsSync(fp)) fs.copyFileSync(fp, path.join(backupDir, `${d}.json`));
  });
  return backupDir;
}

/* ---------------- 统计（看板用） ---------------- */

function taskStats() {
  const tasks = load('tasks');
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total: tasks.length,
    todo: 0, doing: 0, done: 0,
    doneToday: 0,
    overdue: 0,
    byPriority: { high: 0, medium: 0, low: 0 },
    last7Days: []
  };
  const dayMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dayMap[key] = { date: key, done: 0, created: 0 };
  }
  tasks.forEach((t) => {
    stats[t.status] = (stats[t.status] || 0) + 1;
    stats.byPriority[t.priority] = (stats.byPriority[t.priority] || 0) + 1;
    if (t.dueDate && t.dueDate < today && t.status !== 'done') stats.overdue += 1;
    if (t.status === 'done' && t.completedAt && t.completedAt.slice(0, 10) === today) stats.doneToday += 1;
    const createdKey = (t.createdAt || '').slice(0, 10);
    if (dayMap[createdKey]) dayMap[createdKey].created += 1;
    const doneKey = (t.completedAt || '').slice(0, 10);
    if (dayMap[doneKey] && t.status === 'done') dayMap[doneKey].done += 1;
  });
  stats.last7Days = Object.keys(dayMap).sort().map((k) => dayMap[k]);
  stats.doneRate = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  return stats;
}

module.exports = {
  DOMAINS,
  list, get, create, update, remove, batchCreate, upsertBy,
  transactionCreate, transactionUpdate, transactionBatchCreate, transactionSaveSettings,
  rollbackTask, commitTask,
  getSettings, saveSettings,
  getDataDirPath, backupAll,
  taskStats,
  dataDir
};
