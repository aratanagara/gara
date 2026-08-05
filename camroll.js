/* =====================================================================
   camroll.js — モバイル録画保存パッチ
   スマホ (iOS / Android) で Record の録画停止時に、共有シート
   (navigator.share) 経由で「カメラロールに保存」できるようにする。
   - app.js の Record には手を入れず、実行時に Record.start をラップして
     this.mr.onstop をモバイル用ハンドラに差し替える。
   - iOS は navigator.share を「新しいユーザー操作」内で呼ぶ必要があるため、
     録画停止後に保存ボタンを出し、そのタップで share を呼ぶ。
   - PC は従来どおり自動ダウンロード (ラップしてもデスクトップは素通り)。
   - 録画フォーマットは app.js 側で既に mp4(H.264) を優先しているので、
     iOS では mp4 が共有シートからカメラロールに保存できる。
   読み込み: index.html に <script src="camroll.js" defer></script> を追加。
   ===================================================================== */
(function(){
  'use strict';

  function isMobile(){
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod|Android/i.test(ua) ||
           (navigator.maxTouchPoints > 1 && /Mac/.test(ua)); // iPadOS
  }

  function fallbackDownload(blob, fname){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
  }

  function mkBtn(label, accent){
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:13px 18px;font:600 15px Aratana,"Yu Gothic",sans-serif;' +
      'border-radius:8px;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
      (accent
        ? 'background:#3f00ff;color:#fff;border:none'
        : 'background:#161616;color:#bbb;border:1px solid #333');
    return b;
  }

  // 録画停止後に出す保存シート。iOS の share は fresh gesture が要るので
  // ボタンタップで navigator.share を呼ぶ。
  function showSaveSheet(blob, fname, mime){
    var file = null;
    try { file = new File([blob], fname, { type: mime }); } catch(e){ file = null; }
    var canShare = !!(navigator.canShare && file &&
                      navigator.canShare({ files: [file] }));

    var ov = document.createElement('div');
    ov.style.cssText =
      'position:fixed;inset:0;z-index:2147483600;display:flex;' +
      'align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)';

    var box = document.createElement('div');
    box.style.cssText =
      'display:flex;flex-direction:column;gap:12px;align-items:stretch;' +
      'padding:22px;min-width:248px;max-width:86vw;background:#0a0a0a;' +
      'border:1px solid #3f00ff;border-radius:12px;' +
      'font-family:Aratana,"Yu Gothic",sans-serif;color:#fff;' +
      'box-shadow:0 10px 48px rgba(63,0,255,.45)';

    var msg = document.createElement('div');
    msg.textContent = '録画完了 (' + (blob.size / 1048576).toFixed(1) + ' MB)';
    msg.style.cssText = 'font-size:13px;opacity:.85;text-align:center;margin-bottom:2px';
    box.appendChild(msg);

    function close(){ try { document.body.removeChild(ov); } catch(e){} }

    var saveBtn = mkBtn(canShare ? 'カメラロールに保存' : 'ビデオを保存 / 共有', true);
    saveBtn.onclick = function(){
      if(canShare){
        navigator.share({ files: [file], title: 'VJ Recording' })
          .then(close)
          .catch(function(err){
            // ユーザーキャンセルはシートを残す。それ以外は DL にフォールバック
            if(!err || err.name !== 'AbortError'){ fallbackDownload(blob, fname); close(); }
          });
      } else {
        // Web Share 不可: 端末DL + iOS は新規タブで開いて手動保存
        fallbackDownload(blob, fname);
        if(/iPad|iPhone|iPod/.test(navigator.userAgent)){
          var url = URL.createObjectURL(blob);
          setTimeout(function(){ window.open(url, '_blank'); }, 200);
        }
        close();
      }
    };

    var dlBtn = mkBtn('ダウンロード', false);
    dlBtn.onclick = function(){ fallbackDownload(blob, fname); close(); };

    var cancelBtn = mkBtn('閉じる', false);
    cancelBtn.onclick = close;

    box.appendChild(saveBtn);
    box.appendChild(dlBtn);
    box.appendChild(cancelBtn);
    ov.appendChild(box);
    document.body.appendChild(ov);
  }

  function install(){
    if(typeof Record === 'undefined' || !Record || Record.__camrollPatched) return false;
    Record.__camrollPatched = true;
    var origStart = Record.start;
    Record.start = function(){
      origStart.call(this);
      if(!this.mr || !isMobile()) return; // PC は従来どおり (自動ダウンロード)
      // origStart が同期的に立てた onstop をモバイル用に差し替える
      this.mr.onstop = function(){
        var blob = new Blob(Record.chunks, { type: Record.mime });
        var fname = 'vj-' + Date.now() + '.' + Record.ext;
        showSaveSheet(blob, fname, Record.mime);
      };
    };
    if(typeof toast === 'function' && isMobile()){
      toast('カメラロール保存パッチ有効');
    }
    return true;
  }

  // Record (app.js) 定義後に install。読み込み順に依存しないようポーリング。
  if(!install()){
    var n = 0;
    var iv = setInterval(function(){
      if(install() || ++n > 200) clearInterval(iv); // 最大 ~20s
    }, 100);
  }
})();
