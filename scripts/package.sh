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
if [ ! -d "$APP" ]; then
  # electron-packager 17 在 Node 24 上可能停在 Electron 模板解压阶段并错误返回 0。
  # 同版本旧包的 Electron/Framework 骨架已通过签名验证；复制骨架后完整替换业务源码，
  # 再整包重签，比临时手工重建 Helper/Framework 安全且可复验。
  FALLBACK_APP="dist/${APPNAME}.app"
  [ -d "$FALLBACK_APP" ] || {
    echo "打包失败：electron-packager 未生成 $APP，且没有可用于增量重组的 $FALLBACK_APP"
    exit 1
  }
  echo "    ⚠ electron-packager 未产生目标，使用已验证的同版本应用骨架增量重组"
  mkdir -p "dist/科研工作台-darwin-arm64"
  ditto "$FALLBACK_APP" "$APP"

  APP_RES="$APP/Contents/Resources/app"
  [ -d "$APP_RES/node_modules" ] || { echo "增量重组失败：旧包缺少生产依赖"; exit 1; }
  rm -rf "$APP_RES/main" "$APP_RES/renderer"
  ditto main "$APP_RES/main"
  ditto renderer "$APP_RES/renderer"
  cp preload.js package.json README.md "$APP_RES/"

  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.rison.research-workbench" "$APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"

  # 必须证明关键修复已经进入包内，防止只重新压缩旧应用。
  cmp -s main/pet-window.js "$APP_RES/main/pet-window.js" || { echo "增量重组失败：pet-window.js 未同步"; exit 1; }
  cmp -s main/app-lifecycle.js "$APP_RES/main/app-lifecycle.js" || { echo "增量重组失败：app-lifecycle.js 未同步"; exit 1; }
  cmp -s renderer/css/pet-floating.css "$APP_RES/renderer/css/pet-floating.css" || { echo "增量重组失败：pet-floating.css 未同步"; exit 1; }
fi

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
