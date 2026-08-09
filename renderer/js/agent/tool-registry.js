'use strict';

/* ============ ToolRegistry 工具注册表（替代正则动作表路由） ============
 * 每个工具 = { name, description(含正反例消歧), parameters(JSON Schema), write, executor }
 * LLM 通过 function calling 选择工具；执行仍走确定性代码（AssistantActions.executeStructured）。
 * 写工具（write=true）由 AgentLoop 生成确认卡/草案卡，确认后才落库。
 */

const TOOLS = [
  {
    name: 'addTask',
    description: '新增一个任务（待办事项模块）。当用户说「添加/新增/创建任务、记一下待办」时使用。注意：①「计划/日程」指每日计划（addDailyPlan），用户安排具体时间段的事项（如「9点到11点写论文」）应使用 addDailyPlan 而非本工具；②修改/删除任务用 updateTask/deleteTask，查询任务清单用 queryTask。',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: '任务标题（必填）' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级' },
        dueDate: { type: 'string', description: '截止日期 YYYY-MM-DD（相对日期换算）' }
      }
    },
    write: true,
    executor: 'addTask'
  },
  {
    name: 'queryTask',
    description: '查询任务清单（待办事项模块）。当用户问「我的待办有哪些/查一下任务/任务进度/列出任务」时使用；status 可按需过滤（open=未完成/todo/doing/done）。修改或删除任务前建议先调用本工具定位标题。',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['open', 'todo', 'doing', 'done'], description: '按状态过滤，缺省全部' } }
    },
    write: false,
    executor: 'queryTask'
  },
  {
    name: 'updateTask',
    description: '修改任务（标题/优先级/截止日期/状态）。当用户说「把X改到明天/把X标记完成/改一下任务X的优先级」时使用；matchTitle 按标题关键词定位。注意：写入操作会弹确认卡；仅处理任务（待办事项模块），每日计划用 updateDailyPlan；定位不到先 queryTask。',
    parameters: {
      type: 'object',
      required: ['matchTitle'],
      properties: {
        matchTitle: { type: 'string', description: '任务标题关键词' },
        title: { type: 'string', description: '新标题' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        dueDate: { type: 'string', description: '截止日期 YYYY-MM-DD（相对日期换算）' },
        status: { type: 'string', enum: ['todo', 'doing', 'done'], description: '新状态' }
      }
    },
    write: true,
    executor: 'updateTask'
  },
  {
    name: 'deleteTask',
    description: '删除任务。当用户说「删除任务X/把X任务删掉」时使用；matchTitle 按标题关键词定位。注意：写入操作会弹确认卡；仅处理任务（待办事项模块），每日计划用 updateDailyPlan；定位不到先 queryTask。',
    parameters: {
      type: 'object',
      required: ['matchTitle'],
      properties: { matchTitle: { type: 'string', description: '任务标题关键词' } }
    },
    write: true,
    executor: 'deleteTask'
  },
  {
    name: 'splitTask',
    description: '将任务拆解为执行步骤。当用户说「帮我拆解/拆分/分解 任务X」时使用；title 为目标任务标题（缺省拆解最近未完成任务）。打开拆解预览弹窗，由用户编辑确认后应用。',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string', description: '目标任务标题' } }
    },
    write: false,
    executor: 'splitTask'
  },
  {
    name: 'addDailyPlan',
    description: '安排单个日程（含时间段）。当用户说「安排/计划 X点到Y点 做某事」且只有一个时间段时使用。多个时间段或多个事项用 addDailyPlanMulti。',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD' },
        startTime: { type: 'string', description: '开始 HH:MM' },
        endTime: { type: 'string', description: '结束 HH:MM' },
        title: { type: 'string', description: '事项标题（必填）' },
        type: { type: 'string', enum: ['work', 'study', 'meeting', 'life', 'rest'] }
      }
    },
    write: true,
    executor: 'addDailyPlan'
  },
  {
    name: 'addDailyPlanMulti',
    description: '批量安排多个日程事项。当用户给出多个时间段或多个事项（如「九点打卡，下午写论文，晚上健身」）或说「每日计划/每天的计划」时使用。',
    parameters: {
      type: 'object',
      required: ['items'],
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startTime: { type: 'string' }, endTime: { type: 'string' },
              title: { type: 'string' }, type: { type: 'string', enum: ['work', 'study', 'meeting', 'life', 'rest'] }
            }
          }
        }
      }
    },
    write: true,
    executor: 'addDailyPlanMulti'
  },
  {
    name: 'addTimeLog',
    description: '记录时间块。当用户说「记录/统计 X小时/X分钟 学习/工作/生活等」时使用。',
    parameters: {
      type: 'object',
      required: ['category', 'minutes'],
      properties: {
        date: { type: 'string', description: '日期 YYYY-MM-DD' },
        category: { type: 'string', enum: ['focus', 'work', 'study', 'life', 'rest', 'sport', 'reading', 'writing'] },
        minutes: { type: 'number', description: '分钟数（小时换算）' }
      }
    },
    write: true,
    executor: 'addTimeLog'
  },
  {
    name: 'addFitnessLog',
    description: '健身打卡。当用户说「打卡/记录 跑步/力量/瑜伽等 X分钟」时使用。',
    parameters: {
      type: 'object',
      required: ['type', 'durationMin'],
      properties: {
        date: { type: 'string' },
        type: { type: 'string', enum: ['running', 'strength', 'yoga', 'ball', 'other'] },
        durationMin: { type: 'number' }
      }
    },
    write: true,
    executor: 'addFitnessLog'
  },
  {
    name: 'addFitnessPlan',
    description: '新建健身计划并保存。仅当用户明确要「新建/创建/保存 健身计划」时使用；若只是「规划/制定 运动方案」（生成建议不保存）则用 chat 直接给出方案文本。',
    parameters: {
      type: 'object',
      required: ['name', 'type'],
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['running', 'strength', 'yoga', 'ball', 'other'] },
        weeklyGoal: { type: 'number', description: '每周目标次数（每天=7）' },
        durationGoal: { type: 'number', description: '单次分钟数' },
        note: { type: 'string' }
      }
    },
    write: true,
    executor: 'addFitnessPlan'
  },
  {
    name: 'updateDailyPlan',
    description: '修改或删除【每日计划】项。当用户说「把X改到Y点」「删除X」「改一下计划」时使用；matchTitle 用于定位事项。注意：仅处理每日计划（时间段事项）；修改/删除【任务/待办】请用 updateTask/deleteTask，查询任务清单用 queryTask。',
    parameters: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        matchTitle: { type: 'string', description: '要定位的事项标题关键词' },
        startTime: { type: 'string' }, endTime: { type: 'string' }, title: { type: 'string' },
        delete: { type: 'boolean', description: 'true=删除该事项' }
      }
    },
    write: true,
    executor: 'updateDailyPlan'
  },
  {
    name: 'updateTimeLog',
    description: '修改或删除时间记录。当用户说「把学习记录改成X分钟」「删除X记录」时使用。',
    parameters: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string' },
        matchCategory: { type: 'string', enum: ['focus', 'work', 'study', 'life', 'rest', 'sport', 'reading', 'writing'] },
        minutes: { type: 'number' },
        delete: { type: 'boolean' }
      }
    },
    write: true,
    executor: 'updateTimeLog'
  },
  {
    name: 'queryStats',
    description: '查询任务统计与进度。当用户问「总结我的进度/任务情况/还剩多少任务」时使用。',
    parameters: { type: 'object', properties: {} },
    write: false,
    executor: 'queryStats'
  },
  {
    name: 'queryDailyPlan',
    description: '查询某天的日程计划。当用户问「看看今天/明天的计划」时使用。',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD，缺省今天' } }
    },
    write: false,
    executor: 'queryDailyPlan'
  },
  {
    name: 'queryTimeLog',
    description: '查询某天的时间分布。当用户问「今天时间都花哪了/时间统计」时使用。',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string' } }
    },
    write: false,
    executor: 'queryTimeLog'
  },
  {
    name: 'queryFitness',
    description: '查询健身进度、计划完成率与【细致条目清单】（每条显示 ✓完成/○待做/⏭跳过 状态、时长与备注）。当用户问「健身进度/本周打卡/我的健身情况/我的计划有哪些动作」时使用；修改某条动作前建议先调用本工具拿到条目名称，再配合 updateFitnessItem（改状态/备注）或 addFitnessItem（新增动作）。',
    parameters: { type: 'object', properties: {} },
    write: false,
    executor: 'queryFitness'
  },
  {
    name: 'suggestInsights',
    description: '生成工作台洞察与建议（逾期任务/计划完成率/时间分布/健身断档）。当用户问「帮我看看时间安排/给点建议/效率分析」时使用。',
    parameters: { type: 'object', properties: {} },
    write: false,
    executor: 'suggestInsights'
  },
  {
    name: 'queryGitHubTrending',
    description: '查询 GitHub 官方热榜（github.com/trending，语言维度）。当用户说「本周 Python 热门项目/最近热门仓库/看看 trending/本周热榜」时使用。注意：仅支持语言维度（Python/JavaScript/Go 等，支持中文名）；领域词（如 deep learning）无法映射时不传 language 直接返回全领域热榜，并在回答中说明。',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', description: '编程语言（支持中文，如 Python / javascript / Go / 蟒蛇），可省略=全领域' },
        since: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: '时间窗口，默认 weekly' }
      }
    },
    write: false,
    executor: 'queryGitHubTrending'
  },
  {
    name: 'queryLiterature',
    description: '搜索本地文献库。当用户说「找几篇 XX 领域的文献/有没有关于 XX 的论文/推荐相关文献」时使用。按标题/作者/期刊/标签/摘要关键词模糊匹配。',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: '搜索关键词（必填），如「SLAM 综述」「注意力机制」' },
        limit: { type: 'integer', maximum: 20, minimum: 1, description: '返回条数上限 1-20，默认 8' },
        category: { type: 'string', description: '限定分类名称（可选，如「深度学习」）' }
      }
    },
    write: false,
    executor: 'queryLiterature'
  },
  {
    name: 'readLiterature',
    description: '阅读一篇文献的详情（摘要与正文片段）。当用户说「这篇文献讲了什么/帮我总结这篇/XXX（文献标题）内容」时使用。可用 id 或标题定位。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文献记录 id（queryLiterature 返回）' },
        title: { type: 'string', description: '文献标题（模糊匹配）' }
      }
    },
    write: false,
    executor: 'readLiterature'
  },
  {
    name: 'buildLiteratureRelations',
    description: '用 AI 分析文献库中文献之间的关联（引用/方法传承/观点对比/主题相近），生成关系并写入。当用户说「生成文献关系图/分析这些文献的关联」时使用。注意：属于写入操作，会弹确认卡；scope=all 时分析全部文献（可能较慢）。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all', 'category'], description: '分析范围：all=全部文献，category=当前分类' },
        categoryId: { type: 'string', description: 'scope=category 时的分类 id' }
      }
    },
    write: true,
    executor: 'buildLiteratureRelations'
  },
  {
    name: 'generateReport',
    description: '生成日报或周报（汇总完成任务/每日计划/健身打卡/灵感的 Markdown 报告）并保存到历史。当用户说「帮我生成今天的日报/总结今天的工作/生成周报/写日报」时使用。注意：写入操作，会弹确认卡；type=daily 日报/weekly 周报；date 默认今天；polish 用 AI 润色；数据源为任务、每日计划、健身打卡、灵感，不含文献。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['daily', 'weekly'], description: '日报 daily / 周报 weekly，默认 daily' },
        date: { type: 'string', description: '日期 YYYY-MM-DD（相对日期换算），默认今天' },
        polish: { type: 'boolean', description: '是否用 AI 润色，默认 false' }
      }
    },
    write: true,
    executor: 'generateReport'
  },
  {
    name: 'updateFitnessItem',
    description: '更新健身计划中某条细致条目的状态（完成/待做/跳过）或备注（如「今日感冒了」）。当用户说「把今天的力量训练标记为完成/今天的跑步跳过，感冒了」时使用。注意：写入操作，会弹确认卡；matchName 按动作名模糊定位；不确定条目名时先调用 queryFitness 查看条目清单。',
    parameters: {
      type: 'object',
      required: ['status'],
      properties: {
        planId: { type: 'string', description: '健身计划 id' },
        matchName: { type: 'string', description: '条目名称模糊匹配（如「跑步」「举哑铃」）' },
        itemId: { type: 'string', description: '条目精确 id（queryFitness 返回）' },
        status: { type: 'string', enum: ['todo', 'done', 'skipped'], description: '目标状态：待做/完成/跳过' },
        customNote: { type: 'string', description: '自定义备注（如「今日感冒了」），与状态一起保存' }
      }
    },
    write: true,
    executor: 'updateFitnessItem'
  },
  {
    name: 'addFitnessItem',
    description: '向健身计划添加一条细致条目（如跑步、举哑铃等具体动作）。当用户说「给增肌计划加一个动作/加一条 深蹲 20分钟」时使用。注意：写入操作，会弹确认卡；planId 可省略，用 planName 按计划名匹配。',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        planId: { type: 'string', description: '健身计划 id（可用 queryFitness 获取）' },
        planName: { type: 'string', description: '计划名匹配（如「增肌计划」），planId 未提供时用' },
        name: { type: 'string', description: '条目动作名（必填），如「跑步」「举哑铃」「深蹲」' },
        durationMin: { type: 'integer', minimum: 1, maximum: 600, description: '预计时长（分钟），可省略' }
      }
    },
    write: true,
    executor: 'addFitnessItem'
  },
  {
    name: 'addInspiration',
    description: '记录一条灵感（灵光一现/选题方向/视觉画面/研究设想）。当用户说「记一条灵感/想到一个点子/记下来」时使用。注意：写入操作，会弹确认卡。',
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: '灵感标题（必填），如「Transformer 改进方向」' },
        content: { type: 'string', description: '灵感详细内容' },
        tags: { type: 'string', description: '标签（逗号分隔）' },
        mood: { type: 'string', enum: ['spark', 'topic', 'visual', 'research'], description: '类型：灵光一现/选题方向/视觉画面/研究设想，默认 spark' }
      }
    },
    write: true,
    executor: 'addInspiration'
  },
  {
    name: 'queryInspirations',
    description: '查询灵感记录（支持关键词过滤）。当用户说「我的灵感/最近记了什么点子/查一下灵感」时使用。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '返回条数上限，默认 8' },
        keyword: { type: 'string', description: '关键词（匹配标题/内容），可省略' }
      }
    },
    write: false,
    executor: 'queryInspirations'
  },
  {
    name: 'queryProjects',
    description: '查询项目列表与项目下任务进度。当用户问「我的项目有哪些/某项目进展如何/项目下的任务」时使用。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '项目名关键词过滤，可省略=全部' }
      }
    },
    write: false,
    executor: 'queryProjects'
  },
  {
    name: 'subscribeGitHub',
    description: '订阅一个 GitHub 领域关键词或仓库（写入 githubSubs）。当用户说「订阅 XX 关键词/关注某个仓库/帮我盯一下 XX 的更新」时使用。注意：写入操作，会弹确认卡；keyword 与 repo 二选一（repo 支持 owner/repo 或完整链接）；重复订阅会提示已存在。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '订阅的领域关键词（如 deep learning / robotics / slam）' },
        repo: { type: 'string', description: '订阅的仓库（owner/repo 或 GitHub 链接，如 langchain-ai/langchain）' }
      }
    },
    write: true,
    executor: 'subscribeGitHub'
  },
  {
    name: 'unsubscribeGitHub',
    description: '取消一个 GitHub 订阅（关键词或仓库）。当用户说「取消订阅 XX/别再关注 XX」时使用。注意：写入操作，会弹确认卡；keyword/repo 二选一，按名称精确匹配（大小写不敏感）。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '要取消的领域关键词' },
        repo: { type: 'string', description: '要取消的仓库（owner/repo）' }
      }
    },
    write: true,
    executor: 'unsubscribeGitHub'
  },
  {
    name: 'queryGitHubSubs',
    description: '查询当前 GitHub 订阅列表（关键词/仓库）。当用户问「我订阅了哪些 GitHub 关键词/关注的仓库/订阅列表」时使用。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['keyword', 'repo'], description: '订阅类型过滤：keyword=关键词 / repo=仓库，可省略=全部' }
      }
    },
    write: false,
    executor: 'queryGitHubSubs'
  }
];

/** 参数校验：必填 + 类型收敛 + enum 校验（就地修正可收敛类型） */
function validateParams(parameters, params) {
  const p = { ...(params || {}) };
  const errors = [];
  const required = Array.isArray(parameters.required) ? parameters.required : [];
  for (const key of required) {
    if (p[key] === undefined || p[key] === null || p[key] === '') errors.push(`缺少必填参数 ${key}`);
  }
  const props = parameters.properties || {};
  for (const [key, schema] of Object.entries(props)) {
    if (p[key] === undefined) continue;
    const type = schema.type;
    if (type === 'string') p[key] = String(p[key]);
    else if (type === 'number') { const n = Number(p[key]); if (!Number.isNaN(n)) p[key] = n; }
    else if (type === 'integer') { const n = Number(p[key]); if (Number.isInteger(n)) p[key] = n; }
    else if (type === 'boolean') p[key] = !!p[key];
    else if (type === 'array' && !Array.isArray(p[key])) { errors.push(`${key} 应为数组`); continue; }
    if (Array.isArray(schema.enum) && !schema.enum.includes(p[key])) errors.push(`${key} 值非法（可选：${schema.enum.join('/')}）`);
    if ((type === 'number' || type === 'integer') && typeof p[key] === 'number') {
      if (schema.maximum !== undefined && p[key] > schema.maximum) errors.push(`${key} 不能大于 ${schema.maximum}`);
      if (schema.minimum !== undefined && p[key] < schema.minimum) errors.push(`${key} 不能小于 ${schema.minimum}`);
    }
  }
  return { ok: errors.length === 0, errors, params: p };
}

const ToolRegistry = {
  /** OpenAI 兼容 tools 数组（直接传给 /chat/completions 的 tools 字段） */
  list() {
    return TOOLS.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
  },

  get(name) {
    return TOOLS.find((t) => t.name === name) || null;
  },

  isWrite(name) {
    const t = this.get(name);
    return !!t && t.write;
  },

  validate(name, params) {
    const t = this.get(name);
    if (!t) return { ok: false, errors: [`未知工具 ${name}`], params };
    return validateParams(t.parameters, params);
  },

  /** 确定性执行（读工具直接执行；写工具由 AgentLoop 确认后调用） */
  async execute(name, params) {
    const t = this.get(name);
    if (!t || !window.AssistantActions || typeof AssistantActions.executeStructured !== 'function') {
      return `无法执行「${name}」（工具未就绪）`;
    }
    return await AssistantActions.executeStructured(name, params || {});
  }
};

if (typeof window !== 'undefined') window.ToolRegistry = ToolRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = { ToolRegistry, TOOLS, validateParams };
