#!/bin/bash
# 本番サーバーの presets / grads をローカル presets/ にバックアップする。
# git の pre-commit フックから呼ばれ、サーバー保存データ(localStorage 非依存)を
# git 履歴に残す。サーバーが飛んでも復元できるようにする保険。
cd "$(dirname "$0")/.."
BASE="https://vj.aratanagara.com/presets/store.php"
echo "▶ Backing up server presets/grads → presets/ ..."
for name in presets grads; do
  out="presets/$name.json"
  if curl -fsS --max-time 15 "$BASE?name=$name" -o "$out.tmp" 2>/dev/null && [ -s "$out.tmp" ]; then
    mv "$out.tmp" "$out"
    echo "  · $name.json ($(wc -c < "$out" | tr -d ' ') bytes)"
  else
    rm -f "$out.tmp"
    echo "  · $name.json: 取得スキップ (サーバー未到達 or 空)"
  fi
done
