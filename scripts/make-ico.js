'use strict';
/* 生成多尺寸 .ico（ICONDIR + PNG 内嵌，现代 ICO 格式）
 * 输入：build/ico-tmp/icon-{16,32,48,256}.png → 输出 build/icon.ico
 */
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 256];
const tmp = path.join(__dirname, '..', 'build', 'ico-tmp');
const out = path.join(__dirname, '..', 'build', 'icon.ico');

const entries = SIZES.map((s) => {
  const png = fs.readFileSync(path.join(tmp, `icon-${s}.png`));
  return { size: s, png };
});

// ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes each)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);        // reserved
header.writeUInt16LE(1, 2);        // type: icon
header.writeUInt16LE(entries.length, 4);

const dirEntries = Buffer.alloc(16 * entries.length);
let offset = 6 + 16 * entries.length;
entries.forEach((e, i) => {
  const b = 16 * i;
  const dim = e.size >= 256 ? 0 : e.size; // 256 用 0 表示
  dirEntries.writeUInt8(dim, b);
  dirEntries.writeUInt8(dim, b + 1);
  dirEntries.writeUInt8(0, b + 2);       // color palette
  dirEntries.writeUInt8(0, b + 3);       // reserved
  dirEntries.writeUInt16LE(1, b + 4);    // planes
  dirEntries.writeUInt16LE(32, b + 6);   // bpp
  dirEntries.writeUInt32LE(e.png.length, b + 8);
  dirEntries.writeUInt32LE(offset, b + 12);
  offset += e.png.length;
});

fs.writeFileSync(out, Buffer.concat([header, dirEntries, ...entries.map((e) => e.png)]));
console.log('OK ->', out, fs.statSync(out).size, 'bytes');
