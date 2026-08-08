'use strict';

const https = require('https');

const API = 'https://api.zotero.org';
const EXCLUDED_TYPES = new Set(['attachment', 'note', 'annotation']);

function normalizeConfig(config) {
  const type = config.libraryType === 'groups' ? 'groups' : 'users';
  const libraryId = String(config.libraryId || '').trim();
  const apiKey = String(config.apiKey || '').trim();
  const collectionKey = String(config.collectionKey || '').trim();
  if (!/^\d+$/.test(libraryId)) throw new Error('请填写正确的 Zotero Library ID');
  if (collectionKey && !/^[A-Z0-9]+$/i.test(collectionKey)) throw new Error('Collection Key 格式不正确');
  return { type, libraryId, apiKey, collectionKey };
}

function requestJson(url, apiKey) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'research-workbench', 'Zotero-API-Version': '3', Accept: 'application/json' };
    if (apiKey) headers['Zotero-API-Key'] = apiKey;
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const messages = { 401: 'API Key 无效', 403: 'API Key 没有该文献库的读取权限', 404: '未找到该 Zotero 文献库或分类', 429: 'Zotero 请求过于频繁，请稍后重试' };
          reject(new Error(messages[res.statusCode] || `Zotero API 错误 ${res.statusCode}`));
          return;
        }
        try { resolve({ data: JSON.parse(body || '[]'), headers: res.headers }); }
        catch (error) { reject(new Error('Zotero 返回了无法解析的数据')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(18000, () => req.destroy(new Error('Zotero 连接超时')));
  });
}

function prefix(config) {
  return `${API}/${config.type}/${encodeURIComponent(config.libraryId)}`;
}

async function testConnection(input) {
  const config = normalizeConfig(input);
  const endpoint = config.collectionKey
    ? `${prefix(config)}/collections/${encodeURIComponent(config.collectionKey)}/items/top`
    : `${prefix(config)}/items/top`;
  const result = await requestJson(`${endpoint}?limit=1`, config.apiKey);
  return {
    libraryType: config.type,
    libraryId: config.libraryId,
    total: Number(result.headers['total-results'] || result.data.length || 0),
    libraryVersion: result.headers['last-modified-version'] || null
  };
}

async function fetchLibrary(input) {
  const config = normalizeConfig(input);
  const collectionInfo = await fetchCollections(config);
  const collectionMap = collectionInfo.map; // key → {key,name,parentKey}
  const endpoint = config.collectionKey
    ? `${prefix(config)}/collections/${encodeURIComponent(config.collectionKey)}/items/top`
    : `${prefix(config)}/items/top`;
  let start = 0;
  let libraryVersion = null;
  const rawItems = [];
  for (let page = 0; page < 10; page += 1) {
    const result = await requestJson(`${endpoint}?limit=100&start=${start}&sort=dateModified&direction=desc`, config.apiKey);
    libraryVersion = result.headers['last-modified-version'] || libraryVersion;
    rawItems.push(...result.data);
    if (result.data.length < 100) break;
    start += 100;
  }
  const items = rawItems
    .filter((item) => item && item.data && !EXCLUDED_TYPES.has(item.data.itemType))
    .map((item) => mapItem(item, collectionMap));
  const userName = await fetchUserName(config);
  return { items, total: items.length, libraryVersion, userName, collections: collectionInfo.tree };
}

/**
 * 拉取 collections（含 parentCollection 层级）
 * 返回 { map: Map<key, {key,name,parentKey}>, tree: [{key,name,parentKey}] }
 */
async function fetchCollections(config) {
  const map = new Map();
  const raw = [];
  let start = 0;
  for (let page = 0; page < 5; page += 1) {
    const result = await requestJson(`${prefix(config)}/collections?limit=100&start=${start}`, config.apiKey);
    result.data.forEach((item) => raw.push(item));
    if (result.data.length < 100) break;
    start += 100;
  }
  raw.forEach((item) => {
    const d = item.data || {};
    map.set(item.key, { key: item.key, name: d.name || item.key, parentKey: d.parentCollection || null });
  });
  return { map, tree: raw.map((item) => ({ key: item.key, name: (item.data && item.data.name) || item.key, parentKey: (item.data && item.data.parentCollection) || null })) };
}

/** 拉取 Zotero 账户显示名（用于「{用户名} 的 Zotero 同步」根分类）；失败回退 libraryId */
async function fetchUserName(input) {
  const config = normalizeConfig(input);
  try {
    const result = await requestJson(`${API}/${config.type}/${encodeURIComponent(config.libraryId)}`, config.apiKey);
    const profile = result.data || {};
    return String(profile.displayName || profile.name || '').trim() || config.libraryId;
  } catch (e) {
    return config.libraryId;
  }
}

function mapItem(item, collectionMap) {
  const data = item.data || {};
  const creators = (data.creators || []).map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean);
  const collectionKeys = data.collections || [];
  const collectionInfos = collectionKeys.map((key) => (collectionMap && collectionMap.get ? collectionMap.get(key) : null)).filter(Boolean);
  const collectionNames = collectionInfos.map((c) => c.name).filter(Boolean);
  const venue = data.publicationTitle || data.proceedingsTitle || data.bookTitle || data.university || data.institution || '';
  const yearMatch = String(data.date || '').match(/(?:19|20)\d{2}/);
  return {
    zoteroKey: item.key,
    zoteroVersion: item.version,
    itemType: data.itemType,
    title: data.title || '未命名 Zotero 条目',
    authors: creators.join('; '),
    venue,
    year: yearMatch ? yearMatch[0] : '',
    doi: data.DOI || data.url || '',
    abstract: data.abstractNote || '',
    tags: [...(data.tags || []).map((tag) => tag.tag).filter(Boolean), ...collectionNames].filter(Boolean),
    collections: collectionInfos,               // [{key,name,parentKey}]
    zoteroCollectionKeys: collectionKeys,        // Zotero collection key 数组
    url: data.url || '',
    dateModified: data.dateModified || '',
    source: 'zotero'
  };
}

module.exports = { testConnection, fetchLibrary, fetchCollections, fetchUserName, normalizeConfig, mapItem };
