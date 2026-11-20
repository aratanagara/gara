<?php
// GARA tool exporter — /vj/ 一式を ZIP でダウンロードする裏エンドポイント。
//   既定: movies/ images/ を除いたコード一式 (軽量)。
//   ?all=1: 動画・画像も含む全ファイル (大容量)。
// 個人用・認証なし前提。ドットファイル (.htaccess / .user.ini / .claude など) と *.bak は含めない。
header('Cache-Control: no-store');
register_shutdown_function(function () {           // 致命的エラー (メモリ・時間切れなど) を文字で返す
  $e = error_get_last();
  if ($e && in_array($e['type'], array(E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR), true) && !headers_sent()) {
    header('Content-Type: text/plain; charset=utf-8');
    echo 'export failed: ' . $e['message'];
  }
});

if (!class_exists('ZipArchive')) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'ZipArchive not available on this server.';
  exit;
}
@set_time_limit(600);
@ini_set('memory_limit', '512M');

$all  = isset($_GET['all']) && $_GET['all'] !== '0';
$root = realpath(__DIR__);
$name = 'gara_' . date('YmdHis') . ($all ? '_full' : '') . '.zip';

// 既定で除外するトップレベル (重いメディアはサーバー専用・別バックアップ対象)
$skipTop = $all ? array() : array('movies', 'images');

$skipped = array(); $batch = array(); $fail = null; $bytes = 0;
$tmp = tempnam(sys_get_temp_dir(), 'garazip');
if ($tmp !== false) @unlink($tmp);                       // 空のファイルが残っていると libzip が開けないことがあるので消してから作る
$zip = new ZipArchive();
if ($tmp === false || $zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Failed to create zip.';
  exit;
}

$it = new RecursiveIteratorIterator(
  new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
  RecursiveIteratorIterator::SELF_FIRST
);
foreach ($it as $f) {
  if (!$f->isFile()) continue;
  $path = $f->getPathname();
  $rel  = ltrim(str_replace('\\', '/', substr($path, strlen($root))), '/');
  if ($rel === '') continue;
  $parts = explode('/', $rel);
  if (in_array($parts[0], $skipTop, true)) continue;      // 重いメディアを除外
  $dot = false;
  foreach ($parts as $seg) { if ($seg !== '' && $seg[0] === '.') { $dot = true; break; } }
  if ($dot) continue;                                     // ドットファイル / ドットフォルダ (.git / .claude / .htaccess など)
  if (preg_match('/\.bak$/i', $rel)) continue;           // サーバー上の退避ファイル
  if (preg_match('/\.zip$/i', $rel)) continue;            // 既存zipは含めない
  if (!is_readable($path) || preg_match('/\.lftp_tmp$/', $rel)) { $skipped[] = $rel; continue; }   // 読めないもの・転送中の一時ファイル
  // libzip に元ファイルを読ませると、このサーバーでは stat の長さと読める長さが食い違って close が失敗する。
  // 中身をここで読んで渡す。メモリ上限 (300MB) に収まるよう、約 24MB ごとに書き出して開き直す
  $len = @filesize($path);
  if ($len === false || $len > 64 * 1024 * 1024) { $skipped[] = $rel; continue; }   // 64MB を超えるものは入れない (メモリに載らない)
  if ($bytes + $len > 24 * 1024 * 1024 && $batch) {
    if (!$zip->close()) { $fail = $batch; break; }
    $zip = new ZipArchive(); $zip->open($tmp); $batch = array(); $bytes = 0;
  }
  $data = @file_get_contents($path);
  if ($data === false) { $skipped[] = $rel; continue; }
  $zip->addFromString($rel, $data);
  unset($data);
  $batch[] = $rel; $bytes += $len;
}
$st = $zip->getStatusString();
if ($fail !== null || !$zip->close()) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Failed to write zip: ' . $zip->getStatusString() . ' (before close: ' . $st . ', files: ' . $zip->numFiles . ', tmp dir writable: ' . (is_writable(dirname($tmp)) ? 'yes' : 'no') . ")\n" . implode("\n", $fail !== null ? $fail : $batch);
  @unlink($tmp);
  exit;
}
clearstatcache(true, $tmp);

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Content-Length: ' . filesize($tmp));
readfile($tmp);
@unlink($tmp);
