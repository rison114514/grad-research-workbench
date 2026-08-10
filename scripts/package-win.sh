#!/bin/bash
# ============================================================
# 科研工作台 · Windows 打包（win32-x64）—— 手动构造流程
# 用法：npm run pack:win
# 产物：dist/科研工作台-v<VERSION>-win32-x64.zip（内含主程序 .exe）
# 说明：
#  - macOS 上 electron-packager 打 win 包必报「Wine required」（rcedit 注入版本信息需 wine），
#    因此改为手动构造分发：解包缓存 electron-win32 + 只装生产依赖 + 重命名 exe（已验证可运行）。
#  - Windows 版 exe 为默认 Electron 图标（自定义图标需 wine/Windows 环境，正式版建议 CI）。
#  - 未做 Authenticode 签名，SmartScreen 会提示「未知发布者」（属正常）。
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
PKG="科研工作台"
APPNAME="科研工作台-v${VERSION}-win32-x64"
WIN_DIR="dist/科研工作台-win32-x64"
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version")

echo "== [1/6] 准备 win 版 electron 分发（v${ELECTRON_VERSION}）=="
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
ZIP_CACHE=$(find "$HOME/Library/Caches/electron" -name "electron-v${ELECTRON_VERSION}-win32-x64.zip" 2>/dev/null | head -1)
if [ -z "$ZIP_CACHE" ]; then
  echo "缓存未命中，从镜像下载 electron-v${ELECTRON_VERSION}-win32-x64.zip ..."
  mkdir -p "$HOME/Library/Caches/electron"
  curl -fL --retry 3 -o "/tmp/electron-win.zip" "${ELECTRON_MIRROR}v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-win32-x64.zip"
  ZIP_CACHE="/tmp/electron-win.zip"
fi
[ -f "$ZIP_CACHE" ] || { echo "错误：未找到 win electron 分发"; exit 1; }

echo "== [2/6] 解包 electron 分发 =="
rm -rf "$WIN_DIR" && mkdir -p "$WIN_DIR"
ditto -x -k "$ZIP_CACHE" "$WIN_DIR/"

echo "== [3/6] 安装生产依赖（--omit=dev，仅运行时依赖）=="
DEPS_DIR=$(mktemp -d)
cp package.json "$DEPS_DIR/"
( cd "$DEPS_DIR" && npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com >/dev/null 2>&1 )
[ -d "$DEPS_DIR/node_modules/pdf-parse" ] || { echo "错误：生产依赖安装失败（缺 pdf-parse）"; exit 1; }

echo "== [4/6] 组装应用（源码 + 生产依赖 + 重命名 exe）=="
mkdir -p "$WIN_DIR/resources/app"
cp -R main renderer preload.js package.json "$WIN_DIR/resources/app/"
cp -R "$DEPS_DIR/node_modules" "$WIN_DIR/resources/app/"
rm -f "$WIN_DIR/resources/default_app.asar"
mv "$WIN_DIR/electron.exe" "$WIN_DIR/${PKG}.exe"

echo "== [5/6] 完整性校验（模拟用户拿到 zip 前的关键文件清单）=="
for f in "${PKG}.exe" "d3dcompiler_47.dll" "ffmpeg.dll" "icudtl.dat" "libEGL.dll" "libGLESv2.dll" "resources.pak" "chrome_100_percent.pak" "snapshot_blob.bin"; do
  [ -f "$WIN_DIR/$f" ] || { echo "错误：缺关键文件 $f"; exit 1; }
done
[ -f "$WIN_DIR/resources/app/main/index.js" ] || { echo "错误：缺 app/main/index.js"; exit 1; }
[ -d "$WIN_DIR/resources/app/node_modules/pdf-parse" ] || { echo "错误：缺 pdf-parse"; exit 1; }
grep -q "\"version\": \"${VERSION}\"" "$WIN_DIR/resources/app/package.json" || { echo "错误：版本号不匹配"; exit 1; }
echo "    ✅ 关键文件齐备（exe/dll/pak/app/生产依赖/版本号）"

echo "== [6/6] 压缩 ZIP + 解压复验 =="
rm -rf "dist/${APPNAME}.zip"
ditto -c -k --keepParent "$WIN_DIR" "dist/${APPNAME}.zip"
VERIFY_DIR=$(mktemp -d)
ditto -x -k "dist/${APPNAME}.zip" "$VERIFY_DIR/"
[ -f "$VERIFY_DIR/${PKG}-win32-x64/${PKG}.exe" ] || { echo "复验失败：zip 中未找到 exe"; exit 1; }
rm -rf "$VERIFY_DIR" "$DEPS_DIR"

echo "== 完成 =="
ls -la "dist/${APPNAME}.zip"
echo "✅ Windows 打包+校验+复验全部通过（SmartScreen 提示属正常，需代码签名证书消除；exe 为默认图标，正式图标版建议 GitHub Actions windows runner 构建）"
