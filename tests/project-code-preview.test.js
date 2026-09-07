'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Preview = require('../renderer/js/project-code-preview.js');

test('项目文件预览：按文件扩展名识别常见语言', () => {
  assert.equal(Preview.languageForPath('/tmp/demo.ts'), 'TypeScript');
  assert.equal(Preview.languageForPath('C:\\demo\\data.json'), 'JSON');
  assert.equal(Preview.languageForPath('/tmp/README.md'), 'Markdown');
  assert.equal(Preview.languageForPath('/tmp/LICENSE'), 'Plain Text');
});

test('项目文件预览：JSON 格式化并生成 IDE 行号', () => {
  const formatted = Preview.formatContent('{"name":"workbench","ready":true}', 'JSON');
  assert.match(formatted, /\n  "name"/);
  const html = Preview.renderCode(formatted, 'JSON');
  assert.match(html, /ide-line-number">1</);
  assert.match(html, /tok-property/);
  assert.match(html, /tok-literal/);
});

test('项目文件预览：代码内容经过 HTML 转义且保留基础高亮', () => {
  const html = Preview.renderCode('const node = "<script>";', 'JavaScript');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /tok-keyword/);
  assert.match(html, /tok-string/);
});

test('项目管理页面：右侧检查器控件与渲染器脚本已接入', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const projectScript = html.indexOf('js/projects.js');
  const previewScript = html.indexOf('js/project-code-preview.js');
  assert.match(html, /id="fileInspector"/);
  assert.match(html, /id="inspectorResizer"/);
  assert.match(html, /id="inspectorCollapse"/);
  assert.match(html, /id="inspectorZoomIn"/);
  assert.ok(previewScript > -1 && previewScript < projectScript, '渲染器必须在项目模块之前加载');
});
