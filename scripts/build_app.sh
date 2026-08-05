#!/bin/bash
# GARA VJ スタンドアローンアプリのワンクリックビルド
# 使い方:
#   ./scripts/build_app.sh          # macOS (.app/.dmg) + Windows (.exe) 両方
#   ./scripts/build_app.sh mac      # macOS のみ
#   ./scripts/build_app.sh win      # Windows のみ
# 出力: dist_app/ (GARA-VJ-<ver>.dmg / GARA-VJ-<ver>.exe / mac*/GARA.app)
set -e
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "▶ 初回セットアップ: npm install ..."
  npm install
fi

TARGET="${1:-all}"
case "$TARGET" in
  mac) npx electron-builder --mac ;;
  win) npx electron-builder --win ;;
  *)   npx electron-builder --mac --win ;;
esac

echo "✓ ビルド完了: dist_app/"
ls -lh dist_app/*.dmg dist_app/*.exe 2>/dev/null || true
