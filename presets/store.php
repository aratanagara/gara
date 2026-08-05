<?php
// GARA store — <name>.json の取得(GET)/保存(POST)。?name=presets(既定) | grads など。
//   個人用 VJ ツール。認証なし。
//   誤上書き対策:
//     - <name>.json.bak      : 直前1世代 (従来どおり)
//     - history/<name>-<ts>.json : 保存のたびに世代スナップショット (thumb を除いた軽量版)
//   API:
//     GET  ?name=presets                 → 現在の JSON
//     GET  ?name=presets&history=1       → 履歴一覧 [{file,time,count,bytes}] (新しい順)
//     GET  ?name=presets&restore=<file>  → その世代の JSON (thumb は含まれない)
//     POST ?name=presets                 → 保存 + 世代スナップショット
// ── 公開サーバーに置く場合の設定 ────────────────────────────────
//   $READ_ONLY   = true  にすると書き込み(POST)を全面拒否する (配布用ストア向け)
//   $WRITE_TOKEN = '長いランダム文字列' を設定すると、POST に
//                  ヘッダ X-Store-Token: <値> か ?token=<値> が必須になる。
//   どちらも既定は「認証なしで読み書き可」= 自分専用サーバーに置く前提。
//   不特定多数がアクセスできる場所に置くなら、必ずどちらかを設定すること。
$READ_ONLY   = false;
$WRITE_TOKEN = '';
// ────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
// ローカル(別オリジン/file://)からも同期できるよう CORS 許可。個人用・認証なしの前提。
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Store-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$name = isset($_GET['name']) ? preg_replace('/[^a-z0-9_]/', '', $_GET['name']) : 'presets';
if ($name === '') { $name = 'presets'; }
// 任意の名前でファイルを作られないよう、扱うストア名は固定リストに限定する
$ALLOWED_NAMES = ['presets', 'grads', 'midimap', 'defs', 'modegifs', 'visualnames', 'presetombstones'];
if (!in_array($name, $ALLOWED_NAMES, true)) {
  http_response_code(400); echo '{"error":"unknown store name"}'; exit;
}
$file = __DIR__ . '/' . $name . '.json';
$histDir = __DIR__ . '/history';
$method = $_SERVER['REQUEST_METHOD'];

$HIST_KEEP = 150;   // 残す世代数 (thumb 除去済みなので 1 世代 1MB 未満)

// thumb (base64 GIF) はデータの ~88% を占めるうえ復元後に再生成できるので履歴からは落とす
function strip_thumbs($data) {
  if (!is_array($data)) { return $data; }
  foreach ($data as $i => $p) {
    if (is_array($p)) { unset($p['thumb']); $data[$i] = $p; }
  }
  return $data;
}

if ($method === 'GET') {
  // 履歴一覧
  if (isset($_GET['history'])) {
    $out = [];
    if (is_dir($histDir)) {
      foreach (glob($histDir . '/' . $name . '-*.json') as $f) {
        $b = @file_get_contents($f);
        $d = $b === false ? null : json_decode($b, true);
        $out[] = [
          'file'  => basename($f),
          'time'  => preg_replace('/^' . preg_quote($name, '/') . '-|\.json$/', '', basename($f)),
          'count' => is_array($d) ? count($d) : 0,
          'bytes' => $b === false ? 0 : strlen($b),
        ];
      }
    }
    usort($out, function ($a, $b) { return strcmp($b['time'], $a['time']); });   // 新しい順
    echo json_encode($out);
    exit;
  }
  // 特定世代の取り出し
  if (isset($_GET['restore'])) {
    $f = basename($_GET['restore']);                                  // ディレクトリトラバーサル防止
    if (!preg_match('/^[a-z0-9_]+-[0-9TZ\-]+\.json$/', $f)) { http_response_code(400); echo '{"error":"bad name"}'; exit; }
    $path = $histDir . '/' . $f;
    if (!is_file($path)) { http_response_code(404); echo '{"error":"not found"}'; exit; }
    readfile($path);
    exit;
  }
  if (is_file($file)) { readfile($file); }
  else { echo '[]'; }
  exit;
}

if ($method === 'POST') {
  if ($READ_ONLY) {
    http_response_code(403); echo '{"error":"read-only store"}'; exit;
  }
  if ($WRITE_TOKEN !== '') {
    $tok = isset($_SERVER['HTTP_X_STORE_TOKEN']) ? $_SERVER['HTTP_X_STORE_TOKEN']
         : (isset($_GET['token']) ? $_GET['token'] : '');
    if (!hash_equals($WRITE_TOKEN, (string)$tok)) {
      http_response_code(403); echo '{"error":"invalid token"}'; exit;
    }
  }
  $body = file_get_contents('php://input');
  if (strlen($body) > 16 * 1024 * 1024) {           // 16MB 上限(暴走対策)
    http_response_code(413); echo '{"error":"too large"}'; exit;
  }
  $data = json_decode($body, true);
  if (!is_array($data)) {                            // プリセット配列のみ受理
    http_response_code(400); echo '{"error":"invalid"}'; exit;
  }
  // 事故防止: 既存より大幅に件数が減る保存は拒否する (古い状態の端末による全消しを防ぐ)。
  //   意図的に減らす場合は ?force=1 を付ける。
  if (is_file($file) && !isset($_GET['force'])) {
    $prev = json_decode(@file_get_contents($file), true);
    if (is_array($prev) && count($prev) >= 5 && count($data) < count($prev) - 2) {
      http_response_code(409);
      echo json_encode(['error' => 'shrink guard', 'prev' => count($prev), 'next' => count($data)]);
      exit;
    }
  }

  if (is_file($file)) {
    @copy($file, $file . '.bak');                    // 1世代バックアップ (従来どおり)
    // 世代スナップショット: 書き込み前の内容を thumb 抜きで保存 (中身が同じならスキップ)
    if (!is_dir($histDir)) { @mkdir($histDir, 0755, true); }
    if (is_dir($histDir)) {
      $prevRaw = @file_get_contents($file);
      $prev = $prevRaw === false ? null : json_decode($prevRaw, true);
      if (is_array($prev)) {
        $snap = json_encode(strip_thumbs($prev));
        $list = glob($histDir . '/' . $name . '-*.json');
        sort($list);
        $lastFile = count($list) ? end($list) : null;
        $lastRaw = $lastFile ? @file_get_contents($lastFile) : null;
        if ($snap !== false && $snap !== $lastRaw) {                 // 直前世代と同一なら残さない
          @file_put_contents($histDir . '/' . $name . '-' . gmdate('Ymd-His') . 'Z.json', $snap, LOCK_EX);
          // 古い世代を剪定
          $list = glob($histDir . '/' . $name . '-*.json');
          sort($list);
          $over = count($list) - $HIST_KEEP;
          for ($i = 0; $i < $over; $i++) { @unlink($list[$i]); }
        }
      }
    }
  }

  $ok = @file_put_contents($file, $body, LOCK_EX);
  if ($ok === false) { http_response_code(500); echo '{"error":"write failed"}'; exit; }
  echo '{"ok":true,"count":' . count($data) . '}';
  exit;
}

http_response_code(405);
echo '{"error":"method not allowed"}';
