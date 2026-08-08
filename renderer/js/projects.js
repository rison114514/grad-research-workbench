'use strict';

/* ============ 项目管理 ============ */

const Projects = {
  activeId: null,
  graphChart: null,
  treeCache: null,

  async render() {
    App.state.projects = await window.api.store.list('projects');
    if (!this.activeId && App.state.projects.length) this.activeId = App.state.projects[0].id;
    this.renderCards();
    if (this.activeId) await this.renderDetail();
    else document.getElementById('projectDetail').classList.add('hidden');
  },

  renderCards() {
    const box = document.getElementById('projectCards');
    if (App.state.projects.length === 0) {
      box.innerHTML = `<div class="empty-tip" style="grid-column:1/-1">还没有项目，点击「添加项目」选择本地文件夹</div>`;
      return;
    }
    box.innerHTML = App.state.projects.map((p) => `
      <div class="project-card ${p.id === this.activeId ? 'active' : ''}" data-id="${p.id}">
        <div class="p-name">${App.esc(p.name)}</div>
        <div class="p-path">${App.esc(p.path)}</div>
        ${p.description ? `<div class="p-desc">${App.esc(p.description)}</div>` : ''}
        <div class="p-meta">
          <span class="tag status">LOCAL 本地项目</span>
          <span class="tag low">${App.fmtDate((p.createdAt || '').slice(0, 10))}</span>
        </div>
      </div>`).join('');
  },

  async renderDetail() {
    const p = App.state.projects.find((x) => x.id === this.activeId);
    if (!p) return;
    const box = document.getElementById('projectDetail');
    box.classList.remove('hidden');
    document.getElementById('pdName').textContent = p.name;
    document.getElementById('pdPath').textContent = p.path;

    document.getElementById('projectTree').innerHTML = `<div class="loading"><span class="spinner"></span>正在扫描目录…</div>`;
    document.getElementById('projectGraph').innerHTML = '';

    const taskId = await AgentTasks.start(`扫描 · ${p.name}`, '读取本地目录结构', {
      kind: 'project-scan', sourceRef: p.id,
      steps: ['读取本地目录结构', '构建文件索引', '生成项目关系图谱', '验证扫描结果']
    });
    const scan = await window.api.fs.scanTree(p.path, 6);
    if (!scan.ok) {
      document.getElementById('projectTree').innerHTML = `<div class="empty-tip">扫描失败：${App.esc(scan.error)}</div>`;
      await AgentTasks.fail(taskId, scan.error || '目录扫描失败');
      return;
    }
    await AgentTasks.update(taskId, 58, '构建目录树与文件索引');
    this.treeCache = scan.tree;
    this.renderTree(scan.tree, 0);

    const g = await window.api.fs.buildGraph(p.path);
    if (g.ok) {
      await AgentTasks.update(taskId, 86, '生成项目关系图谱');
      this.renderGraph(g.graph);
      await AgentTasks.complete(taskId, `已索引 ${g.graph.nodes.length} 个节点`, { message: `目录扫描完成，共 ${g.graph.nodes.length} 个节点、${g.graph.links.length} 条关系。` }, [
        { label: '目录树可读取', passed: true }, { label: '关系图节点有效', passed: g.graph.nodes.length > 0 }
      ]);
    } else {
      await AgentTasks.fail(taskId, g.error || '关系图谱生成失败');
    }
  },

  renderTree(node, depth, collapsedSet = new Set()) {
    const box = document.getElementById('projectTree');
    const lines = [];
    const walk = (n, d) => {
      if (d > 0 && collapsedSet.has(n.path)) return;
      const indent = '&nbsp;'.repeat(d * 3);
      if (n.type === 'dir') {
        lines.push(`<div class="tr-line"><span class="tr-indent">${indent}</span><span class="tr-dir" data-path="${App.esc(n.path)}">[DIR] ${App.esc(n.name)}</span></div>`);
        if (n.children) n.children.forEach((c) => walk(c, d + 1));
      } else {
        lines.push(`<div class="tr-line"><span class="tr-indent">${indent}</span><span class="tr-file" data-path="${App.esc(n.path)}">[FILE] ${App.esc(n.name)}</span></div>`);
      }
    };
    walk(node, 0);
    box.innerHTML = lines.join('');
  },

  renderGraph(graph) {
    const { nodes = [], links = [] } = graph || {};
    const el = document.getElementById('projectGraph');
    if (this.graphChart) this.graphChart.dispose();
    this.graphChart = echarts.init(el);

    const categories = [
      { name: '根目录', itemStyle: { color: '#3b6ef5' } },
      { name: '目录', itemStyle: { color: '#7a5af8' } },
      { name: '文件', itemStyle: { color: '#c7cfdf' } }
    ];
    this.graphChart.setOption({
      tooltip: {
        formatter: (p) => {
          const n = p.data;
          return `<b>${App.esc(n.name)}</b><br/>${App.esc(n.rel || '')}${n.value !== undefined ? `<br/>子节点: ${n.value}` : ''}`;
        }
      },
      legend: [{ data: ['根目录', '目录', '文件'], bottom: 0 }],
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories,
        data: nodes.map((n) => ({
          id: n.id, name: n.name, symbolSize: n.symbolSize,
          category: n.category,
          rel: n.rel, path: n.path, value: n.value,
          label: { show: n.category !== 2, fontSize: 10 }
        })),
        links: links.map((l) => ({ source: l.source, target: l.target })),
        force: { repulsion: 90, edgeLength: [30, 80], gravity: 0.12 },
        lineStyle: { color: '#d3dbe9', width: 1, curveness: 0.05 },
        emphasis: { focus: 'adjacency', label: { show: true, fontSize: 12 } }
      }]
    });

    this.graphChart.on('click', (params) => {
      if (params.dataType === 'node' && params.data.path && params.data.rel !== '/') {
        this.previewPath(params.data.path);
      }
    });
  },

  async previewPath(fullPath) {
    const box = document.getElementById('filePreview');
    if (!fullPath) { box.innerHTML = ''; return; }
    const info = await window.api.fs.pathInfo(fullPath);
    if (!info.ok || info.isDir) { box.innerHTML = ''; return; }
    const read = await window.api.fs.readTextFile(fullPath);
    if (read.ok) {
      box.textContent = `📄 ${fullPath}\n\n${read.content}${read.truncated ? '\n\n…（内容过长已截断）' : ''}`;
    } else {
      box.textContent = `无法预览（${read.error || '二进制或不可读文件'}）`;
    }
  }
};

window.Projects = Projects;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addProjectBtn').addEventListener('click', async () => {
    const folder = await window.api.dialog.pickProjectFolder();
    if (!folder) return;
    const name = folder.split('/').pop() || folder;
    await window.api.store.create('projects', { name, path: folder, description: '' });
    App.toast('项目已添加，正在扫描…', 'ok');
    const created = await window.api.store.list('projects');
    App.state.projects = created;
    Projects.activeId = created[created.length - 1].id;
    await Projects.render();
    window.Tasks && window.Tasks.render();
  });

  document.getElementById('projectCards').addEventListener('click', (e) => {
    const card = e.target.closest('.project-card');
    if (!card) return;
    Projects.activeId = card.dataset.id;
    Projects.render();
  });

  document.getElementById('pdReScan').addEventListener('click', () => Projects.renderDetail());
  document.getElementById('pdDelete').addEventListener('click', async () => {
    if (confirm('确定从工作台删除该项目记录？（不会删除本地文件夹）')) {
      await window.api.store.remove('projects', Projects.activeId);
      Projects.activeId = null;
      Projects.render();
      App.toast('项目已移除', 'ok');
    }
  });

  document.getElementById('projectTree').addEventListener('click', async (e) => {
    const file = e.target.closest('.tr-file');
    const dir = e.target.closest('.tr-dir');
    if (file) {
      Projects.previewPath(file.dataset.path);
    }
    if (dir) {
      const info = await window.api.fs.pathInfo(dir.dataset.path);
      document.getElementById('filePreview').innerHTML = '';
      if (info.ok) {
        App.toast(`📁 ${dir.dataset.path.split('/').pop()}${info.isDir ? '（文件夹）' : '（文件）'}`);
      }
    }
  });
});
