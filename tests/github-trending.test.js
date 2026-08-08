'use strict';
/* GitHub 官网 trending：HTML 解析纯函数 + 语言映射测试 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const gh = require(path.join(__dirname, '..', 'main', 'github-service.js'));

/* ---------- 语言映射 ---------- */
test('mapLanguageToGithub：中英文别名 → slug', () => {
  assert.equal(gh.mapLanguageToGithub('Python'), 'python');
  assert.equal(gh.mapLanguageToGithub('python'), 'python');
  assert.equal(gh.mapLanguageToGithub('py'), 'python');
  assert.equal(gh.mapLanguageToGithub('蟒蛇'), 'python');
  assert.equal(gh.mapLanguageToGithub('JavaScript'), 'javascript');
  assert.equal(gh.mapLanguageToGithub('js'), 'javascript');
  assert.equal(gh.mapLanguageToGithub('c++'), 'c++');
  assert.equal(gh.mapLanguageToGithub('cpp'), 'c++');
  assert.equal(gh.mapLanguageToGithub('C#'), 'c#');
  assert.equal(gh.mapLanguageToGithub('golang'), 'go');
  assert.equal(gh.mapLanguageToGithub('ts'), 'typescript');
  assert.equal(gh.mapLanguageToGithub('jupyter'), 'jupyter-notebook');
  assert.equal(gh.mapLanguageToGithub('vim'), 'vimscript');
});

test('mapLanguageToGithub：空/未命中 → null（可回退全领域）', () => {
  assert.equal(gh.mapLanguageToGithub(''), null);
  assert.equal(gh.mapLanguageToGithub('  '), null);
  assert.equal(gh.mapLanguageToGithub('deep learning'), null, '领域词无法映射');
  assert.equal(gh.mapLanguageToGithub('机器人'), null);
});

test('languageName：slug → 展示名', () => {
  assert.equal(gh.languageName('python'), 'Python');
  assert.equal(gh.languageName('c++'), 'C++');
  assert.equal(gh.languageName('jupyter-notebook'), 'Jupyter Notebook');
  assert.equal(gh.languageName(''), '全部');
  assert.equal(gh.languageName('unknown'), 'unknown');
});

/* ---------- trending HTML 解析 ---------- */
const FIXTURE = `
<html><body>
<div class="application-main">
<article class="Box-row">
  <div class="float-right d-flex">
    <a href="/sponsors/virgiliojr94" aria-label="Sponsor @virgiliojr94">Sponsor</a>
  </div>
  <h2 class="h3 lh-condensed"> <a data-view-component="true" href="/langchain-ai/langchain"><span>langchain-ai</span> / <span>langchain</span></a> </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">Build context-aware reasoning applications</p>
  <div class="f6 color-fg-muted mt-2">
    <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0"><span itemprop="programmingLanguage">Python</span></span>
    <a href="/langchain-ai/langchain/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block"><svg aria-label="star"></svg> 98,765</a>
    <a href="/langchain-ai/langchain/forks" class="tmp-mr-3 Link Link--muted d-inline-block"><svg aria-label="fork"></svg> 15,432</a>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed"> <a data-view-component="true" href="/microsoft/typescript"><span>microsoft</span> / <span>typescript</span></a> </h2>
  <p class="col-9 color-fg-muted my-1 tmp-pr-4">TypeScript is a superset of JavaScript</p>
  <div class="f6 color-fg-muted mt-2">
    <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0"><span itemprop="programmingLanguage">TypeScript</span></span>
    <a href="/microsoft/typescript/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block"><svg aria-label="star"></svg> 99,999</a>
    <a href="/microsoft/typescript/forks" class="tmp-mr-3 Link Link--muted d-inline-block"><svg aria-label="fork"></svg> 12,345</a>
  </div>
</article>
</div></body></html>`;

test('parseTrendingHtml：完整字段解析（跳过 Sponsor 按钮，h2 内取 repo 链接）', () => {
  const items = gh.parseTrendingHtml(FIXTURE);
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.fullName, 'langchain-ai/langchain', '不被 sponsor 按钮干扰');
  assert.equal(a.name, 'langchain');
  assert.equal(a.owner, 'langchain-ai');
  assert.equal(a.description, 'Build context-aware reasoning applications');
  assert.equal(a.language, 'Python');
  assert.equal(a.stars, 98765, '千分位数字解析');
  assert.equal(a.forks, 15432);
  assert.equal(a.url, 'https://github.com/langchain-ai/langchain');
  assert.equal(b.fullName, 'microsoft/typescript');
  assert.equal(b.stars, 99999);
});

test('parseTrendingHtml：异常容错（空/无匹配/字段缺失）', () => {
  assert.deepEqual(gh.parseTrendingHtml(''), []);
  assert.deepEqual(gh.parseTrendingHtml('<html>no articles here</html>'), []);
  // 字段缺失 → 空值占位不丢整条
  const partial = '<article class="Box-row"><h2><a href="/a/b"><span>a</span> / <span>b</span></a></h2></article>';
  const items = gh.parseTrendingHtml(partial);
  assert.equal(items.length, 1, '缺字段仍保留条目');
  assert.equal(items[0].description, '');
  assert.equal(items[0].stars, 0);
  assert.equal(items[0].language, '');
});

test('parseTrendingHtml：HTML 实体剥除', () => {
  const withEntity = '<article class="Box-row"><h2><a href="/o/r"><span>o</span> / <span>r</span></a></h2>'
    + '<p class="col-9">A &amp; B &lt;tag&gt;</p></article>';
  const items = gh.parseTrendingHtml(withEntity);
  assert.equal(items[0].description, 'A & B <tag>');
});
