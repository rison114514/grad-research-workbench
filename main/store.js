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

const DOMAINS = ['tasks', 'projects', 'literature', 'inspirations', 'reports', 'githubSubs', 'agentTasks', 'activity', 'settings', 'timeLogs', 'dailyPlans', 'fitnessPlans', 'fitnessLogs', 'assistantSessions', 'assistantMessages', 'litCollections', 'litRelations'];

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
  getSettings, saveSettings,
  getDataDirPath, backupAll,
  taskStats,
  dataDir
};
