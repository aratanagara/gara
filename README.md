# GARA — Fragment Shader VJ Tool

A browser-based VJ system built on fragment shaders. Made in 55 days for a two-night live show in Tokyo. No build, no framework — open it and it's already glowing.

日本語 | [English](#english)

GARAは、フラグメントシェーダを主素材にしたブラウザベースのVJシステムである。2026年、anon press presents「CY」(7月31日–8月1日、北千住BUoY) のために55日——実働18日——で作られ、本番の2日間、計12時間半のライブをこの装置が流した。作ったのは映像制作経験ゼロのエディトリアルデザイナーと、6万行を記憶してくれる相棒 (Claude Code) である。

ブラウザで開けば、そのまま動く。インストールは要らない。開けば、もう光っている。

- デモ: <https://aratanagara.github.io/gara/>
- 開発記: <https://note.com/anon_press/n/n0fede8d38451>

このリポジトリは本番のGARAから映像素材を抜いた骨格で、プリセットは「cloud」がふたつ入っているだけの、ほとんど空の装置である。空であることは欠陥ではない——道具は、空の状態で手渡されたときにいちばんよく育つ。設計図の公開というより、招待状に近い。

## 設計思想

出発点にあった理想はひとつ——**究極的には、シェーダだけで完結するVJソフトにしたい**、である。素材集を再生する装置ではなく、「全ピクセルに配られる一枚の指示書」が毎フレーム画を生む装置。動画エンジンもコラージュエンジンも後から生えた枝であって、幹はあくまでシェーダである。

そのうえで、装置はライブの現場のために設計されている。原則は少ない。

- **賢い自動より、愚直な不動。** 画面は操作した通りにしか動かない。気を利かせて勝手に変わる要素は、現場では事故の種になる。自動はBPM同期とオーディオリアクティブ——明示的にONにしたものだけ。
- **すべての操作は、戻れる。** 色相を回しても焼き込まれない。値を戻せば色は戻る。`Esc` を押せば装置は初期状態に帰る。ライブは失敗するので、失敗から数秒で帰還できることは、どんな機能より重要である。
- **死なない。** 会場のWi-Fiは弱い。ビルドなし・フレームワークなし・依存は同梱。静的ファイルだけで動き、回線が死んでも装置は死なない (全素材同梱のElectron版も `desktop/` に用意してある)。
- **開かれた図書館と地続き。** Shadertoy / GLSL Sandbox互換。図書館で覚えたシェーダは、ほぼそのまま持ち込める。この装置自体も、その図書館の棚に返す一冊である。

## 主な機能

Slot A/B クロスフェード / BPM同期・Tap tempo / Audio reactive / MIDIコントローラ (MIDI learn) / Grad Map (パレットマッピング) / Beat同期ブラシオーバーレイ / プリセット (画面の状態の丸ごと保存——アーティストごとに仕込むテンプレート) / 録画 / 3Dコラージュ・動画ループ・タイポグラフィ系の各エンジン

## 構成

- `app.js` — App / GL / Shader / UI / Recorder などコア
- `presets.js` — ビルトインシェーダプリセット
- `mode/` — 各エンジン (layer / video / photoplane / textdeform / spacetype / cyberui ほか)
- `overlay.js` — Beat同期ブラシオーバーレイ (WARP / RISE / SMEAR / SMUDGE / CURVE / POLYGON / POLLOCK)
- `shaders/` — シェーダ本体 (`.frag`) とJSシェーダエンジン
- `presets/store.php` — プリセット保存用のサーバサイドエンドポイント (任意)

## 実行

静的ファイルを配信するだけで動く。

```bash
python3 -m http.server 8000
```

で `http://localhost:8000/` を開く。

- 画像・動画素材 (`images/`, `movies/`) は含まれていないため、IMAGE / VIDEO / PHOTOPLANE系のモードは素材を置くまで空になる。各フォルダに画像を置き、`manifest.json` (ファイル名のJSON配列) を作れば読み込まれる。
- プリセットのサーバ保存 (`presets/store.php`) はPHPが動くサーバでのみ有効。無くてもlocalStorageで動く。

## セキュリティ上の注意 (フォーク・自分で設置する人へ)

GitHub Pages などの**静的ホスティングに置くだけなら、サーバー側の攻撃面はない**。プリセットはブラウザのlocalStorageに保存され、外には出ない。気を付けるのは `presets/store.php` をPHPサーバーに置く場合だけである。

- `store.php` は**既定では認証なし・CORS全許可**の同期エンドポイントである。自分専用のサーバーで使う前提の設計で、URLを知っている人は誰でも読み書きできる。
- 不特定多数が到達できるサーバーに置くなら、ファイル冒頭の設定を必ず変えること:
  - `$READ_ONLY = true;` — 書き込みを全面拒否 (配布・閲覧用)
  - `$WRITE_TOKEN = '長いランダム文字列';` — 書き込みに `X-Store-Token` ヘッダ (または `?token=`) を必須化
  - あるいはサーバー側でBASIC認証・IP制限をかける
- 扱うファイル名は固定リスト (presets / grads / midimap ほか) に限定してあり、任意のファイルは作れない。1回の保存は16MBまで、履歴は150世代で自動剪定される。
- プリセットには**シェーダのソースコードがそのまま入る**。共有ストアを書き込み可で公開すると、見知らぬ利用者のシェーダを実行することになる。シェーダはGPU上のサンドボックスで動き、ファイルやネットワークには触れないが、重いコードで画面を固まらせることはできる。信頼できない相手と書き込みを共有しない。
- リポジトリに認証情報 (FTPパスワード等) を置かないこと。このリポジトリには含まれていない。
- Electron版の内蔵サーバーは 127.0.0.1 のみにバインドし、Hostヘッダ検証 (DNSリバインディング対策) とパストラバーサル拒否を入れてある。

## ライセンス

- 独自コード: **MIT** ([LICENSE](LICENSE))。著作権表示さえ残せば、改変も再配布も自由である。
- 同梱の第三者コード——特にShadertoy移植シェーダの多くは **CC BY-NC-SA 3.0** (非営利・継承): [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。開かれた図書館で覚えた頁は、図書館の判のまま貸すのが筋だろう。

リポジトリ全体をそのまま商用利用することはできない (CC BY-NC-SA部分を除去すればMIT部分は自由に使える)。

---

## English

GARA is a browser-based VJ system built on fragment shaders. It was made in 55 days — 18 of them actual working days — for anon press presents "CY" (July 31–August 1, 2026, BUoY, Tokyo), and ran the show for two nights, twelve and a half hours in total. It was built by an editorial designer with zero video-production experience, together with a partner who could hold sixty thousand lines in memory (Claude Code).

Open it in a browser and it just runs. No install. Open it, and it is already glowing.

- Demo: <https://aratanagara.github.io/gara/>
- Development notes (Japanese): <https://note.com/anon_press/n/n0fede8d38451>

This repository is the skeleton of the production GARA with the footage stripped out; it ships with exactly two presets, both named "cloud" — an almost empty instrument. Emptiness is not a defect here. A tool grows best when it is handed over blank. Think of this less as published blueprints, more as an invitation.

### Design principles

There was one ideal at the origin: **ultimately, a VJ tool complete with shaders alone.** Not an instrument that plays back a library of footage, but one where "a single instruction sheet handed to every pixel" generates the picture every frame. The video and collage engines are branches that grew later; the trunk is, and remains, the shader.

On top of that, the instrument is designed for the live floor. The principles are few.

- **Dumb stillness over clever automation.** The screen moves only as operated. Anything that helpfully changes on its own is an accident waiting to happen on stage. The only automation is BPM sync and audio reactivity — and only when explicitly switched on.
- **Every operation can be undone.** Rotating the hue burns nothing in; return the knob and the color returns. Press `Esc` and the instrument goes home. Live sets fail — being able to recover from a failure in seconds matters more than any feature.
- **It must not die.** Venue Wi-Fi is weak. No build step, no framework, dependencies bundled: it runs on static files alone, and keeps running when the network dies (an Electron build with everything bundled lives in `desktop/`).
- **Contiguous with the open library.** Shadertoy / GLSL Sandbox compatible: shaders you learned in the library carry over almost as-is. This instrument itself is one more book returned to that library's shelf.

### Features

Slot A/B crossfade / BPM sync & tap tempo / audio reactive / MIDI controllers (MIDI learn) / Grad Map (palette mapping) / beat-synced brush overlay / presets (whole-state snapshots — templates prepared per artist) / recording / engines for 3D collage, video loops and typography

### Running

Serve the static files, that's all:

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000/`.

- Image and video assets (`images/`, `movies/`) are not included, so the IMAGE / VIDEO / PHOTOPLANE modes stay empty until you add your own material (drop files into the folders and write a `manifest.json` — a JSON array of filenames).
- Server-side preset storage (`presets/store.php`) works only on a PHP-capable server; without it, presets persist in localStorage.

### Security notes (for forks and self-hosting)

If you only deploy to static hosting (e.g. GitHub Pages), there is **no server-side attack surface**: presets live in the browser's localStorage and never leave it. The only thing to be careful with is `presets/store.php`, if you put it on a PHP server.

- `store.php` is an **unauthenticated, CORS-open** sync endpoint by default — designed for a personal server. Anyone who knows the URL can read and write.
- If it will be reachable by strangers, change the settings at the top of the file:
  - `$READ_ONLY = true;` — reject all writes (for distribution / read-only stores)
  - `$WRITE_TOKEN = 'a-long-random-string';` — require an `X-Store-Token` header (or `?token=`) for writes
  - or protect it with BASIC auth / IP restrictions at the server level
- Store names are restricted to a fixed allowlist (presets / grads / midimap …), so arbitrary files cannot be created. Each save is capped at 16 MB and history is pruned at 150 generations.
- Presets embed **full shader source code**. If you run a world-writable shared store, you are executing strangers' shaders. Shaders run sandboxed on the GPU — they cannot touch files or the network — but heavy code can freeze the screen. Don't share write access with people you don't trust.
- Never commit credentials (FTP passwords etc.) to your fork; this repository ships none.
- The Electron build's internal server binds to 127.0.0.1 only, validates the Host header (anti DNS-rebinding), and rejects path traversal.

### License

- Original code: **MIT** ([LICENSE](LICENSE)). Keep the copyright notice and you are free to modify and redistribute.
- Bundled third-party code — notably, most of the shaders ported from Shadertoy are **CC BY-NC-SA 3.0** (non-commercial, share-alike): see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Pages learned in an open library should be lent out under the library's own stamp.

The repository as a whole cannot be used commercially as-is (remove the CC BY-NC-SA parts and the MIT parts are yours to use freely).
