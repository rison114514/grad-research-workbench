#!/bin/bash
# ============================================================
# 科研工作台 · 打包 + ad-hoc 签名 + 验证 + 压缩 + 解压复验
# 用法：npm run pack  （或 bash scripts/package.sh）
# 产物：dist/科研工作台-v<VERSION>-mac-arm64.app / .zip
# 注意：ad-hoc 签名仅用于本机验证；公开发布需 Apple Developer
#       ID 证书 + Hardened Runtime + Notarization 公证。
# ============================================================
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
PKG="科研工作台"
APPNAME="科研工作台-v${VERSION}-mac-arm64"

echo "== [1/6] electron-packager 组装（v${VERSION}）=="
rm -rf "dist/科研工作台-darwin-arm64"
./node_modules/.bin/electron-packager . "$PKG" \
  --platform=darwin --arch=arm64 --out=dist --overwrite \
  --icon=build/icon.icns --app-version="$VERSION" \
  --app-bundle-id=com.rison.research-workbench --prune \
  --ignore='^/dist($|/)' --ignore='^/build($|/)' --ignore='^/preview-server\.js$' --ignore='^/scripts($|/)' --ignore='^/tests($|/)'

APP="dist/科研工作台-darwin-arm64/科研工作台.app"
[ -d "$APP" ] || { echo "打包失败：未找到 $APP"; exit 1; }

echo "== [2/6] 整包 ad-hoc 重签（修复 electron-packager 无效签名）=="
codesign --force --deep --sign - --timestamp=none "$APP"

echo "== [3/6] 严格签名验证 =="
codesign --verify --deep --strict --verbose=2 "$APP"
echo "    ✅ valid on disk / satisfies its Designated Requirement"

echo "== [4/6] 重命名 + 压缩 ZIP =="
rm -rf "dist/${APPNAME}.app" "dist/${APPNAME}.zip"   # 先清旧目标，防止 mv 嵌套
mv "$APP" "dist/${APPNAME}.app"
rm -rf "dist/科研工作台-darwin-arm64"
ditto -c -k --keepParent "dist/${APPNAME}.app" "dist/${APPNAME}.zip"

echo "== [5/6] 解压后复验（模拟用户拿到 zip 的场景）=="
VERIFY_DIR=$(mktemp -d)
ditto -x -k "dist/${APPNAME}.zip" "$VERIFY_DIR/"
codesign --verify --deep --strict --verbose=2 "$VERIFY_DIR/${APPNAME}.app"
rm -rf "$VERIFY_DIR"

echo "== [6/6] 完成 =="
ls -la "dist/${APPNAME}.app" "dist/${APPNAME}.zip"
echo "✅ 打包+签名+压缩+复验全部通过"
