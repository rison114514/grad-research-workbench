'use strict';

/**
 * 文件系统服务
 * - 扫描本地项目文件夹，生成目录树
 * - 基于目录树生成关系图谱数据（ECharts graph 用）
 * - 忽略 node_modules / .git / dist / __pycache__ 等噪音目录
 */
const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
  '__pycache__', '.idea', '.vscode', '.DS_Store', 'venv', '.venv',
  '.next', '.nuxt', 'coverage', 'target', 'Pods', '.gradle', 'bin', 'obj'
]);

const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name) || name.startsWith('.');
}

function scanTree(rootPath, maxDepth = 6, curDepth = 0) {
  if (curDepth > maxDepth) return null;
  const stats = fs.statSync(rootPath);
  const node = {
    name: path.basename(rootPath) || rootPath,
    path: rootPath,
    type: stats.isDirectory() ? 'dir' : 'file',
    children: []
  };
  if (!stats.isDirectory()) return node;
  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (e) {
    return node;
  }
  entries
    .filter((e) => !(e.isDirectory() && shouldIgnoreDir(e.name)))
    .filter((e) => !(e.isFile() && IGNORE_FILES.has(e.name)))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .forEach((e) => {
      const full = path.join(rootPath, e.name);
      try {
        const child = scanTree(full, maxDepth, curDepth + 1);
        if (child) node.children.push(child);
      } catch (err) {
        /* 无权限等跳过 */
      }
    });
  return node;
}

/**
 * 生成关系图谱（力导向图）数据
 * 目录作为中间节点，文件作为叶子；同目录文件连线到目录。
 */
function buildGraph(tree, rootPath) {
  const nodes = [];
  const links = [];
  const idMap = new Map();

  function norm(p) {
    return p === rootPath ? '/' : path.relative(rootPath, p).split(path.sep).join('/');
  }

  function walk(node, parentId, depth) {
    const id = `n${nodes.length}`;
    idMap.set(node.path, id);
    const isDir = node.type === 'dir';
    const label = isDir ? node.name : node.name;
    nodes.push({
      id,
      name: label,
      path: node.path,
      rel: norm(node.path),
      symbolSize: isDir ? Math.max(18, 26 - depth * 1.5) : 9,
      category: isDir ? (depth === 0 ? 0 : 1) : 2,
      depth,
      value: isDir ? node.children.length : 1
    });
    if (parentId) links.push({ source: parentId, target: id });
    if (isDir) node.children.forEach((c) => walk(c, id, depth + 1));
  }

  walk(tree, null, 0);
  return { nodes, links };
}

module.exports = { scanTree, buildGraph, IGNORE_DIRS };
