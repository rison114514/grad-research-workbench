'use strict';

/* ============ 文献中心（分类树 + 多分类 + 关联图谱） ============ */

const Literature = {
  current: [],        // literature 记录
  collections: [],    // litCollections
  relations: [],      // litRelations
  activeId: null,
  editing: false,
  activeCollection: null,   // null=全部 / '__uncat__'=未分类 / 具体分类 id
  collapsed: {},            // 分类树折叠 {id: true}
  graphMode: false,
  graphData: null,
  graphFocusId: null,   // 图谱中心文献（默认=当前选中文献）
  graphFullMode: false, // 显式全图模式（不受中心回退影响）
  selectedIds: new Set(),   // 批量勾选的文献 id

  async render() {
    this.current = await window.api.store.list('literature');
    this.collections = await window.api.store.list('litCollections');
    this.relations = await window.api.store.list('litRelations');
    // 清理已删除文献的勾选
    const ids = new Set(this.current.map((l) => l.id));
    for (const id of this.selectedIds) if (!ids.has(id)) this.selectedIds.delete(id);
    if (this.graphMode) {
      this.renderGraph();
      this.renderGraphSide();
      return;
    }
    if (!this.current.some((item) => item.id === this.activeId)) {
      this.activeId = this.current.length ? this.current[0].id : null;
    }
    this.renderCollections();
    this.renderList();
    this.renderDetail();
  },

  /* ================= 分类树 ================= */

  colCount(colId) {
    return this.current.filter((l) => (l.collectionIds || []).includes(colId)).length;
  },

  renderCollections() {
    const box = document.getElementById('litColTree');
    if (!box) return;
    const total = this.current.length;
    const uncat = this.current.filter((l) => !(l.collectionIds || []).length).length;
    const node = (id, label, count, depth, extra = '', badge = '') => `
      <div class="col-node ${this.activeCollection === id ? 'active' : ''}" data-cid="${id}" style="padding-left:${10 + depth * 13}px">
        <span class="col-caret"></span><span>${label}</span>${badge}<span class="col-count">${count}</span>${extra}
      </div>`;
    const treeHtml = (parentId, source, depth) => {
      const children = this.collections
        .filter((c) => c.parentId === parentId && c.source === source)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      return children.map((c) => {
        const hasChildren = this.collections.some((x) => x.parentId === c.id);
        const caret = hasChildren ? `<span class="col-caret" data-caret="${c.id}">${this.collapsed[c.id] ? '▸' : '▾'}</span>` : `<span class="col-caret"></span>`;
        const badge = c.readOnly ? '<span class="col-badge-readonly">ZOTERO</span>' : '';
        const ops = c.readOnly ? '' : `<span class="col-edit" data-edit="${c.id}">✎</span><span class="col-del" data-del="${c.id}">✕</span>`;
        const childrenHtml = (!this.collapsed[c.id] && hasChildren) ? treeHtml(c.id, source, depth + 1) : '';
        return `
          <div class="col-node ${this.activeCollection === c.id ? 'active' : ''}" data-cid="${c.id}" style="padding-left:${10 + depth * 13}px">
            ${caret}<span>${App.esc(c.name)}</span>${badge}<span class="col-count">${this.colCount(c.id)}</span>${ops}
          </div>${childrenHtml}`;
      }).join('');
    };
    const userCols = this.collections.some((c) => c.source === 'user');
    const zoteroCols = this.collections.some((c) => c.source === 'zotero');
    box.innerHTML = `
      <div class="col-root-group">ALL</div>
      ${node(null, '全部文献', total, 0)}
      ${node('__uncat__', '未分类', uncat, 0)}
      <div class="col-root-group">我的分类</div>
      ${userCols ? treeHtml(null, 'user', 0) : '<div class="col-node" style="color:#a3a6a8;cursor:default">（点击上方 ＋ 新建分类）</div>'}
      ${zoteroCols ? `<div class="col-root-group">ZOTERO 同步</div>${treeHtml(null, 'zotero', 0)}` : ''}`;
  },

  /* 当前分类过滤 */
  filteredItems() {
    let items = this.current;
    if (this.activeCollection === '__uncat__') {
      items = items.filter((l) => !(l.collectionIds || []).length);
    } else if (this.activeCollection) {
      items = items.filter((l) => (l.collectionIds || []).includes(this.activeCollection));
    }
    return items;
  },

  renderList() {
    const kw = (document.getElementById('litSearch').value || '').toLowerCase().trim();
    const items = this.filteredItems().filter((l) => {
      if (!kw) return true;
      const hay = `${l.title} ${l.authors} ${l.venue} ${l.tags || ''}`.toLowerCase();
      return hay.includes(kw);
    }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const box = document.getElementById('litList');
    if (items.length === 0) {
      box.innerHTML = `<div class="empty-tip">${this.activeCollection ? '该分类下暂无文献' : '暂无文献，点击右上角添加'}</div>`;
      this.updateBulkBar();
      return;
    }
    box.innerHTML = items.map((l) => `
      <div class="lit-item ${l.id === this.activeId ? 'active' : ''}" data-id="${l.id}">
        <label class="check lit-check" title="勾选用于批量操作"><input type="checkbox" data-sel="${l.id}" ${this.selectedIds.has(l.id) ? 'checked' : ''}></label>
        <div class="lit-item-body">
          <div class="l-title">${App.esc(l.title)}</div>
          <div class="l-meta">${App.esc(l.authors || '未知作者')}${l.venue ? ` · ${App.esc(l.venue)}` : ''}${l.year ? ` · ${l.year}` : ''}</div>
          ${this.tagList(l.tags).length ? `<div class="lit-tags">${this.tagList(l.tags).map((t) => `<span class="tag">${App.esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`).join('');
    this.updateBulkBar();
  },

  /* ================= 批量管理（全选 / 批量删除 / 移至分类） ================= */

  currentVisible() {
    const kw = (document.getElementById('litSearch').value || '').toLowerCase().trim();
    return this.filteredItems().filter((l) => {
      if (!kw) return true;
      return `${l.title} ${l.authors} ${l.venue} ${l.tags || ''}`.toLowerCase().includes(kw);
    });
  },

  updateBulkBar() {
    const count = document.getElementById('litSelCount');
    if (count) count.textContent = `已选 ${this.selectedIds.size}`;
    const del = document.getElementById('litBatchDelete');
    const assign = document.getElementById('litBatchAssign');
    const disabled = this.selectedIds.size === 0;
    if (del) del.disabled = disabled;
    if (assign) assign.disabled = disabled;
    const all = document.getElementById('litSelectAll');
    if (all) {
      const visible = this.currentVisible();
      all.checked = visible.length > 0 && visible.every((l) => this.selectedIds.has(l.id));
    }
  },

  toggleSelect(id) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.renderList();
  },

  selectAll(checked) {
    const visible = this.currentVisible();
    if (checked) visible.forEach((l) => this.selectedIds.add(l.id));
    else visible.forEach((l) => this.selectedIds.delete(l.id));
    this.renderList();
  },

  async batchDelete() {
    if (!this.selectedIds.size) return;
    if (!confirm(`确定删除选中的 ${this.selectedIds.size} 篇文献？（会同时清理相关文献关系）`)) return;
    const delIds = [...this.selectedIds];
    for (const id of delIds) await window.api.store.remove('literature', id);
    // 清理指向已删文献的关系
    for (const r of this.relations) {
      if (delIds.includes(r.sourceId) || delIds.includes(r.targetId)) {
        await window.api.store.remove('litRelations', r.id);
      }
    }
    if (delIds.includes(this.activeId)) this.activeId = null;
    this.selectedIds.clear();
    await this.render();
    App.toast(`已批量删除 ${delIds.length} 篇文献`, 'ok');
  },

  async openAssignBulk() {
    if (!this.selectedIds.size) return;
    Modal.open('litAssignModal');
    const box = document.getElementById('litAssignTree');
    const treeHtml = (parentId, depth) => {
      const children = this.collections
        .filter((c) => c.parentId === parentId && c.source === 'user')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      return children.map((c) => `<div class="col-node" style="padding-left:${8 + depth * 16}px"><label style="display:flex;align-items:center;gap:6px;width:100%">
        <input type="checkbox" value="${c.id}">${App.esc(c.name)}</label></div>${treeHtml(c.id, depth + 1)}`).join('');
    };
    box.innerHTML = this.collections.some((c) => c.source === 'user')
      ? treeHtml(null, 0)
      : '<div class="empty-tip">暂无用户分类，请先在上方创建</div>';
    box.dataset.litId = '';
    box.dataset.batch = '1';
    document.getElementById('litAssignModal').querySelector('h3').textContent = `批量设置分类（${this.selectedIds.size} 篇）`;
  },

  /* ================= 分类 CRUD ================= */

  async addCollection(name, parentId) {
    const n = String(name || '').trim();
    if (!n) { App.toast('请填写分类名称', 'error'); return null; }
    if (this.collections.some((c) => c.source === 'user' && c.parentId === (parentId || null) && c.name === n)) {
      App.toast('同级已存在同名分类');
      return null;
    }
    const col = await window.api.store.create('litCollections', {
      name: n, parentId: parentId || null, order: this.collections.filter((c) => c.parentId === (parentId || null)).length,
      source: 'user', zoteroKey: null, readOnly: false
    });
    await this.render();
    App.toast(`已创建分类：${n}`, 'ok');
    return col;
  },

  async renameCollection(id, name) {
    const n = String(name || '').trim();
    if (!n) return;
    await window.api.store.update('litCollections', id, { name: n });
    await this.render();
    App.toast('分类已重命名', 'ok');
  },

  async deleteCollection(id) {
    const col = this.collections.find((c) => c.id === id);
    if (!col) return;
    if (!confirm(`确定删除分类「${col.name}」？子分类将上移，文献将不再归属该分类。`)) return;
    const children = this.collections.filter((c) => c.parentId === id);
    const grandParent = col.parentId;
    // 子分类上移
    for (const child of children) {
      await window.api.store.update('litCollections', child.id, { parentId: grandParent });
    }
    // 文献移除该分类关联
    const inCols = this.current.filter((l) => (l.collectionIds || []).includes(id));
    for (const l of inCols) {
      await window.api.store.update('literature', l.id, { collectionIds: (l.collectionIds || []).filter((x) => x !== id) });
    }
    // 删除相关关系
    const rels = this.relations.filter((r) => r.sourceId === id || r.targetId === id);
    for (const r of rels) await window.api.store.remove('litRelations', r.id);
    await window.api.store.remove('litCollections', id);
    if (this.activeCollection === id) this.activeCollection = null;
    await this.render();
    App.toast('分类已删除', 'ok');
  },

  /* 打开分类 Modal（新建 col=null / 重命名 col=对象） */
  openColModal(col) {
    const modal = document.getElementById('litColModal');
    const nameInput = document.getElementById('litColName');
    const parentSelect = document.getElementById('litColParent');
    const title = document.getElementById('litColTitle');
    nameInput.value = col ? col.name : '';
    parentSelect.innerHTML = '<option value="">（顶层）</option>' + this.collections
      .filter((c) => c.source === 'user' && (!col || c.id !== col.id))
      .map((c) => `<option value="${c.id}" ${col && col.parentId === c.id ? 'selected' : ''}>${App.esc(c.name)}</option>`).join('');
    title.textContent = col ? '重命名分类' : '新建分类';
    modal.dataset.editId = col ? col.id : '';
    Modal.open('litColModal');
    nameInput.focus();
  },

  /* 文献分类关联（多选） */
  async openAssign(l) {
    if (l.source === 'zotero') { App.toast('Zotero 同步文献的分类由同步管理', 'info'); return; }
    Modal.open('litAssignModal');
    const box = document.getElementById('litAssignTree');
    const checked = new Set(l.collectionIds || []);
    const treeHtml = (parentId, depth) => {
      const children = this.collections
        .filter((c) => c.parentId === parentId && c.source === 'user')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      return children.map((c) => {
        const childHtml = treeHtml(c.id, depth + 1);
        return `<div class="col-node" style="padding-left:${8 + depth * 16}px"><label style="display:flex;align-items:center;gap:6px;width:100%">
          <input type="checkbox" value="${c.id}" ${checked.has(c.id) ? 'checked' : ''}>${App.esc(c.name)}</label></div>${childHtml}`;
      }).join('');
    };
    box.innerHTML = this.collections.some((c) => c.source === 'user')
      ? treeHtml(null, 0)
      : '<div class="empty-tip">暂无用户分类，请先在上方创建</div>';
    box.dataset.litId = l.id;
  },

  async saveAssign() {
    const box = document.getElementById('litAssignTree');
    const litId = box.dataset.litId;
    const ids = [...box.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
    if (box.dataset.batch === '1') {
      // 批量模式：为所有勾选文献设置分类（覆盖）
      const targets = [...this.selectedIds];
      for (const id of targets) {
        await window.api.store.update('literature', id, { collectionIds: ids });
      }
      this.selectedIds.clear();
      Modal.close('litAssignModal');
      box.dataset.batch = '';
      await this.render();
      App.toast(`已为 ${targets.length} 篇文献设置分类`, 'ok');
      return;
    }
    if (!litId) return;
    await window.api.store.update('literature', litId, { collectionIds: ids });
    Modal.close('litAssignModal');
    await this.render();
    App.toast('分类已更新', 'ok');
  },

  /* ================= 关联图谱（P4） ================= */

  async generateRelations(scope) {
    const settings = await window.api.store.getSettings();
    if (!(settings.aiBaseUrl && settings.aiApiKey && settings.aiModel)) {
      App.toast('请在设置页配置 AI 后使用关系生成', 'error');
      return;
    }
    // 收集范围内文献
    let items = [];
    if (scope === 'category' && this.activeCollection && this.activeCollection !== '__uncat__') {
      items = this.current.filter((l) => (l.collectionIds || []).includes(this.activeCollection));
    } else if (scope === 'selected' && this.selectedIds.size) {
      items = this.current.filter((l) => this.selectedIds.has(l.id));
    } else {
      items = this.current;
    }
    items = items.slice(0, 40);
    if (items.length < 2) { App.toast('至少需要 2 篇文献才能生成关系', 'error'); return; }

    const btn = document.getElementById('litGenerateRelations');
    btn.disabled = true;
    App.toast(`正在分析 ${items.length} 篇文献的关联…`);
    try {
      const doc = items.map((l, i) => `[${i}] ${l.title}｜${l.authors || ''}｜${String(l.abstract || l.summary || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
      const prompt = `你是文献分析助手。分析下面 ${items.length} 篇文献（[编号] 标题｜作者｜摘要），找出之间存在真实关联的配对。
只输出 JSON 数组（不要任何其他内容），格式：
[{"a":0,"b":1,"type":"correlated|extends|contrasts|cites|topic-similar","strength":0.7,"reason":"30字内关联理由"}]
规则：只输出确有依据的关联（同一主题/方法传承/观点对立/引用扩展），无依据不要硬凑；每篇最多 3 条边；strength 0-1。
文献列表：
${doc}`;
      const r = await window.api.ai.chat([{ role: 'user', content: prompt }], { maxTokens: 2000 });
      if (!r.ok) throw new Error(r.error || 'AI 请求失败');
      const rels = this.parseRelationJson(r.content);
      if (!rels.length) { App.toast('AI 未识别出有效关联，可换范围重试', 'info'); return; }
      // 落库（三元组去重：sourceId+targetId+type，忽略方向按 a<b 归一）
      const idMap = new Map(items.map((l, i) => [i, l.id]));
      let created = 0, updated = 0;
      for (const rel of rels) {
        const a = Number(rel.a), b = Number(rel.b);
        if (!idMap.has(a) || !idMap.has(b) || a === b) continue;
        const [s, t] = a < b ? [a, b] : [b, a];
        const sourceId = idMap.get(s), targetId = idMap.get(t);
        const type = ['cites', 'correlated', 'extends', 'contrasts', 'topic-similar'].includes(rel.type) ? rel.type : 'correlated';
        const strength = Math.min(Math.max(Number(rel.strength) || 0.5, 0), 1);
        const reason = String(rel.reason || '').slice(0, 120);
        const exist = this.relations.find((x) => x.sourceId === sourceId && x.targetId === targetId && x.relationType === type);
        if (exist) {
          await window.api.store.update('litRelations', exist.id, { strength, reason });
          updated++;
        } else {
          await window.api.store.create('litRelations', { sourceId, targetId, relationType: type, strength, reason, source: 'ai' });
          created++;
        }
      }
      this.relations = await window.api.store.list('litRelations');
      this.renderGraph();
      this.renderGraphSide();
      App.toast(`关系已更新：新增 ${created} 条，刷新 ${updated} 条`, 'ok');
    } catch (e) {
      App.toast(e.message || '关系生成失败', 'error');
    }
    btn.disabled = false;
  },

  parseRelationJson(content) {
    const s = String(content || '').trim();
    const fenced = s.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    const candidate = fenced ? fenced[1] : (s.match(/\[[\s\S]*\]/) || [s])[0];
    try {
      const arr = JSON.parse(candidate);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },

  /** 图谱范围：全部 / 当前分类 / 勾选文献（与生成关系 scope 一致） */
  graphScopeItems() {
    const scope = document.getElementById('litGraphScope').value || 'all';
    if (scope === 'category') {
      if (this.activeCollection === '__uncat__') return this.current.filter((l) => !(l.collectionIds || []).length);
      if (this.activeCollection) return this.current.filter((l) => (l.collectionIds || []).includes(this.activeCollection));
      return this.current;
    }
    if (scope === 'selected' && this.selectedIds.size) {
      return this.current.filter((l) => this.selectedIds.has(l.id));
    }
    return this.current;
  },

  renderGraph() {
    const box = document.getElementById('litGraphCanvas');
    if (!box) return;
    if (this.litGraph) { this.litGraph.dispose(); this.litGraph = null; }
    // 图谱范围过滤：与「AI 生成关系」scope 联动（全部 / 当前分类 / 勾选文献）
    const scopeItems = this.graphScopeItems();
    const byId = new Map(scopeItems.map((l) => [l.id, l]));
    const rels = this.relations.filter((r) => byId.has(r.sourceId) && byId.has(r.targetId));
    if (!rels.length) {
      box.innerHTML = `<div class="empty-tip">暂无关联数据，点击「AI 生成关系」分析文献关联</div>`;
      this.graphData = null;
      this.renderGraphFocusBar();
      return;
    }
    // 中心聚焦（graphFullMode=false）：默认以当前选中文献为中心，扩展 2 跳子图；
    // 全图模式（graphFullMode=true）：展示全部关系
    let focusId = null;
    let scopeRels = rels;
    if (!this.graphFullMode) {
      focusId = this.graphFocusId && byId.has(this.graphFocusId)
        ? this.graphFocusId
        : (this.activeId && byId.has(this.activeId) ? this.activeId : null);
    }
    if (focusId) {
      // 1 跳邻居
      const nbr = new Set([focusId]);
      rels.forEach((r) => {
        if (r.sourceId === focusId || r.targetId === focusId) { nbr.add(r.sourceId); nbr.add(r.targetId); }
      });
      // 2 跳：与 1 跳节点相连的节点（仅限当前范围内）
      const oneHop = [...nbr];
      rels.forEach((r) => {
        if (oneHop.includes(r.sourceId) && !nbr.has(r.targetId) && byId.has(r.targetId)) nbr.add(r.targetId);
        if (oneHop.includes(r.targetId) && !nbr.has(r.sourceId) && byId.has(r.sourceId)) nbr.add(r.sourceId);
      });
      scopeRels = rels.filter((r) => nbr.has(r.sourceId) && nbr.has(r.targetId));
      this.graphFocusId = focusId;
    } else {
      this.graphFocusId = null;
    }
    if (!scopeRels.length) {
      box.innerHTML = `<div class="empty-tip">${focusId ? '当前文献暂无关联，可点击「AI 生成关系」分析文献关联' : '暂无关联数据，点击「AI 生成关系」分析文献关联'}</div>`;
      this.graphData = null;
      this.renderGraphFocusBar();
      return;
    }
    // 节点：中心文献大节点 + 邻居按关系度定大小
    const degree = new Map();
    scopeRels.forEach((r) => {
      degree.set(r.sourceId, (degree.get(r.sourceId) || 0) + 1);
      degree.set(r.targetId, (degree.get(r.targetId) || 0) + 1);
    });
    const nodes = [...degree.entries()].slice(0, 80).map(([id, d]) => {
      const lit = byId.get(id);
      const isFocus = focusId === id;
      return { id, name: (lit.title || '').slice(0, 16), symbolSize: isFocus ? 28 : 12 + Math.min(d, 6) * 2, degree: d, isFocus };
    });
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    // 边：无向去重合并（同对文献多条关系 → 一条边，类型聚合；重复关系只保留一次）
    const edgeMap = new Map();
    scopeRels.filter((r) => nodeIdSet.has(r.sourceId) && nodeIdSet.has(r.targetId)).forEach((r) => {
      const key = r.sourceId < r.targetId ? `${r.sourceId}|${r.targetId}` : `${r.targetId}|${r.sourceId}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      const list = edgeMap.get(key);
      if (!list.some((x) => x.relationType === r.relationType)) list.push(r); // 同类型关系去重
    });
    const links = [...edgeMap.entries()].map(([key, list]) => {
      const [s, t] = key.split('|');
      return {
        source: s, target: t,
        types: list.map((r) => r.relationType),
        strength: Math.max(...list.map((r) => r.strength || 0)),
        reasons: list.map((r) => r.reason || '').filter(Boolean).slice(0, 2)
      };
    });
    this.graphData = { byId, links, degrees: degree };
    const edgeColor = { cites: '#111111', extends: '#2d6ba3', contrasts: '#a32d2d', correlated: '#6b7073', 'topic-similar': '#b89b00' };
    const typeLabel = { cites: '引用', extends: '扩展', contrasts: '对比', correlated: '相关', 'topic-similar': '主题相近' };
    this.litGraph = echarts.init(box);
    this.litGraph.setOption({
      tooltip: {
        formatter: (p) => {
          if (p.dataType === 'node') {
            const lit = byId.get(p.data.id);
            const d = this.graphData.degrees.get(p.data.id) || 0;
            const tag = p.data.id === focusId ? ' <b style="color:#a32d2d">[中心]</b>' : '';
            return `<b>${App.esc(lit.title)}</b>${tag}<br/>${App.esc(lit.authors || '')} · ${lit.year || ''}<br/>关联 ${d} 篇`;
          }
          const l = p.data;
          const types = (l.types || []).map((t) => typeLabel[t] || t).join(' / ');
          return `<b>${App.esc(types)}</b> · 强度 ${l.strength}<br/>${(l.reasons || []).map((r) => App.esc(r)).join('<br/>')}`;
        }
      },
      animationDurationUpdate: 600,
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,          // 支持滚轮缩放 + 拖动平移
        draggable: true,     // 节点可拖
        data: nodes.map((n) => ({
          id: n.id, name: n.name, symbolSize: n.symbolSize, value: n.degree,
          itemStyle: n.isFocus
            ? { color: '#FFF44F', borderColor: '#111', borderWidth: 3, shadowBlur: 14, shadowColor: 'rgba(255,244,79,.8)' }
            : { color: '#e8e8e3', borderColor: '#8a8f85', borderWidth: 1.5 }
        })),
        links: links.map((l) => ({
          source: l.source, target: l.target,
          types: l.types, strength: l.strength, reasons: l.reasons,
          lineStyle: { color: edgeColor[l.types[0]] || '#6b7073', width: l.source === focusId || l.target === focusId ? 2.2 : 1.4, curveness: l.types.length > 1 ? 0.12 : 0.05 }
        })),
        force: { repulsion: 130, edgeLength: [50, 150], gravity: 0.1 },
        label: { show: true, fontSize: 10, color: '#33373a', position: 'bottom' },
        emphasis: { focus: 'adjacency', label: { show: true, fontSize: 12 }, lineStyle: { width: 2.6 } },
        lineStyle: { color: '#b9bcb8', width: 1.2, curveness: 0.05 }
      }]
    });
    // 点击节点：切换为该节点为中心重新渲染
    this.litGraph.on('click', (params) => {
      if (params.dataType !== 'node') return;
      if (params.data.id !== this.graphFocusId || this.graphFullMode) {
        this.graphFullMode = false;           // 点击节点 → 中心模式
        this.graphFocusId = params.data.id;
        this.renderGraph();
      }
      this.renderGraphNodeSide(params.data.id);
    });
    this.renderGraphFocusBar();
    this.renderGraphSide();
  },

  /** 图谱中心提示条 */
  renderGraphFocusBar() {
    const bar = document.getElementById('litGraphFocus');
    if (!bar) return;
    if (this.graphFullMode || !this.graphData || !this.graphFocusId) {
      bar.innerHTML = `<span>全图模式（${this.graphData ? this.graphData.links.length : 0} 条关系）· 点击任意节点将以它为中心展开</span>`;
      return;
    }
    const lit = this.graphData.byId.get(this.graphFocusId);
    bar.innerHTML = `<span>中心：<b>${App.esc((lit && lit.title) || '').slice(0, 26)}</b>（2 跳子图 · 点击节点切换中心）</span>
      <button class="btn btn-xs" id="litGraphShowAll">查看全图</button>`;
    const btn = document.getElementById('litGraphShowAll');
    if (btn) btn.addEventListener('click', () => { this.graphFullMode = true; this.graphFocusId = null; this.renderGraph(); });
  },

  /** 图谱侧栏：中心模式显示中心文献+邻居；全图模式显示关系列表 */
  renderGraphSide() {
    const box = document.getElementById('litGraphSide');
    if (!box || !this.graphData) return;
    const byId = this.graphData.byId;
    if (!this.graphData.links.length) {
      box.innerHTML = `<div class="g-node">暂无关联，点击「AI 生成关系」分析文献关联。</div>`;
      return;
    }
    if (this.graphFocusId) { this.renderGraphNodeSide(this.graphFocusId); return; }
    const typeLabel = { cites: '引用', extends: '扩展', contrasts: '对比', correlated: '相关', 'topic-similar': '主题相近' };
    box.innerHTML = this.graphData.links.slice(0, 40).map((l) => {
      const a = byId.get(l.source), b = byId.get(l.target);
      return `<div class="g-node" data-pair="${l.source}|${l.target}">
        <b>${App.esc((a.title || '').slice(0, 20))}</b> ⇄ <b>${App.esc((b.title || '').slice(0, 20))}</b>
        <span class="tag low">${(l.types || []).map((t) => typeLabel[t] || t).join('/')}</span>
        <div class="g-reason">${App.esc((l.reasons || []).join('；') || '')}</div></div>`;
    }).join('');
  },

  /** 图谱节点侧栏：中心文献 + 邻居 */
  renderGraphNodeSide(id) {
    const box = document.getElementById('litGraphSide');
    if (!box || !this.graphData) return;
    const lit = this.graphData.byId.get(id);
    if (!lit) return;
    const neighbors = this.graphData.links.filter((l) => l.source === id || l.target === id);
    const typeLabel = { cites: '引用', extends: '扩展', contrasts: '对比', correlated: '相关', 'topic-similar': '主题相近' };
    box.innerHTML = `<div class="g-node"><b>${App.esc(lit.title)}</b>
      <div class="g-reason">${App.esc(lit.authors || '')} · ${lit.year || ''}</div>
      <div class="g-reason">关联 ${neighbors.length} 篇：</div></div>
      ${neighbors.slice(0, 10).map((l) => {
        const other = this.graphData.byId.get(l.source === id ? l.target : l.source);
        return `<div class="g-node" data-pair="${l.source}|${l.target}"><b>${App.esc((other.title || '').slice(0, 20))}</b>
          <span class="tag low">${(l.types || []).map((t) => typeLabel[t] || t).join('/')}</span>
          <div class="g-reason">${App.esc((l.reasons || []).join('；') || '')}</div></div>`;
      }).join('')}`;
  },

  /* ================= 详情 ================= */

  renderDetail() {
    const box = document.getElementById('litDetail');
    const l = this.current.find((x) => x.id === this.activeId);
    if (!l) {
      box.innerHTML = `<div class="empty-tip">← 从左侧选择一篇文献查看摘要笔记</div>`;
      return;
    }
    if (this.editing) {
      box.innerHTML = `
        <h2>${App.esc(l.title)}</h2>
        <div class="muted" style="margin-bottom:10px">${App.esc(l.authors || '')}${l.venue ? ` · ${App.esc(l.venue)}` : ''}${l.year ? ` · ${l.year}` : ''}</div>
        <textarea class="summary-edit" id="summaryEdit"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary" id="summarySave">保存笔记</button>
          <button class="btn" id="summaryCancel">取消</button>
        </div>`;
      document.getElementById('summaryEdit').value = l.summary || '';
      document.getElementById('summarySave').addEventListener('click', async () => {
        await window.api.store.update('literature', l.id, { summary: document.getElementById('summaryEdit').value });
        this.editing = false;
        App.toast('笔记已保存', 'ok');
        this.render();
      });
      document.getElementById('summaryCancel').addEventListener('click', () => { this.editing = false; this.render(); });
      return;
    }

    const colNames = (l.collectionIds || [])
      .map((id) => this.collections.find((c) => c.id === id))
      .filter(Boolean).map((c) => `<span class="tag low">${App.esc(c.name)}</span>`).join('');
    box.innerHTML = `
      <div class="lit-detail">
        <h2>${App.esc(l.title)}</h2>
        <div class="ld-meta">
          ${App.esc(l.authors || '未知作者')}${l.venue ? ` · ${App.esc(l.venue)}` : ''}${l.year ? ` · ${l.year}` : ''}
          ${l.doi ? ` · <a href="${App.esc(l.doi)}" style="color:var(--primary)">DOI 链接</a>` : ''}
        </div>
        ${l.pdfPath ? `<div class="pdf-attachment"><b>PDF ATTACHED</b><span>${App.esc(l.pdfName || '文献附件')}</span><small>${this.formatBytes(l.pdfSize)}</small></div>` : ''}
        ${l.source === 'zotero' ? `<div class="literature-source-badge zotero">ZOTERO READ-ONLY · ${App.esc(l.zoteroKey || '')}</div>` : ''}
        ${colNames ? `<div class="lit-col-tags">${colNames}</div>` : ''}
        ${l.summaryValidation ? `<div class="literature-validation ${l.summaryValidation.passed ? 'passed' : 'review'}">
          <b>${l.summaryValidation.passed ? 'VALIDATED' : 'NEEDS REVIEW'}</b>
          <span>${App.esc(l.summaryValidation.sourceBasis || '元数据')} · ${(l.summaryValidation.checks || []).filter((check) => check.passed).length}/${(l.summaryValidation.checks || []).length} 项通过</span>
        </div>` : ''}
        <div class="ld-actions">
          <button class="btn" id="litAI">AI 生成摘要</button>
          <button class="btn" id="litEdit">编辑笔记</button>
          ${l.source === 'zotero' ? '' : '<button class="btn" id="litAssign">分类</button>'}
          <button class="btn btn-danger" id="litDel">删除</button>
        </div>
        <div class="lit-agent-progress hidden" id="litAgentProgress">
          <div><span id="litProgressLabel">正在准备文献信息</span><b id="litProgressValue">0%</b></div>
          <span><i id="litProgressBar"></i></span>
        </div>
        <div class="summary-box markdown">${App.markdown(l.summary || '*（暂无摘要笔记，点击「AI 生成摘要」或「编辑笔记」）*')}</div>
      </div>`;

    document.getElementById('litAI').addEventListener('click', () => this.aiSummary(l));
    document.getElementById('litEdit').addEventListener('click', () => { this.editing = true; this.renderDetail(); });
    const assignBtn = document.getElementById('litAssign');
    if (assignBtn) assignBtn.addEventListener('click', () => this.openAssign(l));
    document.getElementById('litDel').addEventListener('click', async () => {
      if (confirm('确定删除该文献记录？')) {
        await window.api.store.remove('literature', l.id);
        this.activeId = null;
        this.render();
        App.toast('已删除', 'ok');
      }
    });
  },

  async aiSummary(l) {
    const button = document.getElementById('litAI');
    const taskId = await AgentTasks.start(`摘要 · ${l.title}`, '读取文献元数据', {
      kind: 'literature-summary', sourceRef: l.id,
      steps: ['读取文献元数据', '整理原文依据', '生成结构化摘要', '验证摘要完整性', '保存文献笔记']
    });
    button.disabled = true;
    this.showProgress(12, '读取文献元数据');
    App.toast('AI 已进入后台摘要队列…');
    try {
      await AgentTasks.update(taskId, 34, '整理标题、作者与摘要');
      this.showProgress(34, '整理标题、作者与摘要');
      const r = await window.api.ai.summarizeLiterature({
        title: l.title, authors: l.authors, venue: l.venue, year: l.year, doi: l.doi, abstract: l.abstract, fullText: l.pdfText
      });
      await AgentTasks.update(taskId, 82, '生成结构化笔记');
      this.showProgress(82, '生成结构化笔记');
      if (!r.ok) throw new Error(r.error || '生成失败');
      const validation = this.validateSummary(r.content, l.pdfText || l.abstract || '', l.pdfText ? 'PDF 正文' : l.abstract ? '原文摘要' : '仅元数据');
      await window.api.store.update('literature', l.id, { summary: r.content, summaryValidation: validation });
      this.showProgress(100, '摘要已保存');
      if (validation.passed) {
        await AgentTasks.complete(taskId, '摘要已验证并保存', { summary: r.content }, validation.checks);
      } else {
        await AgentTasks.needsInput(taskId, '摘要已保存，但有检查项需要人工确认', validation.checks.filter((check) => !check.passed).map((check) => check.label).join('；'));
      }
      App.toast(r.source === 'ai' ? 'AI 摘要已生成' : '已生成（本地模板，配置 AI 可自动填充）', r.source === 'ai' ? 'ok' : 'info');
    } catch (error) {
      await AgentTasks.fail(taskId, error.message || '摘要生成失败');
      App.toast(error.message || '生成失败', 'error');
    }
    await this.render();
  },

  showProgress(progress, label) {
    const box = document.getElementById('litAgentProgress');
    if (!box) return;
    box.classList.remove('hidden');
    document.getElementById('litProgressLabel').textContent = label;
    document.getElementById('litProgressValue').textContent = `${progress}%`;
    document.getElementById('litProgressBar').style.width = `${progress}%`;
  },

  formatBytes(size) {
    if (!Number(size)) return '';
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  },

  tagList(tags) {
    if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
    return String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  },

  validateSummary(summary, sourceText, sourceBasis) {
    const content = String(summary || '');
    const required = ['研究问题', '核心方法', '数据与实验设计', '主要结论', '局限性', '启发'];
    const checks = [
      { label: '存在可用于核对的原文依据', passed: String(sourceText || '').trim().length >= 80 },
      { label: '摘要包含全部核心章节', passed: required.every((heading) => content.includes(heading)) },
      { label: '摘要内容达到可阅读长度', passed: content.length >= 260 },
      { label: '不存在明显的待补充占位内容', passed: !/(待补充|原文信息不足)/.test(content) }
    ];
    return { passed: checks.every((check) => check.passed), sourceBasis, checks, validatedAt: new Date().toISOString() };
  },

  async importPdf() {
    const file = await window.api.dialog.pickPdf();
    if (!file) return;
    const title = String(file.name || '未命名文献').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    const lit = await window.api.store.create('literature', {
      title, authors: '', venue: '', year: '', doi: '', abstract: '', tags: 'PDF', summary: null,
      pdfPath: file.path, pdfName: file.name, pdfSize: file.size
    });
    await window.api.store.create('activity', { date: App.todayStr(), action: '文献', content: `导入 PDF：${title}` });
    this.activeId = lit.id;
    await this.render();
    App.toast('PDF 已归档，正在后台提取正文…', 'ok');
    await this.processPdf(lit);
  },

  async processPdf(lit) {
    const taskId = await AgentTasks.start(`解析 PDF · ${lit.title}`, '读取 PDF 文件', {
      kind: 'pdf-literature', sourceRef: lit.id, goal: `提取「${lit.title}」正文并生成有依据的结构化摘要`,
      steps: ['读取 PDF 文件', '提取并清理正文', '生成结构化摘要', '验证摘要与来源', '保存文献记录']
    });
    try {
      await AgentTasks.update(taskId, 18, '提取并清理 PDF 正文');
      const extracted = await window.api.pdf.extract(lit.pdfPath);
      if (!extracted.ok) throw new Error(extracted.error || 'PDF 正文提取失败');
      await window.api.store.update('literature', lit.id, {
        pdfText: extracted.text, pdfPages: extracted.pages, pdfChars: extracted.chars,
        extractionStatus: 'extracted', extractionTruncated: extracted.truncated
      });
      await AgentTasks.update(taskId, 48, `已提取 ${extracted.pages || '未知'} 页，正在生成结构化摘要`);
      const response = await window.api.ai.summarizeLiterature({
        title: lit.title, authors: lit.authors, venue: lit.venue, year: lit.year, doi: lit.doi,
        abstract: lit.abstract, fullText: extracted.text
      });
      if (!response.ok) throw new Error(response.error || '结构化摘要生成失败');
      await AgentTasks.update(taskId, 78, '验证摘要结构与原文依据');
      const validation = this.validateSummary(response.content, extracted.text, `PDF 正文 · ${extracted.pages || '未知'} 页`);
      await window.api.store.update('literature', lit.id, {
        summary: response.content, summaryValidation: validation, summarySource: response.source,
        extractionStatus: 'complete'
      });
      if (validation.passed) {
        await AgentTasks.complete(taskId, 'PDF 正文、摘要与验证均已完成', { summary: response.content }, validation.checks);
        App.toast('PDF 摘要已生成并通过结构检查', 'ok');
      } else {
        await AgentTasks.needsInput(taskId, '摘要已生成，但需要人工复核', validation.checks.filter((check) => !check.passed).map((check) => check.label).join('；'));
        App.toast('摘要已生成，部分验证项需要确认', 'info');
      }
    } catch (error) {
      await window.api.store.update('literature', lit.id, { extractionStatus: 'error', extractionError: error.message });
      await AgentTasks.needsInput(taskId, 'PDF 处理需要人工介入', `${error.message}。可重新导入，或保留记录后手动填写摘要。`);
      App.toast(error.message || 'PDF 处理失败', 'error');
    }
    await this.render();
  }
};

window.Literature = Literature;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('importPdf').addEventListener('click', () => Literature.importPdf());
  document.getElementById('openLitModal').addEventListener('click', () => {
    ['lmTitle', 'lmAuthors', 'lmVenue', 'lmYear', 'lmDoi', 'lmAbstract', 'lmTags'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    Modal.open('litModal');
    document.getElementById('lmTitle').focus();
  });

  /* 分类树交互 */
  document.getElementById('litColTree').addEventListener('click', async (e) => {
    const caret = e.target.closest('.col-caret');
    if (caret && caret.dataset.caret) {
      const id = caret.dataset.caret;
      Literature.collapsed[id] = !Literature.collapsed[id];
      Literature.renderCollections();
      return;
    }
    const del = e.target.closest('.col-del');
    if (del) { await Literature.deleteCollection(del.dataset.del); return; }
    const edit = e.target.closest('.col-edit');
    if (edit) {
      const col = Literature.collections.find((c) => c.id === edit.dataset.edit);
      if (col) Literature.openColModal(col);
      return;
    }
    const node = e.target.closest('.col-node');
    if (!node || !node.dataset.cid) return;
    Literature.activeCollection = node.dataset.cid;
    Literature.renderCollections();
    Literature.renderList();
  });

  /* 新建分类 */
  document.getElementById('litAddCollection').addEventListener('click', () => Literature.openColModal(null));

  /* 分类 Modal */
  document.getElementById('litColCancel').addEventListener('click', () => Modal.close('litColModal'));
  document.getElementById('litColSave').addEventListener('click', async () => {
    const name = document.getElementById('litColName').value.trim();
    const parent = document.getElementById('litColParent').value || null;
    const editingId = document.getElementById('litColModal').dataset.editId;
    if (editingId) await Literature.renameCollection(editingId, name);
    else await Literature.addCollection(name, parent);
    Modal.close('litColModal');
  });

  /* 文献分类关联 Modal */
  document.getElementById('litAssignCancel').addEventListener('click', () => Modal.close('litAssignModal'));
  document.getElementById('litAssignSave').addEventListener('click', () => Literature.saveAssign());

  /* 图谱切换 */
  document.getElementById('litGraphBtn').addEventListener('click', () => {
    Literature.graphMode = true;
    Literature.graphFocusId = null;   // 每次进入图谱：以当前选中文献为中心
    Literature.graphFullMode = false; // 中心聚焦模式
    document.querySelector('#page-literature .lit-split3').classList.add('hidden');
    document.getElementById('litGraphView').classList.remove('hidden');
    Literature.render();
  });
  document.getElementById('litGraphBack').addEventListener('click', () => {
    Literature.graphMode = false;
    document.getElementById('litGraphView').classList.add('hidden');
    document.querySelector('#page-literature .lit-split3').classList.remove('hidden');
    Literature.render();
  });
  document.getElementById('litGenerateRelations').addEventListener('click', () => {
    Literature.generateRelations(document.getElementById('litGraphScope').value);
  });
  /* 切换范围：立即重渲染图谱（范围过滤联动） */
  document.getElementById('litGraphScope').addEventListener('change', () => {
    if (Literature.graphMode) Literature.render();
  });
  /* 图谱节点点击由 echarts on('click') 处理（renderGraph 内绑定）；侧栏点击跳转 */
  document.getElementById('litGraphSide').addEventListener('click', (e) => {
    const pair = e.target.closest('[data-pair]');
    if (!pair || !Literature.graphData) return;
    const [a, b] = pair.dataset.pair.split('|');
    const id = Literature.graphData.byId.has(a) ? a : b;
    Literature.graphMode = false;
    document.getElementById('litGraphView').classList.add('hidden');
    document.querySelector('#page-literature .lit-split3').classList.remove('hidden');
    Literature.activeId = id;
    Literature.render();
  });

  document.getElementById('litList').addEventListener('click', (e) => {
    const check = e.target.closest('input[type="checkbox"]');
    if (check && check.dataset.sel) {
      e.stopPropagation();
      Literature.toggleSelect(check.dataset.sel);
      return;
    }
    const item = e.target.closest('.lit-item');
    if (!item) return;
    Literature.activeId = item.dataset.id;
    Literature.editing = false;
    Literature.renderList();
    Literature.renderDetail();
  });

  /* 批量管理 */
  document.getElementById('litSelectAll').addEventListener('change', (e) => Literature.selectAll(e.target.checked));
  document.getElementById('litBatchDelete').addEventListener('click', () => Literature.batchDelete());
  document.getElementById('litBatchAssign').addEventListener('click', () => Literature.openAssignBulk());

  document.getElementById('litSearch').addEventListener('input', () => Literature.renderList());

  document.getElementById('lmCancel').addEventListener('click', () => Modal.close('litModal'));
  document.getElementById('lmSave').addEventListener('click', async () => {
    const title = document.getElementById('lmTitle').value.trim();
    if (!title) { App.toast('请填写文献标题', 'error'); return; }
    const lit = await window.api.store.create('literature', {
      title,
      authors: document.getElementById('lmAuthors').value.trim(),
      venue: document.getElementById('lmVenue').value.trim(),
      year: document.getElementById('lmYear').value.trim(),
      doi: document.getElementById('lmDoi').value.trim(),
      abstract: document.getElementById('lmAbstract').value.trim(),
      tags: document.getElementById('lmTags').value.trim(),
      summary: null,
      collectionIds: []
    });
    await window.api.store.create('activity', { date: App.todayStr(), action: '文献', content: `阅读文献：${lit.title}` });
    Modal.close('litModal');
    Literature.activeId = lit.id;
    Literature.render();
    App.toast('文献已添加', 'ok');
  });

  document.getElementById('lmAI').addEventListener('click', async () => {
    const title = document.getElementById('lmTitle').value.trim();
    if (!title) { App.toast('请先填写文献标题', 'error'); return; }
    App.toast('AI 正在生成摘要…');
    const r = await window.api.ai.summarizeLiterature({
      title,
      authors: document.getElementById('lmAuthors').value.trim(),
      venue: document.getElementById('lmVenue').value.trim(),
      year: document.getElementById('lmYear').value.trim(),
      doi: document.getElementById('lmDoi').value.trim(),
      abstract: document.getElementById('lmAbstract').value.trim()
    });
    if (r.ok) {
      document.getElementById('lmAbstract').value = r.content;
      App.toast(r.source === 'ai' ? 'AI 摘要已填入' : '已生成模板（配置 AI 后可增强）', r.source === 'ai' ? 'ok' : 'info');
    } else {
      App.toast(r.error, 'error');
    }
  });
});
