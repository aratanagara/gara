#!/bin/bash
# movies/ の動画を H.264 CRF20 で圧縮(画質はほぼ維持したままサイズ削減)。
#   - オリジナルは movies/_src/ に保管(本番アップロード対象外 = deploy.sh で _src/ を除外)
#   - 一度処理した動画(同名が _src にある)は再処理しない(冪等)
#   - 圧縮で逆に大きくなる動画(既に低ビットレート)は原本をそのまま配信
#   - 出力は H.264 / yuv420p / faststart の mp4(全ブラウザで再生可)
# 使い方: ./scripts/compress-videos.sh   (deploy.sh からも自動で呼ばれる)
set -e
cd "$(dirname "$0")/.."
SRC_DIR="movies/_src"
CRF=20
mkdir -p "$SRC_DIR"

shopt -s nullglob
count=0; before=0; after=0
for f in movies/*.mp4 movies/*.webm movies/*.mov movies/*.m4v movies/*.ogv; do
  base="$(basename "$f")"
  stem="${base%.*}"
  # 原本が既に _src にあれば処理済み → スキップ(冪等)。パターン全体をクォートし glob 先行展開を防ぐ
  if compgen -G "$SRC_DIR/$stem.*" >/dev/null; then continue; fi
  bsz=$(stat -f%z "$f")
  echo "▶ 処理: $base ($(ls -lh "$f" | awk '{print $5}'))"
  mv "$f" "$SRC_DIR/$base"                       # 原本を _src へ(常に保管)
  out="movies/$stem.mp4"
  if ffmpeg -y -i "$SRC_DIR/$base" -c:v libx264 -crf $CRF -preset slow \
       -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k "$out.tmp.mp4" >/dev/null 2>&1; then
    asz=$(stat -f%z "$out.tmp.mp4")
    if [ "$asz" -lt "$bsz" ]; then
      mv "$out.tmp.mp4" "$out"                    # 圧縮版を採用
      echo "  OK $((bsz/1048576))M -> $((asz/1048576))M"
      count=$((count+1)); before=$((before+bsz)); after=$((after+asz))
    else
      rm -f "$out.tmp.mp4"                        # 圧縮で増える動画は原本をそのまま配信
      cp "$SRC_DIR/$base" "$out"
      echo "  = 圧縮効果なし($((bsz/1048576))M) 原本を使用"
      count=$((count+1)); before=$((before+bsz)); after=$((after+bsz))
    fi
  else
    echo "  NG 圧縮失敗 — 原本を復元"
    mv "$SRC_DIR/$base" "$f"
  fi
done
if [ "$count" -gt 0 ]; then
  echo "完了: $count 本  (合計 $((before/1048576))M -> $((after/1048576))M)"
else
  echo "処理対象なし(全て処理済み)"
fi
