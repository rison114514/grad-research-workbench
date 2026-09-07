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
VOICE_STAGE="main/bin/darwin-arm64"

# Whisper 可执行文件属于应用代码的一部分，须在 codesign 范围内；模型权重仍由用户首次使用时下载到 userData。
WHISPER_SRC=$(command -v whisper-cli || true)
[ -n "$WHISPER_SRC" ] || { echo "打包失败：未找到 whisper-cli，请先 brew install whisper-cpp"; exit 1; }
rm -rf "$VOICE_STAGE"
mkdir -p "$VOICE_STAGE/lib" "$VOICE_STAGE/libexec"
cp "$WHISPER_SRC" "$VOICE_STAGE/whisper-cli"
WHISPER_PREFIX=$(brew --prefix whisper-cpp)
GGML_PREFIX=$(brew --prefix ggml)
for LIB_ROOT in "$WHISPER_PREFIX/lib" "$GGML_PREFIX/lib"; do
  for LIB in "$LIB_ROOT"/*.dylib; do
    [ -e "$LIB" ] || continue
    cp -L "$LIB" "$VOICE_STAGE/lib/$(basename "$LIB")"
  done
done
for BACKEND in "$GGML_PREFIX/libexec"/*.so; do
  [ -e "$BACKEND" ] || continue
  cp -L "$BACKEND" "$VOICE_STAGE/libexec/$(basename "$BACKEND")"
done
LIBOMP=$(brew --prefix libomp 2>/dev/null || true)
if [ -n "$LIBOMP" ] && [ -e "$LIBOMP/lib/libomp.dylib" ]; then
  cp -L "$LIBOMP/lib/libomp.dylib" "$VOICE_STAGE/lib/libomp.dylib"
fi
for TARGET in "$VOICE_STAGE/whisper-cli" "$VOICE_STAGE"/lib/*.dylib "$VOICE_STAGE"/libexec/*.so; do
  [ -e "$TARGET" ] || continue
  while IFS= read -r DEP; do
    BASE=$(basename "$DEP")
    [ -e "$VOICE_STAGE/lib/$BASE" ] || continue
    if [ "$TARGET" = "$VOICE_STAGE/whisper-cli" ]; then
      NEW="@executable_path/lib/$BASE"
    elif [[ "$TARGET" == "$VOICE_STAGE/libexec/"* ]]; then
      NEW="@loader_path/../lib/$BASE"
    else
      NEW="@loader_path/$BASE"
    fi
    install_name_tool -change "$DEP" "$NEW" "$TARGET"
  done < <(otool -L "$TARGET" | tail -n +2 | awk '{print $1}')
done
trap 'rm -rf "$VOICE_STAGE"' EXIT

echo "== [1/6] electron-packager 组装（v${VERSION}）=="
rm -rf "dist/科研工作台-darwin-arm64"
./node_modules/.bin/electron-packager . "$PKG" \
  --platform=darwin --arch=arm64 --out=dist --overwrite \
  --icon=build/icon.icns --app-version="$VERSION" \
  --app-bundle-id=com.rison.research-workbench \
  --usage-description.Microphone="用于长按塞西悬浮球进行语音输入；录音仅在用户主动长按时开始。" --prune \
  --ignore='^/dist($|/)' --ignore='^/build($|/)' --ignore='^/preview-server\.js$' --ignore='^/scripts($|/)' --ignore='^/tests($|/)'

APP="dist/科研工作台-darwin-arm64/科研工作台.app"
if [ ! -d "$APP" ]; then
  # electron-packager 17 在 Node 24 上可能停在 Electron 模板解压阶段并错误返回 0。
  # 最近版本旧包的 Electron/Framework 骨架已通过签名验证；复制骨架后完整替换业务源码，
  # 再整包重签，比临时手工重建 Helper/Framework 安全且可复验。
  FALLBACK_APP=$(find dist -maxdepth 1 -type d -name '科研工作台-v*-mac-arm64.app' ! -name "${APPNAME}.app" -print | sort -V | tail -n 1)
  [ -n "$FALLBACK_APP" ] && [ -d "$FALLBACK_APP" ] || {
    echo "打包失败：electron-packager 未生成 $APP，且没有可用于增量重组的历史 macOS 应用骨架"
    exit 1
  }
  echo "    ⚠ electron-packager 未产生目标，使用已验证的应用骨架增量重组：$FALLBACK_APP"
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

# 无论使用全新构建还是旧骨架回退，都必须写入并验证麦克风用途说明。
PLIST="$APP/Contents/Info.plist"
MIC_DESC="用于长按塞西悬浮球进行语音输入；录音仅在用户主动长按时开始。"
if /usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription $MIC_DESC" "$PLIST"
else
  /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string $MIC_DESC" "$PLIST"
fi
/usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$PLIST" | grep -q "长按塞西悬浮球" || {
  echo "打包失败：Info.plist 缺少正确的 NSMicrophoneUsageDescription"
  exit 1
}
[ -x "$APP/Contents/Resources/app/main/bin/darwin-arm64/whisper-cli" ] || {
  echo "打包失败：Whisper 二进制未进入应用签名范围"
  exit 1
}
[ -f "$APP/Contents/Resources/app/main/bin/darwin-arm64/libexec/libggml-metal.so" ] || {
  echo "打包失败：Metal 后端未进入应用签名范围"
  exit 1
}
if otool -L "$APP/Contents/Resources/app/main/bin/darwin-arm64/whisper-cli" | grep -q '/opt/homebrew'; then
  echo "打包失败：Whisper 仍引用本机 Homebrew 动态库"
  exit 1
fi

echo "== [2/6] 整包 ad-hoc 重签（修复 electron-packager 无效签名）=="
# Whisper 不是 .app/.framework 容器，codesign --deep 不保证自动修复这类内嵌 Mach-O。
# 必须在 install_name_tool 改写依赖路径后先签动态库和主二进制，再签整包。
for VOICE_BIN in "$APP/Contents/Resources/app/main/bin/darwin-arm64/lib/"*.dylib \
                 "$APP/Contents/Resources/app/main/bin/darwin-arm64/libexec/"*.so \
                 "$APP/Contents/Resources/app/main/bin/darwin-arm64/whisper-cli"; do
  [ -e "$VOICE_BIN" ] || continue
  codesign --force --sign - --timestamp=none "$VOICE_BIN"
done
codesign --force --deep --sign - --timestamp=none "$APP"

echo "== [3/6] 严格签名验证 =="
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --verify --strict --verbose=2 "$APP/Contents/Resources/app/main/bin/darwin-arm64/whisper-cli"
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
