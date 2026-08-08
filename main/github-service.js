'use strict';

/**
 * GitHub 热点追踪服务
 * - 热门仓库：GitHub Search API（按 stars 排序）
 * - 仓库动态：releases / commits 接口
 * - 支持 PAT（可选，提升限流至 5000 次/h；匿名 60 次/h）
 * - 网络请求使用 Node 内置 fetch（Electron ≥ 22 自带）
 */
const https = require('https');

const API = 'https://api.github.com';

function repoPath(fullName) {
  return String(fullName || '').split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/');
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'grad-research-workbench', Accept: 'application/vnd.github+json', ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
  });
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseRateLimit(headers) {
  return {
    limit: headers['x-ratelimit-limit'],
    remaining: headers['x-ratelimit-remaining'],
    reset: headers['x-ratelimit-reset']
  };
}

function buildWeeklySummary(keyword, items) {
  const languages = {};
  items.forEach((item) => {
    if (item.language) languages[item.language] = (languages[item.language] || 0) + 1;
  });
  return {
    keyword,
    start: daysAgo(7),
    end: daysAgo(0),
    repoCount: items.length,
    totalStars: items.reduce((sum, item) => sum + (item.stars || 0), 0),
    languages: Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
    leaders: items.slice(0, 3).map((item) => ({ fullName: item.fullName, stars: item.stars }))
  };
}

/** 按关键词生成最近 7 天新仓库热榜（按 star 排序） */
async function searchTrending(keyword, token, perPage = 15) {
  const q = encodeURIComponent(`${keyword} created:>${daysAgo(7)}`);
  const url = `${API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}`;
  const res = await httpGet(url, authHeaders(token));
  const rate = parseRateLimit(res.headers);
  if (res.status === 403 && rate.remaining === '0') {
    throw new Error(`GitHub 匿名限流已用尽（${rate.limit} 次/小时）。请到设置页配置 GitHub Token 提升额度。`);
  }
  if (res.status !== 200) throw new Error(`GitHub API 错误 ${res.status}`);
  const json = JSON.parse(res.body);
  const items = (json.items || []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner && r.owner.login,
    description: r.description,
    stars: r.stargazers_count,
    forks: r.forks_count,
    language: r.language,
    htmlUrl: r.html_url,
    topics: (r.topics || []).slice(0, 6),
    pushedAt: r.pushed_at
  }));
  return { items, rate, summary: buildWeeklySummary(keyword, items) };
}

/** 订阅仓库的更新动态（最近 releases） */
async function repoReleases(fullName, token, perPage = 5) {
  const url = `${API}/repos/${repoPath(fullName)}/releases?per_page=${perPage}`;
  const res = await httpGet(url, authHeaders(token));
  if (res.status !== 200) return { items: [], rate: parseRateLimit(res.headers), error: `错误 ${res.status}` };
  const json = JSON.parse(res.body);
  const items = json.map((r) => ({
    id: r.id,
    tag: r.tag_name,
    name: r.name,
    body: (r.body || '').slice(0, 400),
    publishedAt: r.published_at,
    htmlUrl: r.html_url,
    author: r.author && r.author.login
  }));
  return { items, rate: parseRateLimit(res.headers) };
}

/** 仓库基础信息（用于订阅展示） */
async function repoInfo(fullName, token) {
  const url = `${API}/repos/${repoPath(fullName)}`;
  const res = await httpGet(url, authHeaders(token));
  if (res.status !== 200) return null;
  const r = JSON.parse(res.body);
  return {
    id: r.id, fullName: r.full_name, description: r.description,
    stars: r.stargazers_count, forks: r.forks_count,
    language: r.language, htmlUrl: r.html_url, pushedAt: r.pushed_at
  };
}

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ==================== 官网 trending（github.com/trending）==================== */

/* 语言表：slug 为 github.com/trending 路径片段（C++→c%2B%2B、C#→c%23 由 encodeURIComponent 处理） */
const LANGUAGES = [
  { slug: 'python', name: 'Python', aliases: ['python', 'py', '蟒蛇', '蟒'] },
  { slug: 'javascript', name: 'JavaScript', aliases: ['javascript', 'js'] },
  { slug: 'typescript', name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { slug: 'java', name: 'Java', aliases: ['java'] },
  { slug: 'go', name: 'Go', aliases: ['go', 'golang'] },
  { slug: 'rust', name: 'Rust', aliases: ['rust', 'rs'] },
  { slug: 'c++', name: 'C++', aliases: ['c++', 'cpp', 'c加加'] },
  { slug: 'c', name: 'C', aliases: ['c'] },
  { slug: 'c#', name: 'C#', aliases: ['c#', 'csharp'] },
  { slug: 'ruby', name: 'Ruby', aliases: ['ruby'] },
  { slug: 'php', name: 'PHP', aliases: ['php'] },
  { slug: 'swift', name: 'Swift', aliases: ['swift'] },
  { slug: 'kotlin', name: 'Kotlin', aliases: ['kotlin'] },
  { slug: 'shell', name: 'Shell', aliases: ['shell', 'bash', 'zsh'] },
  { slug: 'jupyter-notebook', name: 'Jupyter Notebook', aliases: ['jupyter', 'notebook', 'ipynb'] },
  { slug: 'vue', name: 'Vue', aliases: ['vue', 'vue.js'] },
  { slug: 'react', name: 'React', aliases: ['react'] },
  { slug: 'vimscript', name: 'Vim script', aliases: ['vim', 'vimscript'] },
  { slug: 'html', name: 'HTML', aliases: ['html'] },
  { slug: 'css', name: 'CSS', aliases: ['css'] },
  { slug: 'dart', name: 'Dart', aliases: ['dart', 'flutter'] },
  { slug: 'r', name: 'R', aliases: ['r'] },
  { slug: 'perl', name: 'Perl', aliases: ['perl'] }
];

/** 语言/关键词 → trending slug；未命中返回 null */
function mapLanguageToGithub(input) {
  const t = String(input || '').trim().toLowerCase();
  if (!t) return null;
  const hit = LANGUAGES.find((l) => l.aliases.includes(t) || l.slug === t || l.name.toLowerCase() === t);
  return hit ? hit.slug : null;
}

/** 语言名（展示用） */
function languageName(slug) {
  const hit = LANGUAGES.find((l) => l.slug === slug);
  return hit ? hit.name : slug || '全部';
}

const num = (v) => { const n = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/**
 * 解析 github.com/trending HTML（article.Box-row 结构，纯函数可测）
 * 注意（2026-08 实测）：repo 链接在 h2 内（Block 首个链接是 Sponsor 按钮需跳过）；
 * star/fork 数字在 `</svg> 18,088</a>` 内（新版无 aria-label、无 today 星标）
 * 返回 [{ fullName, name, owner, description, language, stars, forks, todayStars, url }]
 */
function parseTrendingHtml(html) {
  const rows = String(html || '').split(/<article\s+class="[^"]*Box-row[^"]*"/i).slice(1);
  const out = [];
  for (const row of rows) {
    const link = row.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/);
    if (!link) continue;
    const fullName = link[1];
    const [owner, name] = fullName.split('/');
    const descM = row.match(/<p\s+class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const langM = row.match(/itemprop="programmingLanguage"[^>]*>([^<]+)<\/span>/);
    const starsM = row.match(/href="\/[^"]+\/stargazers"[^>]*><svg[\s\S]*?<\/svg>\s*([\d,]+)<\/a>/) || row.match(/aria-label="([\d,]+)\s+stars"/);
    const forksM = row.match(/href="\/[^"]+\/forks"[^>]*><svg[\s\S]*?<\/svg>\s*([\d,]+)<\/a>/) || row.match(/aria-label="([\d,]+)\s+users\s+forked"/);
    const todayM = row.match(/([\d,]+)\s+stars\s+today/);
    out.push({
      fullName,
      name,
      owner,
      description: descM ? stripTags(descM[1]) : '',
      language: langM ? stripTags(langM[1]) : '',
      stars: starsM ? num(starsM[1]) : 0,
      forks: forksM ? num(forksM[1]) : 0,
      todayStars: todayM ? num(todayM[1]) : 0,
      url: `https://github.com/${fullName}`
    });
  }
  return out;
}

/* 官网热榜内存缓存（key=slug|since，TTL 10 分钟；不落盘避免新增数据域） */
const TRENDING_CACHE = new Map();
const TRENDING_TTL = 10 * 60 * 1000;

/**
 * 抓取 GitHub 官网一周热榜（匿名可用，不依赖 Token）
 * { language: 语言/关键词（自动映射 slug，空=全部）, since: daily|weekly|monthly }
 */
async function fetchOfficialTrending({ language, since = 'weekly' } = {}, token) {
  const slug = mapLanguageToGithub(language) || '';
  const sinceNorm = ['daily', 'weekly', 'monthly'].includes(since) ? since : 'weekly';
  const key = `${slug}|${sinceNorm}`;
  const cached = TRENDING_CACHE.get(key);
  if (cached && Date.now() - cached.cachedAt < TRENDING_TTL) {
    return { ...cached, cached: true };
  }
  const url = `https://github.com/trending${slug ? '/' + encodeURIComponent(slug) : ''}?since=${sinceNorm}`;
  const res = await httpGet(url, { Accept: 'text/html', ...authHeaders(token) });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub 官网限流（${res.status}），请稍后重试`);
  }
  if (res.status !== 200) throw new Error(`GitHub 官网返回 ${res.status}，请稍后重试`);
  const items = parseTrendingHtml(res.body);
  if (!items.length) throw new Error('未解析到热榜数据（页面结构可能变化），请稍后重试');
  const data = {
    items, source: 'GitHub 官网', languageSlug: slug, languageName: languageName(slug),
    since: sinceNorm, fetchedAt: new Date().toISOString(),
    summary: buildWeeklySummary(languageName(slug) || '全部领域', items)
  };
  TRENDING_CACHE.set(key, { ...data, cachedAt: Date.now() });
  return data;
}

module.exports = { searchTrending, repoReleases, repoInfo, parseTrendingHtml, mapLanguageToGithub, languageName, fetchOfficialTrending, LANGUAGES };
