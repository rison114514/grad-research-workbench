'use strict';

/* ============ AI 助手动作框架（本地规则优先 + 结构化执行 + 预览确认） ============ */

const AssistantActions = {
  /* 意图匹配：按优先级顺序，返回动作名；未命中返回 null（回退 AI 对话/语义识别） */
  match(text, depth = 0) {
    if (!text || depth > 2) return null;
    const t = String(text).trim();
    // 三级过滤：否定 / 强疑问 → 一律回退（不做任何动作）；弱疑问 → 副作用动作不触发
    if (NEGATION_RE.test(t)) return null;
    if (HARD_QUESTION_RE.test(t)) {
      // S5：礼貌请求外壳（你能帮我X吗 = 请求）→ 剥外壳重走动作路由；其余「吗」句交语义层
      const polite = stripPoliteShell(t);
      if (polite && polite !== t) return this.match(polite, depth + 1);
      return null;
    }
    const softQ = SOFT_QUESTION_RE.test(t);
    if (!softQ) {
      if (FITNESS_PLAN_RE.test(t)) return 'addFitnessPlan';
      if (PLAN_FITNESS_RE.test(t)) return 'planFitnessPlan';
      if (FITNESS_RE.test(t)) return 'addFitnessLog';
      if (TIME_LOG_RE.test(t)) return 'addTimeLog';
      if (isDailyPlanMulti(t)) return 'addDailyPlanMulti'; // 多时间段/每日计划 → 批量日程（先于单条）
      if (DAILY_PLAN_RE.test(t)) return 'addDailyPlan';
      if (ADD_TASK_RE.test(t)) return 'addTask';
      if (SPLIT_RE.test(t)) return 'splitTask';
      if (REPORT_RE.test(t)) return 'generateReport';
      if (UPDATE_TIME_RE.test(t)) return 'updateTimeLog';
      if (UPDATE_PLAN_RE.test(t)) return 'updateDailyPlan';
    }
    if (SUGGEST_RE.test(t)) return 'suggestInsights';
    if (QUERY_FITNESS_RE.test(t)) return 'queryFitness';
    if (QUERY_TIME_RE.test(t)) return 'queryTimeLog';
    if (QUERY_PLAN_RE.test(t)) return 'queryDailyPlan';
    if (QUERY_RE.test(t)) return 'queryStats';
    if (HELP_RE.test(t)) return 'help';
    return null;
  },

  /* 语义层白名单：模型 JSON 动作只允许映射到这些动作 */
  canExecute(action) {
    return ['addTask', 'addDailyPlan', 'addDailyPlanMulti', 'addTimeLog', 'addFitnessLog', 'addFitnessPlan',
      'updateDailyPlan', 'updateTimeLog',
      'queryStats', 'queryDailyPlan', 'queryTimeLog', 'queryFitness', 'suggestInsights', 'queryGitHubTrending',
      'queryLiterature', 'readLiterature', 'buildLiteratureRelations', 'generateReport', 'updateFitnessItem', 'addFitnessItem', 'addInspiration', 'queryInspirations', 'queryProjects',
      'subscribeGitHub', 'unsubscribeGitHub', 'queryGitHubSubs'].includes(action);
  },

  /* ---------------- 新增任务 ---------------- */
  async addTask(text) {
    const isDaily = /(?:每日|每天|天天)/.test(String(text || ''));
    const segments = splitSegments(stripIntent(text), isListCommand(text));
    if (!segments.length) return genericHint();
    const drafts = [];
    const rejected = [];
    for (const seg of segments) {
      if (drafts.length >= 3) { rejected.push('…超出单次 3 条上限'); break; }
      const parsed = await window.api.ai.parseNaturalTask(seg);
      const title = cleanTitle(parsed.title);
      if (!title || isGenericTitle(title) || title.length <= 1) { rejected.push(`「${seg}」缺少具体任务内容`); continue; }
      let dueDate = parsed.dueDate;
      if (!dueDate && isDaily) dueDate = App.todayStr(); // 「每日/每天」按单次记录
      drafts.push({ title, priority: parsed.priority, dueDate });
    }
    if (!drafts.length) {
      return `没能创建任务 😅\n\n> ${rejected.join('；') || '缺少具体任务内容'}\n\n请补充，例如「帮我添加任务 今天 整理实验记录」。`;
    }
    // 单条明确命令 → 直接执行；多条 → 预览确认（歧义输入必须确认）
    if (drafts.length === 1) return executeTaskDrafts(drafts, rejected, isDaily);
    const preview = `**将创建 ${drafts.length} 条任务**：\n${drafts.map((d) => `- \`${PRIO_LABEL[d.priority]}\` ${App.esc(d.title)}${d.dueDate ? `（截止 ${formatDate(d.dueDate)}）` : ''}`).join('\n')}\n${rejected.length ? `\n> 未能解析：${rejected.join('；')}` : ''}\n\n请确认是否执行：`;
    return { needsConfirm: true, preview, apply: () => executeTaskDrafts(drafts, rejected, isDaily) };
  },

  /* 结构化创建（语义层 / 预览确认共用） */
  async createTaskStructured(params = {}) {
    const title = cleanTitle(String(params.title || '')).slice(0, 120);
    if (!title || isGenericTitle(title) || title.length <= 1) return '未能创建任务：缺少有效的任务标题。';
    const priority = ['high', 'medium', 'low'].includes(params.priority) ? params.priority : 'medium';
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(params.dueDate || '')) ? params.dueDate : (params.dueDate || null);
    return executeTaskDrafts([{ title, priority, dueDate }], [], false);
  },

  /* ---------------- 任务拆解（复用现有人工确认流程） ---------------- */
  async splitTask(text) {
    const m = String(text || '').match(/(?:拆解|拆分|分解)\s*[「『]?([^」』\n]{1,40})[」』]?/);
    let target = (m && m[1] || '').replace(/任务$/, '').trim();
    if (!target || isGenericTitle(target)) {
      const tasks = await window.api.store.list('tasks');
      const open = tasks.filter((t) => t.status !== 'done');
      const latest = open[open.length - 1];
      if (!latest) return '当前没有可拆解的未完成任务，先添加一个任务吧（如「帮我添加任务 整理实验数据」）。';
      target = latest.title;
    }
    // 命中已有任务 → 复用 Tasks.split 完整人工确认流程（生成计划 → 预览弹窗 → 编辑确认 → 应用）
    const tasks = await window.api.store.list('tasks');
    const match = tasks.filter((t) => t.status !== 'done' && (t.title === target || t.title.includes(target) || target.includes(t.title)));
    if (window.Tasks && match.length) {
      try {
        await window.Tasks.render(); // 填充 Tasks.current（隐藏页面 DOM 存在，安全）
        const task = window.Tasks.current && window.Tasks.current.find((t) => t.id === match[0].id);
        if (task) {
          await window.Tasks.split(task.id);
          return '已打开 **拆解计划预览**：请在弹出的窗口中检查、编辑步骤并确认应用 ✅';
        }
      } catch (e) {
        console.warn('[assistant-actions] 复用拆解流程失败，回退文字拆解:', e);
      }
    }
    // 兜底：自由文本 / 未匹配到任务 → 无副作用的参考步骤
    const r = await window.api.ai.splitTask(target);
    if (!r.ok) return r.error || '拆解失败';
    return `**拆解参考「${App.esc(target)}」**（未应用到任务，可在任务页对该任务点 PLAN 走完整确认流程）\n\n${(r.items || []).map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n> 目标：${r.goal || ''}\n> 交付物：${r.deliverable || ''}`;
  },

  /* ---------------- 每日计划 ---------------- */
  async addDailyPlan(text) {
    const p = parseDailyPlanIntent(text);
    if (!p.title || isGenericTitle(p.title)) return '没识别出计划内容 😅 请这样输入：**安排 明天9点到11点 写论文**';
    return this.createDailyPlanStructured(p);
  },

  async createDailyPlanStructured(params = {}) {
    const date = isValidDate(String(params.date || '')) ? params.date : App.todayStr();
    const title = String(params.title || '').trim().slice(0, 120);
    if (!title || isGenericTitle(title) || title.length <= 1) return '未能加入计划：缺少有效的计划标题。';
    const startTime = /^\d{1,2}:\d{2}$/.test(String(params.startTime || '')) ? params.startTime : '09:00';
    const endTime = /^\d{1,2}:\d{2}$/.test(String(params.endTime || '')) ? params.endTime : nextHour(startTime);
    const type = ['work', 'study', 'meeting', 'life', 'rest'].includes(params.type) ? params.type : 'work';
    let plan = (await window.api.store.list('dailyPlans')).find((x) => x.date === date);
    if (!plan) plan = await window.api.store.create('dailyPlans', { date, items: [] });
    plan.items.push({ id: `item-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, startTime, endTime, title, type, note: '', done: false, taskId: null });
    await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
    if (window.DailyPlan) { window.DailyPlan.state.date = date; await window.DailyPlan.render(); }
    return `**已加入计划**（${formatDate(date)} ${startTime}–${endTime}）\n- \`${PLAN_TYPE_LABEL[type]}\` ${App.esc(title)}\n\n可在「每日计划」页查看与编辑。`;
  },

  /* ---------------- 每日计划：批量安排（多事项，草案卡确认后落库） ---------------- */
  addDailyPlanMulti(text) {
    const p = parseDailyPlanMulti(text);
    if (!p.items.length) return '没识别出具体的日程事项 😅 请这样补充：**「九点到教研室打卡，然后做自媒体内容，下午写老师的学术内容」**';
    const preview = `**每日计划草案**${p.daily ? '（每日例行 · 按单次记录）' : ''}（${formatDate(p.date)}）\n\n${p.items.map((i) => `- ${i.startTime}–${i.endTime} \`${PLAN_TYPE_LABEL[i.type] || '工作'}\` ${App.esc(i.title)}`).join('\n')}\n\n> 保存后写入「每日计划」页；可回复调整（如「第二项改到下午」）。`;
    return {
      needsConfirm: true, mode: 'draft', action: 'addDailyPlanMulti', params: p, preview,
      apply: async () => {
        let plan = (await window.api.store.list('dailyPlans')).find((x) => x.date === p.date);
        if (!plan) plan = await window.api.store.create('dailyPlans', { date: p.date, items: [] });
        plan.items.push(...p.items);
        await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
        if (window.DailyPlan) { window.DailyPlan.state.date = p.date; await window.DailyPlan.render(); }
        return `**已加入每日计划**（${formatDate(p.date)}，${p.items.length} 项）${p.daily ? ' · 每日例行按单次记录' : ''}\n\n${p.items.map((i) => `- ${i.startTime} ${App.esc(i.title)}`).join('\n')}\n\n可在「每日计划」页查看与编辑。`;
      }
    };
  },

  async createDailyPlanMultiStructured(params = {}) {
    const date = isValidDate(String(params.date || '')) ? params.date : App.todayStr();
    const items = Array.isArray(params.items) ? params.items : [];
    if (!items.length) return '未能加入计划：缺少日程事项。';
    let plan = (await window.api.store.list('dailyPlans')).find((x) => x.date === date);
    if (!plan) plan = await window.api.store.create('dailyPlans', { date, items: [] });
    plan.items.push(...items.map((i) => ({ id: `item-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, startTime: i.startTime || '09:00', endTime: i.endTime || '10:00', title: String(i.title || '').slice(0, 60), type: ['work', 'study', 'meeting', 'life', 'rest'].includes(i.type) ? i.type : 'work', note: '', done: false, taskId: null })));
    await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
    if (window.DailyPlan) { window.DailyPlan.state.date = date; await window.DailyPlan.render(); }
    return `**已加入每日计划**（${formatDate(date)}，${items.length} 项）`;
  },

  async queryDailyPlan(text) {
    const date = parseDateRef(text);
    const plans = await window.api.store.list('dailyPlans');
    const plan = plans.find((x) => x.date === date);
    const items = (plan && plan.items || []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (!items.length) return `**${formatDate(date)} 暂无计划安排。**`;
    const done = items.filter((i) => i.done).length;
    return `**${formatDate(date)} 的计划安排**（完成 ${done}/${items.length}）\n\n${items.map((i) => `- ${i.done ? '✅' : '☐'} ${i.startTime}–${i.endTime} \`${PLAN_TYPE_LABEL[i.type]}\` ${App.esc(i.title)}${i.taskId ? '（已转任务）' : ''}`).join('\n')}`;
  },

  /* ---------------- 时间记录 ---------------- */
  async addTimeLog(text) {
    const p = parseTimeLogIntent(text);
    if (!p.minutes || p.minutes <= 0) return '没识别出时长 😅 请这样输入：**记录 学习 2小时**（分类：工作/学习/生活/休息/运动/专注/阅读/写作）';
    return this.createTimeLogStructured(p);
  },

  async createTimeLogStructured(params = {}) {
    const category = ['focus', 'work', 'study', 'life', 'rest', 'sport', 'reading', 'writing'].includes(params.category) ? params.category : 'study';
    const minutes = Math.min(Math.max(Number(params.minutes) || 0, 1), 1440);
    if (!minutes) return '未能记录：时长无效。';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date || '')) ? params.date : App.todayStr();
    await window.api.store.create('timeLogs', { date, category, minutes, source: 'manual', note: 'AI 记录' });
    if (window.Time && window.Time.render) await window.Time.render();
    return `**已记录**：\`${CATEGORY_LABEL[category]}\` ${formatMinutes(minutes)}（${formatDate(date)}）\n\n可在「时间规划」页查看分布。`;
  },

  async queryTimeLog(text) {
    const date = parseDateRef(text);
    const logs = await window.api.store.list('timeLogs');
    const dayLogs = logs.filter((l) => l.date === date);
    if (!dayLogs.length) return `**${formatDate(date)} 暂无时间记录。**`;
    const byCat = {};
    dayLogs.forEach((l) => { byCat[l.category] = (byCat[l.category] || 0) + l.minutes; });
    const total = Object.values(byCat).reduce((a, b) => a + b, 0);
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    return `**${formatDate(date)} 时间分布**（共 ${formatMinutes(total)}）\n\n${rows.map(([c, min]) => `- \`${CATEGORY_LABEL[c] || c}\` ${formatMinutes(min)}（${Math.round(min / total * 100)}%）`).join('\n')}`;
  },

  /* ---------------- 运动健身 ---------------- */
  async addFitnessLog(text) {
    const p = parseFitnessIntent(text);
    if (!p.durationMin || p.durationMin <= 0) return '没识别出运动时长 😅 请这样输入：**打卡 跑步 30分钟**（类型：跑步/力量/瑜伽/球类/游泳/骑行/其他）';
    return this.createFitnessLogStructured(p);
  },

  async createFitnessLogStructured(params = {}) {
    const type = ['running', 'strength', 'yoga', 'ball', 'other'].includes(params.type) ? params.type : 'other';
    const durationMin = Math.min(Math.max(Number(params.durationMin) || 0, 1), 720);
    if (!durationMin) return '未能打卡：时长无效。';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date || '')) ? params.date : App.todayStr();
    await window.api.store.create('fitnessLogs', { date, planId: null, type, durationMin, done: true, note: 'AI 打卡' });
    if (window.Fitness && window.Fitness.render) await window.Fitness.render();
    return `**已打卡**：\`${FITNESS_TYPE_LABEL[type]}\` ${formatMinutes(durationMin)}（${formatDate(date)}）💪\n\n可在「运动健身」页查看统计。`;
  },

  async queryFitness() {
    const [plans, logs] = await Promise.all([
      window.api.store.list('fitnessPlans'),
      window.api.store.list('fitnessLogs')
    ]);
    const today = App.todayStr();
    const weekStart = shiftDate(new Date(), -new Date().getDay()); // 周日起
    const weekKey = fmtDate(weekStart);
    const weekLogs = logs.filter((l) => l.date >= weekKey);
    const doneCount = weekLogs.filter((l) => l.done).length;
    const weekMinutes = weekLogs.reduce((s, l) => s + (l.durationMin || 0), 0);
    // 连续打卡天数
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = fmtDate(shiftDate(new Date(), -i));
      if (logs.some((l) => l.date === d && l.done)) streak += 1;
      else if (i === 0) continue; // 今天未打卡不打断
      else break;
    }
    const recent = logs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    let reply = `**运动健身概况**\n\n- 本周打卡 **${doneCount}** 次（${formatMinutes(weekMinutes)}）· 连续 **${streak}** 天\n`;
    if (plans.length) {
      const statusLabel = { done: '✓', todo: '○', skipped: '⏭' };
      const rate = plans.map((p) => {
        const cnt = weekLogs.filter((l) => l.planId === p.id || (l.type === p.type)).length;
        // 条目：顶层 items 优先（手动/迁移后），回退 schedule[].items（旧模板）
        const items = (Array.isArray(p.items) && p.items.length)
          ? p.items
          : (p.schedule || []).flatMap((d) => d.items || []);
        const doneItems = items.filter((i) => i.status === 'done').length;
        const skippedItems = items.filter((i) => i.status === 'skipped').length;
        let line = `- ${App.esc(p.name)}：本周 ${cnt}/${p.weeklyGoal} 次${cnt >= (p.weeklyGoal || 1) ? ' ✅' : ''}`;
        if (items.length) line += `（条目 ${doneItems}✓ / ${skippedItems}⏭ / ${items.length}）`;
        // 条目清单：让 Agent 知道具体动作名，便于后续 updateFitnessItem 按名定位
        if (items.length) {
          const detail = items.slice(0, 10).map((i) => {
            const st = statusLabel[i.status] || '○';
            const note = i.customNote ? `（${i.customNote}）` : '';
            return `${st} ${App.esc(i.name)}${i.durationMin ? ` ${i.durationMin}分` : ''}${note}`;
          }).join('；');
          line += `\n  ${detail}${items.length > 10 ? ` 等 ${items.length} 项` : ''}`;
        }
        return line;
      }).join('\n');
      reply += `\n**健身计划**（条目状态 ✓完成 ○待做 ⏭跳过，可让 AI 修改）：\n${rate}\n`;
    } else {
      reply += `\n暂无健身计划，可在「运动健身」页新增（如：晨跑 每周 3 次）。\n`;
    }
    if (recent.length) reply += `\n**最近记录**：\n${recent.map((l) => `- ${l.date} \`${FITNESS_TYPE_LABEL[l.type]}\` ${formatMinutes(l.durationMin)}`).join('\n')}`;
    return reply;
  },

  /** 更新健身计划细致条目状态（Agent 工具，itemId 精确 / matchName 模糊） */
  async updateFitnessItemStructured({ planId, itemId, matchName, status, customNote } = {}) {
    const plans = await window.api.store.list('fitnessPlans');
    let plan = planId ? plans.find((p) => p.id === planId) : null;
    if (!plan && matchName) {
      plan = plans.find((p) => (p.schedule || []).some((d) => (d.items || []).some((i) => String(i.name || '').includes(matchName) || String(d.title || '').includes(matchName)))) || null;
    }
    if (!plan) return '未找到对应的健身计划或条目。';
    const st = ['todo', 'done', 'skipped'].includes(status) ? status : 'todo';
    let target = null;
    // 顶层 items 优先（手动/迁移后的条目）；无则回退 schedule[].items
    const topItems = Array.isArray(plan.items) ? plan.items : [];
    if (itemId) {
      target = topItems.find((x) => x.id === itemId) || null;
      if (!target) {
        for (let di = 0; di < (plan.schedule || []).length; di++) {
          const it = (plan.schedule[di].items || []).find((x) => x.id === itemId);
          if (it) { target = it; break; }
        }
      }
    } else if (matchName) {
      target = topItems.find((x) => String(x.name || '').includes(matchName)) || null;
      if (!target) {
        for (let di = 0; di < (plan.schedule || []).length; di++) {
          const it = (plan.schedule[di].items || []).find((x) => String(x.name || '').includes(matchName));
          if (it) { target = it; break; }
        }
      }
    }
    if (!target) return `在计划「${plan.name}」中未找到匹配的条目，可用 queryFitness 查看条目名称。`;
    target.status = st;
    if (customNote !== undefined) target.customNote = String(customNote);
    target.updatedAt = new Date().toISOString();
    await window.api.store.update('fitnessPlans', plan.id, { items: plan.items, schedule: plan.schedule });
    if (window.Fitness) window.Fitness.render();
    const label = { done: '完成', todo: '待做', skipped: '跳过' }[st];
    return `已更新「${plan.name} · ${target.name}」状态为 **${label}**${target.customNote ? `（备注：${target.customNote}）` : ''}。`;
  },

  /** 添加健身计划细致条目（Agent 工具，planId/planName 定位计划） */
  async addFitnessItemStructured({ planId, planName, name, durationMin } = {}) {
    const n = String(name || '').trim();
    if (!n) return '缺少条目名称，请提供要添加的动作名（如「跑步」「举哑铃」）。';
    const plans = await window.api.store.list('fitnessPlans');
    let plan = planId ? plans.find((p) => p.id === planId) : null;
    if (!plan && planName) plan = plans.find((p) => String(p.name || '').includes(planName)) || null;
    if (!plan) return '未找到对应的健身计划，可用 queryFitness 查看计划列表（或用 planName 指定计划名）。';
    const items = Array.isArray(plan.items) ? plan.items : [];
    items.push({
      id: `it-${plan.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: n,
      durationMin: Number(durationMin) || 0,
      status: 'todo',
      customNote: '',
      updatedAt: new Date().toISOString()
    });
    await window.api.store.update('fitnessPlans', plan.id, { items });
    if (window.Fitness) window.Fitness.render();
    return `已为「${plan.name}」添加条目「${n}」${Number(durationMin) ? `（${durationMin} 分钟）` : ''}，当前共 ${items.length} 条。可用 updateFitnessItem 修改它的状态。`;
  },

  /** 记录灵感（Agent 工具） */
  async addInspirationStructured({ title, content, tags, mood } = {}) {
    const t = String(title || '').trim();
    if (!t) return '缺少灵感标题，请提供标题后再记录。';
    const created = await window.api.store.create('inspirations', {
      title: t,
      content: String(content || ''),
      tags: String(tags || ''),
      mood: ['spark', 'topic', 'visual', 'research'].includes(mood) ? mood : 'spark'
    });
    if (window.Inspirations) window.Inspirations.render();
    return `已记录灵感「${t}」${created ? '' : ''}。`;
  },

  /** 查询灵感（Agent 工具，关键词过滤） */
  async queryInspirationsStructured({ limit, keyword } = {}) {
    const ideas = await window.api.store.list('inspirations');
    const moodLabel = { spark: '灵光一现', topic: '选题方向', visual: '视觉画面', research: '研究设想' };
    let items = ideas.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (keyword) {
      const kw = String(keyword).toLowerCase();
      items = items.filter((i) => String(i.title || '').toLowerCase().includes(kw) || String(i.content || '').toLowerCase().includes(kw));
    }
    items = items.slice(0, Math.min(Number(limit) || 8, 50));
    if (!items.length) return '没有找到灵感记录。';
    return `**灵感记录**（共 ${items.length} 条${keyword ? `，关键词「${keyword}」` : ''}）：\n${items.map((i) => `- ${App.esc(i.title || '未命名')}（${moodLabel[i.mood] || '灵光一现'}）${i.content ? `：${App.esc(String(i.content).slice(0, 40))}` : ''}`).join('\n')}`;
  },

  /** 查询项目列表与项目下任务进度（Agent 工具） */
  async queryProjectsStructured({ keyword } = {}) {
    const [projects, tasks] = await Promise.all([
      window.api.store.list('projects'),
      window.api.store.list('tasks')
    ]);
    let items = projects.slice();
    if (keyword) {
      const kw = String(keyword).toLowerCase();
      items = items.filter((p) => String(p.name || '').toLowerCase().includes(kw));
    }
    if (!items.length) return '没有找到项目。';
    const lines = items.map((p) => {
      const pts = tasks.filter((t) => t.projectId === p.id);
      const done = pts.filter((t) => t.status === 'done').length;
      return `- ${App.esc(p.name)}${p.description ? `：${App.esc(String(p.description).slice(0, 30))}` : ''}（任务 ${pts.length} 项，完成 ${done} 项${pts.length ? `，进度 ${Math.round((done / pts.length) * 100)}%` : ''}）`;
    });
    return `**项目列表**：\n${lines.join('\n')}`;
  },

  /** 解析仓库输入（owner/repo 或链接） */
  parseGithubRepoInput(input) {
    const t = String(input || '').trim();
    if (!t) return '';
    const m = t.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/) || t.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
    return m ? m[1].replace(/\.git$/, '') : '';
  },

  /** 订阅 GitHub 关键词或仓库（Agent 工具） */
  async subscribeGitHubStructured({ keyword, repo } = {}) {
    if (!keyword && !repo) return '请提供 keyword（领域关键词）或 repo（owner/repo）二选一。';
    const subs = await window.api.store.list('githubSubs');
    if (keyword) {
      const kw = String(keyword).trim();
      if (!kw) return '关键词不能为空。';
      if (subs.some((s) => s.type === 'keyword' && s.keyword.toLowerCase() === kw.toLowerCase())) {
        return `已订阅关键词「${kw}」，无需重复添加。`;
      }
      await window.api.store.create('githubSubs', { type: 'keyword', keyword: kw });
      if (window.Github) window.Github.render();
      return `已订阅关键词「${kw}」。可用「按此抓取官网热榜」拉取相关热门项目。`;
    }
    const rp = this.parseGithubRepoInput(repo);
    if (!rp) return '仓库格式无效，请提供 owner/repo（如 langchain-ai/langchain）或完整 GitHub 链接。';
    if (subs.some((s) => s.type === 'repo' && s.keyword.toLowerCase() === rp.toLowerCase())) {
      return `已订阅仓库「${rp}」，无需重复添加。`;
    }
    // 拉取元数据落库（与页面行为一致）；失败降级仅存名称
    let payload = { type: 'repo', keyword: rp };
    try {
      if (window.api.github && typeof window.api.github.repoInfo === 'function') {
        const info = await window.api.github.repoInfo(rp);
        if (info.ok && info.repo) {
          const r = info.repo;
          payload = { ...payload, fullName: r.fullName || rp, description: r.description || '', starCount: r.stars, forks: r.forks, language: r.language || '', url: r.htmlUrl || `https://github.com/${rp}`, pushedAt: r.pushedAt || '' };
        }
      }
    } catch (e) { /* 元数据拉取失败不阻断订阅 */ }
    await window.api.store.create('githubSubs', payload);
    if (window.Github) window.Github.render();
    return `已订阅仓库「${rp}」${payload.starCount ? `（★ ${payload.starCount}）` : ''}。`;
  },

  /** 取消 GitHub 订阅（Agent 工具，精确匹配） */
  async unsubscribeGitHubStructured({ keyword, repo } = {}) {
    if (!keyword && !repo) return '请提供 keyword 或 repo 二选一。';
    const subs = await window.api.store.list('githubSubs');
    const name = keyword ? String(keyword).trim() : this.parseGithubRepoInput(repo);
    if (!name) return '订阅名称无效。';
    const target = subs.find((s) => {
      const k = s.type === 'repo' ? (s.fullName || s.keyword) : s.keyword;
      return k.toLowerCase() === name.toLowerCase();
    });
    if (!target) return `未找到订阅「${name}」（可用 queryGitHubSubs 查看当前订阅）。`;
    await window.api.store.remove('githubSubs', target.id);
    if (window.Github) window.Github.render();
    return `已取消订阅「${name}」。`;
  },

  /** 查询 GitHub 订阅列表（Agent 工具） */
  async queryGitHubSubsStructured({ type } = {}) {
    const subs = await window.api.store.list('githubSubs');
    let items = subs.slice();
    if (type === 'keyword' || type === 'repo') items = items.filter((s) => s.type === type);
    if (!items.length) return `当前没有任何${type ? (type === 'keyword' ? '关键词' : '仓库') : ''}订阅，可让我帮你订阅（如「订阅 robotics 关键词」）。`;
    const lines = items.map((s) => {
      if (s.type === 'keyword') return `- 关键词：${App.esc(s.keyword)}`;
      const star = s.starCount ? ` ★${s.starCount}` : '';
      return `- 仓库：${App.esc(s.fullName || s.keyword)}${star}${s.language ? `（${App.esc(s.language)}）` : ''}`;
    });
    return `**GitHub 订阅**（${items.length} 条${type ? `，${type === 'keyword' ? '关键词' : '仓库'}` : ''}）：\n${lines.join('\n')}`;
  },

  /* 语义层结构化执行入口（模型 JSON 动作 → 白名单方法） */
  async executeStructured(action, params = {}) {
    switch (action) {
      case 'addTask': return await this.createTaskStructured(params);
      case 'addDailyPlan': return await this.createDailyPlanStructured(params);
      case 'addDailyPlanMulti': return await this.createDailyPlanMultiStructured(params);
      case 'addTimeLog': return await this.createTimeLogStructured(params);
      case 'addFitnessLog': return await this.createFitnessLogStructured(params);
      case 'addFitnessPlan': return await this.createFitnessPlanStructured(params);
      case 'updateDailyPlan': return await this.updateDailyPlanStructured(params);
      case 'updateTimeLog': return await this.updateTimeLogStructured(params);
      case 'suggestInsights': return await this.suggestInsights();
      case 'queryStats': return await this.queryStats();
      case 'queryDailyPlan': return await this.queryDailyPlan(params.date || '');
      case 'queryTimeLog': return await this.queryTimeLog(params.date || '');
      case 'queryFitness': return await this.queryFitness();
      case 'queryGitHubTrending': return await this.queryGitHubTrending(params);
      case 'queryLiterature': return await this.queryLiterature(params);
      case 'readLiterature': return await this.readLiterature(params);
      case 'buildLiteratureRelations': return await this.buildLiteratureRelations(params);
      case 'generateReport': return await this.generateReportStructured(params);
      case 'updateFitnessItem': return await this.updateFitnessItemStructured(params);
      case 'addFitnessItem': return await this.addFitnessItemStructured(params);
      case 'addInspiration': return await this.addInspirationStructured(params);
      case 'queryInspirations': return await this.queryInspirationsStructured(params);
      case 'queryProjects': return await this.queryProjectsStructured(params);
      case 'subscribeGitHub': return await this.subscribeGitHubStructured(params);
      case 'unsubscribeGitHub': return await this.unsubscribeGitHubStructured(params);
      case 'queryGitHubSubs': return await this.queryGitHubSubsStructured(params);
      default: return null;
    }
  },

  /* ---------------- 日报/周报：Agent 结构化生成 ---------------- */
  async generateReportStructured({ type = 'daily', date, polish = false } = {}) {
    const t = type === 'weekly' ? 'weekly' : 'daily';
    const d = String(date || App.todayStr()).slice(0, 10) || App.todayStr();
    const r = await window.api.report.generate(t, d, { polish: !!polish });
    if (!r || !r.report) return '报告生成失败，请稍后重试。';
    const content = String(r.report.content || '');
    const preview = content.split('\n').slice(0, 5).join('\n');
    return `**${t === 'weekly' ? '周报' : '日报'}已生成**（${d}${polish && r.report.source === 'ai' ? ' · AI 润色' : ''}）\n\n${preview}\n\n> 完整报告已归档，可在「日报 / 周报」页查看、编辑与导出。`;
  },

  /* ---------------- 文献库：搜索 / 阅读 / 关系生成（Agent 工具） ---------------- */
  async queryLiterature({ query, limit = 8, category } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return '请提供搜索关键词，例如「找几篇 SLAM 相关的文献」。';
    const all = await window.api.store.list('literature');
    let items = all.filter((l) => {
      if (category) {
        const cats = l.collectionIds || [];
        const match = cats.some((id) => String(id).includes(category) || String(id) === category);
        if (!match) return false;
      }
      const hay = `${l.title} ${l.authors} ${l.venue} ${l.tags || ''} ${l.abstract || ''}`.toLowerCase();
      return hay.includes(q);
    });
    items = items.slice(0, Math.min(Number(limit) || 8, 20));
    if (!items.length) return `文献库中没有找到与「${query}」相关的文献。`;
    const lines = items.map((l, i) => `${i + 1}. **${l.title}**${l.authors ? ` — ${l.authors}` : ''}${l.year ? ` (${l.year})` : ''}`);
    return `找到 ${items.length} 篇相关文献：\n${lines.join('\n')}\n\n如需了解某篇详情，告诉我标题即可。`;
  },

  async readLiterature({ id, title } = {}) {
    const all = await window.api.store.list('literature');
    let l = null;
    if (id) l = all.find((x) => x.id === id);
    if (!l && title) l = all.find((x) => String(x.title || '').toLowerCase().includes(String(title).trim().toLowerCase()));
    if (!l) return '未找到该文献，可先搜索确认标题。';
    const body = [
      `**${l.title}**`,
      l.authors ? `作者：${l.authors}` : '',
      [l.venue, l.year].filter(Boolean).join(' · '),
      l.doi ? `DOI：${l.doi}` : '',
      '',
      l.abstract ? `**摘要**：${String(l.abstract).replace(/\s+/g, ' ').slice(0, 600)}` : '',
      l.summary ? `**笔记摘要**：${String(l.summary).replace(/\s+/g, ' ').slice(0, 500)}` : '',
      l.pdfText ? `**正文片段**：${String(l.pdfText).replace(/\s+/g, ' ').slice(0, 1200)}` : ''
    ].filter(Boolean).join('\n');
    return body || '该文献暂无可读内容（未提取正文/摘要）。';
  },

  async buildLiteratureRelations({ scope = 'all', categoryId } = {}) {
    const settings = await window.api.store.getSettings();
    if (!(settings.aiBaseUrl && settings.aiApiKey && settings.aiModel)) {
      return '关系生成需要 AI 能力，请在「设置」页配置模型后重试。';
    }
    const all = await window.api.store.list('literature');
    let items = all;
    if (scope === 'category' && categoryId) items = all.filter((l) => (l.collectionIds || []).includes(categoryId));
    items = items.slice(0, 40);
    if (items.length < 2) return '至少需要 2 篇文献才能分析关联，请扩大范围。';
    const doc = items.map((l, i) => `[${i}] ${l.title}｜${l.authors || ''}｜${String(l.abstract || l.summary || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
    const prompt = `你是文献分析助手。分析下面 ${items.length} 篇文献（[编号] 标题｜作者｜摘要），找出之间存在真实关联的配对。
只输出 JSON 数组（不要任何其他内容），格式：
[{"a":0,"b":1,"type":"correlated|extends|contrasts|cites|topic-similar","strength":0.7,"reason":"30字内关联理由"}]
规则：只输出确有依据的关联，无依据不要硬凑；每篇最多 3 条边；strength 0-1。
文献列表：
${doc}`;
    const r = await window.api.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 2000 });
    if (!r.ok) return `关系分析失败：${r.error || 'AI 请求失败'}`;
    const rels = this.parseRelationArray(r.content);
    if (!rels.length) return 'AI 未识别出有效关联，可换范围重试。';
    // 落库（三元组去重）
    const idMap = new Map(items.map((l, i) => [i, l.id]));
    const existing = await window.api.store.list('litRelations');
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
      if (exist) {
        await window.api.store.update('litRelations', exist.id, { strength, reason });
        updated++;
      } else {
        await window.api.store.create('litRelations', { sourceId, targetId, relationType: type, strength, reason, source: 'ai' });
        created++;
      }
    }
    if (window.Literature) window.Literature.render();
    return `文献关联分析完成：新增 ${created} 条关系，刷新 ${updated} 条。可在「文献中心 → 关联图谱」查看。`;
  },

  parseRelationArray(content) {
    const s = String(content || '').trim();
    const fenced = s.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    const candidate = fenced ? fenced[1] : (s.match(/\[[\s\S]*\]/) || [s])[0];
    try {
      const arr = JSON.parse(candidate);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },

  /* ---------------- GitHub 官网热榜（Agent 工具） ---------------- */
  async queryGitHubTrending({ language, since } = {}) {
    if (!window.api.github || typeof window.api.github.trending !== 'function') {
      return '当前环境不支持抓取 GitHub 官网热榜（浏览器预览仅提供示例数据）。';
    }
    const r = await window.api.github.trending({ language, since });
    if (!r.ok) return `抓取 GitHub 官网热榜失败：${r.error || '未知错误'}`;
    const items = r.items || [];
    if (!items.length) return `GitHub 官网热榜（${r.languageName || '全部'}）暂无数据，请稍后重试。`;
    const lines = items.slice(0, 10).map((i, idx) => `${idx + 1}. **${i.fullName}** ★${i.stars}${i.language ? ` · ${i.language}` : ''}${i.description ? ` — ${String(i.description).slice(0, 60)}` : ''}`);
    return `**GitHub 官网热榜**（${r.languageName || '全部领域'} · ${r.since === 'daily' ? '今日' : r.since === 'monthly' ? '本月' : '本周'} · ${r.source || 'GitHub 官网'}）\n\n${lines.join('\n')}\n\n> 数据来源：${r.source || 'github.com/trending'}${r.cached ? '（缓存）' : ''}。`;
  },

  /* ---------------- 运动健身：新建计划 ---------------- */
  async addFitnessPlan(text) {
    const p = parseFitnessPlanIntent(text);
    return this.createFitnessPlanStructured(p);
  },

  async createFitnessPlanStructured(params = {}) {
    const type = ['running', 'strength', 'yoga', 'ball', 'other'].includes(params.type) ? params.type : 'other';
    const name = String(params.name || '').trim().slice(0, 60) || `${FITNESS_TYPE_LABEL[type]}训练计划`;
    const weeklyGoal = Math.min(Math.max(Number(params.weeklyGoal) || 3, 1), 14);
    const durationGoal = Math.min(Math.max(Number(params.durationGoal) || 30, 5), 240);
    const record = { name, type, weeklyGoal, durationGoal, note: String(params.note || '').slice(0, 120) };
    if (Array.isArray(params.schedule) && params.schedule.length) record.schedule = params.schedule; // S6：可选完整七天安排
    await window.api.store.create('fitnessPlans', record);
    if (window.Fitness && window.Fitness.render) await window.Fitness.render();
    return `**已创建健身计划** ✅\n- 名称：${App.esc(name)}\n- 类型：\`${FITNESS_TYPE_LABEL[type]}\` · 每周目标 **${weeklyGoal}** 次 · 每次约 **${durationGoal}** 分钟${record.schedule ? '\n- 已保存一周 7 天安排（可在「运动健身」页查看）' : ''}\n\n可在「运动健身」页查看，或直接说「打卡 ${FITNESS_TYPE_LABEL[type]} ${durationGoal}分钟」开始记录。`;
  },

  /* S6：生成本地七天草案（不落库，供草案卡展示/保存） */
  createFitnessPlanDraft(params = {}) {
    const type = ['running', 'strength', 'yoga', 'ball', 'other'].includes(params.type) ? params.type : 'other';
    const name = String(params.name || '').trim().slice(0, 60) || `${FITNESS_TYPE_LABEL[type]}训练计划`;
    const weeklyGoal = Math.min(Math.max(Number(params.weeklyGoal) || 3, 1), 14);
    const durationGoal = Math.min(Math.max(Number(params.durationGoal) || 30, 5), 240);
    const note = String(params.note || '').slice(0, 120);
    const schedule = buildFitnessSchedule(type, durationGoal, weeklyGoal);
    return { name, type, weeklyGoal, durationGoal, note, schedule };
  },

  /* ---------------- 运动健身：规划草案（返回草案卡，不落库） ---------------- */
  planFitnessPlan(text) {
    const p = parseFitnessPlanIntent(text);
    const draft = this.createFitnessPlanDraft(p);
    const min = draft.durationGoal;
    const preview = `**${draft.name} · 恢复期草案**（每天约 ${min} 分钟）\n\n循序渐进，先恢复心肺与肌肉耐力，前 2 周避免高强度：\n\n${scheduleText(draft.schedule)}\n\n> 默认假设：每周 **${draft.weeklyGoal}** 次 · 低强度恢复${draft.note ? ` · ${draft.note}` : ''}\n> 这是草案，**保存后才写入**；可回复调整（如「改成每周4次」）。`;
    return this.buildDraftCard('addFitnessPlan', draft, ['低强度恢复期安排', `每周 ${draft.weeklyGoal} 次`], preview);
  },

  /* S4：确认执行卡（语义层 mode=action / 需确认的写动作） */
  buildActionCard(action, params = {}, assumptions = []) {
    const preview = this.formatActionPreview(action, params);
    const assump = (assumptions && assumptions.length) ? `\n\n> 假设：${assumptions.join('；')}` : '';
    return {
      needsConfirm: true, mode: 'action', action,
      preview: `**确认执行**\n\n${preview}${assump}\n\n是否执行？`,
      apply: async () => {
        const reply = await this.executeStructured(action, params || {});
        return reply || '已执行';
      }
    };
  },

  /* S4：草案卡（语义层 mode=proposal / 规划类草案） */
  buildDraftCard(action, params = {}, assumptions = [], content = '') {
    const preview = content || this.formatActionPreview(action, params);
    const assump = (assumptions && assumptions.length) ? `\n\n> 假设：${assumptions.join('；')}` : '';
    return {
      needsConfirm: true, mode: 'draft', action, params,
      preview: `**拟保存草案**\n\n${preview}${assump}\n\n（保存后才写入；可回复调整，如「改成每周4次」「去掉第三项」）`,
      apply: async () => {
        const reply = await this.executeStructured(action, params || {});
        return reply || '已保存';
      }
    };
  },

  /* S4：语义层动作参数预览（人类可读） */
  formatActionPreview(action, params = {}) {
    switch (action) {
      case 'addTask': return `新增任务「${params.title || '?'}」${params.priority ? `（${PRIO_LABEL[params.priority] || params.priority}）` : ''}${params.dueDate ? `，截止 ${formatDate(params.dueDate)}` : ''}`;
      case 'addDailyPlan': return `计划项「${params.title || '?'}」${params.date ? ` ${formatDate(params.date)}` : ''} ${params.startTime || ''}–${params.endTime || ''}`;
      case 'addDailyPlanMulti': return `批量日程（${params.date ? formatDate(params.date) : '?'}）共 ${Array.isArray(params.items) ? params.items.length : '?'} 项：${Array.isArray(params.items) ? params.items.map((i) => i.title).join('、').slice(0, 60) : ''}`;
      case 'addTimeLog': return `记录时间 \`${CATEGORY_LABEL[params.category] || params.category || '?'}\` ${formatMinutes(params.minutes)}`;
      case 'addFitnessLog': return `健身打卡 \`${FITNESS_TYPE_LABEL[params.type] || params.type || '?'}\` ${formatMinutes(params.durationMin)}`;
      case 'addFitnessPlan': return `健身计划「${params.name || '?'}」每周 ${params.weeklyGoal || '?'} 次 · 每次约 ${params.durationGoal || '?'} 分钟${Array.isArray(params.schedule) && params.schedule.length ? '（含一周安排）' : ''}`;
      case 'updateDailyPlan': return `计划项${params.delete ? '删除' : '修改'}${params.matchTitle ? `「${params.matchTitle}」` : ''}${params.date ? `（${formatDate(params.date)}）` : ''}${!params.delete && params.startTime ? ` → ${params.startTime}` : ''}`;
      case 'updateTimeLog': return `时间记录${params.delete ? '删除' : '修改'}${params.matchCategory ? ` \`${CATEGORY_LABEL[params.matchCategory] || params.matchCategory}\`` : ''}${!params.delete && params.minutes ? ` → ${formatMinutes(params.minutes)}` : ''}`;
      case 'generateReport': return `生成${params.type === 'weekly' ? '周报' : '日报'}（${params.date || '今天'}）${params.polish ? ' · AI 润色' : ''}`;
      case 'updateFitnessItem': return `健身条目${params.matchName ? `「${params.matchName}」` : ''}标记为${({ done: '完成', todo: '待做', skipped: '跳过' })[params.status] || params.status || '?'}${params.customNote ? `（备注：${params.customNote}）` : ''}`;
      case 'addFitnessItem': return `为计划「${params.planName || params.planId || '?'}」添加条目「${params.name || '?'}」${params.durationMin ? ` · ${params.durationMin} 分钟` : ''}`;
      case 'addInspiration': return `记录灵感「${params.title || '?'}」${params.mood ? `（${({ spark: '灵光一现', topic: '选题方向', visual: '视觉画面', research: '研究设想' })[params.mood] || params.mood}）` : ''}`;
      case 'queryInspirations': return `查询灵感${params.keyword ? `（关键词：${params.keyword}）` : ''}`;
      case 'queryProjects': return `查询项目${params.keyword ? `（关键词：${params.keyword}）` : ''}`;
      case 'subscribeGitHub': return `订阅${params.keyword ? `关键词「${params.keyword}」` : `仓库「${params.repo}」`}`;
      case 'unsubscribeGitHub': return `取消订阅${params.keyword ? `关键词「${params.keyword}」` : `仓库「${params.repo}」`}`;
      case 'queryGitHubSubs': return `查询 GitHub 订阅${params.type ? `（${params.type === 'keyword' ? '关键词' : '仓库'}）` : ''}`;
      default: return `${action}：${JSON.stringify(params).slice(0, 120)}`;
    }
  },

  /* ---------------- 每日计划：修改 / 删除 ---------------- */
  async updateDailyPlan(text) {
    const p = parseUpdatePlanIntent(text);
    const plans = await window.api.store.list('dailyPlans');
    const plan = plans.find((x) => x.date === p.date);
    if (!plan || !plan.items.length) return `**${formatDate(p.date)} 没有可修改的计划安排。**`;
    let target = null;
    if (p.matchTitle) target = plan.items.find((i) => i.title.includes(p.matchTitle) || p.matchTitle.includes(i.title));
    if (!target && p.matchTime) target = plan.items.find((i) => i.startTime === p.matchTime);
    if (!target) return `没有找到${p.matchTitle ? `「${App.esc(p.matchTitle)}」` : p.matchTime ? `${p.matchTime} 的` : ''}计划项，请确认后重试。`;
    const before = { ...target };
    if (p.action === 'delete') {
      plan.items = plan.items.filter((i) => i.id !== target.id);
    } else {
      const idx = plan.items.findIndex((i) => i.id === target.id);
      if (p.newStart) plan.items[idx].startTime = p.newStart;
      if (p.newEnd) plan.items[idx].endTime = p.newEnd;
      if (p.newTitle) plan.items[idx].title = p.newTitle;
      if (p.newType) plan.items[idx].type = p.newType;
      if (p.newDone !== undefined) plan.items[idx].done = p.newDone;
    }
    await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
    if (window.DailyPlan) { window.DailyPlan.state.date = p.date; await window.DailyPlan.render(); }
    if (p.action === 'delete') return `**已删除计划项**：${App.esc(before.title)}（${formatDate(p.date)} ${before.startTime}）`;
    const after = plan.items.find((i) => i.id === before.id) || before;
    return `**已修改计划项**：${App.esc(after.title)}（${formatDate(p.date)}）\n- 时间：${after.startTime}–${after.endTime}${p.newDone !== undefined ? `\n- 状态：${p.newDone ? '✅ 已完成' : '☐ 待完成'}` : ''}\n\n已同步到「每日计划」页。`;
  },

  async updateDailyPlanStructured(params = {}) {
    const date = isValidDate(String(params.date || '')) ? params.date : App.todayStr();
    const plans = await window.api.store.list('dailyPlans');
    const plan = plans.find((x) => x.date === date);
    if (!plan || !plan.items.length) return `**${formatDate(date)} 没有可修改的计划安排。**`;
    const itemId = String(params.itemId || '');
    const matchTitle = String(params.matchTitle || '');
    let target = itemId ? plan.items.find((i) => i.id === itemId) : null;
    if (!target && matchTitle) target = plan.items.find((i) => i.title.includes(matchTitle) || matchTitle.includes(i.title));
    if (!target) return `没有找到要修改的计划项，请确认后重试。`;
    const idx = plan.items.findIndex((i) => i.id === target.id);
    if (params.delete) { plan.items.splice(idx, 1); }
    else {
      if (params.startTime) plan.items[idx].startTime = params.startTime;
      if (params.endTime) plan.items[idx].endTime = params.endTime;
      if (params.title) plan.items[idx].title = String(params.title).slice(0, 60);
      if (params.type && ['work', 'study', 'meeting', 'life', 'rest'].includes(params.type)) plan.items[idx].type = params.type;
      if (params.done !== undefined) plan.items[idx].done = !!params.done;
    }
    await window.api.store.update('dailyPlans', plan.id, { items: plan.items });
    if (window.DailyPlan) { window.DailyPlan.state.date = date; await window.DailyPlan.render(); }
    return params.delete ? `**已删除计划项**：${App.esc(target.title)}（${formatDate(date)}）` : `**已修改计划项**：${App.esc(plan.items[idx].title)}（${formatDate(date)} ${plan.items[idx].startTime}–${plan.items[idx].endTime}）`;
  },

  /* ---------------- 时间记录：修改 / 删除 ---------------- */
  async updateTimeLog(text) {
    const p = parseUpdateTimeIntent(text);
    const logs = await window.api.store.list('timeLogs');
    const dayLogs = logs.filter((l) => l.date === p.date);
    if (!dayLogs.length) return `**${formatDate(p.date)} 没有时间记录。**`;
    let target = p.matchCategory ? dayLogs.filter((l) => l.category === p.matchCategory).slice(-1)[0] : null;
    if (!target) target = dayLogs[dayLogs.length - 1];
    if (p.action === 'delete') {
      await window.api.store.remove('timeLogs', target.id);
    } else {
      const patch = {};
      if (p.newMinutes) patch.minutes = p.newMinutes;
      if (p.newCategory) patch.category = p.newCategory;
      await window.api.store.update('timeLogs', target.id, patch);
    }
    if (window.Time && window.Time.render) await window.Time.render();
    return p.action === 'delete'
      ? `**已删除时间记录**：${formatDate(p.date)} \`${CATEGORY_LABEL[target.category]}\` ${formatMinutes(target.minutes)}`
      : `**已修改时间记录**：${formatDate(p.date)} \`${CATEGORY_LABEL[p.newCategory || target.category]}\` → ${formatMinutes(p.newMinutes || target.minutes)}`;
  },

  async updateTimeLogStructured(params = {}) {
    const date = isValidDate(String(params.date || '')) ? params.date : App.todayStr();
    const logs = await window.api.store.list('timeLogs');
    const dayLogs = logs.filter((l) => l.date === date);
    if (!dayLogs.length) return `**${formatDate(date)} 没有时间记录。**`;
    const target = String(params.matchCategory || '') ? dayLogs.filter((l) => l.category === params.matchCategory).slice(-1)[0] : dayLogs[dayLogs.length - 1];
    if (!target) return '没有找到要修改的时间记录。';
    if (params.delete) {
      await window.api.store.remove('timeLogs', target.id);
    } else {
      const patch = {};
      if (params.minutes) patch.minutes = Math.min(Math.max(Number(params.minutes), 1), 1440);
      if (params.category) patch.category = params.category;
      await window.api.store.update('timeLogs', target.id, patch);
    }
    if (window.Time && window.Time.render) await window.Time.render();
    return params.delete ? `**已删除时间记录**（${formatDate(date)}）` : `**已修改时间记录**：${formatDate(date)} → ${formatMinutes(params.minutes || target.minutes)}`;
  },

  /* ---------------- 工作台洞察 / 主动建议 ---------------- */
  async suggestInsights() {
    const [tasks, plans, logs, fLogs] = await Promise.all([
      window.api.store.list('tasks'),
      window.api.store.list('dailyPlans'),
      window.api.store.list('timeLogs'),
      window.api.store.list('fitnessLogs')
    ]);
    const today = App.todayStr();
    const tips = [];
    // 1. 逾期任务
    const overdue = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today);
    if (overdue.length) tips.push(`你有 **${overdue.length}** 项任务已逾期（如「${App.esc(overdue[0].title)}」），建议今天优先处理或调整截止日期。`);
    // 2. 待办事项
    const dayPlan = plans.find((p) => p.date === today);
    if (dayPlan && dayPlan.items.length) {
      const undone = dayPlan.items.filter((i) => !i.done);
      const done = dayPlan.items.length - undone.length;
      tips.push(`待办事项完成 **${done}/${dayPlan.items.length}**${undone.length ? `，未完成：${undone.slice(0, 3).map((i) => App.esc(i.title)).join('、')}${undone.length > 3 ? ' 等' : ''}` : '，全部完成 🎉'}。`);
    } else {
      tips.push('今天还没有日程安排，可以让我帮你规划，如「安排 今天9点到10点 写论文」。');
    }
    // 3. 时间分布
    const dayLogs = logs.filter((l) => l.date === today);
    if (dayLogs.length) {
      const total = dayLogs.reduce((s, l) => s + l.minutes, 0);
      const byCat = {};
      dayLogs.forEach((l) => { byCat[l.category] = (byCat[l.category] || 0) + l.minutes; });
      const restRatio = ((byCat.rest || 0) + (byCat.life || 0)) / total;
      if (restRatio > 0.5) tips.push(`今日时间「休息/生活」占比 ${Math.round(restRatio * 100)}%，注意平衡工作与休息节奏。`);
      if (!byCat.focus && total > 0) tips.push('今天还没有「专注」记录，试试用番茄钟进入深度工作。');
    } else {
      tips.push('今天还没有时间记录，可用「记录 学习 2小时」或番茄钟开始追踪。');
    }
    // 4. 健身断档
    if (fLogs.length) {
      const last = fLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
      const days = Math.max(0, Math.floor((new Date(`${today}T00:00:00`) - new Date(`${last.date}T00:00:00`)) / 86400000));
      if (days >= 3) tips.push(`已连续 **${days}** 天没有健身打卡，今天可安排 30 分钟恢复训练。`);
    } else {
      tips.push('还没有健身记录，说「新建运动计划」开始制定训练目标。');
    }
    if (!tips.length) return '**今日工作台洞察** 📊\n\n一切井然有序，继续保持！';
    return `**今日工作台洞察** 📊\n\n${tips.map((tip) => `· ${tip}`).join('\n\n')}\n\n> 需要我调整安排或细化某方面建议，直接说即可（如「把明天9点的写论文改到下午2点」）。`;
  },

  /* ---------------- 查询统计（任务） ---------------- */
  async queryStats() {
    const tasks = await window.api.store.list('tasks');
    const today = App.todayStr();
    const done = tasks.filter((t) => t.status === 'done');
    const doneToday = done.filter((t) => (t.completedAt || '').slice(0, 10) === today).length;
    const open = tasks.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;
    const byPrio = { high: 0, medium: 0, low: 0 };
    open.forEach((t) => { byPrio[t.priority] = (byPrio[t.priority] || 0) + 1; });
    const recent = open.slice().sort((a, b) => String(a.dueDate || '9999-99-99').localeCompare(String(b.dueDate || '9999-99-99'))).slice(0, 5);
    let reply = `**任务概况**\n\n- 总数 ${tasks.length} 项，已完成 **${done.length}**（今日完成 ${doneToday}）\n- 未完成 **${open.length}** 项（高 ${byPrio.high} / 中 ${byPrio.medium} / 低 ${byPrio.low}），已逾期 ${overdue} 项\n\n**最近待办**：\n`;
    reply += recent.length ? recent.map((t) => `- ${t.dueDate ? `[${t.dueDate}] ` : ''}${App.esc(t.title)}${t.priority === 'high' ? '（高优先）' : ''}`).join('\n') : '（无）';
    return reply;
  },

  /* ---------------- 生成日报 / 周报 ---------------- */
  async generateReport(text) {
    const type = /周报/.test(String(text || '')) ? 'weekly' : 'daily';
    const date = App.todayStr();
    const r = await window.api.report.generate(type, date, {});
    if (!r || !r.report) return '报告生成失败，请稍后重试。';
    const content = String(r.report.content || '');
    const preview = content.split('\n').slice(0, 6).join('\n');
    return `**${type === 'weekly' ? '周报' : '日报'}已生成**（${date}）\n\n${preview}\n\n> 完整报告已归档，可在「日报 / 周报」页查看、润色与导出。`;
  },

  /* ---------------- 帮助 ---------------- */
  help() {
    return `**我可以直接帮你执行这些操作**（输入即可）：\n\n- **新增任务**：「帮我添加任务 明天下午 完成实验设计（高优先级）」\n- **安排计划**：「安排 明天9点到11点 写论文」；批量：「帮我新增一个每日计划，九点到教研室打卡，然后做自媒体内容」\n- **修改计划**：「把明天9点的写论文改到下午2点」「删除明天的组会」\n- **记录时间**：「记录 学习 2小时」\n- **修改时间记录**：「把今天的学习记录改成 1小时」「删除今天的学习记录」\n- **健身打卡 / 计划**：「打卡 跑步 30分钟」「新建运动计划 跑步 每周5次」\n- **规划运动方案**：「帮我规划一个运动计划，每天半小时」\n- **任务拆解**：「帮我拆解 撰写论文第二章」（进入确认弹窗）\n- **查询**：「总结我的任务进度」「看看今天的计划」「今天时间都花哪了」「我的健身进度」\n- **洞察建议**：「帮我看看时间安排」「给点建议」\n- **生成报告**：「帮我生成今天的日报」\n\n未命中的问题将走 AI 对话回答（在「设置」页配置模型后支持语义识别）。`;
  }
};

/* ================= 结构化执行统一入口（语义层/预览确认调用） ================= */
async function executeTaskDrafts(drafts, rejected, isDaily) {
  const created = [];
  for (const d of drafts) {
    const task = await window.api.store.create('tasks', {
      title: d.title, priority: d.priority, dueDate: d.dueDate,
      status: 'todo', note: '', projectId: null, aiSplit: null
    });
    try {
      await window.api.store.create('activity', { date: App.todayStr(), taskId: task.id, action: '创建', content: `创建任务：${task.title}` });
    } catch (e) { /* 活动日志失败不阻断任务创建 */ }
    created.push(task);
  }
  if (window.Tasks && window.Tasks.render) window.Tasks.render();
  if (window.Board && window.Board.invalidate) window.Board.invalidate();
  const openTasks = await window.api.store.list('tasks').then((list) => list.filter((t) => t.status !== 'done').length);
  const lines = created.map((t) => `- \`${PRIO_LABEL[t.priority] || '中优先'}\` ${App.esc(t.title)}${t.dueDate ? `（截止 ${formatDate(t.dueDate)}）` : ''}${isDaily ? ' · 已按单次记录' : ''}`);
  let reply = `**已创建任务**${created.length > 1 ? `（${created.length} 项）` : ''}\n${lines.join('\n')}\n\n当前还有 **${openTasks}** 项未完成。`;
  if (rejected && rejected.length) reply += `\n\n> 未能创建：${rejected.join('；')}`;
  return reply;
}

/* ---------------- 规则与工具 ---------------- */

const PRIO_LABEL = { high: '高优先', medium: '中优先', low: '低优先' };
const CATEGORY_LABEL = { focus: '专注', work: '工作', study: '学习', life: '生活', rest: '休息', sport: '运动', reading: '阅读', writing: '写作' };
const PLAN_TYPE_LABEL = { work: '工作', study: '学习', meeting: '会议', life: '生活', rest: '休息' };
const FITNESS_TYPE_LABEL = { running: '跑步', strength: '力量', yoga: '瑜伽', ball: '球类', other: '其他' };
const GENERIC_TITLES = new Set(['任务', '计划', '待办', 'todo', '安排', '每日', '每天', '今天', '明天', '后天', '日程', '每日任务', '每天任务', '任务计划', '任务安排', '日程安排']);

function isGenericTitle(title) {
  if (GENERIC_TITLES.has(title)) return true;
  return /^(?:每日|每天|天天|今日|今天|明天|后天|本周|下周|早上|晚上)?(?:任务|计划|待办|日程|安排|工作)$/.test(title);
}

/* --- 否定 / 疑问过滤（带副作用的动作必须明确命令句） --- */
const NEGATION_RE = /(?:不|别|不要|不用|无需|不想|别做|拒绝|取消|禁止|别加)/;
const HARD_QUESTION_RE = /(?:吗|呢|？|\?|能否|是否|需不需要|可不可以|行不行)/;
const SOFT_QUESTION_RE = /(?:怎么|如何|为什么|需要什么|要准备|需要准备|有什么)/;

/* --- S5：礼貌请求外壳（你能帮我X吗 = 请求，而非纯提问） --- */
const POLITE_SHELL_RE = /^(?:请|麻烦)?(?:你能|你帮|可以帮我|请你|请帮我)?(?:帮我)?\s*(?:新建|新增|添加|创建|安排|记录|打卡|规划|制定|拆解|生成|修改|删除|调整|建个)[^。？\n]{1,30}(?:吗|好不好|可以吗|行吗|吧)$/;

function stripPoliteShell(text) {
  const t = String(text || '').trim();
  if (!POLITE_SHELL_RE.test(t)) return null;
  return t
    .replace(/^(?:请|麻烦|你能|你帮|可以帮我|请你|请帮我|帮我)+/, '')
    .replace(/(?:吗|好不好|可以吗|行吗|吧)$/, '')
    .trim();
}

/* --- 动作正则 --- */
// 新增任务：① 动词 + 对象词（任务/待办/todo；「计划」属日程语境不再归任务，避免「新增每日计划」被误建任务）；② 记一下/记个/加个（负向前瞻排除笔记类）
const ADD_TASK_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:(?:新增|添加|创建|安排)[^。；！？\n]{0,30}?(?:任务|待办|to[\s-]?do)|(?:记一下|记个|加个)(?![^。；！？\n]{0,8}(?:笔记|备忘|想法|灵感|日记|文献))[^。；！？\n]{0,40})/i;

/** 每日计划批量判定：① 含「每日/每天」+「计划/安排/日程」；② 或含 ≥2 个独立时间段（时间段范围算一个） */
function isDailyPlanMulti(t) {
  const s = String(t || '');
  const hasVerb = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:新增|添加|创建|安排|规划)/.test(s);
  if (!hasVerb) return false;
  if (/(?:每日|每天|天天)/.test(s) && /(?:计划|安排|日程)/.test(s)) return true;
  const noRange = s.replace(/\d{1,2}\s*[:：]?\s*\d{0,2}\s*(?:点|时)\s*(?:到|至|-|~)\s*\d{1,2}\s*[:：]?\s*\d{0,2}\s*(?:点|时)/g, 'RANGE');
  const timeCount = (noRange.match(/\d{1,2}\s*[:：]?\s*\d{0,2}\s*(?:点|时)/g) || []).length;
  return timeCount >= 2;
}
// 拆解（进入人工确认流程）
const SPLIT_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:拆解|拆分|分解)/;
// 每日计划：安排/计划/规划 + 时间段特征（X点 / X:XX）
const DAILY_PLAN_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:安排|计划|规划)[^。；！？\n]{0,20}(?:\d{1,2}\s*[:：]?\s*\d{0,2}\s*(?:点|时)|\d{1,2}:\d{2})/;
// 时间记录：记录/记一下 + 分类 + 时长
const TIME_LOG_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:记录|记一下|录入|添加时间)[^。；！？\n]{0,18}(?:工作|学习|生活|休息|运动|专注|阅读|写作)[^。；！？\n]{0,15}(?:\d{1,2}(?:\.\d+)?)\s*(?:小时|分钟|分)/;
// 健身打卡：打卡/健身 + 运动类型 + 时长
const FITNESS_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:打卡|健身打卡|运动打卡|记录健身)[^。；！？\n]{0,20}(?:\d{1,2}(?:\.\d+)?)\s*(?:小时|分钟|分)/;
// 新建健身计划：新建/创建 + 健身/运动类型 + 计划/方案（明确保存意图；「制定/规划」归草案）
const FITNESS_PLAN_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:新建|新增|创建|加个|建个|设个|存个|保存)[^。；！？\n]{0,12}(?:健身|运动|锻炼|跑步|力量|瑜伽|球类|游泳|骑行)[^。；！？\n]{0,10}(?:计划|方案|目标)/;
// 规划健身方案：规划/制定/安排 + 健身/运动 + 计划（走 AI 或本地建议，不落库）
const PLAN_FITNESS_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:规划|制定|安排|设计)[^。；！？\n]{0,12}(?:健身|运动|锻炼|跑步|力量|瑜伽|球类|游泳|骑行)[^。；！？\n]{0,10}(?:计划|方案|安排)/;
// 查询：需查询词开头，避免「新建/规划运动计划」被误吞
const QUERY_FITNESS_RE = /(?:看看|查看|我的|当前|本周|上月|总结|统计|还剩|多少).{0,10}(?:健身|运动|锻炼|打卡)|(?:健身|运动|锻炼|打卡).{0,6}(?:进度|记录|完成情况|统计|完成率)|连续.*天/;
const QUERY_PLAN_RE = /(?:看看|查看|我的|今天|今日|明天|明日|本周).{0,12}(?:计划|日程|安排)/;
const QUERY_TIME_RE = /(?:时间|时长).*(?:分布|统计|花|哪里|多少)|(?:今天|今日|本周).*(?:时间|时长)/;
const QUERY_RE = /(?:我的|当前|看看|总结|统计|还剩|多少|进度|完成).*(?:任务|进度|完成|待办|情况)/;
// 报告
const REPORT_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:生成|写|来一份|出一份|做)\s*(?:今天|今日|本周|这周|上周|昨天|的)*\s*(?:日报|周报)/;
// 修改/删除 每日计划（放查询前，避免「删除明天的组会」被查询吞掉）
const UPDATE_PLAN_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:修改|更改|更新|调整|改一下|推迟|提前|删除|取消|移除|把|将)[^。；！？\n]{0,24}(?:计划|日程|安排|事项|组会|会议|讲座|论文|实验|文献|学习|锻炼|健身)/;
// 修改/删除 时间记录
const UPDATE_TIME_RE = /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:修改|更改|更新|调整|改一下|删除|取消|移除|把|将)[^。；！？\n]{0,20}(?:时间|时长|记录)/;
// 洞察建议（只读，不受弱疑问限制）
const SUGGEST_RE = /(?:建议|优化|时间管理|效率|怎么安排|安排不合理|忙不过来|时间不够|帮我分析|分析一下|看看我的|查看我的|今日洞察|如何安排|(?:看看|查看).{0,6}(?:时间|安排))/;
// 帮助
const HELP_RE = /(?:你能|你可以|能帮我|帮我什么|帮助|help|怎么用|能做什么|会什么)/i;

/* --- 意图文本清洗 --- */
function stripIntent(text) {
  return String(text || '')
    .replace(/^(?:请|麻烦|帮我|你好)?\s*(?:新增|添加|创建|安排|记一下|记个|加个|我要)\s*/i, '')
    .replace(/^(?:任务|待办|计划|todo)[：:]?\s*/i, '')
    // 长词优先：每日任务/每天任务 先于 每日/每天（否则「每日任务：背单词」会残留「任务：」前缀）
    .replace(/^(?:每日任务|每天任务|每日|每天|天天)\s*/g, '')
    .replace(/^[：:，,、\s]+|[，,、\s]+$/g, '')
    .trim();
}

function cleanTitle(title) {
  return String(title || '').trim()
    .replace(/^(?:任务|待办|计划|todo)[：:]?\s*/i, '') // 剥残留对象词前缀（如「任务：背单词」→「背单词」）
    .replace(/[（(]\s*(?:高|中|低)?优先(?:级)?[)）]/g, '') // 去（高优先级）
    .replace(/^(?:上午|中午|下午|晚上|早上|清晨|深夜)\s*/g, '') // 去时段词
    .trim();
}

/* --- 多任务拆分：分号/换行/编号/顿号列表；「和」不拆分（避免误拆「整理实验数据和图表」） --- */
function isListCommand(text) {
  return /^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:新增|添加|创建|记一下|记个|加个|安排|我要)/.test(String(text || ''));
}

function splitSegments(text, listCommand) {
  const result = [];
  const push = (s) => { const v = String(s || '').trim(); if (v) result.push(v); };
  String(text || '').split(/\n|；|;/).forEach((part) => {
    const p = String(part).trim();
    if (!p) return;
    // 编号列表：1. xxx 2. xxx / ① ②（惰性匹配 + 前瞻，避免吞掉下一个编号）
    const numbered = p.match(/\d+[.、．]\s*[^。；\n]{1,40}?(?=\d+[.、．]|$)/g);
    if (numbered && numbered.length > 1) {
      numbered.forEach((n) => push(n.replace(/^\d+[.、．]\s*/, '')));
      return;
    }
    // 顿号列表：仅当命令以动词开头（明确列表意图）时拆分
    if (listCommand && (p.match(/、/g) || []).length >= 1) {
      p.split(/、/).forEach(push);
      return;
    }
    push(p);
  });
  return result.slice(0, 4);
}

/* --- 日期/时间解析 --- */
function pad(n) { return String(Number(n)).padStart(2, '0'); }
function shiftDate(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** 严格日期校验：YYYY-MM-DD 且为真实存在的日期 */
function isValidDate(str) {
  const m = String(str || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(y, mo, 0).getDate(); // 该月天数
  return d <= days;
}

function parseDateRef(text, fallback = App.todayStr()) {
  const today = new Date();
  let m;
  if ((m = String(text || '').match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = String(text || '').match(/(\d{1,2})月(\d{1,2})日/))) return `${today.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  if (/后天/.test(String(text || ''))) return fmtDate(shiftDate(today, 2));
  if (/明天/.test(String(text || ''))) return fmtDate(shiftDate(today, 1));
  return fallback;
}

function parseTimeRange(text) {
  const t = String(text || '');
  const m = t.match(/(\d{1,2})\s*[:：]?\s*(\d{2})?\s*(?:点|时)?\s*(?:到|至|-|~|—)?\s*(\d{1,2})\s*[:：]?\s*(\d{2})?\s*(?:点|时)?/);
  if (m && m[3] !== undefined) return { start: `${pad(resolveHour(m[1], t))}:${m[2] || '00'}`, end: `${pad(resolveHour(m[3], t))}:${m[4] || '00'}` };
  const s = t.match(/(\d{1,2})\s*[:：]?\s*(\d{2})?\s*(?:点|时)/);
  if (s) return { start: `${pad(resolveHour(s[1], t))}:${s[2] || '00'}`, end: nextHour(`${pad(resolveHour(s[1], t))}:${s[2] || '00'}`) };
  return { start: '09:00', end: '10:00' };
}

/** 12 小时制 → 24 小时制（下午/晚上 +12；中午 12 保持） */
function resolveHour(rawHour, text) {
  let h = Number(rawHour);
  if (/下午|晚上|傍晚/.test(String(text || '')) && h < 12) h += 12;
  else if (/中午/.test(String(text || '')) && h < 12) h += 12;
  return h % 24;
}

function nextHour(time) {
  const [h, m] = String(time).split(':').map(Number);
  return `${pad((h + 1) % 24)}:${pad(m || 0)}`;
}

function parseMinutes(text) {
  let total = 0;
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*小时/g);
  if (m) m.forEach((x) => { total += Math.round(Number(x.match(/(\d+(?:\.\d+)?)/)[1]) * 60); });
  const n = String(text || '').match(/(\d+(?:\.\d+)?)\s*(?:分钟|分)/);
  if (n) total += Math.round(Number(n[1]));
  return total;
}

/* --- 各模块意图解析 --- */
function parseDailyPlanIntent(text) {
  const t = String(text || '');
  const date = parseDateRef(t);
  const range = parseTimeRange(t);
  // 标题 = 去掉意图动词/日期/时间后的剩余
  let title = stripIntent(t)
    .replace(/(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{1,2}月\d{1,2}日|今天|明天|后天|本周|下周|上午|下午|中午|晚上|早上|清晨|深夜)\s*/g, '')
    .replace(/\d{1,2}\s*[:：]?\s*\d{0,2}\s*(?:点|时)?\s*(?:到|至|-|~|—)?\s*\d{0,2}\s*[:：]?\s*\d{0,2}\s*(?:点|时)?\s*/g, '')
    .replace(/^[：:，,、\s]+|[，,、\s]+$/g, '')
    .trim();
  let type = 'work';
  if (/会议|组会|讨论|汇报/.test(t)) type = 'meeting';
  else if (/学习|研究|读文献|阅读|写作|论文|实验|文献/.test(t)) type = 'study';
  else if (/休息|午休|放松|散步/.test(t)) type = 'rest';
  else if (/生活|吃饭|家务|通勤|购物|运动/.test(t)) type = 'life';
  return { date, startTime: range.start, endTime: range.end, title, type };
}

function parseTimeLogIntent(text) {
  const t = String(text || '');
  const catMap = { 工作: 'work', 学习: 'study', 生活: 'life', 休息: 'rest', 运动: 'sport', 专注: 'focus', 阅读: 'reading', 写作: 'writing' };
  let category = 'study';
  for (const [k, v] of Object.entries(catMap)) { if (t.includes(k)) { category = v; break; } }
  return { category, minutes: parseMinutes(t), date: parseDateRef(t) };
}

function parseFitnessIntent(text) {
  const t = String(text || '');
  const typeMap = { 跑步: 'running', 慢跑: 'running', 力量: 'strength', 举铁: 'strength', 瑜伽: 'yoga', 球: 'ball', 篮球: 'ball', 羽毛球: 'ball', 游泳: 'other', 骑行: 'other', 健身: 'other' };
  let type = 'other';
  for (const [k, v] of Object.entries(typeMap)) { if (t.includes(k)) { type = v; break; } }
  return { type, durationMin: parseMinutes(t), date: parseDateRef(t) };
}

/** 解析健身计划意图：类型 / 每周目标次数 / 单次时长 / 备注 */
function parseFitnessPlanIntent(text) {
  const t = String(text || '');
  const typeMap = { 跑步: 'running', 慢跑: 'running', 力量: 'strength', 举铁: 'strength', 瑜伽: 'yoga', 球类: 'ball', 篮球: 'ball', 羽毛球: 'ball', 游泳: 'other', 骑行: 'other' };
  let type = 'other';
  for (const [k, v] of Object.entries(typeMap)) { if (t.includes(k)) { type = v; break; } }
  // 每周目标：每天 → 7；每周 N 次 → N；默认 3
  let weeklyGoal = 3;
  if (/每天|每日/.test(t)) weeklyGoal = 7;
  else {
    const m = t.match(/(?:每周|一周|每星期)\s*(\d+)\s*次/);
    if (m) weeklyGoal = Math.min(Number(m[1]), 14);
  }
  // 单次时长：X小时/X分钟/半小时；默认 30
  let durationGoal = 30;
  const dm = t.match(/(\d+(?:\.\d+)?)\s*(小时|分钟)/);
  if (dm) durationGoal = dm[2] === '小时' ? Math.round(Number(dm[1]) * 60) : Number(dm[1]);
  else if (/半小时/.test(t)) durationGoal = 30;
  const note = /很久没|恢复|久未|新手|刚开始/.test(t) ? '恢复期，循序渐进' : '';
  return { name: `${FITNESS_TYPE_LABEL[type]}训练计划`, type, weeklyGoal, durationGoal, note };
}

/** 解析每日计划修改意图：日期 / 动作(update|delete) / 目标(标题|时间) / 新时间 */
function parseUpdatePlanIntent(text) {
  const t = String(text || '');
  const date = parseDateRef(t);
  const action = /删除|取消|移除/.test(t) ? 'delete' : 'update';
  let matchTitle = null;
  let matchTime = null;
  const quotes = t.match(/[「『""]([^」』""]{1,20})[」』""]/);
  // 「把 明天9点的写论文 改到 下午2点」：目标=9点的写论文
  const timeM = t.match(/(?:把|将)?\s*(?:今天|明天|后天|今日|明日)?\s*(\d{1,2})\s*[:：]?\s*(\d{2})?\s*(?:点|时)\s*的\s*([^，。；！？\n]{1,16})/);
  if (quotes) {
    matchTitle = quotes[1];
  } else if (timeM) {
    matchTime = `${pad(timeM[1])}:${timeM[2] || '00'}`;
    matchTitle = timeM[3] || null;
  } else {
    const dm = t.match(/(?:删除|取消|移除|修改|改|调整|推迟|提前)\s*(?:今天|明天|后天|今日|明日)?\s*(?:的)?\s*([^，。；！？\n]{2,14})$/);
    if (dm) matchTitle = dm[1].replace(/(?:计划|日程|安排|事项)$/, '');
  }
  // 新时间：改到/移到/提前到/推迟到 X点（[到 Y点]）
  let newStart = null;
  let newEnd = null;
  const toM = t.match(/(?:改到|移到|调整到|改成|挪到|提前到|推迟到)\s*(?:下午|晚上|上午|中午|早上)?\s*(\d{1,2})\s*[:：]?\s*(\d{2})?\s*(?:点|时)?\s*(?:到|至|-|~)?\s*(\d{1,2})?\s*[:：]?\s*(\d{2})?\s*(?:点|时)?/);
  if (toM) {
    newStart = `${pad(resolveHour(toM[1], t))}:${toM[2] || '00'}`;
    if (toM[3] !== undefined) newEnd = `${pad(resolveHour(toM[3], t))}:${toM[4] || '00'}`;
  }
  return { date, action, matchTitle, matchTime, newStart, newEnd };
}

/** 解析时间记录修改意图：日期 / 动作 / 目标分类 / 新时长 / 新分类 */
function parseUpdateTimeIntent(text) {
  const t = String(text || '');
  const date = parseDateRef(t);
  const action = /删除|取消|移除/.test(t) ? 'delete' : 'update';
  const catMap = { 工作: 'work', 学习: 'study', 生活: 'life', 休息: 'rest', 运动: 'sport', 专注: 'focus', 阅读: 'reading', 写作: 'writing' };
  let matchCategory = null;
  for (const [k, v] of Object.entries(catMap)) { if (t.includes(k)) { matchCategory = v; break; } }
  let newMinutes = null;
  const m = t.match(/(?:改成|改为|调整成|调成|设为|变成)\s*(\d+(?:\.\d+)?)\s*(小时|分钟)/);
  if (m) newMinutes = m[2] === '小时' ? Math.round(Number(m[1]) * 60) : Number(m[1]);
  else { const mm = t.match(/(\d+(?:\.\d+)?)\s*(小时|分钟)/); if (mm) newMinutes = mm[2] === '小时' ? Math.round(Number(mm[1]) * 60) : Number(mm[1]); }
  return { date, action, matchCategory, newMinutes };
}

/** 解析每日计划批量安排：剥离意图头尾 → 按连接词拆事项 → 每项提取时间/标题/类型 */
function parseDailyPlanMulti(text) {
  const t = String(text || '');
  const today = new Date();
  const date = /后天/.test(t) ? fmtDate(shiftDate(today, 2)) : /明天/.test(t) ? fmtDate(shiftDate(today, 1)) : App.todayStr();
  const daily = /每日|每天|天天/.test(t);
  // 剥离「帮我新增一个每日计划」头部与「帮我安排每日的计划」尾部
  let body = t
    .replace(/^(?:请|麻烦|你帮我|你帮|帮我)?\s*(?:新增|添加|创建|安排|规划)\s*(?:一个|一项|每日|每天)?\s*(?:每日|每天|每日的)?\s*(?:计划|安排|日程)[，,:：]?\s*/i, '')
    .replace(/(?:帮我安排(?:每日|每天)?的?(?:计划|安排|日程))[。！？]?$/i, '')
    .trim();
  if (!body) return { date, items: [], daily };
  // 拆事项（连接词分隔）
  const rawItems = body.split(/，|,|；|;|。|然后|接着|还需要|还要|还需|另外|以及|\s+和\s+|然后去|再/)
    .map((s) => s.trim()).filter((s) => s && s.length > 1);
  const items = [];
  let cursorHour = 9;
  rawItems.forEach((raw) => {
    const m = raw.match(/(?:([一二三四五六七八九十两]{1,3})|\d{1,2})\s*[:：]?\s*(\d{2})?\s*(?:点|时)/);
    let start;
    if (m) {
      const h = m[1] ? cnNumToInt(m[1]) : Number(m[0].match(/\d+/)[0]);
      cursorHour = /下午|晚上|傍晚/.test(raw) && h < 12 ? h + 12 : h;
      start = `${pad(cursorHour)}:${m[2] || '00'}`;
    } else {
      start = `${pad(cursorHour % 24)}:00`;
    }
    const end = `${pad((cursorHour + 1) % 24)}:00`;
    cursorHour += 1;
    let title = raw
      .replace(/(?:我|每天|每日|天天|上午|下午|晚上|早上|中午|清晨|深夜)/g, '')
      .replace(/(?:[一二三四五六七八九十两]{1,3}|\d{1,2})\s*[:：]?\s*\d{0,2}\s*(?:点|时)\s*/g, '')
      .replace(/^(?:要到|到|去|需要|还要|然后|接着|做|要|以及|和)\s*/, '')
      .replace(/[，,。；;、]+$/g, '')
      .trim();
    if (!title || title.length < 2) return;
    const type = /教研|打卡|开会|组会|会议|兼职|工作|汇报/.test(title) ? 'work' : /自媒体|学术|论文|学习|文献|读书|写|备课|课程/.test(title) ? 'study' : /推特|新闻|休息|运动|娱乐|吃饭|生活/.test(title) ? 'life' : 'work';
    items.push({ id: `item-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, startTime: start, endTime: end, title, type, note: '', done: false, taskId: null });
  });
  return { date, items, daily };
}

/** 中文数字 → 整数（支持 十/十五/二十/二十五） */
function cnNumToInt(s) {
  const num = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  if (/^十[一二三四五六七八九]$/.test(s)) return 10 + num[s[1]];
  if (/^[一二三四五六七八九]十$/.test(s)) return num[s[0]] * 10;
  if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(s)) return num[s[0]] * 10 + num[s[2]];
  return num[s] !== undefined ? num[s] : null;
}

function formatDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : dateStr;
}

/** S6：生成一周 7 天训练草案（恢复期低强度） */
function buildFitnessSchedule(type, durationMin, weekGoal) {
  const t = FITNESS_TYPE_LABEL[type] || '健身';
  const dayMap = ['一', '二', '三', '四', '五', '六', '日'];
  const strengthDay = { title: '居家力量（深蹲 / 俯卧撑各 3 组）', durationMin: Math.round(durationMin * 0.8) };
  const cardioDay = { title: `${t} ${Math.round(durationMin * 0.8)} 分钟 + 拉伸`, durationMin };
  const restDay = { title: '主动休息（散步 20 分钟 + 拉伸）', durationMin: 20 };
  const plans = [cardioDay, strengthDay, restDay, cardioDay, strengthDay, { ...cardioDay, durationMin: Math.round(durationMin * 1.1) }, restDay];
  // 按周目标裁减：前 weekGoal 天安排运动，其余为休息日
  return dayMap.map((day, i) => {
    const p = plans[i];
    if (i < weekGoal) return { day, title: p.title, durationMin: p.durationMin, type };
    return { day, title: restDay.title, durationMin: restDay.durationMin, type: 'rest' };
  });
}

function scheduleText(schedule) {
  if (!Array.isArray(schedule)) return '';
  return schedule.map((d) => `- **周${d.day}**：${d.title}${d.durationMin ? `（${d.durationMin} 分钟）` : ''}`).join('\n');
}

function formatMinutes(min) {
  const n = Number(min) || 0;
  if (n >= 60 && n % 60 === 0) return `${n / 60} 小时`;
  if (n > 60) return `${Math.floor(n / 60)} 小时 ${n % 60} 分`;
  return `${n} 分钟`;
}

function genericHint() {
  return '没能识别出具体任务内容 😅 请补充，例如：\n\n- 「帮我添加任务 明天下午 完成实验设计（高优先级）」\n- 「帮我添加任务 整理实验数据」';
}

/* ---------------- 挂载 ---------------- */
if (typeof window !== 'undefined') window.AssistantActions = AssistantActions;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantActions;
