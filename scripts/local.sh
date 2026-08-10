#!/bin/bash
# ローカル起動: この場で http サーバを立てて Chrome のアプリウィンドウで開く。
#   ./scripts/local.sh          → http://localhost:8123
#   ./scripts/local.sh 9000     → ポート指定
# サーバはデスクトップ版と同じ desktop/server.js (静的配信 + /__media 素材取り込み)。
# ネット不要(オフライン可)。プリセット同期(store.php)はオンライン時のみ本番へ保存され、
# オフライン時は localStorage キャッシュで動作します。
set -e
cd "$(dirname "$0")/.."
PORT="${1:-8123}"

# 既に同ポートで立っていれば再利用
if ! lsof -i ":$PORT" >/dev/null 2>&1; then
  (node desktop/server.js "$PORT" >/dev/null 2>&1 &)
  sleep 0.5
fi

open -na "Google Chrome" --args --app="http://localhost:$PORT/"
echo "GARA local: http://localhost:$PORT/"
