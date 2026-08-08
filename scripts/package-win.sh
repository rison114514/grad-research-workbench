#!/bin/bash
# ============================================================
# 科研工作台 · Windows 打包（win32-x64）
# 用法：npm run pack:win
# 产物：dist/科研工作台-v<VERSION>-win32-x64.zip（内含主程序 .exe）
# 说明：macOS 上通过 electron-packager 交叉打包，无需 Wine；
#       未做 Authenticode 签名，Windows SmartScreen 会提示「未知发布者」。
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
PKG="科研工作台"
APPNAME="科研工作台-v${VERSION}-win32-x64"

# 图标：无 .ico 时由 icns 生成（macOS）
if [ ! -f "build/icon.ico" ]; then
  echo "== [0/4] 生成 Windows 图标（.ico）=="
  mkdir -p build/ico-tmp
  sips -s format png build/icon.icns --out build/ico-tmp/icon-1024.png >/dev/null
  for s in 16 32 48 256; do sips -z $s $s build/ico-tmp/icon-1024.png --out build/ico-tmp/icon-$s.png >/dev/null; done
  node scripts/make-ico.js
fi

echo "== [1/4] electron-packager 组装 Windows（v${VERSION}）=="
rm -rf "dist/科研工作台-win32-x64"
# 国内网络：默认走 npmmirror 镜像下载 win 版 electron（GitHub 直连常超时），可用 ELECTRON_MIRROR 覆盖
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
./node_modules/.bin/electron-packager . "$PKG" \
  --platform=win32 --arch=x64 --out=dist --overwrite \
  --icon=build/icon.ico --app-version="$VERSION" \
  --app-bundle-id=com.rison.research-workbench --prune \
  --ignore='^/dist($|/)' --ignore='^/build($|/)' --ignore='^/preview-server\.js$' --ignore='^/scripts($|/)' --ignore='^/tests($|/)'

WINAPP="dist/科研工作台-win32-x64/科研工作台.exe"
[ -f "$WINAPP" ] || { echo "打包失败：未找到 $WINAPP"; exit 1; }

echo "== [2/4] 压缩 ZIP =="
rm -rf "dist/${APPNAME}.zip"
ditto -c -k --keepParent "dist/科研工作台-win32-x64" "dist/${APPNAME}.zip"

echo "== [3/4] 解压复验（模拟用户拿到 zip）=="
VERIFY_DIR=$(mktemp -d)
ditto -x -k "dist/${APPNAME}.zip" "$VERIFY_DIR/"
[ -f "$VERIFY_DIR/科研工作台-win32-x64/科研工作台.exe" ] || { echo "复验失败：zip 中未找到 exe"; exit 1; }
rm -rf "$VERIFY_DIR"

echo "== [4/4] 完成 =="
ls -la "dist/${APPNAME}.zip"
echo "✅ Windows 打包+压缩+复验全部通过（SmartScreen 提示属正常，需代码签名证书消除）"
