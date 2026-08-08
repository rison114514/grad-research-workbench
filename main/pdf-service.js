'use strict';

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function extract(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('请选择有效的 PDF 文件');
  if (!fs.existsSync(filePath)) throw new Error('PDF 文件不存在或已被移动');
  const stat = fs.statSync(filePath);
  if (stat.size > 80 * 1024 * 1024) throw new Error('PDF 超过 80 MB，请压缩后重试');
  const data = fs.readFileSync(filePath);
  const result = await pdfParse(data, { max: 0 });
  const text = normalizeText(result.text || '');
  if (text.length < 10) throw new Error('未提取到可用正文；文件可能是扫描图片或受密码保护');
  return {
    ok: true,
    text: text.slice(0, 180000),
    chars: text.length,
    truncated: text.length > 180000,
    pages: result.numpages || 0,
    metadata: result.info || result.metadata || null
  };
}

function normalizeText(value) {
  return String(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

module.exports = { extract, normalizeText };
