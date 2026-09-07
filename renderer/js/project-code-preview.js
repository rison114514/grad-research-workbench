'use strict';

/* 项目文件 IDE 预览：纯格式化与安全高亮，可在 Node 测试中复用。 */
(function initProjectCodePreview(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProjectCodePreview = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const LANGUAGE_MAP = {
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
    ts: 'TypeScript', tsx: 'TypeScript', json: 'JSON', jsonc: 'JSON',
    html: 'HTML', htm: 'HTML', vue: 'Vue', svelte: 'Svelte', xml: 'XML', svg: 'SVG',
    css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
    md: 'Markdown', markdown: 'Markdown', txt: 'Plain Text', log: 'Log',
    py: 'Python', rb: 'Ruby', php: 'PHP', java: 'Java', kt: 'Kotlin',
    c: 'C', h: 'C Header', cc: 'C++', cpp: 'C++', hpp: 'C++ Header',
    cs: 'C#', go: 'Go', rs: 'Rust', swift: 'Swift', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
    yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', env: 'Environment',
    sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL', csv: 'CSV'
  };

  const KEYWORDS = {
    JavaScript: new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined'.split(' ')),
    TypeScript: new Set('abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of override private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield'.split(' ')),
    Python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')),
    Shell: new Set('case do done elif else esac fi for function if in select then time until while'.split(' ')),
    SQL: new Set('SELECT FROM WHERE INSERT UPDATE DELETE INTO VALUES CREATE ALTER DROP TABLE JOIN INNER LEFT RIGHT ON AS AND OR NOT NULL GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT UNION ALL CASE WHEN THEN ELSE END'.split(' '))
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function fileName(fullPath) {
    return String(fullPath || '').split(/[\\/]/).pop() || '未命名文件';
  }

  function extension(fullPath) {
    const name = fileName(fullPath);
    if (/^\.[^.]+$/.test(name)) return name.slice(1).toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
  }

  function languageForPath(fullPath) {
    return LANGUAGE_MAP[extension(fullPath)] || 'Plain Text';
  }

  function formatContent(content, language) {
    const text = String(content ?? '').replace(/\r\n?/g, '\n');
    if (language === 'JSON') {
      try { return JSON.stringify(JSON.parse(text), null, 2); } catch (_) { return text; }
    }
    return text;
  }

  function tokenClass(token, language) {
    if (/^(\/\/|\/\*|\*|<!--|--)/.test(token)) return 'comment';
    if (/^#/.test(token) && ['Python', 'Shell', 'YAML', 'TOML'].includes(language)) return 'comment';
    if (/^(["'`])/.test(token)) return 'string';
    if (/^-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?$/i.test(token)) return 'number';
    if (/^(true|false|null|undefined|None|True|False)$/i.test(token)) return 'literal';
    if (language === 'JSON' && /^"(?:\\.|[^"\\])*"(?=\s*:)/.test(token)) return 'property';
    const words = KEYWORDS[language] || KEYWORDS[language === 'TypeScript' ? 'TypeScript' : 'JavaScript'];
    if (words && words.has(token)) return 'keyword';
    return 'operator';
  }

  function highlightMarkup(line) {
    const parts = [];
    let cursor = 0;
    const re = /<!--.*?-->|<\/?[A-Za-z][^>]*>/g;
    for (const match of line.matchAll(re)) {
      parts.push(escapeHtml(line.slice(cursor, match.index)));
      const cls = match[0].startsWith('<!--') ? 'comment' : 'tag';
      parts.push(`<span class="tok-${cls}">${escapeHtml(match[0])}</span>`);
      cursor = match.index + match[0].length;
    }
    parts.push(escapeHtml(line.slice(cursor)));
    return parts.join('');
  }

  function highlightMarkdown(line) {
    const escaped = escapeHtml(line);
    if (/^\s*#{1,6}\s/.test(line)) return `<span class="tok-heading">${escaped}</span>`;
    if (/^\s*(?:[-*+] |\d+\. )/.test(line)) return `<span class="tok-keyword">${escaped}</span>`;
    if (/^\s*>/.test(line)) return `<span class="tok-comment">${escaped}</span>`;
    return escaped.replace(/(`[^`]+`|\*\*[^*]+\*\*)/g, '<span class="tok-string">$1</span>');
  }

  function highlightLine(line, language) {
    if (['HTML', 'XML', 'SVG', 'Vue', 'Svelte'].includes(language)) return highlightMarkup(line);
    if (language === 'Markdown') return highlightMarkdown(line);

    const tokenRe = language === 'JSON'
      ? /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/gi
      : /(\/\/.*$|\/\*.*?\*\/|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:e[+-]?\d+)?|\b[A-Za-z_$][\w$]*\b|[{}()[\],.;:+\-*\/%=<>!?&|]+)/gi;
    const parts = [];
    let cursor = 0;
    for (const match of line.matchAll(tokenRe)) {
      parts.push(escapeHtml(line.slice(cursor, match.index)));
      const token = match[0];
      const isJsonProperty = language === 'JSON' && token.startsWith('"')
        && /^\s*:/.test(line.slice(match.index + token.length));
      const cls = isJsonProperty ? 'property' : tokenClass(token, language);
      parts.push(`<span class="tok-${cls}">${escapeHtml(token)}</span>`);
      cursor = match.index + token.length;
    }
    parts.push(escapeHtml(line.slice(cursor)));
    return parts.join('');
  }

  function renderCode(content, language) {
    return formatContent(content, language).split('\n').map((line, index) => (
      `<div class="ide-code-line"><span class="ide-line-number">${index + 1}</span><code>${highlightLine(line, language) || '&nbsp;'}</code></div>`
    )).join('');
  }

  function formatBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return '—';
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
    return `${(size / 1024 ** 2).toFixed(1)} MB`;
  }

  return { escapeHtml, fileName, extension, languageForPath, formatContent, highlightLine, renderCode, formatBytes };
});
