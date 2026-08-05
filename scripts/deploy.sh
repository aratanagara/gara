#!/bin/bash
# Lolipop FTP デプロイ: ローカル → ftp.lolipop.jp:/vj/
# 使い方: ./scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."
source .ftpconfig

# 各メディアフォルダの manifest.json を最新に再生成 (file:// やローカルサーバ用)
# サーバ側は index.php (PHP) でも自動列挙できるが、両方備える
regen_manifest(){
  local dir="$1"
  local pattern="$2"
  if [ -d "$LOCAL_DIR/$dir" ]; then
    (cd "$LOCAL_DIR/$dir" && \
     ls -1 | grep -iE "$pattern" | \
     python3 -c "import sys,json; print(json.dumps(sorted([l.strip() for l in sys.stdin])))" \
     > manifest.json)
    echo "  · $dir/manifest.json regenerated"
  fi
}
echo "▶ Compressing new videos (原本は movies/_src/ に保管)..."
bash "$(dirname "$0")/compress-videos.sh"

echo "▶ Regenerating manifests..."
# shaders/manifest.json: bg_*.frag を自動登録 (新規シェーダの手動登録漏れ防止)。
#   既存エントリの名前・順序は保持し、新規ファイルだけ末尾に追加 / 消えたファイルは除去。
python3 - <<'PYMANIFEST'
import json, os, re
d = 'shaders'
mpath = os.path.join(d, 'manifest.json')
try:
    m = json.load(open(mpath))
except Exception:
    raise SystemExit(0)
changed = False
for g in m.get('groups', []):
    if g.get('type') != 'perBg':
        continue
    bgs = g.get('bgs', [])
    known = {b.get('file') for b in bgs} | set(g.get('exclude', []))   # exclude = エンジン用シェーダ (プリセット化しない)
    disk = sorted(f for f in os.listdir(d) if re.match(r'^bg_.*\.frag$', f))
    for f in disk:
        if f in known:
            continue
        src = open(os.path.join(d, f), encoding='utf-8', errors='replace').read()
        fn = re.search(r'vec3\s+(bg_\w+)\s*\(\s*vec2', src)
        if not fn:
            print(f'  ! shaders/{f}: vec3 bg_*(vec2) が見つからないためスキップ')
            continue
        name = re.sub(r'^bg_', '', os.path.splitext(f)[0])
        name = ' '.join(w.capitalize() for w in name.split('_'))
        bgs.append({'file': f, 'func': fn.group(1), 'name': name})
        print(f'  + shaders/manifest.json ← {f} (name: {name})')
        changed = True
    kept = [b for b in bgs if os.path.exists(os.path.join(d, b.get('file','')))]
    if len(kept) != len(bgs):
        for b in bgs:
            if b not in kept:
                print(f"  - shaders/manifest.json → {b.get('file')} (ファイル消失)")
        g['bgs'] = kept
        changed = True
    else:
        g['bgs'] = bgs
if changed:
    json.dump(m, open(mpath, 'w'), ensure_ascii=False, indent=1)
    open(mpath, 'a').write('\n')
    print('  · shaders/manifest.json updated')
PYMANIFEST
regen_manifest "movies"       '\.(mp4|webm|mov|m4v|ogv)$'
# images/: サブフォルダを自動発見して、各フォルダの manifest.json と images/folders.json
# (IMAGE モードのフォルダ一覧) を再生成する。フォルダを作って画像を置くだけで登録される。
#   除外: etc (CYBER UI が直接参照する UI 素材。スライドショー用フォルダではない)
python3 - <<'PYIMAGES'
import json, os, re
base = 'images'
EXCLUDE = {'etc'}
IMG = re.compile(r'\.(png|jpe?g|webp|gif|bmp)$', re.I)
folders = []
for name in sorted(os.listdir(base)):
    d = os.path.join(base, name)
    if not os.path.isdir(d) or name.startswith(('_', '.')) or name in EXCLUDE:
        continue
    imgs = sorted(f for f in os.listdir(d) if IMG.search(f))
    if not imgs:
        continue
    json.dump(imgs, open(os.path.join(d, 'manifest.json'), 'w'))
    print(f'  · {d}/manifest.json regenerated ({len(imgs)})')
    folders.append({'name': name, 'dir': f'{base}/{name}', 'count': len(imgs), 'images': imgs})
# images/ 直下の画像: manifest (Layer のフォールバック) + フォルダ一覧の先頭に「(直下)」として登録
root_imgs = sorted(f for f in os.listdir(base) if os.path.isfile(os.path.join(base, f)) and IMG.search(f))
json.dump(root_imgs, open(os.path.join(base, 'manifest.json'), 'w'))
print(f'  · images/manifest.json regenerated ({len(root_imgs)})')
# 直下の画像は 1 枚ずつ個別エントリ (single) として一覧の先頭に並べる
for f in reversed(root_imgs):
    folders.insert(0, {'name': os.path.splitext(f)[0], 'dir': f'{base}/{f}', 'single': True, 'count': 1, 'images': [f]})
json.dump(folders, open(os.path.join(base, 'folders.json'), 'w'), indent=1)
print(f'  · images/folders.json regenerated ({len(folders)} folders)')
PYIMAGES

# ローカル JS/CSS にキャッシュバスティング用のバージョンクエリを付与 (ブラウザの古いキャッシュ対策)
VER=$(date +%s)
echo "▶ Stamping cache-busting version ?v=$VER on local assets..."
# ファイル名を列挙せず、ローカル参照の js/css を総なめでスタンプする。
#   (列挙方式だと mode を追加するたび入れ忘れが起き、デプロイしても古い JS が配信され続ける。
#    実際 ugomeki.js / spacetype.js が漏れていた)
#   絶対URL(https://cdn... )は "//" や ":" を含むため下記パターンに一致せず、CDN は対象外のまま。
sed -i '' -E "s#\"(([a-z0-9_]+/)?[a-z0-9_.-]+\.(js|css))(\?v=[0-9]+)?\"#\"\1?v=$VER\"#g" "$LOCAL_DIR/index.html"

# グラデパレット(サーバ grads.json)を毎デプロイでバックアップ(誤上書き・消失対策)。
# 本番サーバから取得し、前回と同じ内容ならスキップ。grad_backups/ はミラー除外でローカル保管。
echo "▶ Backing up grad palette (server grads.json)..."
mkdir -p "$LOCAL_DIR/grad_backups"
GRAD_BK="$LOCAL_DIR/grad_backups/grads_$(date +%Y%m%d%H%M).json"
if curl -fsS -m 20 "https://vj.aratanagara.com/presets/store.php?name=grads" -o "$GRAD_BK" && [ "$(wc -c < "$GRAD_BK")" -gt 5 ]; then
  LATEST=$(ls -1t "$LOCAL_DIR/grad_backups"/grads_*.json 2>/dev/null | grep -v "/$(basename "$GRAD_BK")\$" | head -1)
  if [ -n "$LATEST" ] && cmp -s "$GRAD_BK" "$LATEST"; then
    rm -f "$GRAD_BK"; echo "  · unchanged since $(basename "$LATEST") — skip"
  else
    echo "  · saved grad_backups/$(basename "$GRAD_BK") ($(wc -c < "$GRAD_BK") bytes)"
  fi
else
  rm -f "$GRAD_BK"; echo "  · skipped (fetch failed or empty)"
fi

echo "▶ Mirroring $LOCAL_DIR  →  ftp://$FTP_HOST$FTP_REMOTE_DIR/ ..."
lftp -u "$FTP_USER,$FTP_PASS" "$FTP_HOST" <<EOF
set ftp:ssl-allow yes
set ssl:verify-certificate no
set mirror:parallel-transfer-count 4
# 一時ファイルへ転送→完了後にリネーム (デプロイ中にアクセスした人へ
# 書きかけの JS が配信されて SyntaxError になるのを防ぐ)
set xfer:use-temp-file yes
set xfer:temp-file-name *.lftp_tmp
mirror -R --delete --verbose=1 \
  --exclude-glob .git/ \
  --exclude-glob .git* \
  --exclude-glob .claude/ \
  --exclude-glob .firecrawl/ \
  --exclude-glob .DS_Store \
  --exclude-glob '*.zip' \
  --exclude-glob .ftpconfig \
  --exclude-glob CLAUDE.md \
  --exclude-glob scripts/ \
  --exclude-glob node_modules/ \
  --exclude-glob desktop/ \
  --exclude-glob dist_app/ \
  --exclude-glob package.json \
  --exclude-glob package-lock.json \
  --exclude-glob _src/ \
  --exclude-glob grad_backups/ \
  --exclude-glob 'presets/*.json' \
  --exclude-glob 'presets/*.bak' \
  --exclude-glob 'presets/history/' \
  --exclude 'presets/history/' \
  "$LOCAL_DIR/" "$FTP_REMOTE_DIR/"
bye
EOF
echo "✓ Deploy complete: https://vj.aratanagara.com/"
