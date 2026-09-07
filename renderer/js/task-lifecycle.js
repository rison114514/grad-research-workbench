'use strict';

/* 任务完成与自动归档规则：保持为纯函数，供待办列表、看板和测试共用。 */
(function initTaskLifecycle(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaskLifecycle = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ARCHIVE_AFTER_DAYS = 3;

  function completionTime(task) {
    if (!task || task.status !== 'done') return null;
    const raw = task.completedAt || task.updatedAt || null;
    if (!raw) return null;
    const value = new Date(raw).getTime();
    return Number.isFinite(value) ? value : null;
  }

  function isArchived(task, now = Date.now(), days = ARCHIVE_AFTER_DAYS) {
    const completed = completionTime(task);
    if (completed === null) return false;
    const age = Number(now) - completed;
    return age >= 0 && age > Math.max(0, Number(days) || 0) * DAY_MS;
  }

  function toggleCompletionPatch(task, nowIso = new Date().toISOString()) {
    if (task && task.status === 'done') return { status: 'todo', completedAt: null };
    return { status: 'done', completedAt: nowIso };
  }

  function partition(tasks, now = Date.now()) {
    return (tasks || []).reduce((result, task) => {
      result[isArchived(task, now) ? 'archived' : 'active'].push(task);
      return result;
    }, { active: [], archived: [] });
  }

  return { DAY_MS, ARCHIVE_AFTER_DAYS, completionTime, isArchived, toggleCompletionPatch, partition };
});
