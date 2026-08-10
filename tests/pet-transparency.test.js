'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const appRoot = path.join(__dirname, '..');

function loadPetWindowModule() {
  const originalLoad = Module._load;
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        BrowserWindow: class {},
        app: { getPath: () => '/tmp' },
        screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = path.join(appRoot, 'main', 'pet-window.js');
  delete require.cache[require.resolve(modulePath)];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test('桌面宠物窗口：透明 surface 会清空 Windows DWM 材质和强调边框', () => {
  const { enforceTransparentSurface, TRANSPARENT_COLOR } = loadPetWindowModule();
  const calls = [];
  const win = {
    isDestroyed: () => false,
    setBackgroundColor: (value) => calls.push(['background', value]),
    setHasShadow: (value) => calls.push(['shadow', value]),
    setBackgroundMaterial: (value) => calls.push(['material', value]),
    setAccentColor: (value) => calls.push(['accent', value])
  };

  enforceTransparentSurface(win, 'win32');

  assert.equal(TRANSPARENT_COLOR, 'rgba(0, 0, 0, 0)');
  assert.deepEqual(calls, [
    ['background', TRANSPARENT_COLOR],
    ['shadow', false],
    ['material', 'none'],
    ['accent', false]
  ]);
});

test('桌面宠物窗口：非 Windows 不调用 DWM 专属 API', () => {
  const { enforceTransparentSurface } = loadPetWindowModule();
  const calls = [];
  const win = {
    isDestroyed: () => false,
    setBackgroundColor: () => calls.push('background'),
    setHasShadow: () => calls.push('shadow'),
    setBackgroundMaterial: () => calls.push('material'),
    setAccentColor: () => calls.push('accent')
  };

  enforceTransparentSurface(win, 'darwin');
  assert.deepEqual(calls, ['background', 'shadow']);
});

test('桌面宠物页面：首帧透明，动画不作用于整窗根容器', () => {
  const html = fs.readFileSync(path.join(appRoot, 'renderer', 'pet-floating.html'), 'utf8');
  const css = fs.readFileSync(path.join(appRoot, 'renderer', 'css', 'pet-floating.css'), 'utf8');

  assert.match(html, /<style>html,body\{background:rgba\(0,0,0,0\)!important/);
  assert.match(html, /class="pet-ball-visual"/);

  const rootRule = css.match(/\.pet-ball\s*\{([\s\S]*?)\n\}/);
  const visualRule = css.match(/\.pet-ball-visual\s*\{([\s\S]*?)\n\}/);
  assert.ok(rootRule, '缺少 .pet-ball 根规则');
  assert.ok(visualRule, '缺少 .pet-ball-visual 规则');
  assert.doesNotMatch(rootRule[1], /^\s*animation\s*:/m);
  assert.doesNotMatch(rootRule[1], /^\s*transform\s*:/m);
  assert.match(visualRule[1], /animation:\s*petBallFloat/);
});

test('桌面宠物窗口：隐藏创建并在首帧后显示，避免默认白色闪帧', () => {
  const source = fs.readFileSync(path.join(appRoot, 'main', 'pet-window.js'), 'utf8');
  assert.match(source, /show:\s*false/);
  assert.match(source, /once\('ready-to-show',\s*reveal\)/);
  assert.match(source, /once\('did-finish-load'/);
  assert.match(source, /setBounds\([\s\S]*?enforceTransparentSurface\(petWindow\)/);
});
