'use strict';

/* ============ 创作灵感 ============ */

const Inspirations = {
  current: [],
  moodLabels: {
    spark: '灵光一现',
    topic: '选题方向',
    visual: '视觉画面',
    research: '研究设想'
  },

  async render() {
    this.current = await window.api.store.list('inspirations');
    document.getElementById('inspirationCount').textContent = this.current.length;
    this.renderGrid();
  },

  renderGrid() {
    const keyword = (document.getElementById('ideaSearch').value || '').trim().toLowerCase();
    const items = this.current
      .filter((idea) => `${idea.title || ''} ${idea.content || ''} ${idea.tags || ''}`.toLowerCase().includes(keyword))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const grid = document.getElementById('inspirationGrid');
    if (!items.length) {
      grid.innerHTML = `<div class="empty-tip inspiration-empty">${keyword ? '没有匹配的灵感记录' : '还没有灵感记录，在左侧捕捉第一个想法'}</div>`;
      return;
    }

    grid.innerHTML = items.map((idea, index) => {
      const tags = Array.isArray(idea.tags) ? idea.tags : String(idea.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
      const title = idea.title || String(idea.content || '').slice(0, 22) || '未命名灵感';
      const stamp = (idea.createdAt || '').slice(0, 16).replace('T', ' ');
      return `
        <article class="inspiration-card" data-id="${idea.id}" data-mood="${App.esc(idea.mood || 'spark')}" style="--idea-index:${index}">
          <div class="inspiration-card-top">
            <span class="idea-seq">IDEA / ${String(index + 1).padStart(2, '0')}</span>
            <span class="idea-mood">${App.esc(this.moodLabels[idea.mood] || this.moodLabels.spark)}</span>
          </div>
          <h3>${App.esc(title)}</h3>
          <p>${App.esc(idea.content || '')}</p>
          <div class="idea-tags">${tags.map((tag) => `<span>${App.esc(tag)}</span>`).join('')}</div>
          <footer><time>${App.esc(stamp)}</time><button class="icon-btn" data-act="delete" aria-label="删除灵感">DEL</button></footer>
        </article>`;
    }).join('');
  },

  async save() {
    const title = document.getElementById('ideaTitle').value.trim();
    const content = document.getElementById('ideaContent').value.trim();
    const tags = document.getElementById('ideaTags').value.split(',').map((tag) => tag.trim()).filter(Boolean);
    const mood = document.getElementById('ideaMood').value;
    if (!content) {
      App.toast('请先写下灵感内容', 'error');
      document.getElementById('ideaContent').focus();
      return;
    }
    await window.api.store.create('inspirations', { title, content, tags, mood });
    document.getElementById('ideaTitle').value = '';
    document.getElementById('ideaContent').value = '';
    document.getElementById('ideaTags').value = '';
    document.getElementById('ideaMood').value = 'spark';
    App.toast('灵感已保存', 'ok');
    await this.render();
  },

  async remove(id) {
    await window.api.store.remove('inspirations', id);
    App.toast('灵感已移除', 'ok');
    await this.render();
  }
};

window.Inspirations = Inspirations;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ideaSave').addEventListener('click', () => Inspirations.save());
  document.getElementById('ideaSearch').addEventListener('input', () => Inspirations.renderGrid());
  document.getElementById('ideaContent').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') Inspirations.save();
  });
  document.getElementById('inspirationGrid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-act="delete"]');
    const card = event.target.closest('.inspiration-card');
    if (button && card && confirm('确定删除这条灵感记录？')) Inspirations.remove(card.dataset.id);
  });
});
