// GARA UI translations. Plain keys are Japanese source strings; html.* contains trusted static help.
// Never pass user content through translation or HTML bindings.
(function () {
  const pairs = {
  "Tone の現在値を既定値として保存": ["Tone の現在値を既定値として保存", "Save current Tone settings as defaults"],
  "保存した Tone の既定値へ戻す (保存が無ければ初期値)": ["保存した Tone の既定値へ戻す (保存が無ければ初期値)", "Restore saved Tone defaults, or original values"],
  "Tone の量・種類・詳細をランダムに変える (色は保持)": ["Tone の量・種類・詳細をランダムに変える (色は保持)", "Randomize Tone amount, type and details; keep ink and paper colors"],
  "ディザ・網点・線の種類。Blue Noise と Error Diffusion はテクスチャ不要の近似": ["ディザ・網点・線の種類。Blue Noise と Error Diffusion はテクスチャ不要の近似", "Dither and screen patterns. Blue Noise and Error Diffusion are texture-free approximations."],
  "輝度をディザやトーンに変える量。0 = OFF。Audio のあと、Color の前に適用": ["輝度をディザやトーンに変える量。0 = OFF。Audio のあと、Color の前に適用", "Convert luminance to dither or screen tones. 0 = Off. Applied after Audio and before Color."],
  "模様のセルサイズ (描画解像度の px)。ディザは 1 ドット、網点・線は 1 周期の大きさ": ["模様のセルサイズ (描画解像度の px)。ディザは 1 ドット、網点・線は 1 周期の大きさ", "Pattern cell size in render pixels: one dither dot or one screen period."],
  "格子・網点・線の角度 (度)。同心円には影響しない": ["格子・網点・線の角度 (度)。同心円には影響しない", "Grid, dot and line angle in degrees. Does not affect concentric rings."],
  "しきい値の偏り。0 = 中立、正 = 暗く、負 = 明るく": ["しきい値の偏り。0 = 中立、正 = 暗く、負 = 明るく", "Threshold bias: 0 = neutral, positive = darker, negative = lighter."],
  "量子化前の輝度コントラスト。0 = 等倍、両端で 1/16〜16 倍": ["量子化前の輝度コントラスト。0 = 等倍、両端で 1/16〜16 倍", "Luminance contrast before quantization: 0 = unchanged; endpoints = 1/16× and 16×."],
  "Ink と Paper の間の階調数。2 = 2 色、増やすと中間の階調も使う": ["Ink と Paper の間の階調数。2 = 2 色、増やすと中間の階調も使う", "Levels between Ink and Paper. 2 = two colors; higher values add intermediate shades."],
  "トーンのインク色": ["トーンのインク色", "Tone ink color"],
  "トーンの紙色": ["トーンの紙色", "Tone paper color"],
  "0 = Ink/Paper の色。1 = 元の色を紙にして Ink を重ねる": ["0 = Ink/Paper の色。1 = 元の色を紙にして Ink を重ねる", "0 = Ink/Paper colors. 1 = use original colors as paper and overlay Ink."],
  "tone.help": ["Tone は Audio のあとに適用。通常の Grad Map で再彩色できます。A BG = None / @gradmask の Grad Map は合成段のままです。", "Tone follows Audio and can be recolored with normal Grad Map. With A BG = None or @gradmask, Grad Map remains in the composite stage."],
  "高さ": ["高さ", "Height"],
  "分け方": ["分け方", "Partition"],
  "凹凸": ["凹凸", "Relief"],
  "形": ["形", "Shape"],
  "複製・場": ["複製・場", "Copies / Field"],
  "Stack": ["Stack", "Stack"],
  "Build": ["Build", "Build"],
  "Chain": ["Chain", "Chain"],
  "組み立て": ["組み立て", "Build"],
  "絵の連鎖": ["絵の連鎖", "Chain"],
  "重ね方。Build = 高さ・分け方・形を組み立てる / Chain = 前の段の絵を次の段に貼る (従来の見え方)": ["重ね方。Build = 高さ・分け方・形を組み立てる / Chain = 前の段の絵を次の段に貼る (従来の見え方)", "Stack mode. Build combines height, partitions and shape; Chain maps each rendered image onto the next effect (legacy appearance)."],
  "画像フォルダを構成主義の配置で組む。取り込み済み・臨時ドロップのフォルダも選べます。": ["画像フォルダを構成主義の配置で組む。取り込み済み・臨時ドロップのフォルダも選べます。", "Arrange a folder of images in constructivist compositions, including imported and temporary dropped folders."],
  "FUDE と共有する構成: Axis / Hero / Grid / Frame / Diagonal / Stairs / Cross / Radial。": ["FUDE と共有する構成: Axis / Hero / Grid / Frame / Diagonal / Stairs / Cross / Radial。", "Shared FUDE compositions: Axis / Hero / Grid / Frame / Diagonal / Stairs / Cross / Radial."],
  "Flat は画面に平らに、Iso は床と左右の壁に画像を貼ります。": ["Flat は画面に平らに、Iso は床と左右の壁に画像を貼ります。", "Flat places images on the screen. Iso places them on the floor and the two walls."],
  "1 枚を置く拍数。Redraw は構図全体の切替間隔。Drone も BPM に合わせて進みます。": ["1 枚を置く拍数。Redraw は構図全体の切替間隔。Drone も BPM に合わせて進みます。", "Beats per image, or per full arrangement in Redraw. Drone also advances at the current BPM."],
  "全部を置いたあと、次の構図まで保持する拍数。": ["全部を置いたあと、次の構図まで保持する拍数。", "Beats to hold the completed arrangement before composing the next one."],
  "Auto で構成プリセットを切り替える拍数。画像フォルダは変えません。": ["Auto で構成プリセットを切り替える拍数。画像フォルダは変えません。", "Beats between automatic composition presets. Keeps the selected image folder."],
  "Crop は切り抜き、Contain は縦横比を保って全体表示、Stretch は枠に合わせて伸縮。": ["Crop は切り抜き、Contain は縦横比を保って全体表示、Stretch は枠に合わせて伸縮。", "Crop fills the frame, Contain shows the whole image with its aspect ratio, Stretch fills by resizing."],
  "余白の紙を表示。Off では画像の外側と透明な画素を透過します。": ["余白の紙を表示。Off では画像の外側と透明な画素を透過します。", "Show paper behind images and margins. Off keeps margins and transparent image pixels clear."],
  "画像を読み込み中…": ["画像を読み込み中…", "Loading images…"],

  "Columns": ["Columns", "Columns"],
  "格子の列数 (1〜16)。Tile は格子全体の繰り返し倍率": ["格子の列数 (1〜16)。Tile は格子全体の繰り返し倍率", "Number of grid columns (1–16). Tile repeats the entire grid."],
  "Rows": ["Rows", "Rows"],
  "格子の行数 (1〜16)。Tile は格子全体の繰り返し倍率": ["格子の行数 (1〜16)。Tile は格子全体の繰り返し倍率", "Number of grid rows (1–16). Tile repeats the entire grid."],
  "Gap X": ["Gap X", "Gap X"],
  "横の間隔 (画面幅の %)。隙間は透明。セル幅以上で非表示": ["横の間隔 (画面幅の %)。隙間は透明。セル幅以上で非表示", "Horizontal gap (% of screen width). Transparent; hides cells when at least as wide as a cell."],
  "Gap Y": ["Gap Y", "Gap Y"],
  "縦の間隔 (画面高さの %)。隙間は透明。セル高さ以上で非表示": ["縦の間隔 (画面高さの %)。隙間は透明。セル高さ以上で非表示", "Vertical gap (% of screen height). Transparent; hides cells when at least as tall as a cell."],
  "Offset X": ["Offset X", "Offset X"],
  "格子全体の横位置 (画面幅の %、正で右へ、繰り返し)": ["格子全体の横位置 (画面幅の %、正で右へ、繰り返し)", "Horizontal grid offset (% of screen width). Positive moves right; wraps."],
  "Offset Y": ["Offset Y", "Offset Y"],
  "格子全体の縦位置 (画面高さの %、正で上へ、繰り返し)": ["格子全体の縦位置 (画面高さの %、正で上へ、繰り返し)", "Vertical grid offset (% of screen height). Positive moves up; wraps."],
  "Cell Size": ["Cell Size", "Cell Size"],
  "1 枚の大きさ (%)。100 を超える部分はセル枠で切り取る": ["1 枚の大きさ (%)。100 を超える部分はセル枠で切り取る", "Individual cell size (%). Enlargement beyond 100% is clipped to the cell frame."],
  "Row Shift": ["Row Shift", "Row Shift"],
  "奇数行の横ずらし (セル幅の %)。レンガ積み": ["奇数行の横ずらし (セル幅の %)。レンガ積み", "Horizontal stagger of odd rows (% of cell width), like brickwork."],
  "Col Shift": ["Col Shift", "Col Shift"],
  "奇数列の縦ずらし (セル高さの %)。レンガ積み": ["奇数列の縦ずらし (セル高さの %)。レンガ積み", "Vertical stagger of odd columns (% of cell height), like brickwork."],
  "Cell Rotate": ["Cell Rotate", "Cell Rotate"],
  "セル枠内で 1 枚ずつ回転 (度)。枠外は切り取る": ["セル枠内で 1 枚ずつ回転 (度)。枠外は切り取る", "Rotate each image inside its cell (degrees). Clipped to the cell frame."],
  "Flip Alt": ["Flip Alt", "Flip Alt"],
  "1 枚おきに左右反転 (0=なし / 1=反転)": ["1 枚おきに左右反転 (0=なし / 1=反転)", "Mirror alternate cells horizontally (0=off / 1=on)."],
  "Scroll X": ["Scroll X", "Scroll X"],
  "格子の横移動速度 (画面幅 / 拍、Drone は画面幅 / 秒)。Beat は拍ごとに移動": ["格子の横移動速度 (画面幅 / 拍、Drone は画面幅 / 秒)。Beat は拍ごとに移動", "Horizontal grid speed (screen widths per beat, or per second in Drone). Beat moves in steps."],
  "Scroll Y": ["Scroll Y", "Scroll Y"],
  "格子の縦移動速度 (画面高さ / 拍、Drone は画面高さ / 秒)。Beat は拍ごとに移動": ["格子の縦移動速度 (画面高さ / 拍、Drone は画面高さ / 秒)。Beat は拍ごとに移動", "Vertical grid speed (screen heights per beat, or per second in Drone). Beat moves in steps."],
  "Time Offset": ["Time Offset", "Time Offset"],
  "タイルごとの UV ずらし (0〜1)。再生時刻は変えず、同じ絵の横・縦位置をずらす": ["タイルごとの UV ずらし (0〜1)。再生時刻は変えず、同じ絵の横・縦位置をずらす", "Per-cell UV offset (0–1). Shifts the same image horizontally and vertically; playback time is unchanged."],
  "別ウィンドウに出力": [
    "別ウィンドウに出力",
    "Open a separate output window"
  ],
  "録画。画面音声ON時は音声も保存": [
    "録画。画面音声ON時は音声も保存",
    "Record video, with audio when system audio is on"
  ],
  "スクリーンショットをPNG保存": [
    "スクリーンショットをPNG保存",
    "Save a PNG screenshot"
  ],
  "代理モード (L): 離席中、安全なプリセットを 30〜60 秒ごとに自動で切り替える。キー・クリック・ホイール・MIDI 入力で停止": [
    "代理モード (L): 離席中、安全なプリセットを 30〜60 秒ごとに自動で切り替える。キー・クリック・ホイール・MIDI 入力で停止",
    "Away (L): switch between safe presets every 30–60 seconds. Any key, click, wheel or MIDI input stops it."
  ],
  "Help (右のパネルに表示 / もう一度押すと戻る)": [
    "Help (右のパネルに表示 / もう一度押すと戻る)",
    "Show Help in the side panel; click again to return"
  ],
  "設定": [
    "設定",
    "Settings"
  ],
  "設定 (右のパネルに表示 / もう一度押すと戻る)": [
    "設定 (右のパネルに表示 / もう一度押すと戻る)",
    "Show Settings in the side panel; click again to return"
  ],
  "描画解像度 (録画 / Projector の出力サイズ。表示枠も追従)": [
    "描画解像度 (録画 / Projector の出力サイズ。表示枠も追従)",
    "Output resolution for recording and Projector; the preview follows this size"
  ],
  "Grad Preset (キー 1〜9 = パレット / 0 = 通常色。クリックで適用)": [
    "Grad Preset (キー 1〜9 = パレット / 0 = 通常色。クリックで適用)",
    "Grad Presets: 1–9 for palettes, 0 for original colors. Click to apply."
  ],
  "Grad Preset + Invert (クリックでパレット適用 + Invert ON)": [
    "Grad Preset + Invert (クリックでパレット適用 + Invert ON)",
    "Click to apply a Grad Preset with Invert on"
  ],
  "Blend Mode プレビュー (クリックで適用)": [
    "Blend Mode プレビュー (クリックで適用)",
    "Blend Mode preview: click to apply"
  ],
  "Slot A (クリックで操作対象に / ダブルクリックで表示切替)": [
    "Slot A (クリックで操作対象に / ダブルクリックで表示切替)",
    "Slot A: click to select; double-click to show or hide"
  ],
  "Slot B (クリックで操作対象に / ダブルクリックで表示切替)": [
    "Slot B (クリックで操作対象に / ダブルクリックで表示切替)",
    "Slot B: click to select; double-click to show or hide"
  ],
  "Draw フリーズ (Space)": [
    "Draw フリーズ (Space)",
    "Freeze animation (Space)"
  ],
  "パラメータを保存値・初期値へリセット (R。スロットは保持)": [
    "パラメータを保存値・初期値へリセット (R。スロットは保持)",
    "Reset parameters to saved defaults (R); keep slots"
  ],
  "IMAGON / Manga をクリア + Pan・Zoom リセット + 初期フレームへ (C)": [
    "IMAGON / Manga をクリア + Pan・Zoom リセット + 初期フレームへ (C)",
    "Clear IMAGON / Manga, reset Pan / Zoom and return to the first frame (C)"
  ],
  "全スロットをなしにして全パラメータをリセット (Esc。Live Lock 中は無効)": [
    "全スロットをなしにして全パラメータをリセット (Esc。Live Lock 中は無効)",
    "Clear all slots and reset parameters (Esc); disabled by Live Lock"
  ],
  "現在の全状態を新規プリセットとして追加": [
    "現在の全状態を新規プリセットとして追加",
    "Save the current state as a new preset"
  ],
  "サーバーに残っている保存履歴から、今は無いプリセットを復元する": [
    "サーバーに残っている保存履歴から、今は無いプリセットを復元する",
    "Restore missing presets from server history"
  ],
  "検索…": [
    "検索…",
    "Search…"
  ],
  "アクティブスロットの形式": [
    "アクティブスロットの形式",
    "Active slot format"
  ],
  "新規": [
    "新規",
    "New"
  ],
  "コンパイル (Cmd+Enter)": [
    "コンパイル (Cmd+Enter)",
    "Compile (Cmd+Enter)"
  ],
  "Crossfade / Blend / Auto mode の現在値をデフォルトとして保存": [
    "Crossfade / Blend / Auto mode の現在値をデフォルトとして保存",
    "Save Crossfade / Blend / Auto mode as defaults"
  ],
  "保存したデフォルトを削除して初期値へ戻す": [
    "保存したデフォルトを削除して初期値へ戻す",
    "Delete saved defaults and restore original values"
  ],
  "Normal=通常クロスフェード, 他はブレンドモード (Opacity で適用強度)": [
    "Normal=通常クロスフェード, 他はブレンドモード (Opacity で適用強度)",
    "Normal: crossfade. Other modes: blend, with strength set by Opacity."
  ],
  "Double Mix: Slot B を A と別の動きにする (OFF = 0 拍)": [
    "Double Mix: Slot B を A と別の動きにする (OFF = 0 拍)",
    "Double Mix: make Slot B move differently from A (OFF = 0 beats)"
  ],
  "Double Mix: Slot B の時間 (拍) を先へずらす。A/B に同じシェーダや Visual を入れてタイミング違いで重ねる用。動画は再生位置、Code の Visual は拍と時計をずらす。状態を持つ Visual は B 専用の初期状態で動かす": [
    "Double Mix: Slot B の時間 (拍) を先へずらす。A/B に同じシェーダや Visual を入れてタイミング違いで重ねる用。動画は再生位置、Code の Visual は拍と時計をずらす。状態を持つ Visual は B 専用の初期状態で動かす",
    "Double Mix: shift Slot B ahead in time (beats) to layer the same shader or Visual with different timing. Videos shift the playback position, Code Visuals shift beat and clock, and stateful Visuals run B from its own initial state."
  ],
  "Slot A の表示 ON/OFF ([)": [
    "Slot A の表示 ON/OFF ([)",
    "Show / hide Slot A ([)"
  ],
  "Slot B の表示 ON/OFF (])": [
    "Slot B の表示 ON/OFF (])",
    "Show / hide Slot B (])"
  ],
  "Slot A ⇄ B を交換 (Shift+X)": [
    "Slot A ⇄ B を交換 (Shift+X)",
    "Swap Slot A and B (Shift+X)"
  ],
  "クロスフェードを A ⇄ B の端へ反転 (\\)": [
    "クロスフェードを A ⇄ B の端へ反転 (\\)",
    "Flip crossfade to the opposite end (\\)"
  ],
  "操作中のスロットを縮小 (,)": [
    "操作中のスロットを縮小 (,)",
    "Zoom out in the active slot (,)"
  ],
  "Pan / Zoom を 1:1 へ": [
    "Pan / Zoom を 1:1 へ",
    "Reset Pan / Zoom to 1:1"
  ],
  "操作中のスロットを拡大 (.)": [
    "操作中のスロットを拡大 (.)",
    "Zoom in on the active slot (.)"
  ],
  "Slot A の背景色 = 出力の下地。Slot A が透過している所 (なし / 透過シェーダ / Image の余白) がこの色になる": [
    "Slot A の背景色 = 出力の下地。Slot A が透過している所 (なし / 透過シェーダ / Image の余白) がこの色になる",
    "Output background color, visible through transparent areas of Slot A"
  ],
  "透過: 背景色なし。A BG の所に Grad Map を掛けず、#000000 の上に出す (もう一度で黒に戻す)": [
    "透過: 背景色なし。A BG の所に Grad Map を掛けず、#000000 の上に出す (もう一度で黒に戻す)",
    "Transparent background: skip Grad Map on A BG and display over black. Click again for a black background."
  ],
  "黒 (既定) に戻す": [
    "黒 (既定) に戻す",
    "Reset to black"
  ],
  "Slot B のシェーダ位相ずらし (拍)。A/B に同じシェーダを入れて周期をずらして重ねる用": [
    "Slot B のシェーダ位相ずらし (拍)。A/B に同じシェーダを入れて周期をずらして重ねる用",
    "Slot B shader phase offset in beats; offset matching shaders in A and B"
  ],
  "Crossfade=なめらか, Switch=パチンと切替": [
    "Crossfade=なめらか, Switch=パチンと切替",
    "Crossfade: smooth blend. Switch: instant cut."
  ],
  "いまの Look・文字の出どころ・版面をこの Visual のデフォルトとして保存": [
    "いまの Look・文字の出どころ・版面をこの Visual のデフォルトとして保存",
    "Save this Look, text source and layout as this Visual's defaults"
  ],
  "ライブ調整を捨てて「デフォルト保存」した内容へ戻す (保存が無ければ初期値)": [
    "ライブ調整を捨てて「デフォルト保存」した内容へ戻す (保存が無ければ初期値)",
    "Restore saved defaults, or original values if none are saved"
  ],
  "表示する文字 (改行可)。入力すると Custom に切り替わる": [
    "表示する文字 (改行可)。入力すると Custom に切り替わる",
    "Text to display (line breaks allowed). Typing switches to Custom."
  ],
  "動きの量 (全 Look 共通の倍率)。文字の動き出しの頻度と Surface / Composition の速さに掛かる": [
    "動きの量 (全 Look 共通の倍率)。文字の動き出しの頻度と Surface / Composition の速さに掛かる",
    "Motion multiplier across all Looks: text motion rate and Surface / Composition speed"
  ],
  "音への反応の強さ。音の立ち上がりで動きが脈打つ": [
    "音への反応の強さ。音の立ち上がりで動きが脈打つ",
    "Audio response: pulse motion on audio attacks"
  ],
  "拍で脈打つ量 (beat モード、または R BPM が On で無音のとき)": [
    "拍で脈打つ量 (beat モード、または R BPM が On で無音のとき)",
    "Beat pulse strength in beat mode, or in silence with R BPM on"
  ],
  "音が無いとき (音声入力 Off を含む) も BPM の拍で脈打たせる (drone モードでも)": [
    "音が無いとき (音声入力 Off を含む) も BPM の拍で脈打たせる (drone モードでも)",
    "Pulse to BPM in silence, even with audio input off or in drone mode"
  ],
  "共通パレット: Key = 文字・インク、Base = 紙・背景、Accent = アクセント。Surface の色も Look のいちばん近い役割に割り当て、色みはその役割の色に揃えて明るさの差だけ残す (版ずれは A = Accent / B = Key、周辺減光は Key)。Off は Look の色のまま、Paper only は背景だけ Base に固定。Rainbow は対象外": [
    "共通パレット: Key = 文字・インク、Base = 紙・背景、Accent = アクセント。Surface の色も Look のいちばん近い役割に割り当て、色みはその役割の色に揃えて明るさの差だけ残す (版ずれは A = Accent / B = Key、周辺減光は Key)。Off は Look の色のまま、Paper only は背景だけ Base に固定。Rainbow は対象外",
    "Shared palette: Key = text / ink, Base = paper / background, Accent = accent. Surface colors follow the closest role, keeping brightness differences. Misregistration: A = Accent, B = Key; vignette = Key. Off keeps Look colors; Paper only fixes the background to Base. Excludes Rainbow."
  ],
  "置いたスタンプを全部消す": [
    "置いたスタンプを全部消す",
    "Clear all stamps"
  ],
  "拍の数え方: BPM = 実際の拍 (beat xA を掛けない) / ×A = beat xA を掛けた拍": [
    "拍の数え方: BPM = 実際の拍 (beat xA を掛けない) / ×A = beat xA を掛けた拍",
    "Beat source: BPM = raw beats; ×A = beats multiplied by beat xA"
  ],
  "別のレイアウトをランダムに": [
    "別のレイアウトをランダムに",
    "Pick another random layout"
  ],
  "Canvas に置くスタンプの最大数 (6〜32、1 刻み)": [
    "Canvas に置くスタンプの最大数 (6〜32、1 刻み)",
    "Maximum Canvas stamps (6–32)"
  ],
  "Composition (Type Deformer 0.3 の Compose): テキストから生成シーンを合成。On にした時点でエンジン (約 2.7MB) を読み込む": [
    "Composition (Type Deformer 0.3 の Compose): テキストから生成シーンを合成。On にした時点でエンジン (約 2.7MB) を読み込む",
    "Composition: generate scenes from text with Type Deformer 0.3 Compose. Loads the engine (about 2.7 MB) when enabled."
  ],
  "順序・頻度・文字種から編集的レイアウトを組む": [
    "順序・頻度・文字種から編集的レイアウトを組む",
    "Build editorial layouts from order, frequency and character types"
  ],
  "複数の経路へ文字を組版する": [
    "複数の経路へ文字を組版する",
    "Set text along multiple paths"
  ],
  "文字・語・句を字形の器へ充填する": [
    "文字・語・句を字形の器へ充填する",
    "Fill glyph shapes with characters, words and phrases"
  ],
  "Composition の乱数シードを引き直す": [
    "Composition の乱数シードを引き直す",
    "Randomize the Composition seed"
  ],
  "いまの Composition を保存 (全端末で共通)": [
    "いまの Composition を保存 (全端末で共通)",
    "Save this Composition across devices"
  ],
  "選んでいる保存 Composition を削除": [
    "選んでいる保存 Composition を削除",
    "Delete the selected saved Composition"
  ],
  "Composition のループ速度 (1周/秒)": [
    "Composition のループ速度 (1周/秒)",
    "Composition loop speed (cycles per second)"
  ],
  "Composition マクロ: 変形の強さ": [
    "Composition マクロ: 変形の強さ",
    "Composition macro: deformation strength"
  ],
  "Composition マクロ: 密度 (インスタンス数)": [
    "Composition マクロ: 密度 (インスタンス数)",
    "Composition macro: density (instance count)"
  ],
  "Composition マクロ: 不安定さ (ノイズ量)": [
    "Composition マクロ: 不安定さ (ノイズ量)",
    "Composition macro: instability (noise)"
  ],
  "Composition マクロ: 奥行き/スケール変調": [
    "Composition マクロ: 奥行き/スケール変調",
    "Composition macro: depth / scale modulation"
  ],
  "Composition マクロ: 可読性の下限 (低いほど崩れる)": [
    "Composition マクロ: 可読性の下限 (低いほど崩れる)",
    "Composition macro: minimum legibility; lower values distort more"
  ],
  "Composition を音で動かす量": [
    "Composition を音で動かす量",
    "Composition audio response"
  ],
  "いまの構成を保存 (全端末で共通)": [
    "いまの構成を保存 (全端末で共通)",
    "Save this layout across devices"
  ],
  "選んでいる保存構成を削除": [
    "選んでいる保存構成を削除",
    "Delete the selected saved layout"
  ],
  "FXラック: 残像トレイル (0で無効)": [
    "FXラック: 残像トレイル (0で無効)",
    "FX rack: trails (0 = off)"
  ],
  "FXラック: フィードバック (ズーム/回転の再帰。0で無効)": [
    "FXラック: フィードバック (ズーム/回転の再帰。0で無効)",
    "FX rack: recursive zoom / rotation feedback (0 = off)"
  ],
  "FXラック: 色収差スプリット (0で無効)": [
    "FXラック: 色収差スプリット (0で無効)",
    "FX rack: chromatic split (0 = off)"
  ],
  "FXラック: ラスタ質感 (スキャンライン/ノイズ。0で無効)": [
    "FXラック: ラスタ質感 (スキャンライン/ノイズ。0で無効)",
    "FX rack: scanlines / noise (0 = off)"
  ],
  "一覧に出す Look (Random と Auto もこの中から選ぶ)": [
    "一覧に出す Look (Random と Auto もこの中から選ぶ)",
    "Looks to display; Random and Auto use this pool too"
  ],
  "一覧からランダムに Look を選ぶ (重い Surface を含む Featured は除く。Rand Guard の負荷判定を通す)": [
    "一覧からランダムに Look を選ぶ (重い Surface を含む Featured は除く。Rand Guard の負荷判定を通す)",
    "Pick a random Look; skip heavy Featured Surfaces and check Rand Guard"
  ],
  "クリックで Look を当てる": [
    "クリックで Look を当てる",
    "Click to apply this Look"
  ],
  "この拍数ごとに一覧から Look を引き直す (重い Surface を含む Featured は除く)": [
    "この拍数ごとに一覧から Look を引き直す (重い Surface を含む Featured は除く)",
    "Pick a Look every N beats; skip heavy Featured Surfaces"
  ],
  "いまの見た目を保存 Look の末尾に保存 (全端末で共通)": [
    "いまの見た目を保存 Look の末尾に保存 (全端末で共通)",
    "Append the current Look to Saved across devices"
  ],
  "選んでいる保存 Look を、いまの見た目で上書き": [
    "選んでいる保存 Look を、いまの見た目で上書き",
    "Overwrite the selected saved Look"
  ],
  "選んでいる保存 Look を削除": [
    "選んでいる保存 Look を削除",
    "Delete the selected saved Look"
  ],
  "Random の負荷ガード: 適用前に 1 フレームを試しに描き、この fps を保てない Look は引き直す。適用後 3 秒も見張り、重くなったら元に戻す": [
    "Random の負荷ガード: 適用前に 1 フレームを試しに描き、この fps を保てない Look は引き直す。適用後 3 秒も見張り、重くなったら元に戻す",
    "Rand Guard: test one frame before applying a Look. Retry if FPS is below this value. Watch for 3 seconds after applying and revert if too slow."
  ],
  "表示する文字: Look = Look の語 (Featured のサムネと同じ語。保存 Look は今の文字のまま) / Random = テキストプリセットから拍ごとにランダム / Custom = 下のテキストエリア": [
    "表示する文字: Look = Look の語 (Featured のサムネと同じ語。保存 Look は今の文字のまま) / Random = テキストプリセットから拍ごとにランダム / Custom = 下のテキストエリア",
    "Text source: Look = Featured preset text (Saved keeps current text); Random = text presets on beats; Custom = text field"
  ],
  "テキストプリセットから次の文字へ (Random に切り替わる)": [
    "テキストプリセットから次の文字へ (Random に切り替わる)",
    "Next text preset; switches to Random"
  ],
  "押すたびに On / Off。On の種類を混ぜて Random で使う": [
    "押すたびに On / Off。On の種類を混ぜて Random で使う",
    "Toggle each category; Random uses the enabled categories"
  ],
  "Random で文字を替える間隔 (拍)": [
    "Random で文字を替える間隔 (拍)",
    "Beats between random text changes"
  ],
  "一文字ずつ入力": [
    "一文字ずつ入力",
    "Type one character at a time"
  ],
  "1 拍あたりの文字数": [
    "1 拍あたりの文字数",
    "Characters per beat"
  ],
  "全文を出したあと最初に戻るまでの拍数": [
    "全文を出したあと最初に戻るまでの拍数",
    "Beats to hold the full text before restarting"
  ],
  "Accent 色で描く文字の割合": [
    "Accent 色で描く文字の割合",
    "Share of characters using Accent color"
  ],
  "折り返し幅 (隠しステージの幅)": [
    "折り返し幅 (隠しステージの幅)",
    "Line wrap width (offscreen stage width)"
  ],
  "グリッド組版 (原稿用紙状のマスに1文字ずつ配置)": [
    "グリッド組版 (原稿用紙状のマスに1文字ずつ配置)",
    "Grid layout: one character per cell"
  ],
  "文字が伸び縮みする規則": [
    "文字が伸び縮みする規則",
    "Character stretch pattern"
  ],
  "文字が動き出す頻度 (0 で止まる)": [
    "文字が動き出す頻度 (0 で止まる)",
    "Motion trigger rate (0 = stop)"
  ],
  "各 Operator が文字に乗る確率": [
    "各 Operator が文字に乗る確率",
    "Chance of each Operator affecting a character"
  ],
  "類字置換の深さ (浅=形態違い → 深=異スクリプト)": [
    "類字置換の深さ (浅=形態違い → 深=異スクリプト)",
    "Glyph substitution depth: shape variants to other scripts"
  ],
  "Surface 効果を文字に重ねる。On にした時点でエンジン (約 2.7MB) を読み込む": [
    "Surface 効果を文字に重ねる。On にした時点でエンジン (約 2.7MB) を読み込む",
    "Layer Surface effects over text. Loads the engine (about 2.7 MB) when enabled."
  ],
  "この Operator のパラメータを上流の既定値へ戻す": [
    "この Operator のパラメータを上流の既定値へ戻す",
    "Reset this Operator to upstream defaults"
  ],
  "この Operator のパラメータをランダムに変える (Strength / Chance / Speed / 色は変えない)": [
    "この Operator のパラメータをランダムに変える (Strength / Chance / Speed / 色は変えない)",
    "Randomize this Operator; keep Strength / Chance / Speed / colors"
  ],
  "Surface Operator (上流のカタログの分類順)。ここで選ぶと Operator 1 つだけにする": [
    "Surface Operator (上流のカタログの分類順)。ここで選ぶと Operator 1 つだけにする",
    "Surface Operators in upstream catalog order. Selecting here uses a single Operator."
  ],
  "重ねている Operator のうち、下にパラメータを出すもの": [
    "重ねている Operator のうち、下にパラメータを出すもの",
    "Layered Operator whose parameters appear below"
  ],
  "効果の強さ": [
    "効果の強さ",
    "Effect strength"
  ],
  "効果を掛ける文字の割合": [
    "効果を掛ける文字の割合",
    "Share of characters affected"
  ],
  "効果の位相の進み (1周/秒。beat モードは拍で脈打つ)。重い Operator は描き終えるまで位相が止まる": [
    "効果の位相の進み (1周/秒。beat モードは拍で脈打つ)。重い Operator は描き終えるまで位相が止まる",
    "Effect speed in cycles per second; pulses in beat mode. Heavy Operators pause phase until rendering finishes."
  ],
  "効果が掛かった文字の元の字の見せ方": [
    "効果が掛かった文字の元の字の見せ方",
    "How to show the original glyph under the effect"
  ],
  "効果レイヤーの不透明度": [
    "効果レイヤーの不透明度",
    "Effect layer opacity"
  ],
  "粗さ: 効果を粗い解像度で描き、ドットのまま拡大する (1 = 従来どおり。ビットマップ系の Look 向け)": [
    "粗さ: 効果を粗い解像度で描き、ドットのまま拡大する (1 = 従来どおり。ビットマップ系の Look 向け)",
    "Coarse rendering: draw at low resolution and scale up as pixels. 1 = normal."
  ],
  "効果レイヤーの重ね方": [
    "効果レイヤーの重ね方",
    "Effect layer blend mode"
  ],
  "効果の色: Operator の既定色 / Ink / Accent": [
    "効果の色: Operator の既定色 / Ink / Accent",
    "Effect color: Operator default / Ink / Accent"
  ],
  "選択中のmdに現在のパラメータをデフォルトとして保存": [
    "選択中のmdに現在のパラメータをデフォルトとして保存",
    "Save current parameters as defaults for the selected md"
  ],
  "ランダムにアニメ設定一式＋組版を生成": [
    "ランダムにアニメ設定一式＋組版を生成",
    "Randomize animation and layout"
  ],
  "揺れの乱数パターンだけ変更": [
    "揺れの乱数パターンだけ変更",
    "Change only the motion seed"
  ],
  "表示量を超えたとき: Page=画面リセットして次ページ / Scroll=1行ずつスクロール": [
    "表示量を超えたとき: Page=画面リセットして次ページ / Scroll=1行ずつスクロール",
    "When full: Page clears for the next page; Scroll moves one line at a time"
  ],
  "シーンと動きのパラメータをランダム生成 (Scene=Randomのままなら自動切替も継続)": [
    "シーンと動きのパラメータをランダム生成 (Scene=Randomのままなら自動切替も継続)",
    "Randomize scene and motion; automatic changes continue in Random mode"
  ],
  "Saved=呼び出したmdにデフォルト保存したsceneを再生(既定) / Random=サイクルごとにランダム抽選 / 具体名=固定。シーン: wave=波打つ文字面 / wall=文字の壁 / arc=弧 / tunnel=トンネル / cylinder=円筒 / helix=螺旋 / sphere=球 / rings=同心円 / ribbon=3D曲線帯 / lissajous=リサージュ / vortex=渦 / burst=放射 / scatter=散布 / fall=雨": [
    "Saved=呼び出したmdにデフォルト保存したsceneを再生(既定) / Random=サイクルごとにランダム抽選 / 具体名=固定。シーン: wave=波打つ文字面 / wall=文字の壁 / arc=弧 / tunnel=トンネル / cylinder=円筒 / helix=螺旋 / sphere=球 / rings=同心円 / ribbon=3D曲線帯 / lissajous=リサージュ / vortex=渦 / burst=放射 / scatter=散布 / fall=雨",
    "Saved: use the md's saved scene. Random: pick each cycle. Select a scene name to lock it. Scenes include waves, walls, arcs, tunnels, cylinders, helices, spheres, rings, ribbons, Lissajous curves, vortices, bursts, scatter and rain."
  ],
  "現在のシーンと、次のサイクルまでの残り。next が減らないときは拍が進んでいない(逆再生・フリーズ等)": [
    "現在のシーンと、次のサイクルまでの残り。next が減らないときは拍が進んでいない(逆再生・フリーズ等)",
    "Current scene and beats until the next cycle. If next stops, beats are not advancing (reverse, freeze, etc.)."
  ],
  "所定の拍数ごとにシーンとmdを自動で送る (beat モード限定。drone モードでは切り替わらない)": [
    "所定の拍数ごとにシーンとmdを自動で送る (beat モード限定。drone モードでは切り替わらない)",
    "Advance scene and md every N beats; beat mode only"
  ],
  "カメラを自動で周回させる (tunnelでは視線の揺れ)": [
    "カメラを自動で周回させる (tunnelでは視線の揺れ)",
    "Orbit the camera automatically; sway the view in tunnel mode"
  ],
  "ON=サイクルでmdを送るたび、初期値へ戻してからそのmdの保存デフォルトを適用(保存が無いmdは初期値) / OFF=保存デフォルトがあるmdだけ読み込み、無いmdは今のパラメータを維持": [
    "ON=サイクルでmdを送るたび、初期値へ戻してからそのmdの保存デフォルトを適用(保存が無いmdは初期値) / OFF=保存デフォルトがあるmdだけ読み込み、無いmdは今のパラメータを維持",
    "On: reset then apply each md's saved defaults (or original values). Off: load saved defaults only when available; otherwise keep current parameters."
  ],
  "tunnel/cylinderでも文字を常にカメラへ向ける": [
    "tunnel/cylinderでも文字を常にカメラへ向ける",
    "Keep text facing the camera in tunnel / cylinder scenes"
  ],
  "奥/端で文字をフェード (tunnel/fall)": [
    "奥/端で文字をフェード (tunnel/fall)",
    "Fade distant or edge text in tunnel / fall scenes"
  ],
  "Slot Aでも背景を透過 (下のレイヤーが透ける)": [
    "Slot Aでも背景を透過 (下のレイヤーが透ける)",
    "Transparent background even in Slot A"
  ],
  "絵文字を元の色のまま描く (OFF=Ink色のシルエット)": [
    "絵文字を元の色のまま描く (OFF=Ink色のシルエット)",
    "Keep original emoji colors; Off uses Ink silhouettes"
  ],
  "背景色": [
    "背景色",
    "Background color"
  ],
  "文字色": [
    "文字色",
    "Text color"
  ],
  "差し色 (Accent % の割合の文字に付く)": [
    "差し色 (Accent % の割合の文字に付く)",
    "Accent color, used by the Accent % share of characters"
  ],
  "押し出し面の色": [
    "押し出し面の色",
    "Extrusion color"
  ],
  "押し出し面の色。既定=文字の縁の色をそのまま引き延ばす (Ink/Accent/絵文字のフチ)。色を選ぶと専用色になり、ダブルクリックで既定に戻る": [
    "押し出し面の色。既定=文字の縁の色をそのまま引き延ばす (Ink/Accent/絵文字のフチ)。色を選ぶと専用色になり、ダブルクリックで既定に戻る",
    "Extrusion color defaults to the glyph edge color. Pick a custom color; double-click to reset."
  ],
  "操作中のスロット": [
    "操作中のスロット",
    "Active slot"
  ],
  "現在のパラメータ値をこのシェーダのデフォルトとして保存(次回そのシェーダを呼ぶと反映)": [
    "現在のパラメータ値をこのシェーダのデフォルトとして保存(次回そのシェーダを呼ぶと反映)",
    "Save these parameters as this shader's defaults for future loads"
  ],
  "保存したデフォルトを削除してシェーダ本来の値へ戻す": [
    "保存したデフォルトを削除してシェーダ本来の値へ戻す",
    "Delete saved defaults and restore this shader's original values"
  ],
  "現在の値をデフォルトとして保存": [
    "現在の値をデフォルトとして保存",
    "Save current values as defaults"
  ],
  "images/photo/ の写真をランダムな長方形にトリミングして 3D プレーン化。回転/曲げ/ワープ。": [
    "images/photo/ の写真をランダムな長方形にトリミングして 3D プレーン化。回転/曲げ/ワープ。",
    "Crop photos from images/photo/ into 3D planes, then rotate, bend and warp them"
  ],
  "images/photo/ を再スキャン": [
    "images/photo/ を再スキャン",
    "Rescan images/photo/"
  ],
  "配置とトリミングを引き直す": [
    "配置とトリミングを引き直す",
    "Randomize layout and crops"
  ],
  "カール(渦)ノイズで流れる粒に、原点を貫いて互いに交差する三角形の刃を生やした群れ。表=ブルー / 裏=クローム。": [
    "カール(渦)ノイズで流れる粒に、原点を貫いて互いに交差する三角形の刃を生やした群れ。表=ブルー / 裏=クローム。",
    "Curl-noise particles with intersecting triangular blades. Blue fronts and chrome backs."
  ],
  "角張った矩形ブラシの「錬成痕」が群れで旋回する。板 1 枚ずつを 3D で描き、重なりは手前の板が奥を隠す。": [
    "角張った矩形ブラシの「錬成痕」が群れで旋回する。板 1 枚ずつを 3D で描き、重なりは手前の板が奥を隠す。",
    "Angular brush plates swirl in 3D, with nearer plates hiding those behind"
  ],
  "形が変わり続ける液体の本体を破片が覆い、輪郭が退いた所から破片がペリペリ起き上がって飛び散る。戻れば貼り付く。Peel By=マウスで、クリック・ドラッグした所の破片だけ剥がれる (Brush=半径)。本体の色はインクと連動か Body Color。": [
    "形が変わり続ける液体の本体を破片が覆い、輪郭が退いた所から破片がペリペリ起き上がって飛び散る。戻れば貼り付く。Peel By=マウスで、クリック・ドラッグした所の破片だけ剥がれる (Brush=半径)。本体の色はインクと連動か Body Color。",
    "Fragments cover a morphing liquid body, peeling and flying off as its outline recedes. Peel By = Mouse peels under clicks / drags; Brush sets radius. Body color follows Ink or Body Color."
  ],
  "線画の風。先端 (頭) が 3D 空間を往来し (Wander)、その軌跡に何本もの風の面が時間差で連なる (Trail / Gap)。面は重なり合う長方形の板の群れで、軌跡のまわりにらせん状に巻きつく。一部の板は面から剥がれて飛ぶ (Scatter)。手前の板が奥を隠し、裏に回った板には流れに沿うハッチかベタ塗りの影 (Shade / Shade Fill)。Size Var で板の大きさを指数分布に (大半が小さく一部が大きい)。スクショ用: Seed で構図を引き直し、Cam Yaw / Pitch で固定アングル、Hold=静止 + Phase で時刻を固定。": [
    "線画の風。先端 (頭) が 3D 空間を往来し (Wander)、その軌跡に何本もの風の面が時間差で連なる (Trail / Gap)。面は重なり合う長方形の板の群れで、軌跡のまわりにらせん状に巻きつく。一部の板は面から剥がれて飛ぶ (Scatter)。手前の板が奥を隠し、裏に回った板には流れに沿うハッチかベタ塗りの影 (Shade / Shade Fill)。Size Var で板の大きさを指数分布に (大半が小さく一部が大きい)。スクショ用: Seed で構図を引き直し、Cam Yaw / Pitch で固定アングル、Hold=静止 + Phase で時刻を固定。",
    "Line-drawn wind: a head wanders in 3D, trailing spiraling sheets of overlapping plates (Trail / Gap). Scatter detaches plates; Shade / Shade Fill controls their backs. Size Var mixes mostly small plates with a few large ones. For stills, choose a Seed, fix Cam Yaw / Pitch, then use Hold and Phase."
  ],
  "鏡面のトゲの塊。球を引き伸ばしたスパイクが拍で伸び縮みし、姿勢がカクッと切り替わる。": [
    "鏡面のトゲの塊。球を引き伸ばしたスパイクが拍で伸び縮みし、姿勢がカクッと切り替わる。",
    "Reflective spikes pulse with the beat and snap to new orientations"
  ],
  "リゾーム的なダイアグラム。黄緑の楕円のノードが次々とポップアップして現れては消え、親から伸びる線や近くのノードへの線、茶色の四角、矢印付きの青い弧が網をつくる。Cycle ごとに、平らな網と、地面が斜めに倒れて縦の面 (人の輪郭を切り抜いたもの) が 90° 立ち上がる状態を繰り返す (Rise 0 で平らのまま)。Life で寿命、Nodes で数。Slot B は背景を透過。": [
    "リゾーム的なダイアグラム。黄緑の楕円のノードが次々とポップアップして現れては消え、親から伸びる線や近くのノードへの線、茶色の四角、矢印付きの青い弧が網をつくる。Cycle ごとに、平らな網と、地面が斜めに倒れて縦の面 (人の輪郭を切り抜いたもの) が 90° 立ち上がる状態を繰り返す (Rise 0 で平らのまま)。Life で寿命、Nodes で数。Slot B は背景を透過。",
    "Rhizome diagrams: lime nodes appear and disappear, linked by lines, rectangles and blue arcs. Cycle alternates a flat network with tilted ground and upright silhouettes. Rise = 0 keeps it flat; Life sets lifespan and Nodes sets count. Slot B is transparent."
  ],
  "小さなバネから青い線が同じ向きに巻きながら扇形に伸び、届いた先で黄緑の円盤がふくらむ。いくつかは黒い種になり、緑の線が円盤を抜けて先へ伸びる。最後は尾が先へ追いついて消える。描き方と地面の倒れは RHIZOME と共通。": [
    "小さなバネから青い線が同じ向きに巻きながら扇形に伸び、届いた先で黄緑の円盤がふくらむ。いくつかは黒い種になり、緑の線が円盤を抜けて先へ伸びる。最後は尾が先へ追いついて消える。描き方と地面の倒れは RHIZOME と共通。",
    "Blue spiraling lines fan out from springs to growing lime discs. Some form black seeds with green extensions, then disappear as their tails catch up. Shares RHIZOME's drawing and ground tilt."
  ],
  "黄緑の楕円が輪をまわって順にふくらみ、輪の上の宙の一点から全員へ線が伸びる。輪はゆっくり回り、ときどき一つが輪を離れて逃げる。平らなときは放射状、地面が倒れると円錐に見える。": [
    "黄緑の楕円が輪をまわって順にふくらみ、輪の上の宙の一点から全員へ線が伸びる。輪はゆっくり回り、ときどき一つが輪を離れて逃げる。平らなときは放射状、地面が倒れると円錐に見える。",
    "Lime discs grow around a rotating ring, linked to a point above it; some escape. Flat view is radial; tilted view forms a cone."
  ],
  "黄緑の楕円の網 (線の先に矢印、いくつかの楕円を青い縦の両矢印が貫く) の上に、楕円が縦に積み重なる柱が立つ。1 つの楕円 → 青い軸 → 上・中・下の楕円と赤い筒 → 楕円が詰まって柱になり、やがて傾いてほどけ、線を伸ばして散る。": [
    "黄緑の楕円の網 (線の先に矢印、いくつかの楕円を青い縦の両矢印が貫く) の上に、楕円が縦に積み重なる柱が立つ。1 つの楕円 → 青い軸 → 上・中・下の楕円と赤い筒 → 楕円が詰まって柱になり、やがて傾いてほどけ、線を伸ばして散る。",
    "Columns rise from a lime network: a disc becomes an axis, stacked discs and a red tube, then a dense column that tilts, unravels and scatters"
  ],
  "左に黄緑の楕円の網 (黒い線と矢印、先が Y に開く緑の線)。網の前の端の楕円が輪の重なる筒の口になり、中のバネから青い線の束が出て、黄色い楕円を通って扇形に広がり、遠くの円盤へ届く。円盤は遠いほど大きく、いくつかは緑の尾を引いて飛ぶ。": [
    "左に黄緑の楕円の網 (黒い線と矢印、先が Y に開く緑の線)。網の前の端の楕円が輪の重なる筒の口になり、中のバネから青い線の束が出て、黄色い楕円を通って扇形に広がり、遠くの円盤へ届く。円盤は遠いほど大きく、いくつかは緑の尾を引いて飛ぶ。",
    "A lime network opens into overlapping tubes. Blue lines fan from springs through yellow ovals to distant discs; some fly away with green tails."
  ],
  "白い線で編んだリボン曲面。線の本数・長さ、ねじれ、うねり、輪の幅、首振り、遠近を変えられる。": [
    "白い線で編んだリボン曲面。線の本数・長さ、ねじれ、うねり、輪の幅、首振り、遠近を変えられる。",
    "White line ribbon surfaces: adjust line count, length, twist, waves, width, sway and perspective"
  ],
  "洞窟の中を飛ぶ。起伏・鍾乳石・天井の高さ・トンネルの太さ・岩肌を変えると地形を焼き直す。ヘッドライトの絞りと減衰、艶、霧も変えられる。": [
    "洞窟の中を飛ぶ。起伏・鍾乳石・天井の高さ・トンネルの太さ・岩肌を変えると地形を焼き直す。ヘッドライトの絞りと減衰、艶、霧も変えられる。",
    "Fly through a cave. Terrain controls rebuild the cave; adjust headlight focus, falloff, gloss and fog."
  ],
  "画像を流体で溶かす。力・渦・うねり・放射の強さ、粘り、にじみ、輪郭のシャープさ、凹凸と光を変えられる (FX の Boltzmann には効かない)。": [
    "画像を流体で溶かす。力・渦・うねり・放射の強さ、粘り、にじみ、輪郭のシャープさ、凹凸と光を変えられる (FX の Boltzmann には効かない)。",
    "Melt images with fluid motion. Adjust force, swirl, waves, viscosity, bleed, sharpness, relief and lighting. Does not affect the Boltzmann FX."
  ],
  "円筒の本棚タワーの中を巡る。カメラ (距離・画角・上下の振れ・高さ・傾き)、光 (方位・仰角・主光源・環境光・階段の光・霧・背表紙の色)、棚の形 (本の隙間・幅・高さ・棚の間隔・階段の勾配・中央の柱) を変えられる。形の列は動かして止めると作り直す。光と色の列は通常表示 (Slot A・Dark OFF) だけに効く。Shift で Dark。": [
    "円筒の本棚タワーの中を巡る。カメラ (距離・画角・上下の振れ・高さ・傾き)、光 (方位・仰角・主光源・環境光・階段の光・霧・背表紙の色)、棚の形 (本の隙間・幅・高さ・棚の間隔・階段の勾配・中央の柱) を変えられる。形の列は動かして止めると作り直す。光と色の列は通常表示 (Slot A・Dark OFF) だけに効く。Shift で Dark。",
    "Explore a cylindrical library tower. Adjust camera, lighting and shelf geometry. Geometry rebuilds when you stop dragging; light and color apply in Slot A with Dark off. Shift toggles Dark."
  ],
  "流れ場に乗って舞う紙片の群れ。表=ブルー / 裏=クローム。数・大きさ・広がり、流れ・はためき・回転・ねじれ・反り、カメラ (距離・高さ・回遊)、遠近のかすみ、面の色を変えられる。背景色は Option のスポイトで入れる。": [
    "流れ場に乗って舞う紙片の群れ。表=ブルー / 裏=クローム。数・大きさ・広がり、流れ・はためき・回転・ねじれ・反り、カメラ (距離・高さ・回遊)、遠近のかすみ、面の色を変えられる。背景色は Option のスポイトで入れる。",
    "Paper pieces drift through a flow field, blue in front and chrome behind. Adjust count, scale, spread, motion, camera, haze and colors. Use Option eyedropper for background color."
  ],
  "入力した文字を、穴の開いた有機的な塊に押し出して回す。文字は溶けてつながり (Smooth / Merge / Melt X)、太いところにボロノイの穴が開き (Holes)、横へヒレ (Fins)、奥と手前に重なるヒレ層 (Layers)、下へ枝分かれする根 (Tendrils) が伸びる。Style で 読める / 既定 / 紋章 をまとめて切り替え。Material は マット (石膏)・クローム・黒クローム・赤など (Surface = 石膏像の肌: 細かいざらつき・気泡の穴・粉っぽい柔らかな陰。Matte で入る)、Texture で images/ の画像を正面・三面・映り込みに貼れる。Tilt 60° 前後で寝かせた見え方になる。beat モードは Spin Step で拍ごとに回り、Kick で拍に膨らむ。Reverse で逆回転、Random Rev でランダムな拍数 (2〜16 拍) ごとに反転 (どちらも拍の頭で切り替わる)、Attack Rev で音のアタックを拾うたびにその場で反転 (音声入力が要る。拾う音は Audio の Attack / プリセットで決まる)。Typing を On にすると presets/chrometype.md の文字列を 1 字ずつ打ち、全文にすると打たずに Hold 拍ごとに丸ごと入れ替える (beat モードは拍に合わせ、drone モードは時間で。Rate = 速さ / Hold = 打ち終えて止まる拍数 / End = 消し方 / Morph = 1 字ごとに形を溶かしてつなぐ時間 (1 字の間隔に対する %、0 で切り替え))。": [
    "入力した文字を、穴の開いた有機的な塊に押し出して回す。文字は溶けてつながり (Smooth / Merge / Melt X)、太いところにボロノイの穴が開き (Holes)、横へヒレ (Fins)、奥と手前に重なるヒレ層 (Layers)、下へ枝分かれする根 (Tendrils) が伸びる。Style で 読める / 既定 / 紋章 をまとめて切り替え。Material は マット (石膏)・クローム・黒クローム・赤など (Surface = 石膏像の肌: 細かいざらつき・気泡の穴・粉っぽい柔らかな陰。Matte で入る)、Texture で images/ の画像を正面・三面・映り込みに貼れる。Tilt 60° 前後で寝かせた見え方になる。beat モードは Spin Step で拍ごとに回り、Kick で拍に膨らむ。Reverse で逆回転、Random Rev でランダムな拍数 (2〜16 拍) ごとに反転 (どちらも拍の頭で切り替わる)、Attack Rev で音のアタックを拾うたびにその場で反転 (音声入力が要る。拾う音は Audio の Attack / プリセットで決まる)。Typing を On にすると presets/chrometype.md の文字列を 1 字ずつ打ち、全文にすると打たずに Hold 拍ごとに丸ごと入れ替える (beat モードは拍に合わせ、drone モードは時間で。Rate = 速さ / Hold = 打ち終えて止まる拍数 / End = 消し方 / Morph = 1 字ごとに形を溶かしてつなぐ時間 (1 字の間隔に対する %、0 で切り替え))。",
    "Extrude text into rotating organic forms. Smooth / Merge / Melt X join letters; Holes, Fins, Layers and Tendrils shape them. Style sets legibility; Material and Texture set the surface. Tilt near 60° lays text down. Spin Step and Kick follow beats. Reverse, Random Rev and Attack Rev change direction. Typing reads presets/chrometype.md character by character or as full text; Rate, Hold, End and Morph control timing and transitions."
  ],
  "保存したデフォルトに戻す (保存がなければ初期値)": [
    "保存したデフォルトに戻す (保存がなければ初期値)",
    "Restore saved defaults, or original values if none are saved"
  ],
  "パラメータをランダムに変える (文字・書体・材質・テクスチャ・大きさは変えない)": [
    "パラメータをランダムに変える (文字・書体・材質・テクスチャ・大きさは変えない)",
    "Randomize parameters; keep text, font, material, texture and size"
  ],
  "Aratana などの書体で、ドゥルーズの引用をスイス・タイポグラフィのグリッドに組み、ランダムな記号や英数字がスクランブルしながら確定していくグリッチタイピングで打ち続ける。引用ごとに Layout (Hero / Column / Stack / Split / Rotate) を組み替える。": [
    "Aratana などの書体で、ドゥルーズの引用をスイス・タイポグラフィのグリッドに組み、ランダムな記号や英数字がスクランブルしながら確定していくグリッチタイピングで打ち続ける。引用ごとに Layout (Hero / Column / Stack / Split / Rotate) を組み替える。",
    "Set Deleuze quotes in Swiss-style grids with fonts such as Aratana. Random symbols scramble into each character. Layout changes between quotes."
  ],
  "パラメータをランダムに変える (文字・書体・大きさは変えない)": [
    "パラメータをランダムに変える (文字・書体・大きさは変えない)",
    "Randomize parameters; keep text, font and size"
  ],
  "白い砂漠の上空を、マグリット風の構造物 (板・管・石膏球・輪・小窓・白い布) とイヴ・タンギー風の不定形が、それぞれの速さと向きで近づいたり遠ざかったりする。Depth=行き交う速さ、Pan=カメラの横回転、Morph=部品の組み替え。シェーダ版 (Surreal Float) をジオメトリで描き直した軽量版。": [
    "白い砂漠の上空を、マグリット風の構造物 (板・管・石膏球・輪・小窓・白い布) とイヴ・タンギー風の不定形が、それぞれの速さと向きで近づいたり遠ざかったりする。Depth=行き交う速さ、Pan=カメラの横回転、Morph=部品の組み替え。シェーダ版 (Surreal Float) をジオメトリで描き直した軽量版。",
    "Magritte-like structures and Tanguy-like forms float over a white desert. Depth controls travel, Pan rotates the camera and Morph rebuilds parts. Lightweight geometry version of Surreal Float."
  ],
  "パラメータをランダムに変える (色は変えない)": [
    "パラメータをランダムに変える (色は変えない)",
    "Randomize parameters; keep colors"
  ],
  "入力した文字の骨格を取り出し、筆で書き直す。太さ・はらい・かすれ・にじみは全部ライブで動く。Write=Loop で一画ずつ書いていく (C で一画目へ)。Ease は 1 画の、Ease All は文章全体の速度カーブで、強さは Ease Pow。Beat Write で A: Beat ごとに 1 筆 / B: 1 文字 / C: 全文字列 を選べる (間隔は Beat Rate、Attack を上げるとその拍の中で筆で書く)。beat モードは Bar Beats (既定 4 拍) の中で全部を書き切って次のセットへ移る (Off は C と同じ。A / B は Beat Rate で進み、収まらなければ詰める)。drone モードは選んだとおりで、Off は Write の設定で書く。Text Pick で Word Set (1 行 1 文字列、/ で改行。空なら既定のセット) からランダムか順番に読む。Exit でフェード / 一気に消える / 1 筆・1 文字ずつ を選ぶ。Color で指定色 / セットから選ぶ / セットからランダム / 完全ランダム を選ぶ。1 筆・1 文字ずつは Beat Write の A / B で効き、書いた順に消えて、消えきった拍で次のセットが始まる。C や Off ではフェードになる。Set Trans を入れると、セットが変わるときに Transition が掛かる (演出は Trans Style、既定は Mix の設定)。このとき文字は Exit に関わらず切替まで残る。beat モードのフェードも切替まで文字を残す。Reseed=毎回変える なら周回・C・読込のたびに Seed を引き直して別の書きぶりになる (幅は Vary)。気に入ったら Reseed を固定にするとその Seed で止まる。Style で楷書 / 行書 / 草書 / 隷書 / 篆書 のパラメータと筆運び (Ease・画の間・速さのばらつき) をまとめて入れられる (そのあと個別に動かせる)。Font はこの端末で使えるものだけ出る。Layout は横組 / 縦組 / ランダム配置と、それをセットごとに選び直す毎回ランダムで、ランダム配置は Placement=構成 ならポスターの型 16 種で組む (大きい字は画面の外へ出る)。1 文字ごとの位置・ずらし・傾き・大きさも指定できる (Size Min と Max を離すと大きさがばらける)。Aspect は文字の縦横比で、Aspect Rand / Slant Rand で 1 文字ごとにばらせる。Random Unit で書体・フォント・筆・配置の変わる単位を 1 文字ごと / 1 セットごと (文章を 1 回書く間) から選ぶ。セットは Reseed=毎回変える なら文章を 1 回書くごとに切り替わる。線が崩れる書体は Smooth / Spur / Merge で骨格を調整する。Random は筆・毛・墨だけを引き直す。": [
    "入力した文字の骨格を取り出し、筆で書き直す。太さ・はらい・かすれ・にじみは全部ライブで動く。Write=Loop で一画ずつ書いていく (C で一画目へ)。Ease は 1 画の、Ease All は文章全体の速度カーブで、強さは Ease Pow。Beat Write で A: Beat ごとに 1 筆 / B: 1 文字 / C: 全文字列 を選べる (間隔は Beat Rate、Attack を上げるとその拍の中で筆で書く)。beat モードは Bar Beats (既定 4 拍) の中で全部を書き切って次のセットへ移る (Off は C と同じ。A / B は Beat Rate で進み、収まらなければ詰める)。drone モードは選んだとおりで、Off は Write の設定で書く。Text Pick で Word Set (1 行 1 文字列、/ で改行。空なら既定のセット) からランダムか順番に読む。Exit でフェード / 一気に消える / 1 筆・1 文字ずつ を選ぶ。Color で指定色 / セットから選ぶ / セットからランダム / 完全ランダム を選ぶ。1 筆・1 文字ずつは Beat Write の A / B で効き、書いた順に消えて、消えきった拍で次のセットが始まる。C や Off ではフェードになる。Set Trans を入れると、セットが変わるときに Transition が掛かる (演出は Trans Style、既定は Mix の設定)。このとき文字は Exit に関わらず切替まで残る。beat モードのフェードも切替まで文字を残す。Reseed=毎回変える なら周回・C・読込のたびに Seed を引き直して別の書きぶりになる (幅は Vary)。気に入ったら Reseed を固定にするとその Seed で止まる。Style で楷書 / 行書 / 草書 / 隷書 / 篆書 のパラメータと筆運び (Ease・画の間・速さのばらつき) をまとめて入れられる (そのあと個別に動かせる)。Font はこの端末で使えるものだけ出る。Layout は横組 / 縦組 / ランダム配置と、それをセットごとに選び直す毎回ランダムで、ランダム配置は Placement=構成 ならポスターの型 16 種で組む (大きい字は画面の外へ出る)。1 文字ごとの位置・ずらし・傾き・大きさも指定できる (Size Min と Max を離すと大きさがばらける)。Aspect は文字の縦横比で、Aspect Rand / Slant Rand で 1 文字ごとにばらせる。Random Unit で書体・フォント・筆・配置の変わる単位を 1 文字ごと / 1 セットごと (文章を 1 回書く間) から選ぶ。セットは Reseed=毎回変える なら文章を 1 回書くごとに切り替わる。線が崩れる書体は Smooth / Spur / Merge で骨格を調整する。Random は筆・毛・墨だけを引き直す。",
    "Redraw text skeletons with live brush width, taper, dry ink and bleed. Write = Loop writes stroke by stroke (C restarts). Ease / Ease All and Ease Pow shape timing. Beat Write: A = stroke, B = character, C = full text; Beat Rate and Attack set timing. Beat mode fits each set into Bar Beats. Text Pick reads Word Set lines (use / for line breaks). Exit controls fade, cut or sequential removal; Set Trans keeps text until a Transition. Reseed varies each run; lock it to keep a result. Style applies script and stroke settings. Font lists local fonts. Layout supports horizontal, vertical or random arrangements; Placement adds poster layouts. Per-character position, angle, size, aspect and slant can vary. Random Unit sets changes per character or set. Smooth / Spur / Merge adjust the skeleton. Random changes brush, bristles and ink only."
  ],
  "クラスタ内で次の panel が何 % の大きさになるか": [
    "クラスタ内で次の panel が何 % の大きさになるか",
    "Next panel size within a cluster (%)"
  ],
  "クラスタの広がり (Jitter px に対する %)": [
    "クラスタの広がり (Jitter px に対する %)",
    "Cluster spread relative to Jitter px (%)"
  ],
  "クラスタ中心を焦点へ寄せる": [
    "クラスタ中心を焦点へ寄せる",
    "Pull cluster centers toward the focus"
  ],
  "焦点のページ中心からのずれ": [
    "焦点のページ中心からのずれ",
    "Focus offset from page center"
  ],
  "slide 出現の移動距離": [
    "slide 出現の移動距離",
    "Slide entry distance"
  ],
  "同じクラスタ内の出現のずれ": [
    "同じクラスタ内の出現のずれ",
    "Entry timing offset within a cluster"
  ],
  "パンの振れ幅 (ページに対する %)": [
    "パンの振れ幅 (ページに対する %)",
    "Pan range relative to page size (%)"
  ],
  "ズームの細かい揺れ": [
    "ズームの細かい揺れ",
    "Fine zoom wobble"
  ],
  "縦の周期 (横に対する %)": [
    "縦の周期 (横に対する %)",
    "Vertical cycle length relative to horizontal (%)"
  ],
  "現在のフォルダ・送り拍・順序・フィットをデフォルトとして保存": [
    "現在のフォルダ・送り拍・順序・フィットをデフォルトとして保存",
    "Save folder, beat interval, order and fit as defaults"
  ],
  "いまの設定 (Order / Beats / Fit / Trans / Style) を選択中のフォルダ/画像に保存。次に選んだとき自動で適用される (md と同方式)": [
    "いまの設定 (Order / Beats / Fit / Trans / Style) を選択中のフォルダ/画像に保存。次に選んだとき自動で適用される (md と同方式)",
    "Save Order / Beats / Fit / Trans / Style for this folder or image; apply on its next load"
  ],
  "このフォルダ/画像の保存設定を削除": [
    "このフォルダ/画像の保存設定を削除",
    "Delete saved settings for this folder or image"
  ],
  "beat モード時に何拍ごとに次の画像へ送るか (drone モードでは自動送りなし)": [
    "beat モード時に何拍ごとに次の画像へ送るか (drone モードでは自動送りなし)",
    "Beats between images; no automatic advance in drone mode"
  ],
  "Sequential/Random=自動送り / Single=自動送りなし (Prev/Next で選んだ 1 枚を固定表示)": [
    "Sequential/Random=自動送り / Single=自動送りなし (Prev/Next で選んだ 1 枚を固定表示)",
    "Sequential / Random: auto advance. Single: keep the image selected with Prev / Next."
  ],
  "Contain=全体表示(余白透過) / Cover=画面いっぱい / Drone=ゆっくり寄り引きしながら漂う": [
    "Contain=全体表示(余白透過) / Cover=画面いっぱい / Drone=ゆっくり寄り引きしながら漂う",
    "Contain: fit whole image with transparent margins. Cover: fill frame. Drone: drift with slow zoom."
  ],
  "画像切替のトランジション: Trans 連動=Timing タブの Transition の Beat 設定 / カット=即時 / 拍数=その長さで全画面トランジション": [
    "画像切替のトランジション: Trans 連動=Timing タブの Transition の Beat 設定 / カット=即時 / 拍数=その長さで全画面トランジション",
    "Image transition length: linked = Timing Transition Beat; Cut = instant; beat count = full-frame transition length"
  ],
  "画像切替の演出: Style 連動=Timing タブの Transition の Trans Style / なし=素の Crossfade": [
    "画像切替の演出: Style 連動=Timing タブの Transition の Trans Style / なし=素の Crossfade",
    "Image transition style: linked = Timing Trans Style; None = plain crossfade"
  ],
  "画像の回転 (度)。画像の外は透明": [
    "画像の回転 (度)。画像の外は透明",
    "Image rotation in degrees; outside the image is transparent"
  ],
  "回転の揺れ幅 (度)。ゆっくり左右に揺れる": [
    "回転の揺れ幅 (度)。ゆっくり左右に揺れる",
    "Rotation sway in degrees"
  ],
  "横の傾き (度)": [
    "横の傾き (度)",
    "Horizontal tilt in degrees"
  ],
  "縦の傾き (度)": [
    "縦の傾き (度)",
    "Vertical tilt in degrees"
  ],
  "台形ゆがみ (%)。+ で上が狭く / - で下が狭く": [
    "台形ゆがみ (%)。+ で上が狭く / - で下が狭く",
    "Keystone (%): positive narrows the top; negative narrows the bottom"
  ],
  "横幅の比率 (%)": [
    "横幅の比率 (%)",
    "Width ratio (%)"
  ],
  "鏡像: 中心線で折り返す": [
    "鏡像: 中心線で折り返す",
    "Mirror across the center line"
  ],
  "敷き詰め: 1 辺に足す枚数 (0=1 枚のまま)": [
    "敷き詰め: 1 辺に足す枚数 (0=1 枚のまま)",
    "Tiling: extra copies per side (0 = one image)"
  ],
  "敷き詰めを交互に裏返す (継ぎ目がつながる)": [
    "敷き詰めを交互に裏返す (継ぎ目がつながる)",
    "Alternate mirrored tiles for seamless edges"
  ],
  "万華鏡の分割数 (0=なし)": [
    "万華鏡の分割数 (0=なし)",
    "Kaleidoscope segments (0 = off)"
  ],
  "樽型 / 糸巻き型のゆがみ (%)": [
    "樽型 / 糸巻き型のゆがみ (%)",
    "Barrel / pincushion distortion (%)"
  ],
  "中心のねじれ (度)": [
    "中心のねじれ (度)",
    "Center twist (degrees)"
  ],
  "波ゆがみの振れ幅 (%)": [
    "波ゆがみの振れ幅 (%)",
    "Wave distortion amplitude (%)"
  ],
  "波ゆがみの山の数 (Wave Amp が 1 以上のとき)": [
    "波ゆがみの山の数 (Wave Amp が 1 以上のとき)",
    "Wave count (when Wave Amp is at least 1)"
  ],
  "モザイクの粗さ (%)": [
    "モザイクの粗さ (%)",
    "Mosaic size (%)"
  ],
  "色ずれ (RGB の分離幅 %)": [
    "色ずれ (RGB の分離幅 %)",
    "RGB separation (%)"
  ],
  "色ずれの向き (度) (Chroma Split が 1 以上のとき)": [
    "色ずれの向き (度) (Chroma Split が 1 以上のとき)",
    "RGB separation angle (degrees; Chroma Split ≥ 1)"
  ],
  "画像の角丸 (%)。画像の外は透明": [
    "画像の角丸 (%)。画像の外は透明",
    "Corner radius (%); outside the image is transparent"
  ],
  "画像の縁のぼかし (%)。画像の外は透明": [
    "画像の縁のぼかし (%)。画像の外は透明",
    "Edge softness (%); outside the image is transparent"
  ],
  "Drone の基本ズーム (%)": [
    "Drone の基本ズーム (%)",
    "Base Drone zoom (%)"
  ],
  "Drone の寄り引きの振れ幅 (%)": [
    "Drone の寄り引きの振れ幅 (%)",
    "Drone zoom range (%)"
  ],
  "Drone の漂いの大きさ (%)": [
    "Drone の漂いの大きさ (%)",
    "Drone drift range (%)"
  ],
  "画像を切り替えるときの内蔵クロスフェードの長さ (Trans がカット以外のとき)": [
    "画像を切り替えるときの内蔵クロスフェードの長さ (Trans がカット以外のとき)",
    "Built-in crossfade duration between images (unless Trans is Cut)"
  ],
  "前の画像": [
    "前の画像",
    "Previous image"
  ],
  "次の画像 (C キーでも送り)": [
    "次の画像 (C キーでも送り)",
    "Next image (also C)"
  ],
  "選択中の画像に現在のパラメータをデフォルトとして保存": [
    "選択中の画像に現在のパラメータをデフォルトとして保存",
    "Save current parameters as defaults for this image"
  ],
  "images/slicer/ を再スキャン": [
    "images/slicer/ を再スキャン",
    "Rescan images/slicer/"
  ],
  "画像とシードをランダムに選び直す (保存は右上の Save)": [
    "画像とシードをランダムに選び直す (保存は右上の Save)",
    "Pick a random image and seed; use Save to keep them"
  ],
  "Random スロット選択時に画像を切り替える拍数 (0=自動切替なし)": [
    "Random スロット選択時に画像を切り替える拍数 (0=自動切替なし)",
    "Beats between images in the Random slot (0 = no auto change)"
  ],
  "空間全体を波打たせる (M006 相当・アニメ)": [
    "空間全体を波打たせる (M006 相当・アニメ)",
    "Animate waves through the entire space (like M006)"
  ],
  "断片の大きさ": [
    "断片の大きさ",
    "Fragment size"
  ],
  "小さい断片の割合": [
    "小さい断片の割合",
    "Share of small fragments"
  ],
  "大きい断片の割合": [
    "大きい断片の割合",
    "Share of large fragments"
  ],
  "断片を撒く幅": [
    "断片を撒く幅",
    "Fragment spread width"
  ],
  "断片を撒く高さ": [
    "断片を撒く高さ",
    "Fragment spread height"
  ],
  "多角形の断片へ置き換える割合": [
    "多角形の断片へ置き換える割合",
    "Share of polygon fragments"
  ],
  "細い針の断片へ置き換える割合": [
    "細い針の断片へ置き換える割合",
    "Share of needle fragments"
  ],
  "断片の向きを揃える": [
    "断片の向きを揃える",
    "Align fragment directions"
  ],
  "揃える向き": [
    "揃える向き",
    "Alignment direction"
  ],
  "断片の傾き": [
    "断片の傾き",
    "Fragment tilt"
  ],
  "断片の奥行きの散らばり": [
    "断片の奥行きの散らばり",
    "Fragment depth spread"
  ],
  "Curl のうねりの細かさ": [
    "Curl のうねりの細かさ",
    "Curl noise frequency"
  ],
  "断片に写る画像の拡大": [
    "断片に写る画像の拡大",
    "Image scale on fragments"
  ],
  "断片に写る画像の回転": [
    "断片に写る画像の回転",
    "Image rotation on fragments"
  ],
  "断片の浮遊の振れ幅": [
    "断片の浮遊の振れ幅",
    "Fragment drift range"
  ],
  "パラメータ + カメラを自動変調": [
    "パラメータ + カメラを自動変調",
    "Auto-modulate parameters and camera"
  ],
  "Auto: 拍ごとに断片配置を組み直す割合": [
    "Auto: 拍ごとに断片配置を組み直す割合",
    "Auto: share of fragments rearranged per beat"
  ],
  "カメラの回転": [
    "カメラの回転",
    "Camera rotation"
  ],
  "カメラの方位のずれ": [
    "カメラの方位のずれ",
    "Camera azimuth offset"
  ],
  "注視点の X": [
    "注視点の X",
    "Target X"
  ],
  "注視点の Y": [
    "注視点の Y",
    "Target Y"
  ],
  "断片に掛ける色": [
    "断片に掛ける色",
    "Fragment tint"
  ],
  "断片の彩度 (背景には掛けない)": [
    "断片の彩度 (背景には掛けない)",
    "Fragment saturation; excludes background"
  ],
  "奥の断片を暗くする": [
    "奥の断片を暗くする",
    "Darken distant fragments"
  ],
  "BG=Color のときの背景色 (Slot A で敷く / Slot B は透過)": [
    "BG=Color のときの背景色 (Slot A で敷く / Slot B は透過)",
    "Background when BG = Color; Slot A only (Slot B stays transparent)"
  ],
  "低いほど高速 (0.5=1/4 pixel)": [
    "低いほど高速 (0.5=1/4 pixel)",
    "Lower is faster (0.5 = one quarter of the pixels)"
  ],
  "インク場の切替を拍に同期": [
    "インク場の切替を拍に同期",
    "Sync ink field changes to beats"
  ],
  "何拍ごとにインク場を切替 (Beat Sync 時)": [
    "何拍ごとにインク場を切替 (Beat Sync 時)",
    "Beats between ink fields with Beat Sync on"
  ],
  "切替周期 (Beat Sync OFF 時)": [
    "切替周期 (Beat Sync OFF 時)",
    "Change interval with Beat Sync off"
  ],
  "インク発生リングの半径": [
    "インク発生リングの半径",
    "Ink source ring radius"
  ],
  "形の大きさ(弧の長さ)": [
    "形の大きさ(弧の長さ)",
    "Shape size (arc length)"
  ],
  "尖り具合(大きいほど尖る)": [
    "尖り具合(大きいほど尖る)",
    "Sharpness; higher is more pointed"
  ],
  "発生形状の歪み": [
    "発生形状の歪み",
    "Source shape distortion"
  ],
  "フィードバック変位(流れの強さ)": [
    "フィードバック変位(流れの強さ)",
    "Feedback displacement (flow strength)"
  ],
  "軌跡が消える速さ": [
    "軌跡が消える速さ",
    "Trail fade rate"
  ],
  "インク場の連続ドリフト": [
    "インク場の連続ドリフト",
    "Continuous ink field drift"
  ],
  "ブリージング(密度増減)の周期(小節)": [
    "ブリージング(密度増減)の周期(小節)",
    "Breathing cycle in bars"
  ],
  "エッジ検出の柔らかさ": [
    "エッジ検出の柔らかさ",
    "Edge detection softness"
  ],
  "Slot B の輪郭線の太さ (px)。0.2 未満は薄くなり 0.1 で極細": [
    "Slot B の輪郭線の太さ (px)。0.2 未満は薄くなり 0.1 で極細",
    "Slot B outline width (px); fades below 0.2, hairline at 0.1"
  ],
  "濃い黒い絵の具版 (低明度 / 鈍いウェット反射)": [
    "濃い黒い絵の具版 (低明度 / 鈍いウェット反射)",
    "Dark black paint with muted wet reflections"
  ],
  "白(左端)→ ドラッグで色相環を回す (Slot A クローム & Slot B ライン共通)": [
    "白(左端)→ ドラッグで色相環を回す (Slot A クローム & Slot B ライン共通)",
    "White at the left end; drag through hues for Slot A chrome and Slot B lines"
  ],
  "ON: Slot A の最も鮮やかで支配的な色相を自動で Hue に適用": [
    "ON: Slot A の最も鮮やかで支配的な色相を自動で Hue に適用",
    "Auto-apply Slot A's dominant vivid hue"
  ],
  "インク発生リングの中心 X (%) (Black / Slot B の線で見える)": [
    "インク発生リングの中心 X (%) (Black / Slot B の線で見える)",
    "Ink ring center X (%); visible in Black / Slot B lines"
  ],
  "インク発生リングの中心 Y (%) (Black / Slot B の線で見える)": [
    "インク発生リングの中心 Y (%) (Black / Slot B の線で見える)",
    "Ink ring center Y (%); visible in Black / Slot B lines"
  ],
  "リングの横幅比 (%)。100=真円 / 大きいほど横長の楕円 (Black / Slot B の線で見える)": [
    "リングの横幅比 (%)。100=真円 / 大きいほど横長の楕円 (Black / Slot B の線で見える)",
    "Ring width ratio (%); 100 = circle, higher = wide ellipse (Black / Slot B lines)"
  ],
  "楕円リングの回転 (度) (Black / Slot B の線で見える)": [
    "楕円リングの回転 (度) (Black / Slot B の線で見える)",
    "Ellipse rotation (degrees; Black / Slot B lines)"
  ],
  "リングの花弁数 (0=真円) (Black / Slot B の線で見える)": [
    "リングの花弁数 (0=真円) (Black / Slot B の線で見える)",
    "Ring petal count (0 = circle; Black / Slot B lines)"
  ],
  "花弁の深さ (%) (Ring Lobes が 1 以上のとき) (Black / Slot B の線で見える)": [
    "花弁の深さ (%) (Ring Lobes が 1 以上のとき) (Black / Slot B の線で見える)",
    "Petal depth (%; Ring Lobes ≥ 1; Black / Slot B lines)"
  ],
  "リング断面の鋭さ (%)。大きいほど芯だけが残る (Black / Slot B の線で見える)": [
    "リング断面の鋭さ (%)。大きいほど芯だけが残る (Black / Slot B の線で見える)",
    "Ring profile sharpness (%); higher leaves only the core (Black / Slot B lines)"
  ],
  "場全体の大きなうねりの振れ幅 (%)": [
    "場全体の大きなうねりの振れ幅 (%)",
    "Large-scale field wave amplitude (%)"
  ],
  "帯の数 (%)": [
    "帯の数 (%)",
    "Band count (%)"
  ],
  "帯の位相の傾き量 (%)": [
    "帯の位相の傾き量 (%)",
    "Band phase tilt (%)"
  ],
  "帯の位相の傾きの向き (度)": [
    "帯の位相の傾きの向き (度)",
    "Band phase tilt direction (degrees)"
  ],
  "渦を拾う間隔 (px)。小さいほど細かい渦": [
    "渦を拾う間隔 (px)。小さいほど細かい渦",
    "Curl sampling interval (px); smaller gives finer swirls"
  ],
  "流れの向き (度)。0=等高線に沿う渦 / 90=外へ広がる流れ": [
    "流れの向き (度)。0=等高線に沿う渦 / 90=外へ広がる流れ",
    "Flow direction (degrees): 0 follows contours; 90 flows outward"
  ],
  "フィードバックの拡大縮小 (%)。+ で内側へ吸い込み / - で外へ広がる": [
    "フィードバックの拡大縮小 (%)。+ で内側へ吸い込み / - で外へ広がる",
    "Feedback scale (%): positive draws inward; negative spreads outward"
  ],
  "フィードバックの回転 (%)": [
    "フィードバックの回転 (%)",
    "Feedback rotation (%)"
  ],
  "クロームの流れ場の大きさ (%)": [
    "クロームの流れ場の大きさ (%)",
    "Chrome flow field scale (%)"
  ],
  "クロームの流れ場の入れ替わる速さ (%)": [
    "クロームの流れ場の入れ替わる速さ (%)",
    "Chrome flow field change rate (%)"
  ],
  "ブリージングで密度が下がる下限 (%)。100=ブリージングなし": [
    "ブリージングで密度が下がる下限 (%)。100=ブリージングなし",
    "Minimum breathing density (%); 100 = no breathing"
  ],
  "反射の曲がり量 (%)": [
    "反射の曲がり量 (%)",
    "Reflection curvature (%)"
  ],
  "反射の滑らかさの幅 (%)": [
    "反射の滑らかさの幅 (%)",
    "Reflection smoothing width (%)"
  ],
  "反射の上下グラデの強さ (%)": [
    "反射の上下グラデの強さ (%)",
    "Vertical reflection gradient strength (%)"
  ],
  "暗い境目の濃さ (%)": [
    "暗い境目の濃さ (%)",
    "Dark boundary intensity (%)"
  ],
  "境目を拾う感度 (%)": [
    "境目を拾う感度 (%)",
    "Boundary sensitivity (%)"
  ],
  "暗い境目の色の掛け算ティント (白=そのまま)": [
    "暗い境目の色の掛け算ティント (白=そのまま)",
    "Dark boundary tint (multiply; white = unchanged)"
  ],
  "Hue の色の濃さ (%)": [
    "Hue の色の濃さ (%)",
    "Hue saturation (%)"
  ],
  "Slot B: インクの塊を塗りつぶす濃さ (%)": [
    "Slot B: インクの塊を塗りつぶす濃さ (%)",
    "Slot B ink fill opacity (%)"
  ],
  "Black のウェット反射の強さ (%)": [
    "Black のウェット反射の強さ (%)",
    "Black paint wet reflection strength (%)"
  ],
  "panel のランダム回転の振れ幅": [
    "panel のランダム回転の振れ幅",
    "Random panel rotation range"
  ],
  "panel の縦の伸縮": [
    "panel の縦の伸縮",
    "Panel vertical stretch"
  ],
  "panel の不透明度 (重なりが透ける)": [
    "panel の不透明度 (重なりが透ける)",
    "Panel opacity; reveal overlapping panels"
  ],
  "panel の縁取りの太さ (panel 幅に対する %)": [
    "panel の縁取りの太さ (panel 幅に対する %)",
    "Panel outline width (% of panel width)"
  ],
  "panel の落ち影": [
    "panel の落ち影",
    "Panel drop shadow"
  ],
  "panel の彩度 (背景には掛けない)": [
    "panel の彩度 (背景には掛けない)",
    "Panel saturation; excludes background"
  ],
  "panel に掛ける色": [
    "panel に掛ける色",
    "Panel tint"
  ],
  "表示の回転": [
    "表示の回転",
    "View rotation"
  ],
  "ページの繰り返し数 (100%=1 枚, 200%=2×2 ...)": [
    "ページの繰り返し数 (100%=1 枚, 200%=2×2 ...)",
    "Page tiling (100% = one page, 200% = 2×2)"
  ],
  "モザイクの大きさ": [
    "モザイクの大きさ",
    "Mosaic size"
  ],
  "RGB の色ずれ": [
    "RGB の色ずれ",
    "RGB separation"
  ],
  "波打ちの振れ幅": [
    "波打ちの振れ幅",
    "Wave amplitude"
  ],
  "波の本数": [
    "波の本数",
    "Wave count"
  ],
  "周辺減光": [
    "周辺減光",
    "Vignette"
  ],
  "粒": [
    "粒",
    "Grain"
  ],
  "Post FX 全体を既定値へ戻す (確認あり)": [
    "Post FX 全体を既定値へ戻す (確認あり)",
    "Reset all Post FX to defaults (with confirmation)"
  ],
  "色調の現在値を既定値として保存": [
    "色調の現在値を既定値として保存",
    "Save current color settings as defaults"
  ],
  "保存した色調の既定値へ戻す (保存が無ければ初期値)": [
    "保存した色調の既定値へ戻す (保存が無ければ初期値)",
    "Restore saved color defaults, or original values if none are saved"
  ],
  "抽出色でもう片方のスロットを再彩色 (Grad Map より先に適用)": [
    "抽出色でもう片方のスロットを再彩色 (Grad Map より先に適用)",
    "Recolor the other slot with sampled colors, before Grad Map"
  ],
  "正=B を A のパレットへ / 負=A を B のパレットへ / 0=なし (ホットキー: A = アクティブスロットへ適用)": [
    "正=B を A のパレットへ / 負=A を B のパレットへ / 0=なし (ホットキー: A = アクティブスロットへ適用)",
    "Positive: map B to A's palette. Negative: map A to B. 0: off. A applies to the active slot."
  ],
  "自然な彩度: 低彩度ほど強く持ち上げ、既に鮮やかな色とハイライトは保護(負で控えめに脱色)": [
    "自然な彩度: 低彩度ほど強く持ち上げ、既に鮮やかな色とハイライトは保護(負で控えめに脱色)",
    "Vibrance: boost muted colors while protecting vivid colors and highlights; negative values gently desaturate"
  ],
  "輝度→2色グラデーション (中央0、負値で反転)": [
    "輝度→2色グラデーション (中央0、負値で反転)",
    "Map brightness to a two-color gradient (0 = off; negative = reversed)"
  ],
  "クリック or 数字キー 1〜9,0 で適用": [
    "クリック or 数字キー 1〜9,0 で適用",
    "Click or press 1–9 / 0 to apply"
  ],
  "バー=ストップ追加 / つまみ: ドラッグ=移動・クリック=色変更・バー外(下)へドラッグ=削除": [
    "バー=ストップ追加 / つまみ: ドラッグ=移動・クリック=色変更・バー外(下)へドラッグ=削除",
    "Click bar to add a stop; drag to move, click to change color, drag below bar to remove"
  ],
  "Visual から生成 (印象的な色 + グレーで、元の絵の色味を保つグラデを作る)": [
    "Visual から生成 (印象的な色 + グレーで、元の絵の色味を保つグラデを作る)",
    "Generate a gradient from the Visual's key colors and grays"
  ],
  "現在のグラデを名前付きで新規保存": [
    "現在のグラデを名前付きで新規保存",
    "Save this gradient with a new name"
  ],
  "色温度 (− = 寒色 / + = 暖色)": [
    "色温度 (− = 寒色 / + = 暖色)",
    "Color temperature: − cool / + warm"
  ],
  "色被り補正 (− = グリーン / + = マゼンタ)": [
    "色被り補正 (− = グリーン / + = マゼンタ)",
    "Tint correction: − green / + magenta"
  ],
  "表示する項目 (隠した項目の値もそのまま掛かる)": [
    "表示する項目 (隠した項目の値もそのまま掛かる)",
    "Visible controls; hidden settings still apply"
  ],
  "色相の帯ごとに色相を回す": [
    "色相の帯ごとに色相を回す",
    "Rotate hue by color band"
  ],
  "色相の帯ごとに彩度を変える": [
    "色相の帯ごとに彩度を変える",
    "Adjust saturation by color band"
  ],
  "色相の帯ごとに明度を変える": [
    "色相の帯ごとに明度を変える",
    "Adjust brightness by color band"
  ],
  "赤 (0°)の色相 (−1〜1 = −180°〜+180°)": [
    "赤 (0°)の色相 (−1〜1 = −180°〜+180°)",
    "Red (0°) hue: −1…1 = −180°…180°"
  ],
  "橙 (30°)の色相 (−1〜1 = −180°〜+180°)": [
    "橙 (30°)の色相 (−1〜1 = −180°〜+180°)",
    "Orange (30°) hue: −1…1 = −180°…180°"
  ],
  "黄 (60°)の色相 (−1〜1 = −180°〜+180°)": [
    "黄 (60°)の色相 (−1〜1 = −180°〜+180°)",
    "Yellow (60°) hue: −1…1 = −180°…180°"
  ],
  "緑 (120°)の色相 (−1〜1 = −180°〜+180°)": [
    "緑 (120°)の色相 (−1〜1 = −180°〜+180°)",
    "Green (120°) hue: −1…1 = −180°…180°"
  ],
  "水色 (180°)の色相 (−1〜1 = −180°〜+180°)": [
    "水色 (180°)の色相 (−1〜1 = −180°〜+180°)",
    "Cyan (180°) hue: −1…1 = −180°…180°"
  ],
  "青 (240°)の色相 (−1〜1 = −180°〜+180°)": [
    "青 (240°)の色相 (−1〜1 = −180°〜+180°)",
    "Blue (240°) hue: −1…1 = −180°…180°"
  ],
  "紫 (270°)の色相 (−1〜1 = −180°〜+180°)": [
    "紫 (270°)の色相 (−1〜1 = −180°〜+180°)",
    "Violet (270°) hue: −1…1 = −180°…180°"
  ],
  "赤紫 (300°)の色相 (−1〜1 = −180°〜+180°)": [
    "赤紫 (300°)の色相 (−1〜1 = −180°〜+180°)",
    "Magenta (300°) hue: −1…1 = −180°…180°"
  ],
  "赤 (0°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "赤 (0°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Red (0°) saturation: −1 = gray / +1 = double"
  ],
  "橙 (30°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "橙 (30°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Orange (30°) saturation: −1 = gray / +1 = double"
  ],
  "黄 (60°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "黄 (60°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Yellow (60°) saturation: −1 = gray / +1 = double"
  ],
  "緑 (120°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "緑 (120°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Green (120°) saturation: −1 = gray / +1 = double"
  ],
  "水色 (180°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "水色 (180°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Cyan (180°) saturation: −1 = gray / +1 = double"
  ],
  "青 (240°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "青 (240°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Blue (240°) saturation: −1 = gray / +1 = double"
  ],
  "紫 (270°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "紫 (270°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Violet (270°) saturation: −1 = gray / +1 = double"
  ],
  "赤紫 (300°)の彩度 (−1 = 無彩色 / +1 = 2 倍)": [
    "赤紫 (300°)の彩度 (−1 = 無彩色 / +1 = 2 倍)",
    "Magenta (300°) saturation: −1 = gray / +1 = double"
  ],
  "赤 (0°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "赤 (0°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Red (0°) brightness: −1 = darker / +1 = lighter"
  ],
  "橙 (30°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "橙 (30°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Orange (30°) brightness: −1 = darker / +1 = lighter"
  ],
  "黄 (60°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "黄 (60°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Yellow (60°) brightness: −1 = darker / +1 = lighter"
  ],
  "緑 (120°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "緑 (120°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Green (120°) brightness: −1 = darker / +1 = lighter"
  ],
  "水色 (180°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "水色 (180°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Cyan (180°) brightness: −1 = darker / +1 = lighter"
  ],
  "青 (240°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "青 (240°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Blue (240°) brightness: −1 = darker / +1 = lighter"
  ],
  "紫 (270°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "紫 (270°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Violet (270°) brightness: −1 = darker / +1 = lighter"
  ],
  "赤紫 (300°)の明度 (−1 = 暗く / +1 = 明るく)": [
    "赤紫 (300°)の明度 (−1 = 暗く / +1 = 明るく)",
    "Magenta (300°) brightness: −1 = darker / +1 = lighter"
  ],
  "色反転 (hue も180°回転)": [
    "色反転 (hue も180°回転)",
    "Invert colors, including a 180° hue shift"
  ],
  "Qualityの現在値を既定値として保存": [
    "Qualityの現在値を既定値として保存",
    "Save Quality settings as defaults"
  ],
  "保存したQualityの既定値へ戻す (保存が無ければ初期値)": [
    "保存したQualityの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Quality defaults, or original values"
  ],
  "エッジ保存平滑: 輪郭を残して面のノイズ/圧縮の粗れを均す(バイラテラル風)": [
    "エッジ保存平滑: 輪郭を残して面のノイズ/圧縮の粗れを均す(バイラテラル風)",
    "Edge-preserving smoothing: reduce noise and compression artifacts while keeping outlines"
  ],
  "バンディング除去: グラデーションの段差を溶かして微細ディザで均す": [
    "バンディング除去: グラデーションの段差を溶かして微細ディザで均す",
    "Debanding: soften gradient steps with fine dithering"
  ],
  "CAS風の適応シャープ: 局所コントラストが低い所ほど強く輪郭を立てる(ノイズを増幅しにくい)": [
    "CAS風の適応シャープ: 局所コントラストが低い所ほど強く輪郭を立てる(ノイズを増幅しにくい)",
    "Adaptive sharpening: sharpen low-contrast areas more, with less noise amplification"
  ],
  "Textureの現在値を既定値として保存": [
    "Textureの現在値を既定値として保存",
    "Save Texture settings as defaults"
  ],
  "保存したTextureの既定値へ戻す (保存が無ければ初期値)": [
    "保存したTextureの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Texture defaults, or original values"
  ],
  "中央0=無効。正=黒い走査線、負=白い走査線": [
    "中央0=無効。正=黒い走査線、負=白い走査線",
    "0 = off; positive = black scanlines; negative = white scanlines"
  ],
  "正=黒みがかったノイズ / 負=白みがかったノイズ (静的)": [
    "正=黒みがかったノイズ / 負=白みがかったノイズ (静的)",
    "Positive = dark noise; negative = light noise (static)"
  ],
  "Materialの現在値を既定値として保存": [
    "Materialの現在値を既定値として保存",
    "Save Material settings as defaults"
  ],
  "保存したMaterialの既定値へ戻す (保存が無ければ初期値)": [
    "保存したMaterialの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Material defaults, or original values"
  ],
  "Rain Screen: ガラスに付いた雨粒で映像を屈折 (4ljXDy)": [
    "Rain Screen: ガラスに付いた雨粒で映像を屈折 (4ljXDy)",
    "Rain Screen: refract the image through raindrops on glass (4ljXDy)"
  ],
  "Water: fBMノイズで画面を水面のように歪ませる (lt33zn)": [
    "Water: fBMノイズで画面を水面のように歪ませる (lt33zn)",
    "Water: distort the image with fBM waves (lt33zn)"
  ],
  "0=off。値で運動の強弱・速さ。攪拌の向きはランダム": [
    "0=off。値で運動の強弱・速さ。攪拌の向きはランダム",
    "0 = off; controls motion strength and speed, with random stirring directions"
  ],
  "Relief (旧Chrome Relief): 輝度勾配法線に金属スペキュラ+フレネル。プラスチック/金属のレリーフ": [
    "Relief (旧Chrome Relief): 輝度勾配法線に金属スペキュラ+フレネル。プラスチック/金属のレリーフ",
    "Relief: metallic highlights and Fresnel reflections on brightness-based normals"
  ],
  "1 = 物体だけに掛ける (A BG の色の所には掛けない) / 0 = 背景にも掛ける (従来)": [
    "1 = 物体だけに掛ける (A BG の色の所には掛けない) / 0 = 背景にも掛ける (従来)",
    "1 = objects only, excluding A BG; 0 = include background"
  ],
  "水彩/インクのにじみ。輪郭が滲んで溶け、エッジに顔料の暗溜まりが出る": [
    "水彩/インクのにじみ。輪郭が滲んで溶け、エッジに顔料の暗溜まりが出る",
    "Watercolor / ink bleed: dissolve edges with dark pigment pooling"
  ],
  "油絵の厚塗り。絵の具の盛り上がり・筆すじ・艶が乗る(色は保持)": [
    "油絵の厚塗り。絵の具の盛り上がり・筆すじ・艶が乗る(色は保持)",
    "Impasto: raised paint, brush marks and gloss; preserves colors"
  ],
  "液体金属(マットキャップ)。スタジオ照明の映り込みで全体を金属質に。光源はゆっくり回転": [
    "液体金属(マットキャップ)。スタジオ照明の映り込みで全体を金属質に。光源はゆっくり回転",
    "Liquid metal with rotating studio reflections (matcap)"
  ],
  "起伏の高さ (0.5 = 従来)": [
    "起伏の高さ (0.5 = 従来)",
    "Relief height (0.5 = original)"
  ],
  "縁の幅 (0.5 = 従来)": [
    "縁の幅 (0.5 = 従来)",
    "Edge width (0.5 = original)"
  ],
  "映り込みの明暗の振れ (0.5 = 従来)": [
    "映り込みの明暗の振れ (0.5 = 従来)",
    "Reflection contrast (0.5 = original)"
  ],
  "映像の色の乗り (0 = 銀一色 / 0.35 = 従来)": [
    "映像の色の乗り (0 = 銀一色 / 0.35 = 従来)",
    "Source color strength (0 = silver; 0.35 = original)"
  ],
  "グリント (光の粒) の強さ (0.5 = 従来)": [
    "グリント (光の粒) の強さ (0.5 = 従来)",
    "Glint intensity (0.5 = original)"
  ],
  "グリントの鋭さ (0.5 = 従来)": [
    "グリントの鋭さ (0.5 = 従来)",
    "Glint sharpness (0.5 = original)"
  ],
  "縁の青い光の強さ (0.5 = 従来)": [
    "縁の青い光の強さ (0.5 = 従来)",
    "Blue rim light intensity (0.5 = original)"
  ],
  "光源が回る速さ (0 = 止める / 0.5 = 従来)": [
    "光源が回る速さ (0 = 止める / 0.5 = 従来)",
    "Light rotation speed (0 = stop; 0.5 = original)"
  ],
  "光沢: 輝度の起伏に濡れたクリアコートをかける。元の色は残し、濡れ色 + ハイライト + 映り込みの帯を足す": [
    "光沢: 輝度の起伏に濡れたクリアコートをかける。元の色は残し、濡れ色 + ハイライト + 映り込みの帯を足す",
    "Gloss: wet clearcoat on brightness relief, adding deeper colors, highlights and reflection bands"
  ],
  "起伏の高さとなだらかさ": [
    "起伏の高さとなだらかさ",
    "Relief height and smoothness"
  ],
  "ハイライトの鋭さ (高い = 小さく鋭い点)": [
    "ハイライトの鋭さ (高い = 小さく鋭い点)",
    "Highlight sharpness; higher gives smaller, sharper spots"
  ],
  "ハイライトと映り込みの強さ": [
    "ハイライトと映り込みの強さ",
    "Highlight and reflection intensity"
  ],
  "濡れ色の深さ (色を少し深く・鮮やかに)": [
    "濡れ色の深さ (色を少し深く・鮮やかに)",
    "Wet color depth; makes colors deeper and richer"
  ],
  "光源が回る速さ (0 = 止める)": [
    "光源が回る速さ (0 = 止める)",
    "Light rotation speed (0 = stop)"
  ],
  "小説化: 画面を字のマス目に割り、明るさに応じて C007 の本文の字で描き直す。3D FX の前に掛かるので紙の柄として一緒に折れる": [
    "小説化: 画面を字のマス目に割り、明るさに応じて C007 の本文の字で描き直す。3D FX の前に掛かるので紙の柄として一緒に折れる",
    "Novel: redraw brightness as a grid of characters from C007 text. Applied before 3D FX, so it folds with the paper."
  ],
  "字の大きさ (マスの大きさ)": [
    "字の大きさ (マスの大きさ)",
    "Character / grid cell size"
  ],
  "字を置く明るさのしきい値 (高い = 明るい所だけ)": [
    "字を置く明るさのしきい値 (高い = 明るい所だけ)",
    "Brightness threshold; higher draws only bright areas"
  ],
  "字の色: 0 = 生成りの単色 / 1 = 元の画面の色。分版 (Sep) では 0 = グレーの版 / 1 = 版の色 (R G B C M Y)": [
    "字の色: 0 = 生成りの単色 / 1 = 元の画面の色。分版 (Sep) では 0 = グレーの版 / 1 = 版の色 (R G B C M Y)",
    "Text color: 0 = cream, 1 = source colors. In Sep mode: 0 = gray plates, 1 = plate colors (RGB / CMY)."
  ],
  "本文が流れる速さ (0 = 止める)": [
    "本文が流れる速さ (0 = 止める)",
    "Text scroll speed (0 = stop)"
  ],
  "地: 0 = Slot A 背景色 (Option のカラーサークル / スポイトで変わる色) / 1 = 元の画面": [
    "地: 0 = Slot A 背景色 (Option のカラーサークル / スポイトで変わる色) / 1 = 元の画面",
    "Background: 0 = Slot A background color; 1 = source image"
  ],
  "1 = 縦組み (右から左へ) / 0 = 横組み": [
    "1 = 縦組み (右から左へ) / 0 = 横組み",
    "1 = vertical, right to left; 0 = horizontal"
  ],
  "3D Mode の深度で字のマス目を面に沿わせる量 (深度を出すシェーダ + FX の 3D Depth が 0 より大きいとき)": [
    "3D Mode の深度で字のマス目を面に沿わせる量 (深度を出すシェーダ + FX の 3D Depth が 0 より大きいとき)",
    "Align the text grid to 3D Mode depth; requires a depth shader and 3D Depth > 0"
  ],
  "字間 (字送り): 左 = 詰める / 0.2 = ベタ組み / 右 = 空ける": [
    "字間 (字送り): 左 = 詰める / 0.2 = ベタ組み / 右 = 空ける",
    "Tracking: left = tight; 0.2 = solid; right = loose"
  ],
  "行間 (行送り): 左 = 行がくっつく / 0.2 = 1.3 字 / 右 = 大きく空ける": [
    "行間 (行送り): 左 = 行がくっつく / 0.2 = 1.3 字 / 右 = 大きく空ける",
    "Line spacing: left = touching; 0.2 = 1.3 characters; right = wide"
  ],
  "縦組みと横組みを入れ替える間隔: 0 = 入れ替えない / 上げるほど短く (16・8・4・2・1 拍)。クラスターもこのたびに組み直す。drone では 120BPM 換算の時間": [
    "縦組みと横組みを入れ替える間隔: 0 = 入れ替えない / 上げるほど短く (16・8・4・2・1 拍)。クラスターもこのたびに組み直す。drone では 120BPM 換算の時間",
    "Switch horizontal / vertical layout and rebuild clusters. 0 = off; higher = 16 / 8 / 4 / 2 / 1 beats. Drone uses 120 BPM timing."
  ],
  "大きさと組み方向の違う字の塊の数 (0〜6)。全面の格子の上に重なる": [
    "大きさと組み方向の違う字の塊の数 (0〜6)。全面の格子の上に重なる",
    "Text clusters with varied size and orientation (0–6), over the full grid"
  ],
  "全面の格子の濃さ (0 = クラスターだけ)": [
    "全面の格子の濃さ (0 = クラスターだけ)",
    "Full grid opacity (0 = clusters only)"
  ],
  "字の大きさが変わる頻度: 0 = 変えない / 上げるほど短い間隔 (8・4・2・1・1/2 拍) で、全面の格子とクラスターの字の大きさを引き直す": [
    "字の大きさが変わる頻度: 0 = 変えない / 上げるほど短い間隔 (8・4・2・1・1/2 拍) で、全面の格子とクラスターの字の大きさを引き直す",
    "Text size change rate: 0 = off; higher = 8 / 4 / 2 / 1 / ½ beats for grid and clusters"
  ],
  "分版: 0 = しない / 〜1/3 = RGB + 明度 / 〜2/3 = CMYK / それ以上 = 全 8 版。版ごとに画面を不揃いな区画に割り (区画の数 = Cluster)、区画ごとに字の大きさと組み方向を変える。字の明るさ = 版の濃さ。版はグレーで描き、重ねて一枚の絵に戻す (地が暗いと白の光、明るいと黒のインク)。全面の格子とクラスターの代わりに出る": [
    "分版: 0 = しない / 〜1/3 = RGB + 明度 / 〜2/3 = CMYK / それ以上 = 全 8 版。版ごとに画面を不揃いな区画に割り (区画の数 = Cluster)、区画ごとに字の大きさと組み方向を変える。字の明るさ = 版の濃さ。版はグレーで描き、重ねて一枚の絵に戻す (地が暗いと白の光、明るいと黒のインク)。全面の格子とクラスターの代わりに出る",
    "Color separation: 0 = off; up to ⅓ = RGB + brightness; up to ⅔ = CMYK; above = all 8 plates. Cluster sets region count, each with its own size and direction. Gray plates recombine as light on dark backgrounds or ink on light ones; replaces the grid and clusters."
  ],
  "字の大小で階調を出す割合: 0 = 明るさ (字の濃さ) で出す / 1 = 大きさで出す (明るい所ほど字が大きく、暗い所ほど小さい。網点の代わり)": [
    "字の大小で階調を出す割合: 0 = 明るさ (字の濃さ) で出す / 1 = 大きさで出す (明るい所ほど字が大きく、暗い所ほど小さい。網点の代わり)",
    "Tone by character size: 0 = opacity; 1 = size (larger in bright areas)"
  ],
  "3D の形を残す量: 元のシェーダの深度 (3D Mode) から面の向きを出して字に陰影をつけ、深度の段に輪郭線を引き、物体の外の字を沈める (深度を出すシェーダ + FX の 3D Depth が 0 より大きいとき)": [
    "3D の形を残す量: 元のシェーダの深度 (3D Mode) から面の向きを出して字に陰影をつけ、深度の段に輪郭線を引き、物体の外の字を沈める (深度を出すシェーダ + FX の 3D Depth が 0 より大きいとき)",
    "Preserve 3D form with depth-based shading, contour lines and dimmed outside text; requires depth and 3D Depth > 0"
  ],
  "Pollock をオン / オフ (量と詳細値は保持)": [
    "Pollock をオン / オフ (量と詳細値は保持)",
    "Turn Pollock on or off (keep amount and detail settings)"
  ],
  "Pollock の種類 (詳細値は全種類で共通)": [
    "Pollock の種類 (詳細値は全種類で共通)",
    "Pollock type (all types share the detail settings)"
  ],
  "Pollock の量。オンのとき現フレームを捕獲して徐々に描く (0 = 効果なし)": [
    "Pollock の量。オンのとき現フレームを捕獲して徐々に描く (0 = 効果なし)",
    "Pollock amount: capture the frame and gradually paint it when on (0 = no effect)"
  ],
  "筆の太さ (0.5 = 従来)": [
    "筆の太さ (0.5 = 従来)",
    "Brush width (0.5 = original)"
  ],
  "一筆の長さ (0.5 = 従来)": [
    "一筆の長さ (0.5 = 従来)",
    "Stroke length (0.5 = original)"
  ],
  "描き足す速さ・量 (0.5 = 従来。上げると重くなる)": [
    "描き足す速さ・量 (0.5 = 従来。上げると重くなる)",
    "Paint rate / amount (0.5 = original); higher is slower to render"
  ],
  "しずく・飛び散りの量 (0 = なし / 0.5 = 従来)": [
    "しずく・飛び散りの量 (0 = なし / 0.5 = 従来)",
    "Drips / splashes (0 = none; 0.5 = original)"
  ],
  "線の曲がり (0 = まっすぐ / 0.5 = 従来)": [
    "線の曲がり (0 = まっすぐ / 0.5 = 従来)",
    "Stroke curvature (0 = straight; 0.5 = original)"
  ],
  "塗りが残る長さ (0 = すぐ消える / 0.5 = 従来 / 1 = 長く残る)": [
    "塗りが残る長さ (0 = すぐ消える / 0.5 = 従来 / 1 = 長く残る)",
    "Paint persistence (0 = short; 0.5 = original; 1 = long)"
  ],
  "塗りの厚み・陰影の強さ (0 = 平ら / 0.5 = 従来)": [
    "塗りの厚み・陰影の強さ (0 = 平ら / 0.5 = 従来)",
    "Paint relief / shading (0 = flat; 0.5 = original)"
  ],
  "3Dの現在値を既定値として保存": [
    "3Dの現在値を既定値として保存",
    "Save 3D settings as defaults"
  ],
  "保存した3Dの既定値へ戻す (保存が無ければ初期値)": [
    "保存した3Dの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved 3D defaults, or original values"
  ],
  "Extrude: 画面の絵を形に沿って厚みのある立体に押し出し、カメラを少し傾けて見せる。形 = 背景が透過のフレーム (3D Target = Object で深度を出す Visual など) は透けていない所、それ以外は地 (画面の縁の色) と違う所。地は押し出しの奥に床として残る。値=厚み・傾き (0=元画像→1=全開)": [
    "Extrude: 画面の絵を形に沿って厚みのある立体に押し出し、カメラを少し傾けて見せる。形 = 背景が透過のフレーム (3D Target = Object で深度を出す Visual など) は透けていない所、それ以外は地 (画面の縁の色) と違う所。地は押し出しの奥に床として残る。値=厚み・傾き (0=元画像→1=全開)",
    "Extrude the image into a solid with a tilted camera. Uses opaque areas when transparent, otherwise differences from the edge color. The background remains as a floor. 0 = original; 1 = full depth and tilt."
  ],
  "Flat = 形を一律の厚みで押し出す / Depth = 表示中のシェーダ・Code の深度 (3D Depth と同じもの) に応じた高さで押し出す (深度が無いときは形の濃さ)。Depth は手前ほど高い地形になり、Depth の値が高さの最大。Rock = 表示中のシェーダの SDF (S035 Flowing Metal) をそのまま閉じたポリゴンの岩にして、縦軸まわりに回るカメラで横・裏まで見せる S091 SigInt Bands は 16 本の帯を厚みのある板 (厚み = Extrude Depth、前の面は波形で凹凸) にして並べる。どちらでもないシェーダは Depth と同じ)": [
    "Flat = 形を一律の厚みで押し出す / Depth = 表示中のシェーダ・Code の深度 (3D Depth と同じもの) に応じた高さで押し出す (深度が無いときは形の濃さ)。Depth は手前ほど高い地形になり、Depth の値が高さの最大。Rock = 表示中のシェーダの SDF (S035 Flowing Metal) をそのまま閉じたポリゴンの岩にして、縦軸まわりに回るカメラで横・裏まで見せる S091 SigInt Bands は 16 本の帯を厚みのある板 (厚み = Extrude Depth、前の面は波形で凹凸) にして並べる。どちらでもないシェーダは Depth と同じ)",
    "Flat: uniform thickness. Depth: height from shader / Code depth, or shape intensity if unavailable; nearer areas rise higher. Rock: closed SDF geometry for S035 Flowing Metal, or 16 thick waveform bands for S091 SigInt Bands. Other shaders use Depth behavior."
  ],
  "押し出しの厚み": [
    "押し出しの厚み",
    "Extrusion depth"
  ],
  "カメラの傾き (1 = 約 43°)": [
    "カメラの傾き (1 = 約 43°)",
    "Camera tilt (1 ≈ 43°)"
  ],
  "カメラが左右に振れる速さ。beat = 拍ごとに進む / drone = 連続。0 = 止まったまま斜めから": [
    "カメラが左右に振れる速さ。beat = 拍ごとに進む / drone = 連続。0 = 止まったまま斜めから",
    "Camera sway speed: steps on beats or moves continuously in drone mode. 0 = fixed oblique view."
  ],
  "側面の暗さ (陰影)。0 = 縁の色のまま": [
    "側面の暗さ (陰影)。0 = 縁の色のまま",
    "Side shading (0 = edge color unchanged)"
  ],
  "ひねり: 奥へ行くほど断面を画面の中心まわりに回す (らせん状の押し出し)。±1 = 厚み全体で ±90°。0 = まっすぐ": [
    "ひねり: 奥へ行くほど断面を画面の中心まわりに回す (らせん状の押し出し)。±1 = 厚み全体で ±90°。0 = まっすぐ",
    "Twist cross-sections around the image center; ±1 = ±90° over the full depth; 0 = straight"
  ],
  "角丸: 前面と側面の境 (形の縁) を丸める。1 = 1080p で半径 24px。Mode = Flat のとき": [
    "角丸: 前面と側面の境 (形の縁) を丸める。1 = 1080p で半径 24px。Mode = Flat のとき",
    "Round front edges in Flat mode (1 = 24 px radius at 1080p)"
  ],
  "Photos: 画面をランダムな矩形に切り抜き、3D 空間に浮かせる (Code の PhotoPlane を画面素材で描く)。値=展開量 (0=元画像→1=全開)。後段の Needle / Origami / Drape はこの結果ごと折る": [
    "Photos: 画面をランダムな矩形に切り抜き、3D 空間に浮かせる (Code の PhotoPlane を画面素材で描く)。値=展開量 (0=元画像→1=全開)。後段の Needle / Origami / Drape はこの結果ごと折る",
    "Photos: crop the image into rectangles floating in 3D. 0 = original; 1 = fully spread. Later Needle / Origami / Drape effects fold the result."
  ],
  "切り抜きの枚数": [
    "切り抜きの枚数",
    "Crop count"
  ],
  "切り抜きの大きさ (画面比の長辺の上限)": [
    "切り抜きの大きさ (画面比の長辺の上限)",
    "Crop size: maximum long edge relative to the frame"
  ],
  "紙全体が円筒のように丸まる強さ": [
    "紙全体が円筒のように丸まる強さ",
    "Cylindrical paper bend"
  ],
  "曲げる軸のばらつき (0 = 板の縦軸に揃う / 1 = 板ごとにばらばら)": [
    "曲げる軸のばらつき (0 = 板の縦軸に揃う / 1 = 板ごとにばらばら)",
    "Bend axis variation: 0 = vertical; 1 = random per plane"
  ],
  "ゆっくりたわむ揺れ (0 = 止まる)": [
    "ゆっくりたわむ揺れ (0 = 止まる)",
    "Slow bending motion (0 = stop)"
  ],
  "片端・片隅を巻き上げる強さ": [
    "片端・片隅を巻き上げる強さ",
    "Edge / corner curl strength"
  ],
  "板の自転の速さ (0 = 止まる)": [
    "板の自転の速さ (0 = 止まる)",
    "Plane spin speed (0 = stop)"
  ],
  "Slicer: 画面を多角形の断片に砕いて 3D 空間に散らす (Code の Slicer を画面素材で描く)。値=砕け方 (0=元画像→1=全開)。後段の Layers / Needle / Origami / Drape はこの結果ごと処理する": [
    "Slicer: 画面を多角形の断片に砕いて 3D 空間に散らす (Code の Slicer を画面素材で描く)。値=砕け方 (0=元画像→1=全開)。後段の Layers / Needle / Origami / Drape はこの結果ごと処理する",
    "Slicer: break the image into 3D polygon fragments. 0 = original; 1 = fully spread. Later Layers / Needle / Origami / Drape process the result."
  ],
  "断片の数": [
    "断片の数",
    "Fragment count"
  ],
  "Layers: 画面と同じ形の板を揃えたまま奥へ積み、拍ごとに回転の波が 1 枚ずつ遅れて積層を通り抜ける (軸は縦 / 横 / 面内)。積層全体も回り続ける。値=開き方 (0=元画像→1=全開)。後段の Needle / Origami / Drape はこの結果ごと折る": [
    "Layers: 画面と同じ形の板を揃えたまま奥へ積み、拍ごとに回転の波が 1 枚ずつ遅れて積層を通り抜ける (軸は縦 / 横 / 面内)。積層全体も回り続ける。値=開き方 (0=元画像→1=全開)。後段の Needle / Origami / Drape はこの結果ごと折る",
    "Layers: stack image planes in depth. Beat-driven rotation waves pass through them with a delay, while the stack rotates. 0 = original; 1 = fully open. Later folds affect the whole result."
  ],
  "重ねる板の枚数": [
    "重ねる板の枚数",
    "Layer count"
  ],
  "板の大きさ (%)": [
    "板の大きさ (%)",
    "Plane size (%)"
  ],
  "板の縁の線の太さ。0 = 線なし": [
    "板の縁の線の太さ。0 = 線なし",
    "Plane outline width (0 = none)"
  ],
  "Diorama: 明るさで画面を何層かの切り絵に分け、奥行きに並べて視差を出す。値=層の間隔・カメラの振り (0=元画像→1=全開)": [
    "Diorama: 明るさで画面を何層かの切り絵に分け、奥行きに並べて視差を出す。値=層の間隔・カメラの振り (0=元画像→1=全開)",
    "Diorama: split brightness into paper-cut layers with depth and parallax. 0 = original; 1 = full spacing and camera motion."
  ],
  "層の数": [
    "層の数",
    "Layer count"
  ],
  "カメラの振りの大きさ。0.5 = 従来、0 = 振らない": [
    "カメラの振りの大きさ。0.5 = 従来、0 = 振らない",
    "Camera sway amount (0 = none; 0.5 = original)"
  ],
  "カメラの振りの速さ。drone は回る速さ、beat は向きを替える間隔 (0 = 4 拍、0.5 = 1 拍、1 = 1/4 拍)": [
    "カメラの振りの速さ。drone は回る速さ、beat は向きを替える間隔 (0 = 4 拍、0.5 = 1 拍、1 = 1/4 拍)",
    "Camera speed: continuous in drone mode; beat interval 4 / 1 / ¼ at 0 / 0.5 / 1"
  ],
  "カメラの左右の向き (振りの中心)": [
    "カメラの左右の向き (振りの中心)",
    "Camera horizontal direction (sway center)"
  ],
  "カメラの上下の向き (振りの中心)": [
    "カメラの上下の向き (振りの中心)",
    "Camera vertical direction (sway center)"
  ],
  "カメラの寄り (+) と引き (-)": [
    "カメラの寄り (+) と引き (-)",
    "Camera zoom: + closer / − farther"
  ],
  "Points: 画面を点群にして、明るさを奥行きに取り、音で散らす。値=奥行き・散り・カメラ (0=元画像→1=全開)": [
    "Points: 画面を点群にして、明るさを奥行きに取り、音で散らす。値=奥行き・散り・カメラ (0=元画像→1=全開)",
    "Points: turn the image into a depth point cloud with audio scatter. 0 = original; 1 = full depth, scatter and camera motion."
  ],
  "横の点の数 (多いほど細かく重い)": [
    "横の点の数 (多いほど細かく重い)",
    "Horizontal point count; more is finer and heavier"
  ],
  "Box: 画面全体を 1 個の直方体にし、拍ごとに縦か横へ 90° 転がる。6 面すべてに画面の絵を貼るので、転がり終わると正立した同じ絵に戻る": [
    "Box: 画面全体を 1 個の直方体にし、拍ごとに縦か横へ 90° 転がる。6 面すべてに画面の絵を貼るので、転がり終わると正立した同じ絵に戻る",
    "Box: wrap the image on all six faces of a cuboid rolling 90° on each beat; each turn ends with the image upright"
  ],
  "Blinds: 画面を横長の帯に割り、ブラインドのように回転・らせん状にねじれる。値=回転の振れ幅・カメラ (0=元画像→1=全開)": [
    "Blinds: 画面を横長の帯に割り、ブラインドのように回転・らせん状にねじれる。値=回転の振れ幅・カメラ (0=元画像→1=全開)",
    "Blinds: split the image into rotating, twisting strips. 0 = original; 1 = full rotation and camera motion."
  ],
  "帯の本数": [
    "帯の本数",
    "Strip count"
  ],
  "回転が帯の長さ方向へ遅れる量 (0=板のまま回る→1=らせん)": [
    "回転が帯の長さ方向へ遅れる量 (0=板のまま回る→1=らせん)",
    "Rotation delay along each strip (0 = rigid; 1 = spiral)"
  ],
  "羽根の向き (0.5 = 従来の横 / 縦の自動切替、0 / 1 で ±90° 傾く)": [
    "羽根の向き (0.5 = 従来の横 / 縦の自動切替、0 / 1 で ±90° 傾く)",
    "Slat direction: 0.5 = auto horizontal / vertical; 0 / 1 = ±90° tilt"
  ],
  "返る速さ (0 = 止まる / 0.5 = 従来 / 1 = 2 倍)": [
    "返る速さ (0 = 止まる / 0.5 = 従来 / 1 = 2 倍)",
    "Flip speed (0 = stop; 0.5 = original; 1 = double)"
  ],
  "波の伝わり方 (0 = 一斉に返る / 0.5 = 従来 / 1 = 逆向きの波)": [
    "波の伝わり方 (0 = 一斉に返る / 0.5 = 従来 / 1 = 逆向きの波)",
    "Wave propagation (0 = all at once; 0.5 = original; 1 = reversed)"
  ],
  "羽根の開き角 (0.5 = 従来、0 / 1 で ±90° 開いたまま)": [
    "羽根の開き角 (0.5 = 従来、0 / 1 で ±90° 開いたまま)",
    "Slat opening angle (0.5 = original; 0 / 1 = held open at ±90°)"
  ],
  "羽根の間のすき間 (0 = 従来)": [
    "羽根の間のすき間 (0 = 従来)",
    "Gap between slats (0 = original)"
  ],
  "羽根の幅のばらつき (0 = 等幅 / 0.5 = 従来)": [
    "羽根の幅のばらつき (0 = 等幅 / 0.5 = 従来)",
    "Slat width variation (0 = equal; 0.5 = original)"
  ],
  "Tunnel (Wax Tunnel): 画面をキャンバスの縦横比の長方形の筒に丸め、うねる道に沿ってねじれて脈打つ凸凹の通路にして奥へ進む。映像は内壁にタイル状に流れる。値 = 0 で元の画面 → 1 で奥まで続く通路": [
    "Tunnel (Wax Tunnel): 画面をキャンバスの縦横比の長方形の筒に丸め、うねる道に沿ってねじれて脈打つ凸凹の通路にして奥へ進む。映像は内壁にタイル状に流れる。値 = 0 で元の画面 → 1 で奥まで続く通路",
    "Tunnel: roll the image into a rectangular tunnel with twisted, rippling walls and flowing image tiles. 0 = flat image; 1 = deep passage."
  ],
  "奥へ進む速さ (0 = 止まる / 1 = 2 倍)": [
    "奥へ進む速さ (0 = 止まる / 1 = 2 倍)",
    "Forward speed (0 = stop; 1 = double)"
  ],
  "通路の太さ": [
    "通路の太さ",
    "Tunnel width"
  ],
  "奥へ行くほど断面が回る量 (0.5 = なし、0 / 1 で逆向き)": [
    "奥へ行くほど断面が回る量 (0.5 = なし、0 / 1 で逆向き)",
    "Twist along depth (0.5 = none; 0 / 1 = opposite directions)"
  ],
  "道のうねり (0 = まっすぐ)": [
    "道のうねり (0 = まっすぐ)",
    "Path waves (0 = straight)"
  ],
  "壁の凸凹": [
    "壁の凸凹",
    "Wall relief"
  ],
  "通路の脈打ち (太さが奥へ波打つ)": [
    "通路の脈打ち (太さが奥へ波打つ)",
    "Tunnel pulse: width waves along depth"
  ],
  "映像を周りに貼る枚数 (0 = 1 枚 / 1 = 6 枚)": [
    "映像を周りに貼る枚数 (0 = 1 枚 / 1 = 6 枚)",
    "Image copies around the tunnel (0 = 1; 1 = 6)"
  ],
  "断面の形 (0 = キャンバスの縦横比の長方形 / 1 = 楕円)": [
    "断面の形 (0 = キャンバスの縦横比の長方形 / 1 = 楕円)",
    "Cross-section (0 = frame-shaped rectangle; 1 = ellipse)"
  ],
  "断面ごと回る速さ (0.5 = 止まる、0 / 1 で逆向き)": [
    "断面ごと回る速さ (0.5 = 止まる、0 / 1 で逆向き)",
    "Cross-section spin speed (0.5 = stop; 0 / 1 = opposite directions)"
  ],
  "回転の向きの変わりやすさ (0 = ずっと同じ向き / 1 = よく反転。Twist のねじれも Spin の回転も)": [
    "回転の向きの変わりやすさ (0 = ずっと同じ向き / 1 = よく反転。Twist のねじれも Spin の回転も)",
    "Direction change rate for Twist and Spin (0 = constant; 1 = frequent reversal)"
  ],
  "通路を左右へ曲げる (0 = まっすぐ / − で左 / + で右)": [
    "通路を左右へ曲げる (0 = まっすぐ / − で左 / + で右)",
    "Horizontal tunnel bend (0 = straight; − left / + right)"
  ],
  "通路を上下へ曲げる (0 = まっすぐ / − で下 / + で上)": [
    "通路を上下へ曲げる (0 = まっすぐ / − で下 / + で上)",
    "Vertical tunnel bend (0 = straight; − down / + up)"
  ],
  "奥の暗さ": [
    "奥の暗さ",
    "Depth darkness"
  ],
  "蝋のような照り": [
    "蝋のような照り",
    "Wax-like sheen"
  ],
  "通路の模様: 0 = 映像をタイル状に貼る / 1 = 画面の端のピクセルを奥へ伸ばす": [
    "通路の模様: 0 = 映像をタイル状に貼る / 1 = 画面の端のピクセルを奥へ伸ばす",
    "Tunnel texture: 0 = tiled image; 1 = stretch edge pixels into depth"
  ],
  "カメラを上下に傾ける (0 = 正面 / − で見下ろす / + で見上げる)": [
    "カメラを上下に傾ける (0 = 正面 / − で見下ろす / + で見上げる)",
    "Camera pitch (0 = forward; − down / + up)"
  ],
  "カメラを左右に振る (0 = 正面 / − で左 / + で右)": [
    "カメラを左右に振る (0 = 正面 / − で左 / + で右)",
    "Camera yaw (0 = forward; − left / + right)"
  ],
  "Globe: 画面が筒から球に巻き上がって回る。値=巻き具合 (前半=筒、後半=球)。Detail を下げるとミラーボール": [
    "Globe: 画面が筒から球に巻き上がって回る。値=巻き具合 (前半=筒、後半=球)。Detail を下げるとミラーボール",
    "Globe: roll the image into a cylinder, then a spinning sphere. Lower Detail gives a mirror ball."
  ],
  "縦の分割数 (小さいほど面が角張る)": [
    "縦の分割数 (小さいほど面が角張る)",
    "Vertical segments; fewer gives flatter facets"
  ],
  "Origami: 一枚のキャンバスを実際の折り紙のように層ごと折りたたむ(ベクター折り)。周期で平面へ戻り再抽選。高パラメータで引き": [
    "Origami: 一枚のキャンバスを実際の折り紙のように層ごと折りたたむ(ベクター折り)。周期で平面へ戻り再抽選。高パラメータで引き",
    "Origami: fold the canvas in layers, returning flat and reseeding each cycle. Higher values zoom out."
  ],
  "折り数 (0 = 1 本 / 1 = 14 本 = 従来)": [
    "折り数 (0 = 1 本 / 1 = 14 本 = 従来)",
    "Fold count (0 = 1; 1 = 14, original)"
  ],
  "開いたり閉じたりする速さ (0 = 止まる / 0.5 = 従来)": [
    "開いたり閉じたりする速さ (0 = 止まる / 0.5 = 従来)",
    "Fold speed (0 = stop; 0.5 = original)"
  ],
  "折り角の大きさ (0.5 = 従来)": [
    "折り角の大きさ (0.5 = 従来)",
    "Fold angle (0.5 = original)"
  ],
  "折り線が中心から散らばる範囲 (0 = 中心に集まる / 0.5 = 従来)": [
    "折り線が中心から散らばる範囲 (0 = 中心に集まる / 0.5 = 従来)",
    "Crease spread from center (0 = centered; 0.5 = original)"
  ],
  "折り目の丸み (0 = 鋭い折り = 従来 / 1 = 丸く曲げる)": [
    "折り目の丸み (0 = 鋭い折り = 従来 / 1 = 丸く曲げる)",
    "Crease roundness (0 = sharp, original; 1 = rounded)"
  ],
  "Drape (旧 Kaiser): 布を巻きつけたように、丸い曲面で折り重なってひねり・うねる。スカーフを巻くような変形": [
    "Drape (旧 Kaiser): 布を巻きつけたように、丸い曲面で折り重なってひねり・うねる。スカーフを巻くような変形",
    "Drape: wrap and twist the image in rounded fabric-like folds"
  ],
  "動く速さ (0 = 止まる / 0.5 = 従来)": [
    "動く速さ (0 = 止まる / 0.5 = 従来)",
    "Motion speed (0 = stop; 0.5 = original)"
  ],
  "折り線が中心から散らばる範囲 (0.5 = 従来)": [
    "折り線が中心から散らばる範囲 (0.5 = 従来)",
    "Crease spread from center (0.5 = original)"
  ],
  "曲面の丸み (0 = 鋭い折りに近い / 0.5 = 従来 / 1 = 大きく丸く)": [
    "曲面の丸み (0 = 鋭い折りに近い / 0.5 = 従来 / 1 = 大きく丸く)",
    "Surface roundness (0 = sharp; 0.5 = original; 1 = broad curves)"
  ],
  "紙全体のひねりとうねり (0 = なし / 0.5 = 従来)": [
    "紙全体のひねりとうねり (0 = なし / 0.5 = 従来)",
    "Paper twist and waves (0 = none; 0.5 = original)"
  ],
  "カメラの揺れ (0 = 正面で固定 / 0.5 = 従来)": [
    "カメラの揺れ (0 = 正面で固定 / 0.5 = 従来)",
    "Camera sway (0 = fixed front view; 0.5 = original)"
  ],
  "Roll: 紙を端から巻物のように巻き取る。折り系 (Needle / Origami / Drape) と同じ紙に乗る。値=巻き取った量 (0=元画像→1=全巻き)": [
    "Roll: 紙を端から巻物のように巻き取る。折り系 (Needle / Origami / Drape) と同じ紙に乗る。値=巻き取った量 (0=元画像→1=全巻き)",
    "Roll: curl paper from an edge into a scroll, sharing the folded surface with Needle / Origami / Drape. 0 = original; 1 = fully rolled."
  ],
  "巻いた筒の太さ (0.5 = 従来)": [
    "巻いた筒の太さ (0.5 = 従来)",
    "Scroll diameter (0.5 = original)"
  ],
  "どこまで巻き取るか (0 = 浅く / 0.5 = 従来 / 1 = 深く)": [
    "どこまで巻き取るか (0 = 浅く / 0.5 = 従来 / 1 = 深く)",
    "Roll depth (0 = shallow; 0.5 = original; 1 = deep)"
  ],
  "巻く向き (0〜1 = 0〜360°)": [
    "巻く向き (0〜1 = 0〜360°)",
    "Roll direction (0–1 = 0–360°)"
  ],
  "巻く向きが回る速さ (0 = Angle の向きに固定 / 0.5 = 従来)": [
    "巻く向きが回る速さ (0 = Angle の向きに固定 / 0.5 = 従来)",
    "Roll direction rotation speed (0 = fixed Angle; 0.5 = original)"
  ],
  "平らな側のゆるい反り (0 = まっすぐ / 0.5 = 従来)": [
    "平らな側のゆるい反り (0 = まっすぐ / 0.5 = 従来)",
    "Gentle bend on the flat side (0 = straight; 0.5 = original)"
  ],
  "筒を斜めから見下ろす構図の強さ (0 = 正面から / 0.5 = 従来)": [
    "筒を斜めから見下ろす構図の強さ (0 = 正面から / 0.5 = 従来)",
    "Oblique overhead view (0 = front view; 0.5 = original)"
  ],
  "Passage (旧 Flames。VitalRiverFlames l3sXW4 を元に): 映像をねじれた四角い通路の壁に貼り、その中を進む。映像は面の上を川のように流れる。値 = 平面 (元の映像) → ねじれた構造。重め": [
    "Passage (旧 Flames。VitalRiverFlames l3sXW4 を元に): 映像をねじれた四角い通路の壁に貼り、その中を進む。映像は面の上を川のように流れる。値 = 平面 (元の映像) → ねじれた構造。重め",
    "Passage: travel through a twisted square tunnel with the image flowing along its walls. Based on VitalRiverFlames l3sXW4. Flat image to full structure; demanding."
  ],
  "通路のねじれの強さ (0.5 = 従来)": [
    "通路のねじれの強さ (0.5 = 従来)",
    "Tunnel twist (0.5 = original)"
  ],
  "通路を進む速さ (0 = 止まる / 0.5 = 従来 / 1 = 2 倍)": [
    "通路を進む速さ (0 = 止まる / 0.5 = 従来 / 1 = 2 倍)",
    "Travel speed (0 = stop; 0.5 = original; 1 = double)"
  ],
  "通路の幅 (0.5 = 従来)": [
    "通路の幅 (0.5 = 従来)",
    "Tunnel width (0.5 = original)"
  ],
  "壁の上を映像が流れる速さ (0 = 止まる / 0.5 = 従来)": [
    "壁の上を映像が流れる速さ (0 = 止まる / 0.5 = 従来)",
    "Image flow along walls (0 = stop; 0.5 = original)"
  ],
  "壁の陰影の深さ (0 = 平ら / 0.5 = 従来)": [
    "壁の陰影の深さ (0 = 平ら / 0.5 = 従来)",
    "Wall shading depth (0 = flat; 0.5 = original)"
  ],
  "奥の暗さ (0 = 奥まで明るい / 0.5 = 従来)": [
    "奥の暗さ (0 = 奥まで明るい / 0.5 = 従来)",
    "Depth darkness (0 = fully lit; 0.5 = original)"
  ],
  "カメラの揺れ (0 = まっすぐ / 0.5 = 従来)": [
    "カメラの揺れ (0 = まっすぐ / 0.5 = 従来)",
    "Camera sway (0 = straight; 0.5 = original)"
  ],
  "Uzumaki: 画面をカードの束として3D空間で対数螺旋状にファン展開。値=展開量 (0=元画像→1=全開の渦)。カードは面と面が平行のまま一枚ごとに浮かび、渦は徐々に逆回転、カメラが渦の周りを公転。Needle/Origami/Drape と重ねがけすると折った紙だけがカードに乗って渦巻く。背景は 3D BG": [
    "Uzumaki: 画面をカードの束として3D空間で対数螺旋状にファン展開。値=展開量 (0=元画像→1=全開の渦)。カードは面と面が平行のまま一枚ごとに浮かび、渦は徐々に逆回転、カメラが渦の周りを公転。Needle/Origami/Drape と重ねがけすると折った紙だけがカードに乗って渦巻く。背景は 3D BG",
    "Uzumaki: fan parallel image cards into a 3D logarithmic spiral with reverse rotation and an orbiting camera. 0 = original; 1 = full spiral. Combined folds appear on each card; background uses 3D BG."
  ],
  "カードの枚数 (0 = 4 枚 / 0.5 = 24 枚 = 従来 / 1 = 44 枚)": [
    "カードの枚数 (0 = 4 枚 / 0.5 = 24 枚 = 従来 / 1 = 44 枚)",
    "Card count (0 = 4; 0.5 = 24, original; 1 = 44)"
  ],
  "渦の巻き数 (0 = 回さず重ねる / 0.5 = 従来)": [
    "渦の巻き数 (0 = 回さず重ねる / 0.5 = 従来)",
    "Spiral turns (0 = straight stack; 0.5 = original)"
  ],
  "カードが外へ広がる半径 (0.5 = 従来)": [
    "カードが外へ広がる半径 (0.5 = 従来)",
    "Card spread radius (0.5 = original)"
  ],
  "カードの奥行きの間隔 (0 = 平ら / 0.5 = 従来)": [
    "カードの奥行きの間隔 (0 = 平ら / 0.5 = 従来)",
    "Card depth spacing (0 = flat; 0.5 = original)"
  ],
  "奥のカードほど小さくなる度合い (0 = 同じ大きさ / 0.5 = 従来)": [
    "奥のカードほど小さくなる度合い (0 = 同じ大きさ / 0.5 = 従来)",
    "Distant card shrinkage (0 = equal sizes; 0.5 = original)"
  ],
  "カード 1 枚の縮み具合 (0 = 縮まない / 0.5 = 従来)": [
    "カード 1 枚の縮み具合 (0 = 縮まない / 0.5 = 従来)",
    "Individual card shrinkage (0 = none; 0.5 = original)"
  ],
  "渦全体が回る量 (0 = 止める / 0.5 = 従来)": [
    "渦全体が回る量 (0 = 止める / 0.5 = 従来)",
    "Spiral rotation (0 = stop; 0.5 = original)"
  ],
  "カメラが回り込む動き (0 = 正面で固定 / 0.5 = 従来)": [
    "カメラが回り込む動き (0 = 正面で固定 / 0.5 = 従来)",
    "Camera orbit (0 = fixed front view; 0.5 = original)"
  ],
  "三角錐主峰が拍頭のEase Outで大きく変形し、重なった裾野だけが峰間のブリッジを形成。Droneでは緩やかに成長し、元映像を内部反射へ使用": [
    "三角錐主峰が拍頭のEase Outで大きく変形し、重なった裾野だけが峰間のブリッジを形成。Droneでは緩やかに成長し、元映像を内部反射へ使用",
    "Triangular peaks deform with beat-driven ease-out, connected by overlapping bases. Grow slowly in drone mode, using the source image for internal reflections."
  ],
  "針の散らばり: 0 = 格子に近い等間隔 → 1 = 位置の揺れが大きく、密な群れと空き地ができる": [
    "針の散らばり: 0 = 格子に近い等間隔 → 1 = 位置の揺れが大きく、密な群れと空き地ができる",
    "Needle scatter: 0 = regular grid; 1 = loose clusters and gaps"
  ],
  "針の太さ (底面の大きさ): 0 = 従来 → マイナスで細かく (針の数が増える)・プラスで太く。長さは変わらない": [
    "針の太さ (底面の大きさ): 0 = 従来 → マイナスで細かく (針の数が増える)・プラスで太く。長さは変わらない",
    "Needle width: 0 = original; negative = finer and more needles; positive = wider. Length stays unchanged."
  ],
  "針の長さ (高さ): 0 = 従来 → マイナスで短く (最短で半分)・プラスで長く (最長で 2 倍)": [
    "針の長さ (高さ): 0 = 従来 → マイナスで短く (最短で半分)・プラスで長く (最長で 2 倍)",
    "Needle length: 0 = original; negative down to half; positive up to double"
  ],
  "針の底の最大辺数: 5 = 従来 (面を覆う針は三角形と四角形、ほかの針は三〜五角形) → 3 = 三角錐だけ": [
    "針の底の最大辺数: 5 = 従来 (面を覆う針は三角形と四角形、ほかの針は三〜五角形) → 3 = 三角錐だけ",
    "Maximum needle base sides: 5 = original (3–5 sides); 3 = triangular pyramids only"
  ],
  "Gravity: 画面の布が重力井戸に吸い込まれて渦を巻く (漏斗形)。値=井戸の深さ・引き込み (0=元画像→1=全開)": [
    "Gravity: 画面の布が重力井戸に吸い込まれて渦を巻く (漏斗形)。値=井戸の深さ・引き込み (0=元画像→1=全開)",
    "Gravity: pull the image into swirling funnel-shaped gravity wells. 0 = original; 1 = full depth and pull."
  ],
  "渦のねじれ量": [
    "渦のねじれ量",
    "Swirl twist amount"
  ],
  "喉 (井戸) の深さ。0.5 = 標準、1 = 2 倍の深さ": [
    "喉 (井戸) の深さ。0.5 = 標準、1 = 2 倍の深さ",
    "Well depth (0.5 = normal; 1 = double)"
  ],
  "拍ごとのめくれ (布が裏返る) の強さ。0 = めくれない": [
    "拍ごとのめくれ (布が裏返る) の強さ。0 = めくれない",
    "Beat-driven fabric flip (0 = none)"
  ],
  "吸い込み口 (消失点) の数 (1〜4)。拍の切り替わりで反映": [
    "吸い込み口 (消失点) の数 (1〜4)。拍の切り替わりで反映",
    "Gravity well count (1–4); applied on the next beat"
  ],
  "布全体のうねり。0 = うねりなし、1 = 2 倍": [
    "布全体のうねり。0 = うねりなし、1 = 2 倍",
    "Fabric waves (0 = none; 1 = double)"
  ],
  "設定中の 3D FX 全体の量に掛ける倍率。1 = そのまま / 0.5 = 半分 / 0 = 3D FX なし。各 FX の設定値は保持する": [
    "設定中の 3D FX 全体の量に掛ける倍率。1 = そのまま / 0.5 = 半分 / 0 = 3D FX なし。各 FX の設定値は保持する",
    "Scale all configured 3D FX amounts. 1 = unchanged; 0.5 = half; 0 = no 3D FX. Individual FX settings are preserved."
  ],
  "立体を描くシェーダ (深度を出すもの) のとき、Origami / Drape / Roll / Uzumaki / Gravity / Needle が紙をその深度で持ち上げてから折る = 立体のまま 3D FX が重なる。0 = 平らな紙 (従来どおり)": [
    "立体を描くシェーダ (深度を出すもの) のとき、Origami / Drape / Roll / Uzumaki / Gravity / Needle が紙をその深度で持ち上げてから折る = 立体のまま 3D FX が重なる。0 = 平らな紙 (従来どおり)",
    "Lift paper using shader depth before folding with Origami / Drape / Roll / Uzumaki / Gravity / Needle. 0 = flat paper."
  ],
  "3D FX と折り (Needle / Origami / Drape / Roll / Uzumaki / Gravity) の頂点を横方向に伸び縮みさせる。0 = 等倍 / +1 = 4 倍 / -1 = 1/4": [
    "3D FX と折り (Needle / Origami / Drape / Roll / Uzumaki / Gravity) の頂点を横方向に伸び縮みさせる。0 = 等倍 / +1 = 4 倍 / -1 = 1/4",
    "Horizontal stretch for 3D FX and folds (0 = normal; +1 = 4×; −1 = ¼×)"
  ],
  "3D FX と折り (Needle / Origami / Drape / Roll / Uzumaki / Gravity) の頂点を縦方向に伸び縮みさせる。0 = 等倍 / +1 = 4 倍 / -1 = 1/4": [
    "3D FX と折り (Needle / Origami / Drape / Roll / Uzumaki / Gravity) の頂点を縦方向に伸び縮みさせる。0 = 等倍 / +1 = 4 倍 / -1 = 1/4",
    "Vertical stretch for 3D FX and folds (0 = normal; +1 = 4×; −1 = ¼×)"
  ],
  "3D FX と折り (Needle / Origami / Drape / Roll / Uzumaki / Gravity) の頂点を奥行き方向に伸び縮みさせる。0 = 等倍 / +1 = 4 倍 / -1 = 1/4": [
    "3D FX と折り (Needle / Origami / Drape / Roll / Uzumaki / Gravity) の頂点を奥行き方向に伸び縮みさせる。0 = 等倍 / +1 = 4 倍 / -1 = 1/4",
    "Depth stretch for 3D FX and folds (0 = normal; +1 = 4×; −1 = ¼×)"
  ],
  "3D FX と折りのカメラを寄せる / 引く (遠近の付き方は変えずに望遠のように)。0 = 等倍 / +1 = 4 倍に寄る / -1 = 1/4 に引く": [
    "3D FX と折りのカメラを寄せる / 引く (遠近の付き方は変えずに望遠のように)。0 = 等倍 / +1 = 4 倍に寄る / -1 = 1/4 に引く",
    "3D camera zoom without changing perspective (0 = normal; +1 = 4×; −1 = ¼×)"
  ],
  "Code (3D で描くエンジン) の深度を 3D FX に渡す。OFF = 平面として扱う (シェーダの 3D Mode と同じ)": [
    "Code (3D で描くエンジン) の深度を 3D FX に渡す。OFF = 平面として扱う (シェーダの 3D Mode と同じ)",
    "Pass Code engine depth to 3D FX; Off treats it as a flat image"
  ],
  "3D FX の描画解像度 (小さいほど軽い)": [
    "3D FX の描画解像度 (小さいほど軽い)",
    "3D FX resolution; lower is faster"
  ],
  "頂点を持つ Code (現状 41/49 Tower) を 1 枚だけ表示しているとき、折り系 (Needle / Origami / Drape) を 3D の形のまま掛ける試験機能。端末ごとの設定 (Random・プリセット・MIDI の対象外)": [
    "頂点を持つ Code (現状 41/49 Tower) を 1 枚だけ表示しているとき、折り系 (Needle / Origami / Drape) を 3D の形のまま掛ける試験機能。端末ごとの設定 (Random・プリセット・MIDI の対象外)",
    "Experimental geometry folding for a single supported Code Visual (currently 41/49 Tower). Device setting; excluded from Random, presets and MIDI."
  ],
  "3D 欄 (Photo〜Globe・Needle / Origami / Drape / Roll・Uzumaki) で画面の外と、3D Target = Object で抜いた背景の所に見える背景 (背景には 3D FX が掛からない)。Auto = 元の画面を大きくぼかして沈めた絵 / Color = Params の背景色 (シェーダの uBgColor → エンジンの背景 → Slot A 背景色)": [
    "3D 欄 (Photo〜Globe・Needle / Origami / Drape / Roll・Uzumaki) で画面の外と、3D Target = Object で抜いた背景の所に見える背景 (背景には 3D FX が掛からない)。Auto = 元の画面を大きくぼかして沈めた絵 / Color = Params の背景色 (シェーダの uBgColor → エンジンの背景 → Slot A 背景色)",
    "Background outside 3D objects, unaffected by 3D FX. Auto = dark, blurred source; Color = shader uBgColor, engine background or Slot A background."
  ],
  "3D 欄の FX を掛けるスロット。Both = 映っている画面全体 (従来どおり) / A = Slot A だけを 3D にし、Slot B は平らなまま後ろに残す / B = Slot B だけを 3D にし、Slot A は平らなまま後ろに残す。両方のスロットが映っているときに効く (選んだスロットが隠れているときは 3D FX は掛からない)。3D Target (Object / All) は選んだスロットに掛かる": [
    "3D 欄の FX を掛けるスロット。Both = 映っている画面全体 (従来どおり) / A = Slot A だけを 3D にし、Slot B は平らなまま後ろに残す / B = Slot B だけを 3D にし、Slot A は平らなまま後ろに残す。両方のスロットが映っているときに効く (選んだスロットが隠れているときは 3D FX は掛からない)。3D Target (Object / All) は選んだスロットに掛かる",
    "3D FX slot: Both = full composite; A / B = selected slot in 3D, other slot flat behind it. Requires the selected slot to be visible. 3D Target applies to that slot."
  ],
  "Slot A / B がどちらも深度を出す Visual のとき (3D Slot = Both)、両方の深度をどう合わせるか。Front = 手前優先 (同じ場所では手前の物体の深度を使う。クロスフェードの中ほどでは両方を全量で使い、端で片方へ消える) / Blend = クロスフェードの比で深度を混ぜる (中ほどでは両方とも半分の高さ)。3D Target = Object なら両方の物体を 3D にし、背景は平らなまま残す。片方だけが深度を出すときは、そのスロットの物体だけを 3D にし、もう一方は平らなまま後ろに残す": [
    "Slot A / B がどちらも深度を出す Visual のとき (3D Slot = Both)、両方の深度をどう合わせるか。Front = 手前優先 (同じ場所では手前の物体の深度を使う。クロスフェードの中ほどでは両方を全量で使い、端で片方へ消える) / Blend = クロスフェードの比で深度を混ぜる (中ほどでは両方とも半分の高さ)。3D Target = Object なら両方の物体を 3D にし、背景は平らなまま残す。片方だけが深度を出すときは、そのスロットの物体だけを 3D にし、もう一方は平らなまま後ろに残す",
    "Combine A/B depth with 3D Slot = Both. Front favors the nearer object at full depth around the crossfade midpoint; Blend mixes heights by crossfade. Object keeps backgrounds flat. If only one slot has depth, only its objects become 3D."
  ],
  "3D 欄 (Photos〜Globe・Needle / Origami / Drape / Roll・Passage・Uzumaki) を掛ける範囲。Object = 深度を出す Visual では物体 (深度 > 0、透過で抜ける Visual は透けていない所) だけに掛け、背景の所には 3D BG を敷く (両スロットが映っているときは 3D Mix を参照) / All = 背景も含めた画面全体に掛ける。深度を出さない Visual はどちらでも全体": [
    "3D 欄 (Photos〜Globe・Needle / Origami / Drape / Roll・Passage・Uzumaki) を掛ける範囲。Object = 深度を出す Visual では物体 (深度 > 0、透過で抜ける Visual は透けていない所) だけに掛け、背景の所には 3D BG を敷く (両スロットが映っているときは 3D Mix を参照) / All = 背景も含めた画面全体に掛ける。深度を出さない Visual はどちらでも全体",
    "3D Target: Object applies FX to objects with depth or opacity and fills the rest with 3D BG; All includes the background. Visuals without depth use the whole frame."
  ],
  "3D 欄の FX が掛かっている間だけ、画面の外 (片側この割合) まで実際の絵と深度を描いておく。紙を回す・折る・傾けたときに画面の端で絵が切れたりミラーになったりしない。3D 対応の Visual (深度を出すシェーダ・Code) のスロットと、3D FX の素材が対象。0% (既定) = 従来どおり (余白なし)。Uzumaki 単体では使わない。描く面積が (1 + 2 × 割合)² 倍になるので、重いときは下げる": [
    "3D 欄の FX が掛かっている間だけ、画面の外 (片側この割合) まで実際の絵と深度を描いておく。紙を回す・折る・傾けたときに画面の端で絵が切れたりミラーになったりしない。3D 対応の Visual (深度を出すシェーダ・Code) のスロットと、3D FX の素材が対象。0% (既定) = 従来どおり (余白なし)。Uzumaki 単体では使わない。描く面積が (1 + 2 × 割合)² 倍になるので、重いときは下げる",
    "Overscan renders extra image and depth beyond each edge during 3D FX, preventing clipping when folding. Supports 3D Visuals; excludes Uzumaki alone. 0% = none. Render area grows by (1 + 2 × margin)², so lower it if slow."
  ],
  "3D FX (Photos〜Globe) の要素が現れる / 消えるときの動き。ON・OFF したとき、拍の組み直し (Slicer / Blinds)、枚数を変えたときに、要素が少しずつ遅れて弾む。Back = 少し行き過ぎて戻る / Elastic = ばねのように揺れる / Bounce = 床で跳ねる / Ease Out = 行き過ぎずに止まる / Off = 弾まない": [
    "3D FX (Photos〜Globe) の要素が現れる / 消えるときの動き。ON・OFF したとき、拍の組み直し (Slicer / Blinds)、枚数を変えたときに、要素が少しずつ遅れて弾む。Back = 少し行き過ぎて戻る / Elastic = ばねのように揺れる / Bounce = 床で跳ねる / Ease Out = 行き過ぎずに止まる / Off = 弾まない",
    "3D element entry / exit animation on toggles, beat rebuilds and count changes. Back overshoots, Elastic springs, Bounce bounces, Ease Out settles, Off disables motion."
  ],
  "Patternの現在値を既定値として保存": [
    "Patternの現在値を既定値として保存",
    "Save Pattern settings as defaults"
  ],
  "保存したPatternの既定値へ戻す (保存が無ければ初期値)": [
    "保存したPatternの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Pattern defaults, or original values"
  ],
  "横の帯ごとに映像を左右へずらして切り裂く。値=ずれの大きさ。帯のパターンは拍ごとに変わる": [
    "横の帯ごとに映像を左右へずらして切り裂く。値=ずれの大きさ。帯のパターンは拍ごとに変わる",
    "Tear the image by shifting horizontal strips; controls shift distance. Pattern changes each beat."
  ],
  "境界線の太さ (0 = 線なし / 0.5 = 従来 1px / 1 = 2px)": [
    "境界線の太さ (0 = 線なし / 0.5 = 従来 1px / 1 = 2px)",
    "Boundary width (0 = none; 0.5 = 1 px; 1 = 2 px)"
  ],
  "帯の数 (0 = 少なく太く / 0.5 = 従来 / 1 = 多く細かく)": [
    "帯の数 (0 = 少なく太く / 0.5 = 従来 / 1 = 多く細かく)",
    "Strip count (0 = few / wide; 0.5 = original; 1 = many / fine)"
  ],
  "ずれる帯の割合 (0 = 動かない / 0.5 = 従来 7 割 / 1 = すべて)": [
    "ずれる帯の割合 (0 = 動かない / 0.5 = 従来 7 割 / 1 = すべて)",
    "Share of shifted strips (0 = none; 0.5 = 70%; 1 = all)"
  ],
  "帯の向き (0 = 横 / 0.5 = 縦 / 1 = 横に戻る)": [
    "帯の向き (0 = 横 / 0.5 = 縦 / 1 = 横に戻る)",
    "Strip direction (0 = horizontal; 0.5 = vertical; 1 = horizontal)"
  ],
  "Mondrian: 画面を再帰分割した矩形ごとに変位。値が大きいほど取り出し座標が大きくジャンプ。音/拍で増幅": [
    "Mondrian: 画面を再帰分割した矩形ごとに変位。値が大きいほど取り出し座標が大きくジャンプ。音/拍で増幅",
    "Mondrian: offset recursively divided rectangles. Higher values jump farther; amplified by audio / beats."
  ],
  "Twisting Rings: 同心円リングごとに映像をねじる。時間経過で常時回転し、Audioヒット時に大きく動く。低値は少ない広いリング": [
    "Twisting Rings: 同心円リングごとに映像をねじる。時間経過で常時回転し、Audioヒット時に大きく動く。低値は少ない広いリング",
    "Twisting Rings: continuously rotate concentric image rings with audio accents. Low values give fewer, wider rings."
  ],
  "境界線の太さ (0 = 線なし / 0.5 = 従来)": [
    "境界線の太さ (0 = 線なし / 0.5 = 従来)",
    "Boundary width (0 = none; 0.5 = original)"
  ],
  "リングの数 (0 = 少なく広く / 0.5 = 従来 / 1 = 多く細かく)": [
    "リングの数 (0 = 少なく広く / 0.5 = 従来 / 1 = 多く細かく)",
    "Ring count (0 = few / wide; 0.5 = original; 1 = many / fine)"
  ],
  "ねじれる角度 (0 = 回さない / 0.5 = 従来 / 1 = 2 倍)": [
    "ねじれる角度 (0 = 回さない / 0.5 = 従来 / 1 = 2 倍)",
    "Twist angle (0 = none; 0.5 = original; 1 = double)"
  ],
  "リング幅のゆらぎ (0 = 等間隔 / 0.5 = 従来)": [
    "リング幅のゆらぎ (0 = 等間隔 / 0.5 = 従来)",
    "Ring width variation (0 = equal; 0.5 = original)"
  ],
  "画面を立方体ボクセル状にピクセル化": [
    "画面を立方体ボクセル状にピクセル化",
    "Pixelate the image into cubic voxels"
  ],
  "Glitchの現在値を既定値として保存": [
    "Glitchの現在値を既定値として保存",
    "Save Glitch settings as defaults"
  ],
  "保存したGlitchの既定値へ戻す (保存が無ければ初期値)": [
    "保存したGlitchの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Glitch defaults, or original values"
  ],
  "時間が縦に流れるスクロール型slit-scan。値=分割数。上下方向はランダムなタイミングで反転。0=OFF": [
    "時間が縦に流れるスクロール型slit-scan。値=分割数。上下方向はランダムなタイミングで反転。0=OFF",
    "Vertical scrolling slit-scan with random direction changes. Controls segment count; 0 = off."
  ],
  "低い値での上下の動きの穏やかさ。0.6 以上の見た目は変わらない": [
    "低い値での上下の動きの穏やかさ。0.6 以上の見た目は変わらない",
    "Soften vertical motion at low values; no change above 0.6"
  ],
  "ランダムなピクセルを横に引き延ばし、ランダムな周期・高さのバーコード状の行に。行ごとに違う速さで変異する": [
    "ランダムなピクセルを横に引き延ばし、ランダムな周期・高さのバーコード状の行に。行ごとに違う速さで変異する",
    "Stretch random pixels into barcode-like rows with varied heights, timing and speeds"
  ],
  "細面ほど1/16〜1/4拍で速く動き、未分割の大面を遅く残しながら分節スキャンを刻むデータモッシュ。0=OFF": [
    "細面ほど1/16〜1/4拍で速く動き、未分割の大面を遅く残しながら分節スキャンを刻むデータモッシュ。0=OFF",
    "Datamosh: small regions scan quickly at 1/16–1/4 beats while large regions move slowly. 0 = off."
  ],
  "Datamosh の種類 (複数を同時に重ねられる。全部外すと未選択 = Datamosh は掛からない)": [
    "Datamosh の種類 (複数を同時に重ねられる。全部外すと未選択 = Datamosh は掛からない)",
    "Datamosh types; combine any number. None selected = off."
  ],
  "面ごとの動き + 走査帯": [
    "面ごとの動き + 走査帯",
    "Per-region motion and scan bands"
  ],
  "マクロブロックの流れ + 4 拍ごとの I フレーム": [
    "マクロブロックの流れ + 4 拍ごとの I フレーム",
    "Macroblock flow with an I-frame every 4 beats"
  ],
  "縦の帯が下へ垂れる": [
    "縦の帯が下へ垂れる",
    "Vertical bands drip downward"
  ],
  "横帯の横ずれ + ロール": [
    "横帯の横ずれ + ロール",
    "Horizontal band shifts and roll"
  ],
  "面が数拍そのまま固まる": [
    "面が数拍そのまま固まる",
    "Hold regions frozen for several beats"
  ],
  "Lensの現在値を既定値として保存": [
    "Lensの現在値を既定値として保存",
    "Save Lens settings as defaults"
  ],
  "保存したLensの既定値へ戻す (保存が無ければ初期値)": [
    "保存したLensの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Lens defaults, or original values"
  ],
  "ランダム方向・長周期サイン波のうねり変位。1/X拍(beat×X)で上限→シード変更で別パターン。指数カーブ": [
    "ランダム方向・長周期サイン波のうねり変位。1/X拍(beat×X)で上限→シード変更で別パターン。指数カーブ",
    "Long sine-wave displacement in random directions. Peaks every 1/X beat, then reseeds; exponential response."
  ],
  "いまの Mode (Add / Multiply / Residue) の設定を、その Mode の既定値として保存 (Mode を切り替えると呼び出す)": [
    "いまの Mode (Add / Multiply / Residue) の設定を、その Mode の既定値として保存 (Mode を切り替えると呼び出す)",
    "Save settings for the current FB Mode (Add / Multiply / Residue); restored on mode changes"
  ],
  "いまの Mode の保存値へ戻す (保存が無ければ初期値)": [
    "いまの Mode の保存値へ戻す (保存が無ければ初期値)",
    "Restore this Mode's saved defaults, or original values"
  ],
  "FBの種類 (同時に掛けるのは 1 種類)": [
    "FBの種類 (同時に掛けるのは 1 種類)",
    "Feedback type; one at a time"
  ],
  "Add: 明るい残像": [
    "Add: 明るい残像",
    "Add: bright trails"
  ],
  "Multiply: 暗い残像": [
    "Multiply: 暗い残像",
    "Multiply: dark trails"
  ],
  "Residue: 動いた形の残像": [
    "Residue: 動いた形の残像",
    "Residue: motion silhouettes"
  ],
  "選んだFBの量。0で無効": [
    "選んだFBの量。0で無効",
    "Selected feedback amount (0 = off)"
  ],
  "保持する残像の枚数。1〜12 段。増やすほど別々の時刻の絵が重なる": [
    "保持する残像の枚数。1〜12 段。増やすほど別々の時刻の絵が重なる",
    "Trail layers (1–12); more layers combine more points in time"
  ],
  "残像が消える速さ。左は長く残り、右は早く消える。残像の採取間隔と段ごとの濃さを調整": [
    "残像が消える速さ。左は長く残り、右は早く消える。残像の採取間隔と段ごとの濃さを調整",
    "Trail decay: left = longer, right = shorter. Adjusts sampling interval and layer opacity."
  ],
  "Add / Multiply のズーム。正=外へ広がる / 負=内へ吸い込み": [
    "Add / Multiply のズーム。正=外へ広がる / 負=内へ吸い込み",
    "Add / Multiply zoom: positive spreads outward; negative pulls inward"
  ],
  "Add / Multiply の回転": [
    "Add / Multiply の回転",
    "Add / Multiply rotation"
  ],
  "前の画が崩れながら残る長さ": [
    "前の画が崩れながら残る長さ",
    "How long the previous image persists as it breaks up"
  ],
  "動きに沿って前の画を引き延ばす強さ。0 で位置ずれなし": [
    "動きに沿って前の画を引き延ばす強さ。0 で位置ずれなし",
    "Stretch previous frames along motion (0 = no displacement)"
  ],
  "選ばれた大きな多角形の面がそれぞれ独立して揺れ、たわみながら前の映像を運ぶ。分割面の形は時間で連続的に変わる。Polygon 1 では粉を出さない。0 は従来の有機的な残像": [
    "選ばれた大きな多角形の面がそれぞれ独立して揺れ、たわみながら前の映像を運ぶ。分割面の形は時間で連続的に変わる。Polygon 1 では粉を出さない。0 は従来の有機的な残像",
    "Large polygons sway and bend independently, carrying previous frames. Shapes evolve continuously. Polygon = 1 removes dust; 0 uses organic trails."
  ],
  "Polygon の面の大きさ。上げるほど分割数が指数的に減り、最大では画面をまたぐ大きな面になる": [
    "Polygon の面の大きさ。上げるほど分割数が指数的に減り、最大では画面をまたぐ大きな面になる",
    "Polygon size; higher values reduce divisions exponentially, up to frame-spanning shapes"
  ],
  "インクのにじみ設定を保存する": [
    "インクのにじみ設定を保存する",
    "Save Ink Bleed settings"
  ],
  "保存した詳細設定に戻す。保存がなければ初期値に戻す": [
    "保存した詳細設定に戻す。保存がなければ初期値に戻す",
    "Restore saved settings, or original values if none are saved"
  ],
  "Spread・Fiber・Edge・Node・Seed をランダムに変える": [
    "Spread・Fiber・Edge・Node・Seed をランダムに変える",
    "Randomize Spread / Fiber / Edge / Node / Seed"
  ],
  "濃淡をデッサンのストロークで描く。線は形の向きに沿って流れ、暗い所ほど層が重なる": [
    "濃淡をデッサンのストロークで描く。線は形の向きに沿って流れ、暗い所ほど層が重なる",
    "Draw tones with sketch strokes following contours, layering more in dark areas"
  ],
  "線の間隔。大きいほど細かく詰まる": [
    "線の間隔。大きいほど細かく詰まる",
    "Line density; higher packs lines more closely"
  ],
  "線を形の向きに沿わせる割合。0 で Angle の角度にそろう": [
    "線を形の向きに沿わせる割合。0 で Angle の角度にそろう",
    "Contour following (0 = fixed Angle)"
  ],
  "形の向きをならす範囲。大きいほど線が長くなめらかに流れ、小さいと細部に沿って細かく曲がる": [
    "形の向きをならす範囲。大きいほど線が長くなめらかに流れ、小さいと細部に沿って細かく曲がる",
    "Orientation smoothing range; larger gives long flowing lines, smaller follows fine detail"
  ],
  "重ねる線の層の数。暗い所ほど層が増える (1 層目 → 直交 → 斜め 2 方向)": [
    "重ねる線の層の数。暗い所ほど層が増える (1 層目 → 直交 → 斜め 2 方向)",
    "Hatching layers, added in darker areas: base, perpendicular, then two diagonals"
  ],
  "形の向きが定まらない所 (平らな所) と Flow 0 のときの線の角度 (0〜180°)": [
    "形の向きが定まらない所 (平らな所) と Flow 0 のときの線の角度 (0〜180°)",
    "Line angle in flat areas or at Flow = 0 (0–180°)"
  ],
  "線の揺らぎ。上げるほど手描きらしく波打つ": [
    "線の揺らぎ。上げるほど手描きらしく波打つ",
    "Line wobble; higher looks more hand-drawn"
  ],
  "紙の代わりに元の絵の色をどれだけ残すか。0 = 紙に線だけ / 1 = 元の色の上に線": [
    "紙の代わりに元の絵の色をどれだけ残すか。0 = 紙に線だけ / 1 = 元の色の上に線",
    "Source color mix (0 = lines on paper; 1 = lines over source colors)"
  ],
  "線の色": [
    "線の色",
    "Line color"
  ],
  "紙の色 (Color Mix 0 のとき)": [
    "紙の色 (Color Mix 0 のとき)",
    "Paper color at Color Mix = 0"
  ],
  "鉛筆・ペンの紙質感。紙の目でかすれ、筆圧のむらと線の途切れが出る (Hatching の線に掛かる)": [
    "鉛筆・ペンの紙質感。紙の目でかすれ、筆圧のむらと線の途切れが出る (Hatching の線に掛かる)",
    "Pencil / pen paper texture: grain, uneven pressure and broken hatching strokes"
  ],
  "Pencil = 黒鉛のグレーで縁が柔らかく紙の目が出る / Pen = 硬い黒の線": [
    "Pencil = 黒鉛のグレーで縁が柔らかく紙の目が出る / Pen = 硬い黒の線",
    "Pencil: soft graphite with paper grain. Pen: hard black lines."
  ],
  "紙の目の強さ。上げるほど線が紙の凹凸でかすれる": [
    "紙の目の強さ。上げるほど線が紙の凹凸でかすれる",
    "Paper grain strength; higher breaks up strokes on the paper texture"
  ],
  "線の途切れ。上げるほど線が切れ切れになる": [
    "線の途切れ。上げるほど線が切れ切れになる",
    "Line breaks; higher gives more broken strokes"
  ],
  "線と輪郭の色を保ったまま紙ににじませる。背景が黒いときは Paper を黒に設定する": [
    "線と輪郭の色を保ったまま紙ににじませる。背景が黒いときは Paper を黒に設定する",
    "Bleed lines and edges into paper while preserving colors. Set Paper to black for black backgrounds."
  ],
  "にじみと溜まりの上限。線幅に比例して広がるが、太い線でもこれ以上は広がらない": [
    "にじみと溜まりの上限。線幅に比例して広がるが、太い線でもこれ以上は広がらない",
    "Maximum bleed / pooling radius, proportional to line width up to this limit"
  ],
  "溜まりの縁の揺らぎ (線幅に対する比)": [
    "溜まりの縁の揺らぎ (線幅に対する比)",
    "Pooling edge variation relative to line width"
  ],
  "印刷インク風の仕上げ。線が少し柔らかく太り、ベタにわずかなムラが出る (線幅によらず一定)": [
    "印刷インク風の仕上げ。線が少し柔らかく太り、ベタにわずかなムラが出る (線幅によらず一定)",
    "Printed ink finish: slightly softer, thicker lines and uneven solids, independent of line width"
  ],
  "線が交差する所の溝をインクで埋めて、内向きの弧 (光マーク状) にする。線幅に比例し、0 で溜まりなし": [
    "線が交差する所の溝をインクで埋めて、内向きの弧 (光マーク状) にする。線幅に比例し、0 で溜まりなし",
    "Fill line intersections with inward-curving ink pools; proportional to line width (0 = off)"
  ],
  "溜まりの大きさと形の模様を変える": [
    "溜まりの大きさと形の模様を変える",
    "Change the pooling size and shape pattern"
  ],
  "インクの判定基準となる紙色。暗い背景では背景に合わせる": [
    "インクの判定基準となる紙色。暗い背景では背景に合わせる",
    "Paper color used to detect ink; match it to dark backgrounds"
  ],
  "Blurの現在値を既定値として保存": [
    "Blurの現在値を既定値として保存",
    "Save Blur settings as defaults"
  ],
  "保存したBlurの既定値へ戻す (保存が無ければ初期値)": [
    "保存したBlurの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Blur defaults, or original values"
  ],
  "Hipass: 初速から高域強調が強く効き、後段でブラー範囲が広がる。補色は弱めに抑えつつ残す": [
    "Hipass: 初速から高域強調が強く効き、後段でブラー範囲が広がる。補色は弱めに抑えつつ残す",
    "Hipass: strong fine detail at low values, wider blur at high values, with restrained complementary colors"
  ],
  "中央0=無効。負=ぼかし / 正=シャープ": [
    "中央0=無効。負=ぼかし / 正=シャープ",
    "0 = off; negative = blur; positive = sharpen"
  ],
  "Sharpen (CAS): 甘い所だけを持ち上げて自然にピントを合わせる。硬い縁は控えめで、上げても白い縁取りやノイズが出にくい": [
    "Sharpen (CAS): 甘い所だけを持ち上げて自然にピントを合わせる。硬い縁は控えめで、上げても白い縁取りやノイズが出にくい",
    "Sharpen (CAS): focus soft areas while limiting halos and noise on strong edges"
  ],
  "Crisp: 輪郭を周りとの差で強めるカリッとした硬いシャープ。細い線・文字・粒が立つ (ノイズや Grain も一緒に強まる)": [
    "Crisp: 輪郭を周りとの差で強めるカリッとした硬いシャープ。細い線・文字・粒が立つ (ノイズや Grain も一緒に強まる)",
    "Crisp: hard contrast sharpening for fine lines, text and particles; also boosts noise and Grain"
  ],
  "Shock: ぼけた境界を詰めて段差にする。グラデーションが平らな面に分かれ、セル画・ポスターのようなくっきり感になる": [
    "Shock: ぼけた境界を詰めて段差にする。グラデーションが平らな面に分かれ、セル画・ポスターのようなくっきり感になる",
    "Shock: compress soft edges into flat tonal regions for a cel / poster look"
  ],
  "Outline: 色差対応Scharr + Canny細線化で、白地にAAなしの1pxドット輪郭を引き直す": [
    "Outline: 色差対応Scharr + Canny細線化で、白地にAAなしの1pxドット輪郭を引き直す",
    "Outline: redraw color-sensitive edges as unaliased 1 px dots on white"
  ],
  "Kawase Jitter Blur: ジッター付き 2 半径 Kawase ブラー。指数カーブ": [
    "Kawase Jitter Blur: ジッター付き 2 半径 Kawase ブラー。指数カーブ",
    "Kawase Jitter Blur: two jittered radii with exponential response"
  ],
  "Ring Slice と同じ同心円の帯ごとに、円周方向の回転ブラー。帯ごとに量と向きが違い、時間で脈動する。一部の帯はぼかさない": [
    "Ring Slice と同じ同心円の帯ごとに、円周方向の回転ブラー。帯ごとに量と向きが違い、時間で脈動する。一部の帯はぼかさない",
    "Rotational blur in concentric Ring Slice bands, with varying strength, direction and pulses; some bands stay sharp"
  ],
  "〜0.5は輪郭を残しつつぼかし、0.5以降で完全にぼかす": [
    "〜0.5は輪郭を残しつつぼかし、0.5以降で完全にぼかす",
    "Below 0.5, blur while keeping edges; above 0.5, fully blur"
  ],
  "輪郭が反転するハローの強さ (0 = 反転なし / 0.5 = 従来 / 1 = さらに強く)。Gaussian Blur の値が大きいほど効く": [
    "輪郭が反転するハローの強さ (0 = 反転なし / 0.5 = 従来 / 1 = さらに強く)。Gaussian Blur の値が大きいほど効く",
    "Inverted edge halo strength (0 = none; 0.5 = original; 1 = stronger). More visible at high Gaussian Blur."
  ],
  "ぼかしの半径 = 反転する輪郭の幅 (0 = 半分 / 0.5 = 従来 / 1 = 2 倍)": [
    "ぼかしの半径 = 反転する輪郭の幅 (0 = 半分 / 0.5 = 従来 / 1 = 2 倍)",
    "Blur radius / inverted edge width (0 = half; 0.5 = original; 1 = double)"
  ],
  "手ブレしたフィルム写真の質感。方向ブレ + 赤橙の滲み + 沈んだ黒 + 粗い粒子。向きは drone でゆっくり揺れ、beat で拍ごとに振れる": [
    "手ブレしたフィルム写真の質感。方向ブレ + 赤橙の滲み + 沈んだ黒 + 粗い粒子。向きは drone でゆっくり揺れ、beat で拍ごとに振れる",
    "Shaky film look: directional blur, red-orange bleed, deep blacks and coarse grain. Direction drifts in drone mode or changes on beats."
  ],
  "Audioの現在値を既定値として保存": [
    "Audioの現在値を既定値として保存",
    "Save Audio settings as defaults"
  ],
  "保存したAudioの既定値へ戻す (保存が無ければ初期値)": [
    "保存したAudioの既定値へ戻す (保存が無ければ初期値)",
    "Restore saved Audio defaults, or original values"
  ],
  "【これを上げないと Drive Atk / Drive Rel は効きません】Lens / Blur・Feedback / Glitch / Tone を音で持ち上げる。値が 0 の FX は鳴らない。色調補正・Grad / Auto Map・Material・Texture・Quality は対象外": [
    "【これを上げないと Drive Atk / Drive Rel は効きません】Lens / Blur・Feedback / Glitch / Tone を音で持ち上げる。値が 0 の FX は鳴らない。色調補正・Grad / Auto Map・Material・Texture・Quality は対象外",
    "Raise this to enable Drive Atk / Drive Rel. Audio boosts active Lens / Blur / Feedback / Glitch / Tone FX; FX at 0 stay off. Excludes color, Grad / Auto Map, Material, Texture and Quality."
  ],
  "0=音の持続 (energy) 寄り / 1=打点 (hit/onset) 寄り": [
    "0=音の持続 (energy) 寄り / 1=打点 (hit/onset) 寄り",
    "0 = sustained energy; 1 = attacks / onsets"
  ],
  "打点で跳ねたあと元に戻るまでの秒数。長いほどアタックの余韻が残る": [
    "打点で跳ねたあと元に戻るまでの秒数。長いほどアタックの余韻が残る",
    "Seconds to return after an attack; longer leaves a longer tail"
  ],
  "強い音で発火: 発火ごとにランダム方向へ画面シェイク": [
    "強い音で発火: 発火ごとにランダム方向へ画面シェイク",
    "Strong audio triggers a shake in a new random direction"
  ],
  "音のスペクトル (FFT) で列ごとに映像を上下へ押す (EQ のバルジ)。低音は左、高音は右": [
    "音のスペクトル (FFT) で列ごとに映像を上下へ押す (EQ のバルジ)。低音は左、高音は右",
    "FFT spectrum pushes image columns vertically; bass on the left, treble on the right"
  ],
  "音量と拍頭でズームと微回転が脈動する。映像が音で呼吸する": [
    "音量と拍頭でズームと微回転が脈動する。映像が音で呼吸する",
    "Volume and beats pulse zoom and slight rotation"
  ],
  "アタックで Voronoi 片に割れて飛び散る。打点で砕ける": [
    "アタックで Voronoi 片に割れて飛び散る。打点で砕ける",
    "Audio attacks shatter the image into Voronoi fragments"
  ],
  "強い音で、画面のランダムな位置に円や多角形がふくらんで飛び出す。中は映像を拡大し、陰影と縁取りで浮かせる。発火ごとに位置が変わる": [
    "強い音で、画面のランダムな位置に円や多角形がふくらんで飛び出す。中は映像を拡大し、陰影と縁取りで浮かせる。発火ごとに位置が変わる",
    "Strong audio triggers expanding circles / polygons at random positions, with zoomed content, shading and outlines"
  ],
  "図形の数": [
    "図形の数",
    "Shape count"
  ],
  "半径の上限 (px)。各図形の半径は 1px〜この値でランダム": [
    "半径の上限 (px)。各図形の半径は 1px〜この値でランダム",
    "Maximum radius (px); each shape uses a random radius from 1 px to this value"
  ],
  "形 (2 = 円 / 3 = 三角形 … 12 = 十二角形)": [
    "形 (2 = 円 / 3 = 三角形 … 12 = 十二角形)",
    "Shape (2 = circle; 3 = triangle; … 12 = dodecagon)"
  ],
  "図形の中の映像の拡大 (0 = 拡大なし / 0.5 = 約 2.5 倍)": [
    "図形の中の映像の拡大 (0 = 拡大なし / 0.5 = 約 2.5 倍)",
    "Zoom inside shapes (0 = none; 0.5 ≈ 2.5×)"
  ],
  "縁取りの太さ (0 = なし / 0.5 = 2px)": [
    "縁取りの太さ (0 = なし / 0.5 = 2px)",
    "Outline width (0 = none; 0.5 = 2 px)"
  ],
  "ふくらみの陰影と落ち影 (0 = 平ら)": [
    "ふくらみの陰影と落ち影 (0 = 平ら)",
    "Bulge shading and shadow (0 = flat)"
  ],
  "多角形の向きのばらつきと、出るときの回転 (0 = そろえる)": [
    "多角形の向きのばらつきと、出るときの回転 (0 = そろえる)",
    "Polygon angle variation and entry rotation (0 = aligned)"
  ],
  "オンセットで走査線ずらし": [
    "オンセットで走査線ずらし",
    "Shift scanlines on audio onsets"
  ],
  "音量で色収差(RGB分離)": [
    "音量で色収差(RGB分離)",
    "Audio-driven chromatic aberration (RGB split)"
  ],
  "拍頭(beat)/アタック(drone)で中心から屈折の衝撃波リング": [
    "拍頭(beat)/アタック(drone)で中心から屈折の衝撃波リング",
    "Refraction shockwave rings on beats or audio attacks in drone mode"
  ],
  "拍頭(beat)/アタック(drone)でセルが粒子状に飛散→吸い戻し": [
    "拍頭(beat)/アタック(drone)でセルが粒子状に飛散→吸い戻し",
    "Cells scatter then return on beats or audio attacks in drone mode"
  ],
  "強い音で発火: 発火ごとにランダムなブロック色swap": [
    "強い音で発火: 発火ごとにランダムなブロック色swap",
    "Strong audio triggers random block color swaps"
  ],
  "拍/音に同期した明滅。正=フラッシュ / 負=ダーク": [
    "拍/音に同期した明滅。正=フラッシュ / 負=ダーク",
    "Beat / audio strobe: positive = flash; negative = dark"
  ],
  "アタックで一瞬フラッシュ (発火ごとに白/反転がランダム)": [
    "アタックで一瞬フラッシュ (発火ごとに白/反転がランダム)",
    "Brief attack flash, randomly white or inverted"
  ],
  "画面上のランダムな点を結んだ多角形を切り抜き、片ごとに別の帯域の音量で拡大縮小する (静か = 縮む / 大きい音 = 膨らむ)。配置は beat で拍ごと、drone でアタックごとに変わる。値=拡縮の強さ": [
    "画面上のランダムな点を結んだ多角形を切り抜き、片ごとに別の帯域の音量で拡大縮小する (静か = 縮む / 大きい音 = 膨らむ)。配置は beat で拍ごと、drone でアタックごとに変わる。値=拡縮の強さ",
    "Random polygons scale with different frequency bands: shrink in silence, swell with volume. Layout changes on beats or attacks in drone mode. Controls scaling strength."
  ],
  "多角形の数": [
    "多角形の数",
    "Polygon count"
  ],
  "多角形の頂点の数": [
    "多角形の頂点の数",
    "Vertices per polygon"
  ],
  "頂点を拾う範囲: 0 = 小さな破片 → 1 = 画面全体にまたがる大きな多角形": [
    "頂点を拾う範囲: 0 = 小さな破片 → 1 = 画面全体にまたがる大きな多角形",
    "Vertex spread (0 = small fragments; 1 = frame-spanning polygons)"
  ],
  "切り抜いた元の場所を黒く抜く量 (0 = 元の絵のまま / 1 = 真っ黒の穴)": [
    "切り抜いた元の場所を黒く抜く量 (0 = 元の絵のまま / 1 = 真っ黒の穴)",
    "Darken original cutout areas (0 = original image; 1 = black holes)"
  ],
  "多角形の縁の線の太さ (色は Slice / Mondrian と同じ線の色)。0 = 線なし": [
    "多角形の縁の線の太さ (色は Slice / Mondrian と同じ線の色)。0 = 線なし",
    "Polygon outline width; uses Slice / Mondrian line color (0 = none)"
  ],
  "破片ごとにランダムに漂って回る量 (音が大きい破片ほど大きく動く)。0 = その場で拡縮するだけ (従来)": [
    "破片ごとにランダムに漂って回る量 (音が大きい破片ほど大きく動く)。0 = その場で拡縮するだけ (従来)",
    "Fragment drift and rotation, stronger with louder audio (0 = scale in place)"
  ],
  "画面を 32 本の縦帯に分け、帯ごとに音声スペクトルの高さへ縦に圧縮する (帯の幅はゆっくり揺れる)。1.0 で無音の帯は高さ 0。0=OFF": [
    "画面を 32 本の縦帯に分け、帯ごとに音声スペクトルの高さへ縦に圧縮する (帯の幅はゆっくり揺れる)。1.0 で無音の帯は高さ 0。0=OFF",
    "Compress 32 vertical image bands to spectrum heights, with slowly varying widths. At 1, silent bands collapse to zero height; 0 = off."
  ],
  "帯の高さの倍率 (0 = 従来 / 1 = 8 倍。小さい音でも高さいっぱいまで振れる)": [
    "帯の高さの倍率 (0 = 従来 / 1 = 8 倍。小さい音でも高さいっぱいまで振れる)",
    "Band height gain (0 = original; 1 = 8×), for full-height response to quiet audio"
  ],
  "本数のゆらぎ (0 = 固定。時間とともに本数が増減する)": [
    "本数のゆらぎ (0 = 固定。時間とともに本数が増減する)",
    "Band count variation over time (0 = fixed)"
  ],
  "帯ごとの中身の幅 (1 = 隙間なし / 小さいほど細い線になる)": [
    "帯ごとの中身の幅 (1 = 隙間なし / 小さいほど細い線になる)",
    "Content width within bands (1 = no gaps; smaller = thin lines)"
  ],
  "帯の幅のばらつき (0 = 均等 / 0.55 = 従来)": [
    "帯の幅のばらつき (0 = 均等 / 0.55 = 従来)",
    "Band width variation (0 = equal; 0.55 = original)"
  ],
  "Freeangle Pixelsort: 明るい部分を角度方向にソート。音量で閾値(ソート量)が変化 (NdGXWD)": [
    "Freeangle Pixelsort: 明るい部分を角度方向にソート。音量で閾値(ソート量)が変化 (NdGXWD)",
    "Freeangle Pixelsort: sort bright areas along an angle; audio controls the threshold (NdGXWD)"
  ],
  "現在のブラシモードの値をデフォルトとして保存": [
    "現在のブラシモードの値をデフォルトとして保存",
    "Save current brush mode values as defaults"
  ],
  "現在のブラシモードを初期値へ戻す": [
    "現在のブラシモードを初期値へ戻す",
    "Reset this brush mode to original values"
  ],
  "筆先の形状(丸筆 / 平筆=ランダム角のリボン / Gペン / 指先)": [
    "筆先の形状(丸筆 / 平筆=ランダム角のリボン / Gペン / 指先)",
    "Brush shape: round / flat ribbon / G-pen / fingertip"
  ],
  "FLAT / G-PEN の曲がる回数。1〜5": [
    "FLAT / G-PEN の曲がる回数。1〜5",
    "FLAT / G-PEN bends (1–5)"
  ],
  "クリックして BPM を入力": [
    "クリックして BPM を入力",
    "Click to enter BPM"
  ],
  "タップテンポ (T)": [
    "タップテンポ (T)",
    "Tap tempo (T)"
  ],
  "位相リセット": [
    "位相リセット",
    "Reset beat phase"
  ],
  "BPM値にCC割当": [
    "BPM値にCC割当",
    "Assign a MIDI CC to BPM"
  ],
  "逆再生 (←)": [
    "逆再生 (←)",
    "Reverse (←)"
  ],
  "順再生 (→)": [
    "順再生 (→)",
    "Forward (→)"
  ],
  "beat scale 下げ (↓)": [
    "beat scale 下げ (↓)",
    "Decrease beat scale (↓)"
  ],
  "beat scale 上げ (↑)": [
    "beat scale 上げ (↑)",
    "Increase beat scale (↑)"
  ],
  "Tapボタンにmidiコンのボタンを割当": [
    "Tapボタンにmidiコンのボタンを割当",
    "Assign a MIDI button to Tap"
  ],
  "Reset Φ にmidiコンのボタンを割当": [
    "Reset Φ にmidiコンのボタンを割当",
    "Assign a MIDI button to Reset Φ"
  ],
  "BPM 検知に使うアタック音。Auto Spectrum は曲全体の音域と音量へ自動追従": [
    "BPM 検知に使うアタック音。Auto Spectrum は曲全体の音域と音量へ自動追従",
    "Attack source for BPM detection. Auto Spectrum follows the track's frequency range and volume."
  ],
  "Speed の現在値を起動時のデフォルトとして保存": [
    "Speed の現在値を起動時のデフォルトとして保存",
    "Save Speed as the startup default"
  ],
  "DRONE: 時間駆動": [
    "DRONE: 時間駆動",
    "DRONE: time-driven"
  ],
  "BEAT: 拍同期": [
    "BEAT: 拍同期",
    "BEAT: beat-synced"
  ],
  "全体の再生速度 (シェーダ time / 動画 playbackRate に乗算)": [
    "全体の再生速度 (シェーダ time / 動画 playbackRate に乗算)",
    "Global playback speed; multiplies shader time and video playbackRate"
  ],
  "Beat拍数 / Style / Param Fade の現在値をデフォルトとして保存": [
    "Beat拍数 / Style / Param Fade の現在値をデフォルトとして保存",
    "Save Beat / Style / Param Fade as defaults"
  ],
  "シェーダ切替時に何拍かけて転換するか (0=即時)": [
    "シェーダ切替時に何拍かけて転換するか (0=即時)",
    "Transition length in beats when switching shaders (0 = instant)"
  ],
  "CC28 に割当済み": [
    "CC28 に割当済み",
    "Assigned to CC28"
  ],
  "切替演出のスタイル (shader/mode 共通)": [
    "切替演出のスタイル (shader/mode 共通)",
    "Transition style for shaders and modes"
  ],
  "プリセット適用や Grad Preset 切替 (1-9/0/-/G キー) 時に、Post の数値パラメータを何拍かけて補間するか (0=即時 / Sync=上の Beat 拍数に追従)": [
    "プリセット適用や Grad Preset 切替 (1-9/0/-/G キー) 時に、Post の数値パラメータを何拍かけて補間するか (0=即時 / Sync=上の Beat 拍数に追従)",
    "Post parameter fade when applying presets or Grad Presets (1–9 / 0 / − / G). 0 = instant; Sync follows Beat above."
  ],
  "音声入力を使わない": [
    "音声入力を使わない",
    "Disable audio input"
  ],
  "クリックでON / 点灯中に再クリックでOFF (マイク)": [
    "クリックでON / 点灯中に再クリックでOFF (マイク)",
    "Click to enable Mic; click again to disable"
  ],
  "クリックでON / 点灯中に再クリックでOFF (画面音声)": [
    "クリックでON / 点灯中に再クリックでOFF (画面音声)",
    "Click to enable system audio; click again to disable"
  ],
  "Target / Sensitivity / Band / Attack の現在値を起動時のデフォルトとして保存": [
    "Target / Sensitivity / Band / Attack の現在値を起動時のデフォルトとして保存",
    "Save Target / Sensitivity / Band / Attack as startup defaults"
  ],
  "Audio FX が反応する音の種類。Manual は Band スライダーで任意の帯域を選択": [
    "Audio FX が反応する音の種類。Manual は Band スライダーで任意の帯域を選択",
    "Audio FX target sound. Manual uses the Band slider to select frequencies."
  ],
  "音声検知の感度(FFT入力倍率)。中央=0.5、上げるほど指数関数的に強く(0.03〜中央0.5〜最大8)。棘/energy/onset/hit 全体に効く": [
    "音声検知の感度(FFT入力倍率)。中央=0.5、上げるほど指数関数的に強く(0.03〜中央0.5〜最大8)。棘/energy/onset/hit 全体に効く",
    "Audio sensitivity (FFT gain), exponential from 0.03 through 0.5 at center to 8. Affects spikes, energy, onsets and hits."
  ],
  "Manual時の拾う音域: 0=低音(キック/ベース) → 1=高音(ハイハット等)。Targetプリセット時は表示上の微調整用": [
    "Manual時の拾う音域: 0=低音(キック/ベース) → 1=高音(ハイハット等)。Targetプリセット時は表示上の微調整用",
    "Manual frequency band: 0 = bass / kick; 1 = treble / hi-hat. Fine adjustment when using a Target preset."
  ],
  "0=持続(サステインで滑らかに) / 1=トランジェント強調(アタックで鋭く発火)": [
    "0=持続(サステインで滑らかに) / 1=トランジェント強調(アタックで鋭く発火)",
    "0 = smooth sustain; 1 = sharp transient attacks"
  ],
  "Direction / Speed / Depth / Threshold の現在値を起動時のデフォルトとして保存": [
    "Direction / Speed / Depth / Threshold の現在値を起動時のデフォルトとして保存",
    "Save Direction / Speed / Depth / Threshold as startup defaults"
  ],
  "音で再生方向 (順/逆) を制御。発火判定は Audio Detect の Target / Sensitivity / Attack と Threshold を使用": [
    "音で再生方向 (順/逆) を制御。発火判定は Audio Detect の Target / Sensitivity / Attack と Threshold を使用",
    "Audio-driven forward / reverse playback, using Audio Detect settings and Threshold"
  ],
  "音で再生速度を変調 (Speed スライダーの値に乗算)。シェーダ time / mode / 動画 playbackRate 全てに掛かる": [
    "音で再生速度を変調 (Speed スライダーの値に乗算)。シェーダ time / mode / 動画 playbackRate 全てに掛かる",
    "Audio speed modulation, multiplied by Speed; applies to shaders, modes and video"
  ],
  "Speed 変調の深さ。Energy: 無音〜大音量で ×1/(1+3d)〜×(1+3d) / Hit Boost: 最大 ×(1+3d) / Hit Duck: 最小 ×(1-0.95d)": [
    "Speed 変調の深さ。Energy: 無音〜大音量で ×1/(1+3d)〜×(1+3d) / Hit Boost: 最大 ×(1+3d) / Hit Duck: 最小 ×(1-0.95d)",
    "Speed modulation depth: Energy ×1/(1+3d)…×(1+3d); Hit Boost up to ×(1+3d); Hit Duck down to ×(1−0.95d)"
  ],
  "Direction の発火閾値 (Audio hit がこの値以上で発火)。低いほど敏感。Flip Charge では反転に必要なアタック累積量 (低いほど頻繁に反転)": [
    "Direction の発火閾値 (Audio hit がこの値以上で発火)。低いほど敏感。Flip Charge では反転に必要なアタック累積量 (低いほど頻繁に反転)",
    "Direction trigger threshold; lower is more sensitive. For Flip Charge, sets accumulated attack needed to reverse."
  ],
  "閉じる (Esc)": [
    "閉じる (Esc)",
    "Close (Esc)"
  ],
  "表示の現在の設定を保存": [
    "表示の現在の設定を保存",
    "Save current appearance settings"
  ],
  "表示を初期値に戻して保存": [
    "表示を初期値に戻して保存",
    "Reset appearance and save"
  ],
  "押した時点で保存 (Save / Reset の対象外)": [
    "押した時点で保存 (Save / Reset の対象外)",
    "Saved immediately; independent of Save / Reset"
  ],
  "アクセントカラーをランダムに": [
    "アクセントカラーをランダムに",
    "Random accent color"
  ],
  "区切り線 (セクション・見出し・表の罫線)。Auto = テーマの既定": [
    "区切り線 (セクション・見出し・表の罫線)。Auto = テーマの既定",
    "Section, heading and table dividers. Auto = theme default."
  ],
  "ボタン・入力欄・スライダーの枠線。Auto = テーマの既定": [
    "ボタン・入力欄・スライダーの枠線。Auto = テーマの既定",
    "Button, input and slider borders. Auto = theme default."
  ],
  "トップバー右側に出す項目": [
    "トップバー右側に出す項目",
    "Stats shown at the right of the top bar"
  ],
  "Preset / Visual のサムネの列数": [
    "Preset / Visual のサムネの列数",
    "Preset / Visual thumbnail columns"
  ],
  "ON のとき、起動時に前回の状態を復元 (3 秒ごとに自動保存)。OFF で毎回クリーン起動": [
    "ON のとき、起動時に前回の状態を復元 (3 秒ごとに自動保存)。OFF で毎回クリーン起動",
    "Restore the last state on startup (autosaved every 3 seconds). Off starts clean."
  ],
  "Grad / Blend プレビューバーの表示 (重いとき用)。P キーと同じ": [
    "Grad / Blend プレビューバーの表示 (重いとき用)。P キーと同じ",
    "Show Grad / Blend preview bars; hide to reduce load. Same as P."
  ],
  "起動時に iMouse を拾うかどうか。今の状態は M キーで切り替える (ここでは変わらない)": [
    "起動時に iMouse を拾うかどうか。今の状態は M キーで切り替える (ここでは変わらない)",
    "Capture iMouse on startup. M changes the current state; this setting does not."
  ],
  "起動時のサーバー取得 (defaults.json・保存デフォルト・S 番号・プリセット・グラデ) を待つ時間。時間切れ・失敗はローカルの値で起動する。Offline = 保存デフォルト・プリセット・グラデのサーバー取得と書き込みをせず、ローカルだけで動く。次回起動から効く": [
    "起動時のサーバー取得 (defaults.json・保存デフォルト・S 番号・プリセット・グラデ) を待つ時間。時間切れ・失敗はローカルの値で起動する。Offline = 保存デフォルト・プリセット・グラデのサーバー取得と書き込みをせず、ローカルだけで動く。次回起動から効く",
    "Startup server wait for defaults, IDs, presets and gradients. On timeout, use local values. Offline skips server reads and writes for saved defaults, presets and gradients. Takes effect next launch."
  ],
  "デフォルト保存をサーバー経由で全端末と共有するか。この端末だけ = 起動時の取得も保存時のアップロードもしない (リハーサル用端末向け)。次回起動から効く": [
    "デフォルト保存をサーバー経由で全端末と共有するか。この端末だけ = 起動時の取得も保存時のアップロードもしない (リハーサル用端末向け)。次回起動から効く",
    "Share defaults across devices via the server. This device only skips both downloads and uploads, useful for rehearsals. Takes effect next launch."
  ],
  "Visual ごとのデフォルト (Params のエンジン別パラメータ・Shader Params) を基準値 (defaults_visual.json) に戻す。全端末共通。Mix / Transition / Post / Audio の保存値は変わらない": [
    "Visual ごとのデフォルト (Params のエンジン別パラメータ・Shader Params) を基準値 (defaults_visual.json) に戻す。全端末共通。Mix / Transition / Post / Audio の保存値は変わらない",
    "Reset Visual and Shader Params defaults to defaults_visual.json across devices. Keeps Mix / Transition / Post / Audio defaults."
  ],
  "Esc による全スロットのリセット。二度押し = 1 秒以内にもう一度 Esc で実行 (Settings・MIDI Learn・モーダルを開いている間の Esc は従来どおり閉じるだけ)": [
    "Esc による全スロットのリセット。二度押し = 1 秒以内にもう一度 Esc で実行 (Settings・MIDI Learn・モーダルを開いている間の Esc は従来どおり閉じるだけ)",
    "Esc resets all slots. Double press requires another Esc within 1 second. In Settings, MIDI Learn or dialogs, Esc only closes the panel."
  ],
  "Backspace でアクティブスロットを「なし(透明)」にする": [
    "Backspace でアクティブスロットを「なし(透明)」にする",
    "Backspace clears the active slot to transparent"
  ],
  "ON の間は Esc 全リセット・Backspace・プリセット / グラデ / Bank の削除と上書き・Shift+X (Slot A ⇄ B 交換) を止めてトーストで知らせる。プリセット切替とパラメータ操作は通る": [
    "ON の間は Esc 全リセット・Backspace・プリセット / グラデ / Bank の削除と上書き・Shift+X (Slot A ⇄ B 交換) を止めてトーストで知らせる。プリセット切替とパラメータ操作は通る",
    "Live Lock blocks Esc reset, Backspace, preset / gradient / Bank deletion and overwrite, and Shift+X swap. Preset loading and parameter changes remain available."
  ],
  "フルスクリーン (Shift+F) のあいだ、ステージ上のマウスカーソルを隠す": [
    "フルスクリーン (Shift+F) のあいだ、ステージ上のマウスカーソルを隠す",
    "Hide the stage cursor in fullscreen (Shift+F)"
  ],
  "画面のスリープを抑止する (ブラウザ版のみ。アプリ版は常に抑止済み。既定はタッチ端末だけ ON)": [
    "画面のスリープを抑止する (ブラウザ版のみ。アプリ版は常に抑止済み。既定はタッチ端末だけ ON)",
    "Prevent screen sleep in browsers; desktop apps always do this. On by default for touch devices."
  ],
  "画面下のトースト通知。出さない = Live Lock の警告と Esc 二度押しの案内以外は出さない": [
    "画面下のトースト通知。出さない = Live Lock の警告と Esc 二度押しの案内以外は出さない",
    "Toast notifications. Hidden still shows Live Lock warnings and Esc double-press guidance."
  ],
  "プリセットタイルにマウスを乗せたときのライブ再生。OFF にすると重いシェーダの上を通っても描画しない": [
    "プリセットタイルにマウスを乗せたときのライブ再生。OFF にすると重いシェーダの上を通っても描画しない",
    "Play live previews when hovering preset tiles. Off avoids rendering heavy shaders on hover."
  ],
  "起動後に動画を順に先読みする。OFF = 先読みしない (弱い回線で帯域を節約。OFF は次回起動から。ON に戻すとその場で始まる)": [
    "起動後に動画を順に先読みする。OFF = 先読みしない (弱い回線で帯域を節約。OFF は次回起動から。ON に戻すとその場で始まる)",
    "Preload videos after startup. Off saves bandwidth on slow connections and takes effect next launch; On starts immediately."
  ],
  "ON 中は動画・画像・シェーダを端末へ保存し、全動画の逆再生用 RGBA フレームバッファも IndexedDB へ永続保存します。ON にするとその場で全素材のダウンロードと復号が走ります": [
    "ON 中は動画・画像・シェーダを端末へ保存し、全動画の逆再生用 RGBA フレームバッファも IndexedDB へ永続保存します。ON にするとその場で全素材のダウンロードと復号が走ります",
    "Cache video, images and shaders locally, plus decoded reverse-playback frames in IndexedDB. Enabling starts downloading and decoding all media immediately."
  ],
  "起動時に Audio 入力を自動で開始する。ブラウザ版は最初のクリック / キー操作で開始 (次回起動から効く)": [
    "起動時に Audio 入力を自動で開始する。ブラウザ版は最初のクリック / キー操作で開始 (次回起動から効く)",
    "Start audio input on launch. Browsers wait for the first click or key. Takes effect next launch."
  ],
  "マイクのエコー除去・ノイズ抑制・自動ゲイン。OFF = 生の音 (キックのアタックが潰れず、BPM 検知と Audio reactive が安定する)。マイク入力中に切り替えると取り直す": [
    "マイクのエコー除去・ノイズ抑制・自動ゲイン。OFF = 生の音 (キックのアタックが潰れず、BPM 検知と Audio reactive が安定する)。マイク入力中に切り替えると取り直す",
    "Mic echo cancellation, noise suppression and auto gain. Off uses raw audio for clearer attacks and steadier BPM detection. Changing this restarts active Mic input."
  ],
  "マイクの入力デバイス。OS の既定、または接続中の入力から選ぶ。マイク入力中に切り替えると取り直す": [
    "マイクの入力デバイス。OS の既定、または接続中の入力から選ぶ。マイク入力中に切り替えると取り直す",
    "Mic device: OS default or a connected input. Changing this restarts active Mic input."
  ],
  "All = プリセット切替もライブ操作もフェード / Preset only = プリセット・状態の切替だけフェードし、MIDI コンやスライダーの操作は即反映。Transition のデフォルトとして全端末で共有されます": [
    "All = プリセット切替もライブ操作もフェード / Preset only = プリセット・状態の切替だけフェードし、MIDI コンやスライダーの操作は即反映。Transition のデフォルトとして全端末で共有されます",
    "All fades presets and live changes. Preset only applies live MIDI / slider changes immediately. Saved with Transition defaults across devices."
  ],
  "Tap テンポで倍・半分に畳む BPM の範囲。DnB は 90–200、ダブは 80–160 など曲に合わせる": [
    "Tap テンポで倍・半分に畳む BPM の範囲。DnB は 90–200、ダブは 80–160 など曲に合わせる",
    "Tap tempo range for half / double BPM folding. Try 90–200 for DnB or 80–160 for dub."
  ],
  "プリセットタイルのクリック・ドロップによる切替を拍の頭まで待つ (小節は 4 拍。待機中に押し直すと最後の操作に置き換わる)": [
    "プリセットタイルのクリック・ドロップによる切替を拍の頭まで待つ (小節は 4 拍。待機中に押し直すと最後の操作に置き換わる)",
    "Wait for a beat / bar boundary before loading a clicked or dropped preset (4 beats per bar). A new action replaces the pending one."
  ],
  "全 Visual・全 Slot 共通。無限回転エンコーダの増分値を蓄積して連続パラメータを動かす": [
    "全 Visual・全 Slot 共通。無限回転エンコーダの増分値を蓄積して連続パラメータを動かす",
    "Accumulate relative encoder steps for continuous parameters across all Visuals and slots"
  ],
  "お使いのエンコーダの送出方式。Launch Control XL 3 は受信値を自動変換します": [
    "お使いのエンコーダの送出方式。Launch Control XL 3 は受信値を自動変換します",
    "Encoder output format. Launch Control XL 3 values are converted automatically."
  ],
  "指定したクリック数で 0 から MAX まで変化します": [
    "指定したクリック数で 0 から MAX まで変化します",
    "Encoder clicks needed to move from 0 to MAX"
  ],
  "コントローラの LED へ状態を返す。無印 Launch Control などで明滅・点灯の不具合が出るなら OFF": [
    "コントローラの LED へ状態を返す。無印 Launch Control などで明滅・点灯の不具合が出るなら OFF",
    "Send state to controller LEDs. Turn off if LEDs flicker or behave incorrectly."
  ],
  "プリセット読込後、つまみが基準点を通過するまで値を反映しない (飛び防止)。OFF = つまみの位置にすぐ追従": [
    "プリセット読込後、つまみが基準点を通過するまで値を反映しない (飛び防止)。OFF = つまみの位置にすぐ追従",
    "After loading a preset, wait until the knob crosses the stored value before applying changes. Off follows the knob immediately."
  ],
  "起動時に MIDI 入力デバイスが無いとき「見つかりません」と知らせる": [
    "起動時に MIDI 入力デバイスが無いとき「見つかりません」と知らせる",
    "Warn when no MIDI input device is found at startup"
  ],
  "この端末の MIDI マップ (learn 差分) をサーバーへ送り、他の端末 (ブラウザ / デスクトップアプリ) に反映する": [
    "この端末の MIDI マップ (learn 差分) をサーバーへ送り、他の端末 (ブラウザ / デスクトップアプリ) に反映する",
    "Upload this device's learned MIDI mappings to share with other browsers / desktop apps"
  ],
  "サーバーの MIDI マップをこの端末へ取り込む (リロードで反映)": [
    "サーバーの MIDI マップをこの端末へ取り込む (リロードで反映)",
    "Download the server MIDI map to this device; reload to apply"
  ],
  "描画フレームレートの上限 (fps)。上限に連動して負荷% の表示も変わる": [
    "描画フレームレートの上限 (fps)。上限に連動して負荷% の表示も変わる",
    "Maximum rendering FPS; load percentages follow this limit"
  ],
  "録画にシステム音声 (Audio = System のとき) を含める。OFF = 映像のみ": [
    "録画にシステム音声 (Audio = System のとき) を含める。OFF = 映像のみ",
    "Include system audio in recordings when Audio = System; Off records video only"
  ],
  "スクショ (Cmd/Ctrl+S) の保存形式。PNG = 劣化なし・大きい / JPEG = 小さい・透過なし / WebP = 小さい。このブラウザで書けない形式はグレー": [
    "スクショ (Cmd/Ctrl+S) の保存形式。PNG = 劣化なし・大きい / JPEG = 小さい・透過なし / WebP = 小さい。このブラウザで書けない形式はグレー",
    "Screenshot format (Cmd/Ctrl+S): PNG = lossless / larger; JPEG = smaller / no alpha; WebP = smaller. Unsupported formats are disabled."
  ],
  "録画 (Cmd/Ctrl+R) の保存形式。MOV / MP4 = H.264 (Mac・iPhone・編集ソフトで扱いやすい) / WebM = VP9 (ブラウザ向け)。このブラウザで書けない形式はグレー": [
    "録画 (Cmd/Ctrl+R) の保存形式。MOV / MP4 = H.264 (Mac・iPhone・編集ソフトで扱いやすい) / WebM = VP9 (ブラウザ向け)。このブラウザで書けない形式はグレー",
    "Recording format (Cmd/Ctrl+R): MOV / MP4 = H.264 for Mac, iPhone and editors; WebM = VP9 for browsers. Unsupported formats are disabled."
  ],
  "診断ログ(エラー/メモリ/FPS)をJSONで保存": [
    "診断ログ(エラー/メモリ/FPS)をJSONで保存",
    "Save diagnostic logs (errors / memory / FPS) as JSON"
  ],
  "コンソールに表示": [
    "コンソールに表示",
    "Show in console"
  ],
  "ログ消去": [
    "ログ消去",
    "Clear logs"
  ],
  "ツール一式 (コード) を ZIP でダウンロード": [
    "ツール一式 (コード) を ZIP でダウンロード",
    "Download the app code as ZIP"
  ],
  "動画・画像も含む全ファイルを ZIP でダウンロード (大容量)": [
    "動画・画像も含む全ファイルを ZIP でダウンロード (大容量)",
    "Download all files including media as ZIP (large)"
  ],
  "すべての Save 値を JSON で書き出す": [
    "すべての Save 値を JSON で書き出す",
    "Export all saved defaults as JSON"
  ],
  "アクティブスロットのビジュアルの Save 値だけを書き出す": [
    "アクティブスロットのビジュアルの Save 値だけを書き出す",
    "Export saved defaults for the active Visual only"
  ],
  "JSON の Save 値を確認して読み込む": [
    "JSON の Save 値を確認して読み込む",
    "Review and import saved defaults from JSON"
  ],
  "html.718": [
    "<span class=\"t-fine\">クリック</span><span class=\"t-coarse\">タップ</span>=<b>呼出</b> / <b>⟳</b>=現在の状態で更新 / <b>✎</b>=名前変更 / <b>×</b>=削除 <span style=\"color:var(--dim)\">(数字キー <kbd>1</kbd>〜<kbd>9</kbd> = Grad Preset / <kbd>0</kbd> = 解除)</span>",
    "<span class=\"t-fine\">Click</span><span class=\"t-coarse\">Tap</span> = <b>load</b> / <b>⟳</b> = update / <b>✎</b> = rename / <b>×</b> = delete <span style=\"color:var(--dim)\">(<kbd>1</kbd>–<kbd>9</kbd> = Grad Presets / <kbd>0</kbd> = off)</span>"
  ],
  "html.719": [
    "<span class=\"t-fine\">ホバーでライブプレビュー / クリック</span><span class=\"t-coarse\">タップ</span>で現スロットにロード。",
    "<span class=\"t-fine\">Hover to preview; click</span><span class=\"t-coarse\">Tap</span> to load into the active slot."
  ],
  "html.720": [
    "<span class=\"t-fine\">クリック</span><span class=\"t-coarse\">タップ</span>で現スロットにロード。動画ファイルをこのタブへ<b>ドラッグ&amp;ドロップ</b>するか「＋ 動画」タイルで読み込み (ローカル起動時は movies/ へ取り込み、次回以降も残ります)。",
    "<span class=\"t-fine\">Click</span><span class=\"t-coarse\">Tap</span> to load into the active slot. <b>Drag &amp; drop</b> video here or use the “+ Video” tile. Local mode saves files in movies/ for future sessions."
  ],
  "html.721": [
    "フォルダを<span class=\"t-fine\">クリック</span><span class=\"t-coarse\">タップ</span>で Slot にロード。サムネは中身を 3×2 表示。beat モードで自動送り / <kbd>C</kbd> で次へ。drone は送りなし。<br>画像・フォルダをここへドラッグ&amp;ドロップするか「＋ 画像」「＋ フォルダ」タイルで読み込みます。",
    "<span class=\"t-fine\">Click</span><span class=\"t-coarse\">Tap</span> a folder to load it into a slot. Thumbnails show a 3×2 preview. Beat mode advances automatically; <kbd>C</kbd> advances manually. Drone stays on one image.<br>Drag &amp; drop images or folders here, or use “+ Image” / “+ Folder”."
  ],
  "html.722": [
    "<b>DRONE</b>: 滑らかにパン+ズーム、たまにキャンバスを一掃 / <b>BEAT</b>: 拍ごとに中央へ panel をスポーン",
    "<b>DRONE</b>: smooth pan / zoom with occasional canvas clears. <b>BEAT</b>: spawn panels at the center on each beat."
  ],
  "html.723": [
    "D&D でも読込可。&lt;&gt; でズーム。Rotate / Mirror / Tile / Aspect / Wave (Wave Freq = 波の本数) / Vignette / Letterbox は画面に対する変形。方向は矢印 ←→ (順/逆)。Motion Mode = Beat では拍ごとにランダム位置へジャンプ (常時 ON)。常にミュート再生。",
    "Drag &amp; drop to load. &lt;&gt; zooms; ← / → reverses or plays forward. Rotate / Mirror / Tile / Aspect / Wave / Vignette / Letterbox transform the frame. Motion Mode = Beat jumps to random positions on each beat. Always muted."
  ],
  "html.724": [
    "画像は images/slicer/ から自動列挙。カーソルキーでオービット、&lt;&gt;でズーム。",
    "Images load from images/slicer/. Arrow keys orbit; &lt;&gt; zooms."
  ],
  "html.725": [
    "フィードバック式インク流体 (Inkelly by leon denise)。Beat Sync で拍に合わせてインク場が切替。",
    "Feedback ink fluid (Inkelly by leon denise). Beat Sync changes the ink field on beats."
  ],
  "html.726": [
    "人物・物体・文字など、動いた部分にだけ残像が生じます。",
    "Trails appear only in moving areas such as people, objects and text."
  ],
  "html.727": [
    "始点を固定したまま終点を「探る」モーション → 確定 → フェード",
    "Hold the start point while the end searches, settles, then fades."
  ],
  "html.728": [
    "imagon.app のブラシ形状を VJ の拍に合わせて生成",
    "Generate imagon.app brush shapes in sync with VJ beats."
  ],
  "html.729": [
    "ブラシは <b>始点周辺の画面ピクセル</b> をテクスチャとして拾い、ブラシ形状で歪めて再投影します。<br> <b>Search Time/Amp/Freq</b> で「探る」モーションの長さ・ぶれ幅・速さを制御。<br> <b>Paint Mode</b> ON でフェードせず蓄積、シェーダ下のアニメは継続。<br> <b>Trigger</b> で 1 拍あたりの発生頻度を細分化。<br> キャンバス消去: <kbd>C</kbd> キー or <b>Clear Canvas</b> ボタン",
    "Brushes sample <b>pixels near the start point</b>, distort them and project them through the brush shape.<br><b>Search Time / Amp / Freq</b> controls search duration, range and speed.<br><b>Paint Mode</b> keeps strokes without fading; the shader keeps animating underneath.<br><b>Trigger</b> sets strokes per beat.<br>Clear with <kbd>C</kbd> or <b>Clear Canvas</b>."
  ],
  "html.730": [
    "Layer モードなど独自パラメータを持つエンジンの動きを切替えます。",
    "Switch motion for engines with their own parameters, such as Layer."
  ],
  "html.731": [
    "<b>System (画面音声・Chrome 系):</b> ピッカーで <b>「Chrome タブ」を選択</b> → 下部の <b>「タブの音声を共有」にチェック</b> → Share。<br> ※ 「ウィンドウ」「画面全体」を選ぶと音声が取れず Permission denied になります。<br> ※ macOS では初回 System Settings → Privacy → Screen Recording で Chrome を許可。<br> <br> シェーダ側: <code>texture(iChannel?, vec2(x, 0.25))</code> でFFT、<code>vec2(x, 0.75)</code> で波形、<code>iEnergy</code> で低〜中域のパワー (0..1)。",
    "<b>System audio (Chromium):</b> choose <b>Chrome Tab</b>, enable <b>Share tab audio</b>, then Share.<br>Window or Entire Screen may not provide audio and can return Permission denied.<br>On macOS, allow Chrome in System Settings → Privacy → Screen Recording.<br><br>Shaders: <code>texture(iChannel?, vec2(x, 0.25))</code> = FFT, <code>vec2(x, 0.75)</code> = waveform, <code>iEnergy</code> = low / mid power (0…1)."
  ],
  "html.732": [
    "音の検知は Timing タブの Audio Detect (Target / Sensitivity / Attack) を共用。Mic / System を ON にしてから使用。",
    "Uses Audio Detect (Target / Sensitivity / Attack) in Timing. Enable Mic or System first."
  ],
  "html.733": [
    "MIDI マップは端末ごとに保存されます。正にしたい端末で <b>Push</b> → 反映したい端末で <b>Pull</b>。",
    "MIDI maps are stored per device. <b>Push</b> from the source device, then <b>Pull</b> on the others."
  ],
  "html.734": [
    "サーバー上のツールを丸ごと ZIP 保存。既定は movies/ images/ を除いたコード一式、All はメディアも含みます。PHP の動くサーバー (本番) でだけ使えます。裏 URL: <code>export.php</code> / <code>export.php?all=1</code>",
    "Download the server app as ZIP. Default excludes movies/ and images/; All includes media. Requires a PHP server. Direct links: <code>export.php</code> / <code>export.php?all=1</code>."
  ],
  "html.735": [
    "エラー・WebGLコンテキストロスト・メモリ/FPSを記録（リロード後も保持）。落ちた後にここから保存して原因を確認できます。",
    "Logs errors, WebGL context loss, memory and FPS across reloads. Export after a crash to investigate."
  ],
  "html.736": [
    "Save したパラメータを JSON で保存・復元します。画像・動画・プリセット一覧・端末固有の設定は対象外です。Import はファイル内のキーだけを上書きし、現在のビジュアルが含まれていれば保存値を反映します。",
    "Export / restore saved parameters as JSON. Excludes media, preset lists and device settings. Import overwrites only keys in the file and applies saved values if the active Visual is included."
  ],
  "html.737": [
    "Draw フリーズ (シェーダ類の時間更新 ON/OFF。描画は継続)",
    "Freeze shader animation time; rendering continues"
  ],
  "html.738": [
    "全スロットを「なし(透明)」に + 各パラメータを保存値/初期値へリセット (Settings の Esc Reset で二度押し・無効に変更可)。Settings / Help を開いているときは閉じるだけ",
    "Clear all slots to transparent and reset parameters to saved / original defaults. Settings → Esc Reset can require a double press or disable it. In Settings / Help, only closes the panel."
  ],
  "html.739": [
    "FX / Params / Transition / Code / IMAGON / Pan・Zoom を保存値・初期値へリセット (スロットは保持)",
    "Reset FX / Params / Transition / Code / IMAGON / Pan / Zoom to saved or original defaults; keep slots"
  ],
  "html.740": [
    "パネルのタブ送り (Preset → Visual → Params → … / <kbd>Shift + Tab</kbd> で逆順)",
    "Cycle panel tabs (Preset → Visual → Params → …); <kbd>Shift + Tab</kbd> goes backward"
  ],
  "html.741": [
    "表示中パネルの検索バーへフォーカス (もう一度押すと解除。何も打たずに 2 回押すと検索欄を空にする) / Manga スロット時はマシンガン配置",
    "Focus the current panel's search; press again to blur. Two presses without typing clear it. In Manga, triggers machine-gun placement."
  ],
  "html.742": [
    "タッチ",
    "Touch"
  ],
  "html.743": [
    "ダブルタップで既定値に戻す / MIDI 割り当ては PC のみ",
    "Double-tap to reset defaults; MIDI assignment requires a computer"
  ],
  "html.744": [
    "操作中のスロットを切替 / <kbd>Shift + X</kbd> Slot A ⇄ B 交換 (Live Lock 中は無効)",
    "Switch the active slot; <kbd>Shift + X</kbd> swaps A and B (disabled by Live Lock)"
  ],
  "html.745": [
    "Slot A / B の表示 ON/OFF / <kbd>\\</kbd> クロスフェードのフリップ",
    "Show / hide Slot A / B; <kbd>\\</kbd> flips crossfade"
  ],
  "html.746": [
    "操作中のスロットを透明に (Settings の Backspace Clear で無効にできる) / <kbd>Shift + Backspace</kbd> Visual 固有の操作",
    "Clear the active slot to transparent (disable via Backspace Clear in Settings); <kbd>Shift + Backspace</kbd> runs the Visual's action"
  ],
  "html.747": [
    "<kbd>Shift</kbd> 単押し",
    "Tap <kbd>Shift</kbd>"
  ],
  "html.748": [
    "Visual 固有の操作 (背景切替、組方向など)",
    "Visual-specific action, such as background or text direction"
  ],
  "html.749": [
    "A/B タイル",
    "A/B tiles"
  ],
  "html.750": [
    "クリック = そのスロットを操作対象に (合成プレビューのクリックでは変わらない) / ダブルクリック = 表示切替 / もう一方へドラッグ = A ⇄ B 交換",
    "Click to select a slot; double-click to show / hide; drag to the other tile to swap A and B. Clicking the composite does not select a slot."
  ],
  "html.751": [
    "IMAGON / Manga キャンバスとドラッグで置いた吹き出しをクリア + User Pan/Zoom リセット + 初期フレームに戻す",
    "Clear IMAGON / Manga and placed balloons; reset Pan / Zoom and return to the first frame"
  ],
  "html.752": [
    "左ドラッグ",
    "Left drag"
  ],
  "html.753": [
    "S128 Uni Flash のスロットがアクティブのとき、押している間カーソル位置へ吹き出しを連射 (MANGA のマシンガンと同じ)",
    "With S128 Uni Flash active, hold to fire balloons at the cursor, like MANGA's machine gun"
  ],
  "html.754": [
    "Grad Preset 切替 / <kbd>0</kbd> 通常色",
    "Switch Grad Presets; <kbd>0</kbd> restores original colors"
  ],
  "html.755": [
    "Grad Map の反転 (+ ↔ −)",
    "Reverse Grad Map (+ ↔ −)"
  ],
  "html.756": [
    "色相反転 (+180°。押すたびに半周、2回で元へ)",
    "Rotate hue by 180°; press twice to return"
  ],
  "html.757": [
    "Invert トグル (明度だけ反転、色相は保つ)",
    "Toggle Invert (brightness only; keeps hue)"
  ],
  "html.758": [
    "Auto Map トグル (操作中のスロットへ適用 — A なら A ← B / B なら B ← A)",
    "Toggle Auto Map for the active slot: A ← B or B ← A"
  ],
  "html.759": [
    "短押し = カラーサークル / 長押し = スポイト (押している間プレビュー、クリックで確定。押したまま動かすと追従し離した位置で確定。確定せずに離すと元の色へ)",
    "Tap for the color wheel; hold for the eyedropper. Click to confirm; drag and release to pick. Release without confirming to restore the original color."
  ],
  "html.760": [
    "<kbd>Option</kbd>+クリック",
    "<kbd>Option</kbd> + click"
  ],
  "html.761": [
    "Visual タブのタイル: その絵から Grad Map を生成して適用",
    "On a Visual tile, generate and apply a Grad Map from its image"
  ],
  "html.762": [
    "代理モード (離席): 安全なプリセットを 30〜60 秒ごとにフェードで切り替え、fps が落ちたら軽いものへ逃がす。何かキー・クリック・ホイール・MIDI を触ると即停止 (上部の Away ボタン・画面左下のバッジのクリックでも切替/停止)",
    "Away mode: fade between safe presets every 30–60 seconds, using lighter ones if FPS drops. Any key, click, wheel or MIDI input stops it. Also toggle with Away or stop with the lower-left badge."
  ],
  "html.763": [
    "beat / drone 切替",
    "Switch beat / drone"
  ],
  "html.764": [
    "beat scale (×倍率) 上げ/下げ",
    "Increase / decrease beat scale"
  ],
  "html.765": [
    "visual 逆再生 / 順再生 (Type Deformer は → で次の Look)",
    "Reverse / forward playback; → selects the next Look in Type Deformer"
  ],
  "html.766": [
    "ズーム (iZoom 経由)",
    "Zoom via iZoom"
  ],
  "html.767": [
    "Audio Direction 切替 (Flip → Flip Charge → Off)",
    "Cycle Audio Direction: Flip → Flip Charge → Off"
  ],
  "html.768": [
    "iMouse 取得 ON/OFF (起動時の値は Settings の iMouse)",
    "Toggle iMouse capture; startup behavior is in Settings"
  ],
  "html.769": [
    "フルスクリーン",
    "Fullscreen"
  ],
  "html.770": [
    "Grad / Blend プレビューバーの表示トグル (負荷対策)",
    "Show / hide Grad / Blend preview bars to reduce load"
  ],
  "html.771": [
    "IMAGON トグル",
    "Toggle IMAGON"
  ],
  "html.772": [
    "スクリーンショットを PNG 保存 / <kbd>Cmd/Ctrl + Shift + S</kbd> 状態の手動保存",
    "Save a PNG screenshot; <kbd>Cmd/Ctrl + Shift + S</kbd> saves the current state"
  ],
  "html.773": [
    "エディタのシェーダをコンパイル",
    "Compile the shader in the editor"
  ],
  "html.774": [
    "何も映らない・真っ黒になった",
    "Nothing appears / the screen is black"
  ],
  "html.775": [
    "<kbd>Esc</kbd> を押すと全スロットが透明 (なし) に戻ります。Visual のサムネをクリックして読み込み直してください。下段の A/B タイルが暗いときは表示 OFF なので、<kbd>[</kbd> / <kbd>]</kbd> かタイルのダブルクリックで戻します。Slot B は Mix の Opacity が 0 だと見えません。",
    "<kbd>Esc</kbd> clears all slots to transparent. Click a Visual thumbnail to load it again. Dark A/B tiles mean the slot is hidden; press <kbd>[</kbd> / <kbd>]</kbd> or double-click its tile. Slot B is invisible when Mix Opacity is 0."
  ],
  "html.776": [
    "どのスロットを操作しているのか分からない",
    "Which slot am I editing?"
  ],
  "html.777": [
    "マゼンタの枠が付いている方です (上の Slot A / B ボタンと下段のタイル)。<kbd>X</kbd> か、ボタン・タイルのクリックで切り替えます。読み込みやパラメータ操作は、このスロットに対して行われます。",
    "The active slot has a magenta border on its top button and bottom tile. Press <kbd>X</kbd> or click a button / tile to switch. Loading and parameter edits affect this slot."
  ],
  "html.778": [
    "自分の画像や動画を使いたい",
    "How do I use my images or videos?"
  ],
  "html.779": [
    "Visual タブへファイルをドラッグ&amp;ドロップするか、Visual の Image 欄・Movie 欄の先頭にある「＋」タイルから読み込みます。アプリ版・ローカル起動では images/drop/ と movies/ に保存されて次回も残ります。ウェブ版ではリロードすると消えます。",
    "Drag &amp; drop files onto Visual, or use the “+” tile in Image / Movie. Desktop and local mode save them in images/drop/ and movies/ for future sessions. Web uploads disappear on reload."
  ],
  "html.780": [
    "音に反応させたい",
    "How do I react to audio?"
  ],
  "html.781": [
    "Timing の Audio Input で Mic か System を選びます。System は、ピッカーで「Chrome タブ」を選び「タブの音声を共有」にチェックしてください。反応の強さは Audio Detect で調整します。",
    "In Timing → Audio Input, choose Mic or System. For System, select Chrome Tab and enable Share tab audio. Adjust the response in Audio Detect."
  ],
  "html.782": [
    "テンポを曲に合わせたい",
    "How do I match the music's tempo?"
  ],
  "html.783": [
    "拍に合わせて <kbd>T</kbd> を数回叩きます (Timing の Tap と同じ)。BPM の大きな数字をクリックすると直接入力でき、Reset Φ で拍の頭を合わせられます。",
    "Tap <kbd>T</kbd> a few times to the beat, or use Tap in Timing. Click the large BPM number to enter a value; Reset Φ aligns the beat phase."
  ],
  "html.784": [
    "値を元に戻したい",
    "How do I reset a value?"
  ],
  "html.785": [
    "スライダーはダブルクリックでデフォルト値に戻ります。各欄の Reset はその欄を保存したデフォルトへ、<kbd>R</kbd> は FX / Params / Transition などをまとめて戻します (スロットは残ります)。直前の操作は <kbd>Cmd/Ctrl + Z</kbd> で取り消せます。",
    "Double-click a slider to restore its default. Each section's Reset restores saved defaults; <kbd>R</kbd> resets FX / Params / Transition together while keeping slots. <kbd>Cmd/Ctrl + Z</kbd> undoes the last change."
  ],
  "html.786": [
    "今の状態を残したい",
    "How do I save this state?"
  ],
  "html.787": [
    "Preset タブの「+ Save Current」で、全体の状態をプリセットにします。各欄の Save は、その欄の起動時のデフォルトを保存します。Settings の Restore を ON にすると、次回の起動で前回の状態に戻ります。",
    "Use “+ Save Current” in Preset to save the whole state. Each section's Save sets its startup defaults. Enable Restore in Settings to resume the last state next launch."
  ],
  "html.788": [
    "MIDI コントローラで動かしたい",
    "How do I use a MIDI controller?"
  ],
  "html.789": [
    "スライダーかチェックボックスを右クリックしてから、つまみやボタンを動かすと割り当てられます。もう一度右クリックで解除します。Shader Params は各行右の MIDI ボタンでも割り当てられます。",
    "Right-click a slider or checkbox, then move a knob or press a controller button to assign it. Right-click again to remove it. Shader Params also has a MIDI button on each row."
  ],
  "html.790": [
    "外部ディスプレイに出したい",
    "How do I use an external display?"
  ],
  "html.791": [
    "トップバーの Projector で出力専用のウィンドウを開き、外部ディスプレイへ移します。出力の解像度は Settings の Resolution で変えます。",
    "Click Projector in the top bar, then move the output window to the external display. Set output Resolution in Settings."
  ],
  "html.792": [
    "重い・カクつく",
    "Playback is slow or choppy"
  ],
  "html.793": [
    "<kbd>P</kbd> で Grad / Blend のプレビューバーを隠す、Settings の Output (FPS Cap・Resolution) を下げる、FX を減らす、の順で試してください。",
    "Try hiding Grad / Blend previews with <kbd>P</kbd>, lowering FPS Cap / Resolution in Settings → Output, then reducing FX."
  ],
  "html.794": [
    "録画したい",
    "How do I record?"
  ],
  "html.795": [
    "Record (<kbd>Cmd/Ctrl + R</kbd>) で開始・停止します。画面音声を ON にしていれば音声も入ります。静止画は Shot (<kbd>Cmd/Ctrl + S</kbd>) で PNG 保存です。",
    "Record (<kbd>Cmd/Ctrl + R</kbd>) starts / stops recording. System audio is included when enabled. Shot (<kbd>Cmd/Ctrl + S</kbd>) saves a PNG still."
  ],
  "Add (加算)": [
    "Add (加算)",
    "Add"
  ],
  "Multiply (乗算)": [
    "Multiply (乗算)",
    "Multiply"
  ],
  "Screen (スクリーン)": [
    "Screen (スクリーン)",
    "Screen"
  ],
  "Darker Color (暗い色)": [
    "Darker Color (暗い色)",
    "Darker Color"
  ],
  "Lighter Color (明るい色)": [
    "Lighter Color (明るい色)",
    "Lighter Color"
  ],
  "Difference (差の絶対値)": [
    "Difference (差の絶対値)",
    "Difference"
  ],
  "Overlay (オーバーレイ)": [
    "Overlay (オーバーレイ)",
    "Overlay"
  ],
  "On (無音でも拍で動く)": [
    "On (無音でも拍で動く)",
    "On (pulse in silence)"
  ],
  "Off (Look の色)": [
    "Off (Look の色)",
    "Off (Look colors)"
  ],
  "Paper only (背景だけ固定)": [
    "Paper only (背景だけ固定)",
    "Paper only"
  ],
  "On (クリックで Look を押す)": [
    "On (クリックで Look を押す)",
    "On (click to stamp)"
  ],
  "Hero (大 1 + 周り)": [
    "Hero (大 1 + 周り)",
    "Hero (large + small)"
  ],
  "Frame (中央を空ける)": [
    "Frame (中央を空ける)",
    "Frame (open center)"
  ],
  "Cascade (大→小)": [
    "Cascade (大→小)",
    "Cascade (large to small)"
  ],
  "Scatter (余白を保つ)": [
    "Scatter (余白を保つ)",
    "Scatter (spaced)"
  ],
  "Free (自由配置)": [
    "Free (自由配置)",
    "Free"
  ],
  "Random (ランダムな周期で構成を入れ替え)": [
    "Random (ランダムな周期で構成を入れ替え)",
    "Random (auto layout)"
  ],
  "Slash (強い対角線)": [
    "Slash (強い対角線)",
    "Slash (diagonal)"
  ],
  "Scale (極端な大小)": [
    "Scale (極端な大小)",
    "Scale (size contrast)"
  ],
  "Cross (縦横の交差)": [
    "Cross (縦横の交差)",
    "Cross"
  ],
  "Radial (放射)": [
    "Radial (放射)",
    "Radial"
  ],
  "Wedge (くさびと円)": [
    "Wedge (くさびと円)",
    "Wedge"
  ],
  "Stairs (階段)": [
    "Stairs (階段)",
    "Stairs"
  ],
  "Sync (まとめて出る)": [
    "Sync (まとめて出る)",
    "Sync (all at once)"
  ],
  "Machine Gun (拍の刻みで 1 枚ずつ)": [
    "Machine Gun (拍の刻みで 1 枚ずつ)",
    "Machine Gun (one per beat)"
  ],
  "Layout (大きい順)": [
    "Layout (大きい順)",
    "Layout (largest first)"
  ],
  "Sweep (左から)": [
    "Sweep (左から)",
    "Sweep (from left)"
  ],
  "Glide (なめらかに移る)": [
    "Glide (なめらかに移る)",
    "Glide"
  ],
  "Jump (瞬間的に置き直す)": [
    "Jump (瞬間的に置き直す)",
    "Jump"
  ],
  "Canvas の詳細": [
    "Canvas の詳細",
    "Canvas details"
  ],
  "Live (焼き付け + 順番に描き直し)": [
    "Live (焼き付け + 順番に描き直し)",
    "Live (bake + redraw)"
  ],
  "Bake (置いたときだけ)": [
    "Bake (置いたときだけ)",
    "Bake (on placement)"
  ],
  "Off (文字の動きだけ)": [
    "Off (文字の動きだけ)",
    "Off (text motion only)"
  ],
  "Off (全体にビネットを掛けない)": [
    "Off (全体にビネットを掛けない)",
    "Off (no global vignette)"
  ],
  "On (本体の Look のビネット・グレイン)": [
    "On (本体の Look のビネット・グレイン)",
    "On (Look vignette / grain)"
  ],
  "Auto (見えにくいものだけ紙を敷く)": [
    "Auto (見えにくいものだけ紙を敷く)",
    "Auto (paper if needed)"
  ],
  "★ オススメだけ": [
    "★ オススメだけ",
    "★ Recommended"
  ],
  "全プリセット (436)": [
    "全プリセット (436)",
    "All presets (436)"
  ],
  "Look の詳細": [
    "Look の詳細",
    "Look details"
  ],
  "文字組 (共通)": [
    "文字組 (共通)",
    "Shared typography"
  ],
  "Off (Look の書体)": [
    "Off (Look の書体)",
    "Off (Look font)"
  ],
  "ゴシック (Aratana + 秀英角ゴ銀)": [
    "ゴシック (Aratana + 秀英角ゴ銀)",
    "Sans (Aratana + Shuei)"
  ],
  "明朝 (Garamond + にじみ明朝)": [
    "明朝 (Garamond + にじみ明朝)",
    "Serif (Garamond + Nijimi)"
  ],
  "にじみ明朝": [
    "にじみ明朝",
    "Nijimi Mincho"
  ],
  "游明朝": [
    "游明朝",
    "Yu Mincho"
  ],
  "リュウミン": [
    "リュウミン",
    "Ryumin"
  ],
  "秀英角ゴ銀": [
    "秀英角ゴ銀",
    "Shuei Gothic Gin"
  ],
  "Motion (伸び縮み)": [
    "Motion (伸び縮み)",
    "Motion (stretch)"
  ],
  "BG透過": [
    "BG透過",
    "Clear BG"
  ],
  "カラー絵文字": [
    "カラー絵文字",
    "Color emoji"
  ],
  "剥離": [
    "剥離",
    "Peeling"
  ],
  "風の面": [
    "風の面",
    "Wind sheets"
  ],
  "リゾーム": [
    "リゾーム",
    "Rhizome"
  ],
  "Rhizome 扇": [
    "Rhizome 扇",
    "Rhizome fan"
  ],
  "逃走線": [
    "逃走線",
    "Lines of flight"
  ],
  "Rhizome 群れの輪": [
    "Rhizome 群れの輪",
    "Rhizome ring"
  ],
  "Rhizome 積層": [
    "Rhizome 積層",
    "Rhizome stack"
  ],
  "Rhizome 筒と網": [
    "Rhizome 筒と網",
    "Rhizome tubes / net"
  ],
  "有機 3D 文字": [
    "有機 3D 文字",
    "Organic 3D text"
  ],
  "Swiss タイポ": [
    "Swiss タイポ",
    "Swiss type"
  ],
  "浮遊する構造物": [
    "浮遊する構造物",
    "Floating structures"
  ],
  "毛筆": [
    "毛筆",
    "Brush lettering"
  ],
  "Auto (縦長=Contain / 横長=Cover)": [
    "Auto (縦長=Contain / 横長=Cover)",
    "Auto (portrait: fit / landscape: fill)"
  ],
  "Cover (画面いっぱい)": [
    "Cover (画面いっぱい)",
    "Cover (fill)"
  ],
  "Contain (全体表示)": [
    "Contain (全体表示)",
    "Contain (fit)"
  ],
  "Stretch (引き伸ばし)": [
    "Stretch (引き伸ばし)",
    "Stretch"
  ],
  "4拍": [
    "4拍",
    "4 beats"
  ],
  "Single (固定)": [
    "Single (固定)",
    "Single (fixed)"
  ],
  "Drone (寄り引き)": [
    "Drone (寄り引き)",
    "Drone (slow zoom)"
  ],
  "Trans 連動": [
    "Trans 連動",
    "Link to Trans"
  ],
  "カット (即時)": [
    "カット (即時)",
    "Cut (instant)"
  ],
  "1/4 拍": [
    "1/4 拍",
    "¼ beat"
  ],
  "1/2 拍": [
    "1/2 拍",
    "½ beat"
  ],
  "1 拍": [
    "1 拍",
    "1 beat"
  ],
  "2 拍": [
    "2 拍",
    "2 beats"
  ],
  "4 拍": [
    "4 拍",
    "4 beats"
  ],
  "8 拍": [
    "8 拍",
    "8 beats"
  ],
  "Style 連動": [
    "Style 連動",
    "Link to Style"
  ],
  "なし (Crossfade)": [
    "なし (Crossfade)",
    "None (Crossfade)"
  ],
  "Black Fade (暗転)": [
    "Black Fade (暗転)",
    "Black Fade"
  ],
  "Add Glow (発光)": [
    "Add Glow (発光)",
    "Add Glow"
  ],
  "Wipe → (左右)": [
    "Wipe → (左右)",
    "Wipe →"
  ],
  "Wipe ↓ (上下)": [
    "Wipe ↓ (上下)",
    "Wipe ↓"
  ],
  "Glitch: Slice (横スライスずれ)": [
    "Glitch: Slice (横スライスずれ)",
    "Glitch: Slice"
  ],
  "Barcode (バーコード化)": [
    "Barcode (バーコード化)",
    "Barcode"
  ],
  "画像読込": [
    "画像読込",
    "Load image"
  ],
  "Image (平均色)": [
    "Image (平均色)",
    "Image (average color)"
  ],
  "丸筆 (等方)": [
    "丸筆 (等方)",
    "Round brush"
  ],
  "平筆 (ランダム角・リボン状)": [
    "平筆 (ランダム角・リボン状)",
    "Flat ribbon (random angle)"
  ],
  "Gペン (進行方向に細長・尖り)": [
    "Gペン (進行方向に細長・尖り)",
    "G-pen (long / pointed)"
  ],
  "指先 (やや幅広の柔らかい丸)": [
    "指先 (やや幅広の柔らかい丸)",
    "Fingertip (soft / wide)"
  ],
  "フェードせず蓄積": [
    "フェードせず蓄積",
    "Keep strokes"
  ],
  "Trigger 連動": [
    "Trigger 連動",
    "Link to Trigger"
  ],
  "1 / 32 拍": [
    "1 / 32 拍",
    "1/32 beat"
  ],
  "1 / 16 拍": [
    "1 / 16 拍",
    "1/16 beat"
  ],
  "1 / 8 拍": [
    "1 / 8 拍",
    "⅛ beat"
  ],
  "1 / 4 拍": [
    "1 / 4 拍",
    "¼ beat"
  ],
  "1 / 2 拍": [
    "1 / 2 拍",
    "½ beat"
  ],
  "16 拍": [
    "16 拍",
    "16 beats"
  ],
  "32 拍": [
    "32 拍",
    "32 beats"
  ],
  "SMUDGE の描画時間を拍単位で選択。": [
    "SMUDGE の描画時間を拍単位で選択。",
    "SMUDGE stroke duration in beats."
  ],
  "=発生間隔と同じ / それ以外で発生と描画を分離": [
    "=発生間隔と同じ / それ以外で発生と描画を分離",
    "= trigger interval; other values separate trigger and stroke duration"
  ],
  "Random (どこでも)": [
    "Random (どこでも)",
    "Random (anywhere)"
  ],
  "◎ 中心付近": [
    "◎ 中心付近",
    "◎ Near center"
  ],
  "▦ 3×3 グリッド": [
    "▦ 3×3 グリッド",
    "▦ 3×3 grid"
  ],
  "□ 外周 (画面の縁)": [
    "□ 外周 (画面の縁)",
    "□ Frame edges"
  ],
  "Random (自由)": [
    "Random (自由)",
    "Random (free)"
  ],
  "↔ 横 (左右)": [
    "↔ 横 (左右)",
    "↔ Horizontal"
  ],
  "↕ 縦 (上下)": [
    "↕ 縦 (上下)",
    "↕ Vertical"
  ],
  "↗ 右上がり 45°": [
    "↗ 右上がり 45°",
    "↗ Upward 45°"
  ],
  "↘ 右下がり 45°": [
    "↘ 右下がり 45°",
    "↘ Downward 45°"
  ],
  "◎→ 放射 (中心→外)": [
    "◎→ 放射 (中心→外)",
    "◎→ Outward"
  ],
  "→◎ 収束 (外→中心)": [
    "→◎ 収束 (外→中心)",
    "→◎ Inward"
  ],
  "↻ 回転 (角度が変化)": [
    "↻ 回転 (角度が変化)",
    "↻ Rotating"
  ],
  "音から自動検出（要 Mic / System）": [
    "音から自動検出（要 Mic / System）",
    "Detect from audio (requires Mic / System)"
  ],
  "0 beat (即時)": [
    "0 beat (即時)",
    "0 beats (instant)"
  ],
  "0 (即時)": [
    "0 (即時)",
    "0 (instant)"
  ],
  "Sync (Transition の Beat と同じ)": [
    "Sync (Transition の Beat と同じ)",
    "Sync (Transition Beat)"
  ],
  "Off (矢印キーのみ)": [
    "Off (矢印キーのみ)",
    "Off (arrow keys only)"
  ],
  "Flip (アタックで反転)": [
    "Flip (アタックで反転)",
    "Flip (on attack)"
  ],
  "Flip Charge (アタック累積で反転)": [
    "Flip Charge (アタック累積で反転)",
    "Flip Charge (attack buildup)"
  ],
  "Reverse on Hit (音の間だけ逆)": [
    "Reverse on Hit (音の間だけ逆)",
    "Reverse on Hit"
  ],
  "Forward on Hit (通常は逆)": [
    "Forward on Hit (通常は逆)",
    "Forward on Hit"
  ],
  "Energy (音量→速度)": [
    "Energy (音量→速度)",
    "Energy (volume → speed)"
  ],
  "Hit Boost (アタックで加速)": [
    "Hit Boost (アタックで加速)",
    "Hit Boost"
  ],
  "Hit Duck (アタックでスロー)": [
    "Hit Duck (アタックでスロー)",
    "Hit Duck"
  ],
  "iMouse (起動時)": [
    "iMouse (起動時)",
    "iMouse (startup)"
  ],
  "Shared (全端末)": [
    "Shared (全端末)",
    "Shared (all devices)"
  ],
  "This device only (この端末だけ)": [
    "This device only (この端末だけ)",
    "This device only"
  ],
  "Single (一発)": [
    "Single (一発)",
    "Single press"
  ],
  "Double (二度押し・1 秒以内)": [
    "Double (二度押し・1 秒以内)",
    "Double press (within 1 sec)"
  ],
  "Off (無効)": [
    "Off (無効)",
    "Off (disabled)"
  ],
  "All (すべて)": [
    "All (すべて)",
    "All"
  ],
  "Off (出さない)": [
    "Off (出さない)",
    "Off (hidden)"
  ],
  "OS default (OS の既定)": [
    "OS default (OS の既定)",
    "OS default"
  ],
  "All (プリセット + ライブ操作)": [
    "All (プリセット + ライブ操作)",
    "All (presets + live)"
  ],
  "Preset only (ライブ操作は即反映)": [
    "Preset only (ライブ操作は即反映)",
    "Preset only (live is instant)"
  ],
  "Now (即時)": [
    "Now (即時)",
    "Now"
  ],
  "Next beat (次の拍)": [
    "Next beat (次の拍)",
    "Next beat"
  ],
  "Next bar (次の小節)": [
    "Next bar (次の小節)",
    "Next bar"
  ],
  "Two's Complement (2の補数: 1..63=CW / 127..65=CCW)": [
    "Two's Complement (2の補数: 1..63=CW / 127..65=CCW)",
    "Two's Complement (1…63=CW / 127…65=CCW)"
  ],
  "Sign Bit (符号ビット: 1..63=CW / 65..127=CCW)": [
    "Sign Bit (符号ビット: 1..63=CW / 65..127=CCW)",
    "Sign Bit (1…63=CW / 65…127=CCW)"
  ],
  "Unlimited (無制限)": [
    "Unlimited (無制限)",
    "Unlimited"
  ],
  "はじめに": [
    "はじめに",
    "Getting started"
  ],
  "タブのサムネをクリックして、操作中のスロット (マゼンタ枠) に読み込む。": [
    "タブのサムネをクリックして、操作中のスロット (マゼンタ枠) に読み込む。",
    "Click a thumbnail to load it into the active slot (magenta border)."
  ],
  "が下地、": [
    "が下地、",
    "is the base;"
  ],
  "がその上に重なる。重ね具合は": [
    "がその上に重なる。重ね具合は",
    "layers over it. Adjust the mix with"
  ],
  "の Opacity と Blend。": [
    "の Opacity と Blend。",
    "Opacity and Blend."
  ],
  "でテンポを合わせ (": [
    "でテンポを合わせ (",
    "sets tempo ("
  ],
  "でタップ)、Audio Input を Mic か System にすると音に反応する。": [
    "でタップ)、Audio Input を Mic か System にすると音に反応する。",
    "to tap). Mic or System enables audio response."
  ],
  "色は": [
    "色は",
    "Choose colors with"
  ],
  "の Grad Preset、仕上げは": [
    "の Grad Preset、仕上げは",
    "Grad Presets; add effects in"
  ],
  "タブ。FX タブの": [
    "タブ。FX タブの",
    ". The"
  ],
  "欄 (Grad Map・Hue・Brightness・Gamma・Invert ほか) は欄だけ先頭にあり、効くのは Post FX の最後 (3D FX・Glitch・残像・ブラーにも掛かる)。": [
    "欄 (Grad Map・Hue・Brightness・Gamma・Invert ほか) は欄だけ先頭にあり、効くのは Post FX の最後 (3D FX・Glitch・残像・ブラーにも掛かる)。",
    "section appears first but runs last, after 3D, Glitch, trails and blur."
  ],
  "画面上部のクイック行:": [
    "画面上部のクイック行:",
    "Quick controls:"
  ],
  "。スマホでは二度押し)。": [
    "。スマホでは二度押し)。",
    "; double press on mobile)."
  ],
  "(FX タブの 3D 欄: Photo / Slicer / Layers / Needle / Origami / Drape / Passage / Uzumaki): 量 0 から元の画面とつながり、重ねがけできる。重いときは": [
    "(FX タブの 3D 欄: Photo / Slicer / Layers / Needle / Origami / Drape / Passage / Uzumaki): 量 0 から元の画面とつながり、重ねがけできる。重いときは",
    "(FX → 3D) starts smoothly from zero and supports stacking. If slow, lower"
  ],
  "を下げる。": [
    "を下げる。",
    "."
  ],
  "気に入った状態は": [
    "気に入った状態は",
    "Save a state in"
  ],
  "タブの「+ Save Current」で残す。": [
    "タブの「+ Save Current」で残す。",
    "with “+ Save Current”."
  ],
  "本番の出力は": [
    "本番の出力は",
    "Output to"
  ],
  "(スマホは": [
    "(スマホは",
    "(on mobile,"
  ],
  "= フルスクリーン)、録画は": [
    "= フルスクリーン)、録画は",
    "is fullscreen); record with"
  ],
  "、静止画は": [
    "、静止画は",
    "and take stills with"
  ],
  "ショートカット: 基本": [
    "ショートカット: 基本",
    "Shortcuts: basics"
  ],
  "ショートカット: スロット": [
    "ショートカット: スロット",
    "Shortcuts: slots"
  ],
  "ショートカット: 色": [
    "ショートカット: 色",
    "Shortcuts: color"
  ],
  "ショートカット: テンポ・動き": [
    "ショートカット: テンポ・動き",
    "Shortcuts: tempo / motion"
  ],
  "ショートカット: 表示・出力": [
    "ショートカット: 表示・出力",
    "Shortcuts: display / output"
  ],
  "help.start.0": [
    "<b>Visual</b> タブのサムネをクリックして、操作中のスロット (マゼンタ枠) に読み込む。",
    "Click a thumbnail in <b>Visual</b> to load it into the active slot (magenta border)."
  ],
  "help.start.1": [
    "<b>Slot A</b> が下地、<b>Slot B</b> がその上に重なる。重ね具合は <b>Mix</b> の Opacity と Blend。",
    "<b>Slot A</b> is the base; <b>Slot B</b> layers over it. Set Opacity and Blend in <b>Mix</b>."
  ],
  "help.start.2": [
    "<b>Timing</b> でテンポを合わせ (<kbd>T</kbd> でタップ)、Audio Input を Mic か System にすると音に反応する。",
    "Set tempo in <b>Timing</b> (tap <kbd>T</kbd>). Choose Mic or System for Audio Input to react to sound."
  ],
  "help.start.3": [
    "色は <kbd>1</kbd>〜<kbd>9</kbd> の Grad Preset、仕上げは <b>FX</b> タブ。FX タブの <b>Color</b> 欄 (Grad Map・Hue・Brightness・Gamma・Invert ほか) は欄だけ先頭にあり、効くのは Post FX の最後 (3D FX・Glitch・残像・ブラーにも掛かる)。",
    "Use <kbd>1</kbd>–<kbd>9</kbd> for Grad Preset colors and <b>FX</b> for effects. The <b>Color</b> section appears first but runs last, after 3D, Glitch, trails and blur."
  ],
  "help.start.4": [
    "画面上部のクイック行: <b>Freeze</b> (<kbd>Space</kbd>) / <b>↶ ↷</b> (Undo / Redo) / <b>Reset</b> (<kbd>R</kbd>) / <b>Clear</b> (<kbd>C</kbd>) / <b>All Off</b> (<kbd>Esc</kbd>。スマホでは二度押し)。",
    "Quick controls: <b>Freeze</b> (<kbd>Space</kbd>) / <b>↶ ↷</b> (Undo / Redo) / <b>Reset</b> (<kbd>R</kbd>) / <b>Clear</b> (<kbd>C</kbd>) / <b>All Off</b> (<kbd>Esc</kbd>; double press on mobile)."
  ],
  "help.start.5": [
    "<b>3D FX</b> (FX タブの 3D 欄: Photo / Slicer / Layers / Needle / Origami / Drape / Passage / Uzumaki): 量 0 から元の画面とつながり、重ねがけできる。重いときは <b>3D Res</b> を下げる。",
    "<b>3D FX</b> in FX → 3D blend smoothly from zero and can be stacked. Lower <b>3D Res</b> if playback slows down."
  ],
  "help.start.6": [
    "気に入った状態は <b>Preset</b> タブの「+ Save Current」で残す。",
    "Keep a state with “+ Save Current” in <b>Preset</b>."
  ],
  "help.start.7": [
    "本番の出力は <b>Projector</b> (スマホは <b>Full</b> = フルスクリーン)、録画は <b>Record</b>、静止画は <b>Shot</b>。",
    "Use <b>Projector</b> for output (<b>Full</b> for fullscreen on mobile), <b>Record</b> for video and <b>Shot</b> for stills."
  ],
  "横長": [
    "横長",
    "Landscape"
  ],
  "縦長": [
    "縦長",
    "Portrait"
  ],
  "正方形": [
    "正方形",
    "Square"
  ],
  "言語": [
    "言語",
    "Language"
  ],
  "日本語": [
    "日本語",
    "Japanese"
  ],
  "秀英角ゴシック銀": [
    "秀英角ゴシック銀",
    "Shuei Gothic Gin"
  ],
  "天明朝アンティーク": [
    "天明朝アンティーク",
    "Ten Mincho Antique"
  ],
  "ヒラギノ角ゴ": [
    "ヒラギノ角ゴ",
    "Hiragino Sans"
  ],
  "ヒラギノ丸ゴ": [
    "ヒラギノ丸ゴ",
    "Hiragino Maru Gothic"
  ],
  "ヒラギノ明朝": [
    "ヒラギノ明朝",
    "Hiragino Mincho"
  ],
  "游ゴシック": [
    "游ゴシック",
    "Yu Gothic"
  ],
  "BIZ UDPゴシック": [
    "BIZ UDPゴシック",
    "BIZ UDPGothic"
  ],
  "(未接続の保存デバイス)": [
    "(未接続の保存デバイス)",
    "(Saved device disconnected)"
  ],
  "format.unsupported": [
    "{name} (非対応)",
    "{name} (unsupported)"
  ],
  "画像": [
    "画像",
    "Image"
  ],
  "フォルダ": [
    "フォルダ",
    "Folder"
  ],
  "ドロップ": [
    "ドロップ",
    "Drop"
  ],
  " (臨時)": [
    " (臨時)",
    " (temporary)"
  ],
  "＋ {0}": [
    "＋ {0}",
    "+ {0}"
  ],
  "{0}を読み込む{1}": [
    "{0}を読み込む{1}",
    "Import {0}{1}"
  ],
  " (images/ ・ movies/ へ保存、次回起動でも残る)": [
    " (images/ ・ movies/ へ保存、次回起動でも残る)",
    " (saved in images/ or movies/ for future sessions)"
  ],
  " (このセッション限り。リロードで消えます)": [
    " (このセッション限り。リロードで消えます)",
    " (this session only; cleared on reload)"
  ],
  "画像・フォルダは images/ に保存され、次回起動でも残ります。": [
    "画像・フォルダは images/ に保存され、次回起動でも残ります。",
    "Images and folders are saved in images/ for future sessions."
  ],
  "このセッション限り。リロードで消えます。": [
    "このセッション限り。リロードで消えます。",
    "This session only; cleared on reload."
  ],
  "一覧から外す (このセッション)": [
    "一覧から外す (このセッション)",
    "Remove from this session"
  ],
  "削除 (images/_trash へ移す)": [
    "削除 (images/_trash へ移す)",
    "Remove (move to images/_trash)"
  ],
  " (一覧から外します)": [
    " (一覧から外します)",
    " (remove from the list)"
  ],
  " (images/_trash へ移します)": [
    " (images/_trash へ移します)",
    " (move to images/_trash)"
  ],
  "画像 / 動画ファイルがありません": [
    "画像 / 動画ファイルがありません",
    "No image or video files found"
  ],
  "取り込み中… ": [
    "取り込み中… ",
    "Importing… "
  ],
  "取り込み失敗: ": [
    "取り込み失敗: ",
    "Import failed: "
  ],
  " 件を取り込みました (": [
    " 件を取り込みました (",
    " files imported ("
  ],
  " 件を読み込みました (このセッション限り。リロードで消えます)": [
    " 件を読み込みました (このセッション限り。リロードで消えます)",
    " files loaded for this session (cleared on reload)"
  ],
  "共有シートから「写真に保存」を選べます": [
    "共有シートから「写真に保存」を選べます",
    "Choose “Save Image” in the share sheet"
  ],
  "Audio: 起動中…": [
    "Audio: 起動中…",
    "Audio: starting…"
  ],
  "システム音声を取得します (Discord は除外)": [
    "システム音声を取得します (Discord は除外)",
    "Capturing system audio (excluding Discord)"
  ],
  "画面全体のシステム音声を取得します": [
    "画面全体のシステム音声を取得します",
    "Capturing all system audio"
  ],
  "ピッカーで「Chromeタブ」を選び「タブの音声を共有」にチェック": [
    "ピッカーで「Chromeタブ」を選び「タブの音声を共有」にチェック",
    "Choose Chrome Tab and enable Share tab audio"
  ],
  "MIDI: つまみを取り込みました": [
    "MIDI: つまみを取り込みました",
    "MIDI: knob mapping imported"
  ],
  "MIDI 入力デバイスが見つかりません (接続すると自動認識します)": [
    "MIDI 入力デバイスが見つかりません (接続すると自動認識します)",
    "No MIDI input found; connected devices are detected automatically"
  ],
  "MIDI マップを共有しました (": [
    "MIDI マップを共有しました (",
    "MIDI map shared ("
  ],
  " 件)": [
    " 件)",
    " items)"
  ],
  "共有に失敗: ": [
    "共有に失敗: ",
    "Sharing failed: "
  ],
  "サーバーにマップがありません": [
    "サーバーにマップがありません",
    "No MIDI map on the server"
  ],
  "MIDI マップを取り込みました (": [
    "MIDI マップを取り込みました (",
    "MIDI map imported ("
  ],
  "取り込みに失敗: ": [
    "取り込みに失敗: ",
    "Import failed: "
  ],
  "録画の音声にエラー (ここまでを保存します)": [
    "録画の音声にエラー (ここまでを保存します)",
    "Recording audio error; saving captured content"
  ],
  "録画エラー (ここまでを保存します)": [
    "録画エラー (ここまでを保存します)",
    "Recording error; saving captured content"
  ],
  "録画開始に失敗: ": [
    "録画開始に失敗: ",
    "Could not start recording: "
  ],
  "録画開始 ({0}{1})": [
    "録画開始 ({0}{1})",
    "Recording started ({0}{1})"
  ],
  "録画へのフレーム供給が止まっています (Diag に記録)": [
    "録画へのフレーム供給が止まっています (Diag に記録)",
    "Recording frames have stopped (logged in Diagnostics)"
  ],
  "録画停止 (書き出し中…)": [
    "録画停止 (書き出し中…)",
    "Recording stopped; exporting…"
  ],
  "録画の書き出しに失敗: ": [
    "録画の書き出しに失敗: ",
    "Recording export failed: "
  ],
  "iOS: 開いたページで [共有] → [ビデオを保存] で保存": [
    "iOS: 開いたページで [共有] → [ビデオを保存] で保存",
    "iOS: use Share → Save Video on the opened page"
  ],
  "録画エラー: ": [
    "録画エラー: ",
    "Recording error: "
  ],
  " (ここまでを保存します)": [
    " (ここまでを保存します)",
    " (saving captured content)"
  ],
  "録画の映像トラックが終了しました (ここまでを保存します)": [
    "録画の映像トラックが終了しました (ここまでを保存します)",
    "Video track ended; saving captured content"
  ],
  "録画停止": [
    "録画停止",
    "Recording stopped"
  ],
  "前回異常終了の可能性。Settings→Diagnostics でログ確認": [
    "前回異常終了の可能性。Settings→Diagnostics でログ確認",
    "Possible previous crash. Check Settings → Diagnostics."
  ],
  "{0} へ {1} 拍でトランジション": [
    "{0} へ {1} 拍でトランジション",
    "Transition to {0} over {1} beats"
  ],
  " は無効 (Settings で解除)": [
    " は無効 (Settings で解除)",
    " is disabled (unlock in Settings)"
  ],
  " → なし(透明)": [
    " → なし(透明)",
    " → None (transparent)"
  ],
  "TYPE 組方向: ": [
    "TYPE 組方向: ",
    "TYPE direction: "
  ],
  "縦組": [
    "縦組",
    "Vertical"
  ],
  "横組": [
    "横組",
    "Horizontal"
  ],
  "Slot A ⇄ B 交換": [
    "Slot A ⇄ B 交換",
    "Swapped Slot A and B"
  ],
  "デフォルト保存: FB (": [
    "デフォルト保存: FB (",
    "Defaults saved: FB ("
  ],
  "デフォルトをリセット: FB (": [
    "デフォルトをリセット: FB (",
    "Defaults reset: FB ("
  ],
  "デフォルト保存: ": [
    "デフォルト保存: ",
    "Defaults saved: "
  ],
  "保存失敗": [
    "保存失敗",
    "Save failed"
  ],
  "保存値へ戻しました: ": [
    "保存値へ戻しました: ",
    "Defaults restored: "
  ],
  "セーフモードで起動中 (軽量プリセット + 重い FX 無効)。安定後に通常起動へ戻ります": [
    "セーフモードで起動中 (軽量プリセット + 重い FX 無効)。安定後に通常起動へ戻ります",
    "Safe mode: light preset, heavy FX disabled. Normal startup resumes once stable."
  ],
  "Projector 再接続": [
    "Projector 再接続",
    "Projector reconnected"
  ],
  "外部シェーダ未ロード: file:// では fetch 不可。ローカル http サーバで開いてください": [
    "外部シェーダ未ロード: file:// では fetch 不可。ローカル http サーバで開いてください",
    "External shaders cannot load via file://. Open with a local HTTP server."
  ],
  "{0}: 再試行で読込": [
    "{0}: 再試行で読込",
    "{0}: loaded on retry"
  ],
  "FREEZE (フレーム更新OFF)": [
    "FREEZE (フレーム更新OFF)",
    "FREEZE (animation paused)"
  ],
  "MIDI Learn 解除": [
    "MIDI Learn 解除",
    "MIDI Learn cleared"
  ],
  "ON (マウスで操作)": [
    "ON (マウスで操作)",
    "ON (mouse control)"
  ],
  "OFF (凍結)": [
    "OFF (凍結)",
    "OFF (frozen)"
  ],
  "反転 (−)": [
    "反転 (−)",
    "Reversed (−)"
  ],
  "通常 (+)": [
    "通常 (+)",
    "Normal (+)"
  ],
  "色相反転 (+180°)": [
    "色相反転 (+180°)",
    "Hue rotated 180°"
  ],
  "スポイト: 色を拾えませんでした": [
    "スポイト: 色を拾えませんでした",
    "Eyedropper: could not sample a color"
  ],
  "このタイルはまだ絵がありません": [
    "このタイルはまだ絵がありません",
    "This tile has no image yet"
  ],
  "Slot {0} ← なし": [
    "Slot {0} ← なし",
    "Slot {0} ← None"
  ],
  "保存対象がありません": [
    "保存対象がありません",
    "Nothing to save"
  ],
  "リセット対象がありません": [
    "リセット対象がありません",
    "Nothing to reset"
  ],
  "シェーダスロットではありません": [
    "シェーダスロットではありません",
    "This is not a shader slot"
  ],
  "保存対象のパラメータがありません": [
    "保存対象のパラメータがありません",
    "No parameters to save"
  ],
  "シェーダ名が不明です": [
    "シェーダ名が不明です",
    "Unknown shader name"
  ],
  "デフォルト保存: Ink Bleed": [
    "デフォルト保存: Ink Bleed",
    "Defaults saved: Ink Bleed"
  ],
  "デフォルト保存: mix": [
    "デフォルト保存: mix",
    "Defaults saved: Mix"
  ],
  "パラメータをリセット (": [
    "パラメータをリセット (",
    "Parameters reset ("
  ],
  " で戻せます)": [
    " で戻せます)",
    " to undo)"
  ],
  "もう一度 {0} で全リセット (1 秒以内)": [
    "もう一度 {0} で全リセット (1 秒以内)",
    "Press {0} again within 1 second to reset all"
  ],
  "両スロットなし / パラメータをリセット (": [
    "両スロットなし / パラメータをリセット (",
    "Both slots cleared; parameters reset ("
  ],
  "保存値へ戻しました: mix": [
    "保存値へ戻しました: mix",
    "Defaults restored: Mix"
  ],
  "デフォルト保存: transition": [
    "デフォルト保存: transition",
    "Defaults saved: Transition"
  ],
  "保存値へ戻しました: transition": [
    "保存値へ戻しました: transition",
    "Defaults restored: Transition"
  ],
  "デフォルト保存: audioDetect": [
    "デフォルト保存: audioDetect",
    "Defaults saved: Audio Detect"
  ],
  "保存値へ戻しました: audioDetect": [
    "保存値へ戻しました: audioDetect",
    "Defaults restored: Audio Detect"
  ],
  "デフォルト保存: motion": [
    "デフォルト保存: motion",
    "Defaults saved: Motion"
  ],
  "保存値へ戻しました: motion": [
    "保存値へ戻しました: motion",
    "Defaults restored: Motion"
  ],
  "デフォルト保存: audioTransport": [
    "デフォルト保存: audioTransport",
    "Defaults saved: Audio Transport"
  ],
  "保存値へ戻しました: audioTransport": [
    "保存値へ戻しました: audioTransport",
    "Defaults restored: Audio Transport"
  ],
  "元に戻す": [
    "元に戻す",
    "Undo"
  ],
  "プリセットを復元: ": [
    "プリセットを復元: ",
    "Preset restored: "
  ],
  "これ以上戻せません": [
    "これ以上戻せません",
    "Nothing more to undo"
  ],
  "やり直す操作がありません": [
    "やり直す操作がありません",
    "Nothing to redo"
  ],
  "やり直す": [
    "やり直す",
    "Redo"
  ],
  "ローカル保存に失敗 — サーバー側の履歴から復元できます": [
    "ローカル保存に失敗 — サーバー側の履歴から復元できます",
    "Local save failed; restore from server history"
  ],
  "履歴の取得に失敗 (HTTP ": [
    "履歴の取得に失敗 (HTTP ",
    "History request failed (HTTP "
  ],
  "履歴の取得に失敗: ": [
    "履歴の取得に失敗: ",
    "History request failed: "
  ],
  "履歴の形式が不正です": [
    "履歴の形式が不正です",
    "Invalid history format"
  ],
  "この世代に、今無いプリセットはありません": [
    "この世代に、今無いプリセットはありません",
    "No missing presets in this version"
  ],
  "履歴から ": [
    "履歴から ",
    "Restored "
  ],
  " 件を復元しました (サムネは再生成されます)": [
    " 件を復元しました (サムネは再生成されます)",
    " presets from history (thumbnails will regenerate)"
  ],
  "プリセットのサーバー保存に失敗 (": [
    "プリセットのサーバー保存に失敗 (",
    "Preset server save failed ("
  ],
  ") — ローカルには保存済み。再試行します": [
    ") — ローカルには保存済み。再試行します",
    "); saved locally. Retrying."
  ],
  "オフライン: 同梱プリセット ": [
    "オフライン: 同梱プリセット ",
    "Offline: loaded "
  ],
  " 件を読み込みました": [
    " 件を読み込みました",
    " bundled presets"
  ],
  "サーバーに無いプリセット ": [
    "サーバーに無いプリセット ",
    "Restored and uploaded "
  ],
  " 件を復元してアップロードしました": [
    " 件を復元してアップロードしました",
    " presets missing from the server"
  ],
  "別のGIF生成中です": [
    "別のGIF生成中です",
    "Another GIF is being generated"
  ],
  " のGIFサムネを生成中…(現在の表示から)": [
    " のGIFサムネを生成中…(現在の表示から)",
    ": generating GIF from the current view…"
  ],
  "GIF生成に失敗": [
    "GIF生成に失敗",
    "GIF generation failed"
  ],
  " GIFサムネ更新完了": [
    " GIFサムネ更新完了",
    ": GIF thumbnail updated"
  ],
  "動画": [
    "動画",
    "Video"
  ],
  "プリセットを追加": [
    "プリセットを追加",
    "Preset added"
  ],
  "プリセット ": [
    "プリセット ",
    "Preset "
  ],
  " は空です": [
    " は空です",
    " is empty"
  ],
  "プリセット: ": [
    "プリセット: ",
    "Preset: "
  ],
  "Grad / Blend プレビュー: 表示": [
    "Grad / Blend プレビュー: 表示",
    "Grad / Blend previews: shown"
  ],
  "Grad / Blend プレビュー: 非表示": [
    "Grad / Blend プレビュー: 非表示",
    "Grad / Blend previews: hidden"
  ],
  "Visual の絵がまだ来ていません": [
    "Visual の絵がまだ来ていません",
    "Visual image is not ready yet"
  ],
  " から": [
    " から",
    " image"
  ],
  "Visual から": [
    "Visual から",
    "Visual"
  ],
  " Grad を生成 (": [
    " Grad を生成 (",
    " → Grad generated ("
  ],
  "通常色 (Grad Map OFF)": [
    "通常色 (Grad Map OFF)",
    "Original colors (Grad Map off)"
  ],
  " は空": [
    " は空",
    " is empty"
  ],
  " を上書き — GIF生成中…": [
    " を上書き — GIF生成中…",
    " overwritten; generating GIF…"
  ],
  "GIF生成に失敗 (静止画のまま)": [
    "GIF生成に失敗 (静止画のまま)",
    "GIF generation failed; kept still image"
  ],
  "プリセット「": [
    "プリセット「",
    "Preset “"
  ],
  "」GIF更新完了": [
    "」GIF更新完了",
    "” GIF updated"
  ],
  "削除: ": [
    "削除: ",
    "Deleted: "
  ],
  "(戻るで復元可)": [
    "(戻るで復元可)",
    "(Undo to restore)"
  ],
  " に保存": [
    " に保存",
    " saved"
  ],
  " を呼出": [
    " を呼出",
    " loaded"
  ],
  "他の端末と同じ値でした": [
    "他の端末と同じ値でした",
    "Already matches other devices"
  ],
  "他の端末へ同期しました": [
    "他の端末へ同期しました",
    "Synced to other devices"
  ],
  "同期できませんでした (この端末だけに残っています)": [
    "同期できませんでした (この端末だけに残っています)",
    "Sync failed; kept on this device"
  ],
  "このビジュアルの Save 値がありません": [
    "このビジュアルの Save 値がありません",
    "No saved defaults for this Visual"
  ],
  "書き出せる Save 値がありません": [
    "書き出せる Save 値がありません",
    "No saved defaults to export"
  ],
  "Save 値を書き出しました (": [
    "Save 値を書き出しました (",
    "Defaults exported ("
  ],
  "書き出し失敗: ": [
    "書き出し失敗: ",
    "Export failed: "
  ],
  "読み込み失敗: ": [
    "読み込み失敗: ",
    "Import failed: "
  ],
  "読み込める Save 値がありません": [
    "読み込める Save 値がありません",
    "No saved defaults to import"
  ],
  "読み込み失敗: 保存できませんでした (変更は戻しました)": [
    "読み込み失敗: 保存できませんでした (変更は戻しました)",
    "Import failed to save; changes reverted"
  ],
  "読み込み失敗: 一部の Save 値だけ更新されています": [
    "読み込み失敗: 一部の Save 値だけ更新されています",
    "Import failed; only some defaults were updated"
  ],
  "この端末へ Save 値を読み込みました (": [
    "この端末へ Save 値を読み込みました (",
    "Defaults imported on this device ("
  ],
  "Save 値は保存しましたが、画面への反映に失敗しました。再読み込みしてください": [
    "Save 値は保存しましたが、画面への反映に失敗しました。再読み込みしてください",
    "Defaults saved, but could not apply them. Please reload."
  ],
  "基準値を読めませんでした": [
    "基準値を読めませんでした",
    "Could not load baseline defaults"
  ],
  "基準値が不正です": [
    "基準値が不正です",
    "Invalid baseline defaults"
  ],
  "サーバーに反映できませんでした (何も変更していません)": [
    "サーバーに反映できませんでした (何も変更していません)",
    "Server update failed; nothing changed"
  ],
  "起動プリセット (startup.json) を適用": [
    "起動プリセット (startup.json) を適用",
    "Startup preset applied (startup.json)"
  ],
  "startup.json を書き出しました": [
    "startup.json を書き出しました",
    "Exported startup.json"
  ],
  "書き出し失敗": [
    "書き出し失敗",
    "Export failed"
  ],
  "Look を保存: ": [
    "Look を保存: ",
    "Look saved: "
  ],
  "Look の保存に失敗: ": [
    "Look の保存に失敗: ",
    "Could not save Look: "
  ],
  "上書きする保存 Look を選んでください": [
    "上書きする保存 Look を選んでください",
    "Select a saved Look to overwrite"
  ],
  "Look を上書き: ": [
    "Look を上書き: ",
    "Look overwritten: "
  ],
  "Look の上書きに失敗: ": [
    "Look の上書きに失敗: ",
    "Could not overwrite Look: "
  ],
  "削除する保存 Look を選んでください": [
    "削除する保存 Look を選んでください",
    "Select a saved Look to delete"
  ],
  "Look を削除: ": [
    "Look を削除: ",
    "Look deleted: "
  ],
  "Look の削除に失敗: ": [
    "Look の削除に失敗: ",
    "Could not delete Look: "
  ],
  "Canvas を呼び出し: ": [
    "Canvas を呼び出し: ",
    "Canvas loaded: "
  ],
  "Canvas を保存: ": [
    "Canvas を保存: ",
    "Canvas saved: "
  ],
  "Canvas の保存に失敗: ": [
    "Canvas の保存に失敗: ",
    "Could not save Canvas: "
  ],
  "削除する構成を選んでください": [
    "削除する構成を選んでください",
    "Select a layout to delete"
  ],
  "Canvas を削除: ": [
    "Canvas を削除: ",
    "Canvas deleted: "
  ],
  "Canvas の削除に失敗: ": [
    "Canvas の削除に失敗: ",
    "Could not delete Canvas: "
  ],
  "Comp を呼び出し: ": [
    "Comp を呼び出し: ",
    "Composition loaded: "
  ],
  "Comp を保存: ": [
    "Comp を保存: ",
    "Composition saved: "
  ],
  "Comp の保存に失敗: ": [
    "Comp の保存に失敗: ",
    "Could not save Composition: "
  ],
  "削除する Composition を選んでください": [
    "削除する Composition を選んでください",
    "Select a Composition to delete"
  ],
  "Comp を削除: ": [
    "Comp を削除: ",
    "Composition deleted: "
  ],
  "Comp の削除に失敗: ": [
    "Comp の削除に失敗: ",
    "Could not delete Composition: "
  ],
  "Audio が Off です — Mic か System をオンにしてください": [
    "Audio が Off です — Mic か System をオンにしてください",
    "Audio is off; enable Mic or System"
  ],
  "BPM Auto: 音響から検出中…": [
    "BPM Auto: 音響から検出中…",
    "BPM Auto: listening…"
  ],
  "MIDI Learn → BPM: CCを動かして": [
    "MIDI Learn → BPM: CCを動かして",
    "MIDI Learn → BPM: move a CC knob"
  ],
  "MIDI Learn → Crossfade: CCを動かして": [
    "MIDI Learn → Crossfade: CCを動かして",
    "MIDI Learn → Crossfade: move a CC knob"
  ],
  "MIDI 相対モード: ": [
    "MIDI 相対モード: ",
    "MIDI relative mode: "
  ],
  "ON (エンドレスエンコーダ)": [
    "ON (エンドレスエンコーダ)",
    "ON (endless encoder)"
  ],
  "OFF (絶対)": [
    "OFF (絶対)",
    "OFF (absolute)"
  ],
  "MIDI 相対エンコーダ方式: ": [
    "MIDI 相対エンコーダ方式: ",
    "MIDI encoder format: "
  ],
  "MIDI Learn → Tap: midiコンのボタンを押して": [
    "MIDI Learn → Tap: midiコンのボタンを押して",
    "MIDI Learn → Tap: press a controller button"
  ],
  "MIDI Learn → Reset Φ: midiコンのボタンを押して": [
    "MIDI Learn → Reset Φ: midiコンのボタンを押して",
    "MIDI Learn → Reset Φ: press a controller button"
  ],
  "診断ログを保存しました": [
    "診断ログを保存しました",
    "Diagnostic log saved"
  ],
  "コンソールに表示 (F12)": [
    "コンソールに表示 (F12)",
    "Shown in console (F12)"
  ],
  "診断ログをクリア": [
    "診断ログをクリア",
    "Diagnostic log cleared"
  ],
  "ツール一式をダウンロード中…": [
    "ツール一式をダウンロード中…",
    "Downloading app code…"
  ],
  "全ファイル (メディア込) をダウンロード中…": [
    "全ファイル (メディア込) をダウンロード中…",
    "Downloading all files, including media…"
  ],
  "全素材・動画バッファのフルキャッシュが完了しました": [
    "全素材・動画バッファのフルキャッシュが完了しました",
    "All media and video frame caches are ready"
  ],
  "フルキャッシュ中にエラーが発生しました": [
    "フルキャッシュ中にエラーが発生しました",
    "Full cache failed"
  ],
  "フルキャッシュ OFF（保存済みデータは保持）": [
    "フルキャッシュ OFF（保存済みデータは保持）",
    "Full cache off; saved data kept"
  ],
  ": スイッチ/ボタンを操作": [
    ": スイッチ/ボタンを操作",
    ": use a switch / button"
  ],
  ": つまみを動かして": [
    ": つまみを動かして",
    ": move a knob"
  ],
  "デフォルトをリセット: overlay (": [
    "デフォルトをリセット: overlay (",
    "Defaults reset: overlay ("
  ],
  "デフォルト保存: IMAGON (": [
    "デフォルト保存: IMAGON (",
    "Defaults saved: IMAGON ("
  ],
  "ストップは最低2つ必要です": [
    "ストップは最低2つ必要です",
    "At least two stops are required"
  ],
  "グラデの向きを反転": [
    "グラデの向きを反転",
    "Gradient reversed"
  ],
  "グラデを保存: ": [
    "グラデを保存: ",
    "Gradient saved: "
  ],
  "名前変更: ": [
    "名前変更: ",
    "Renamed: "
  ],
  "更新: ": [
    "更新: ",
    "Updated: "
  ],
  "Drive を上げると有効になります (現在 0 = 無効)": [
    "Drive を上げると有効になります (現在 0 = 無効)",
    "Raise Drive to enable this (currently 0 = off)"
  ],
  "フォルダ/画像を選択してください": [
    "フォルダ/画像を選択してください",
    "Select a folder or image"
  ],
  "設定を保存: ": [
    "設定を保存: ",
    "Settings saved: "
  ],
  "保存設定を削除: ": [
    "保存設定を削除: ",
    "Saved settings deleted: "
  ],
  "デフォルト保存: image": [
    "デフォルト保存: image",
    "Defaults saved: Image"
  ],
  "保存値へ戻しました: image": [
    "保存値へ戻しました: image",
    "Defaults restored: Image"
  ],
  "削除失敗: ": [
    "削除失敗: ",
    "Delete failed: "
  ],
  "既定値に戻しました": [
    "既定値に戻しました",
    "Defaults restored"
  ],
  "Look が選ばれていません": [
    "Look が選ばれていません",
    "No Look selected"
  ],
  "Look の値に戻しました: ": [
    "Look の値に戻しました: ",
    "Look values restored: "
  ],
  "UGOMEKI 種: ": [
    "UGOMEKI 種: ",
    "UGOMEKI seed: "
  ],
  "UGOMEKI 揺れパターン変更": [
    "UGOMEKI 揺れパターン変更",
    "UGOMEKI motion pattern changed"
  ],
  "押し出し面色: 既定 (文字の縁を引き延ばす)": [
    "押し出し面色: 既定 (文字の縁を引き延ばす)",
    "Extrusion color: default (extend glyph edges)"
  ],
  "保存するmdを選択してください": [
    "保存するmdを選択してください",
    "Select an md to save"
  ],
  "mdデフォルト保存: ": [
    "mdデフォルト保存: ",
    "md defaults saved: "
  ],
  "保存に失敗しました": [
    "保存に失敗しました",
    "Could not save"
  ],
  "リセットするmdを選択してください": [
    "リセットするmdを選択してください",
    "Select an md to reset"
  ],
  "mdを保存値へ戻しました: ": [
    "mdを保存値へ戻しました: ",
    "md defaults restored: "
  ],
  "リセットするmdがありません": [
    "リセットするmdがありません",
    "No md to reset"
  ],
  "初期値へリセット(保存なし): ": [
    "初期値へリセット(保存なし): ",
    "Original values restored (no saved defaults): "
  ],
  "images/slicer/ の画像を選択してください": [
    "images/slicer/ の画像を選択してください",
    "Select an image from images/slicer/"
  ],
  "画像デフォルト保存: ": [
    "画像デフォルト保存: ",
    "Image defaults saved: "
  ],
  "画像の保存値へ戻しました: ": [
    "画像の保存値へ戻しました: ",
    "Image defaults restored: "
  ],
  "初期値へリセット(保存なし)": [
    "初期値へリセット(保存なし)",
    "Original values restored (no saved defaults)"
  ],
  "重いので元に戻しました (": [
    "重いので元に戻しました (",
    "Reverted: too slow ("
  ],
  "ms / 1 フレーム > ": [
    "ms / 1 フレーム > ",
    " ms per frame > "
  ],
  "描画が重くなったので元に戻しました (": [
    "描画が重くなったので元に戻しました (",
    "Reverted after rendering slowed down ("
  ],
  "ms / 1 フレーム)": [
    "ms / 1 フレーム)",
    " ms per frame)"
  ],
  "MIDI Learn → {0}: CCを動かして": [
    "MIDI Learn → {0}: CCを動かして",
    "MIDI Learn → {0}: move a CC knob"
  ],
  "カメラロール保存パッチ有効": [
    "カメラロール保存パッチ有効",
    "Camera roll save patch enabled"
  ],
  "描画が止まったため、全スロットをなしにしました (": [
    "描画が止まったため、全スロットをなしにしました (",
    "Rendering stalled; cleared all slots ("
  ],
  "描画が止まったため、直前の正常な状態に戻しました (": [
    "描画が止まったため、直前の正常な状態に戻しました (",
    "Rendering stalled; restored the last good state ("
  ],
  "GPU のコンテキストが失われました。直前の状態で再起動します…": [
    "GPU のコンテキストが失われました。直前の状態で再起動します…",
    "GPU context lost. Restarting from the last state…"
  ],
  "クラッシュから復帰: 全スロットをなしにしました": [
    "クラッシュから復帰: 全スロットをなしにしました",
    "Crash recovery: all slots cleared"
  ],
  "クラッシュから復帰: 直前の正常な状態に戻しました": [
    "クラッシュから復帰: 直前の正常な状態に戻しました",
    "Crash recovery: restored the last good state"
  ],
  "マウス描画 ON (Shift+D)": [
    "マウス描画 ON (Shift+D)",
    "Mouse drawing ON (Shift+D)"
  ],
  "マウス描画 OFF": [
    "マウス描画 OFF",
    "Mouse drawing OFF"
  ],
  "復元 ON (次回起動から前回状態を復元)": [
    "復元 ON (次回起動から前回状態を復元)",
    "Restore ON (resume the last state next launch)"
  ],
  "復元 OFF (次回起動はクリーン)": [
    "復元 OFF (次回起動はクリーン)",
    "Restore OFF (start clean next launch)"
  ],
  "サーバー同期の設定は次回起動から効きます": [
    "サーバー同期の設定は次回起動から効きます",
    "Server sync changes take effect next launch"
  ],
  "デフォルト共有の設定は次回起動から効きます": [
    "デフォルト共有の設定は次回起動から効きます",
    "Default sharing changes take effect next launch"
  ],
  " のGIFサムネを現在の表示で更新しますか？": [
    " のGIFサムネを現在の表示で更新しますか？",
    ": update GIF thumbnail from the current view?"
  ],
  "」を現在の状態で上書きしますか？": [
    "」を現在の状態で上書きしますか？",
    "”: overwrite with the current state?"
  ],
  "」を削除しますか？": [
    "」を削除しますか？",
    "”: delete this item?"
  ],
  "共有 OFF の間に Save した値が ": [
    "共有 OFF の間に Save した値が ",
    "You have "
  ],
  " 件あります。他の端末へ同期していいですか？ (Cancel ならこの端末だけに残します)": [
    " 件あります。他の端末へ同期していいですか？ (Cancel ならこの端末だけに残します)",
    " defaults saved while sharing was off. Sync them to other devices? Cancel keeps them on this device only."
  ],
  "Save 値 ": [
    "Save 値 ",
    "Overwrite "
  ],
  " 件をこの端末へ上書きしますか？ ファイルにないキーは残ります。": [
    " 件をこの端末へ上書きしますか？ ファイルにないキーは残ります。",
    " defaults on this device? Keys absent from the file will stay unchanged."
  ],
  "読み込んだ ": [
    "読み込んだ ",
    "Sync the "
  ],
  " 件を他の端末へ同期していいですか？ (Cancel ならこの端末だけに残します)": [
    " 件を他の端末へ同期していいですか？ (Cancel ならこの端末だけに残します)",
    " imported defaults to other devices? Cancel keeps them on this device only."
  ],
  "Visual ごとのデフォルト (Params のパラメータ・Shader Params) を基準値に戻して再読み込みしますか？ (全端末共通)": [
    "Visual ごとのデフォルト (Params のパラメータ・Shader Params) を基準値に戻して再読み込みしますか？ (全端末共通)",
    "Reset Visual / Shader Params defaults to the baseline and reload? This affects all devices."
  ],
  "Look の名前": [
    "Look の名前",
    "Look name"
  ],
  "いまの見た目で上書きしますか: ": [
    "いまの見た目で上書きしますか: ",
    "Overwrite with the current Look: "
  ],
  "保存 Look を削除しますか: ": [
    "保存 Look を削除しますか: ",
    "Delete saved Look: "
  ],
  "構成の名前": [
    "構成の名前",
    "Layout name"
  ],
  "保存した構成を削除しますか: ": [
    "保存した構成を削除しますか: ",
    "Delete saved layout: "
  ],
  "Composition の名前": [
    "Composition の名前",
    "Composition name"
  ],
  "保存した Composition を削除しますか: ": [
    "保存した Composition を削除しますか: ",
    "Delete saved Composition: "
  ],
  "保存するグラデの名前:": [
    "保存するグラデの名前:",
    "New gradient name:"
  ],
  "グラデ名を変更:": [
    "グラデ名を変更:",
    "Rename gradient:"
  ],
  "」を現在のグラデで上書きしますか？": [
    "」を現在のグラデで上書きしますか？",
    "”: overwrite with the current gradient?"
  ],
  "FX をすべて既定値へ戻しますか？": [
    "FX をすべて既定値へ戻しますか？",
    "Reset all FX to defaults?"
  ],
  "表示名": [
    "表示名",
    "Display name"
  ],
  "削除しますか: ": [
    "削除しますか: ",
    "Delete: "
  ],
  " の実ファイルを消します)": [
    " の実ファイルを消します)",
    "; the actual file will be deleted)"
  ],
  "プリセット名": [
    "プリセット名",
    "Preset name"
  ],
  "選択時に読込": [
    "選択時に読込",
    "Load on selection"
  ],
  "フルスクリーン (Shift+F)": [
    "フルスクリーン (Shift+F)",
    "Fullscreen (Shift+F)"
  ],
  "Visual タブでタイルをタップ (クリック) して読み込み": [
    "Visual タブでタイルをタップ (クリック) して読み込み",
    "Tap or click a tile in Visual to load it"
  ],
  "Random=Scene Beats 拍ごとに抽選 (beatモードのみ。droneでは現在のシーンを維持) / それ以外=固定": [
    "Random=Scene Beats 拍ごとに抽選 (beatモードのみ。droneでは現在のシーンを維持) / それ以外=固定",
    "Random: pick every Scene Beats in beat mode; drone keeps the current scene. Other choices stay fixed."
  ],
  "動き・密度・色などのパラメータをランダム生成 (Scene の選択は変えない。保存は右上の Save)": [
    "動き・密度・色などのパラメータをランダム生成 (Scene の選択は変えない。保存は右上の Save)",
    "Randomize motion, density and color; keep Scene. Use Save to keep settings."
  ],
  "文字色: Variant=構図ごとの配色 / 品詞=文字種で色分け / Mono=白 / Terminal=緑 / Duotone=横組み Mono Ink + 縦書き Fluid Accent": [
    "文字色: Variant=構図ごとの配色 / 品詞=文字種で色分け / Mono=白 / Terminal=緑 / Duotone=横組み Mono Ink + 縦書き Fluid Accent",
    "Text colors: Variant = scene palette; Type = character classes; Mono = white; Terminal = green; Duotone = Mono Ink horizontally and Fluid Accent vertically"
  ],
  "ASCII Render シーンの配色": [
    "ASCII Render シーンの配色",
    "ASCII Render scene colors"
  ],
  "グラデの向きを反転 (左右入れ替え)": [
    "グラデの向きを反転 (左右入れ替え)",
    "Reverse the gradient"
  ],
  "詳細を開く / 閉じる": [
    "詳細を開く / 閉じる",
    "Show / hide details"
  ],
  "このモードに切替してGIFサムネを生成": [
    "このモードに切替してGIFサムネを生成",
    "Switch to this mode and generate a GIF thumbnail"
  ],
  "名前変更": [
    "名前変更",
    "Rename"
  ],
  "この動画でGIFサムネを生成": [
    "この動画でGIFサムネを生成",
    "Generate a GIF thumbnail from this video"
  ],
  "Slot {0}: {1} ({2} で切替)": [
    "Slot {0}: {1} ({2} で切替)",
    "Slot {0}: {1} ({2} to toggle)"
  ],
  "この画像を削除 (images/ から実ファイルを消す)": [
    "この画像を削除 (images/ から実ファイルを消す)",
    "Delete this image file from images/"
  ],
  "このセクションのパラメータをランダム化": [
    "このセクションのパラメータをランダム化",
    "Randomize this section's parameters"
  ],
  "群れ・筆・破片のパラメータをランダム生成 (色は変えない。保存は右上の Save)": [
    "群れ・筆・破片のパラメータをランダム生成 (色は変えない。保存は右上の Save)",
    "Randomize flock, brush and fragments; keep colors. Use Save to keep settings."
  ],
  "面・板・線のパラメータをランダム生成 (色・カメラ・Hold は変えない。保存は右上の Save)": [
    "面・板・線のパラメータをランダム生成 (色・カメラ・Hold は変えない。保存は右上の Save)",
    "Randomize sheets, plates and lines; keep colors, camera and Hold. Use Save to keep settings."
  ],
  "スパイクのパラメータをランダム生成 (背景色は変えない。保存は右上の Save)": [
    "スパイクのパラメータをランダム生成 (背景色は変えない。保存は右上の Save)",
    "Randomize spikes; keep background color. Use Save to keep settings."
  ],
  "3D にする文字 (改行で複数行)": [
    "3D にする文字 (改行で複数行)",
    "3D text (line breaks allowed)"
  ],
  "md を書き換えたあとに押すと読み直す": [
    "md を書き換えたあとに押すと読み直す",
    "Reload after editing the md file"
  ],
  "Custom (空ならドゥルーズの引用。貼った文章を段落ごとに打つ)": [
    "Custom (空ならドゥルーズの引用。貼った文章を段落ごとに打つ)",
    "Custom text (blank = Deleuze quotes; types one paragraph at a time)"
  ],
  "Random (書くたびに選ぶ)": [
    "Random (書くたびに選ぶ)",
    "Random (each time)"
  ],
  "Transition の設定": [
    "Transition の設定",
    "Transition settings"
  ],
  "今すぐ別の書きぶりに引き直す。気に入ったら Reseed を固定にすればその Seed のまま止まる": [
    "今すぐ別の書きぶりに引き直す。気に入ったら Reseed を固定にすればその Seed のまま止まる",
    "Pick a new brush variation now; lock Reseed to keep its Seed"
  ],
  "筆・毛・墨のパラメータをランダム生成 (文字・書体・色・書き順・配置は変えない。保存は右上の Save)": [
    "筆・毛・墨のパラメータをランダム生成 (文字・書体・色・書き順・配置は変えない。保存は右上の Save)",
    "Randomize brush, bristles and ink; keep text, font, color, stroke order and layout. Use Save to keep settings."
  ],
  "本体の形・破片・剥がれ方のパラメータをランダム生成 (Shape と色は変えない。保存は右上の Save)": [
    "本体の形・破片・剥がれ方のパラメータをランダム生成 (Shape と色は変えない。保存は右上の Save)",
    "Randomize body, fragments and peeling; keep Shape and colors. Use Save to keep settings."
  ],
  "Saved (mdごとの保存scene)": [
    "Saved (mdごとの保存scene)",
    "Saved (per-md scene)"
  ],
  "Random (毎回抽選)": [
    "Random (毎回抽選)",
    "Random (each cycle)"
  ],
  "images/slicer/ 未検出": [
    "images/slicer/ 未検出",
    "No images/slicer/ folder found"
  ],
  "画像をランダム表示 (Img Beats 拍ごとに切替。画像ごとの保存値もそのまま適用)": [
    "画像をランダム表示 (Img Beats 拍ごとに切替。画像ごとの保存値もそのまま適用)",
    "Random images every Img Beats, applying each image's saved settings"
  ],
  "削除": [
    "削除",
    "Delete"
  ],
  "この世代から復元": [
    "この世代から復元",
    "Restore from this version"
  ],
  "復元中…": [
    "復元中…",
    "Restoring…"
  ],
  "プリセットがありません。「+ Save Current」で追加してください。": [
    "プリセットがありません。「+ Save Current」で追加してください。",
    "No presets. Use “+ Save Current” to add one."
  ],
  "クリック=呼出 / Shift+クリック=上書き保存": [
    "クリック=呼出 / Shift+クリック=上書き保存",
    "Click to load; Shift+click to overwrite"
  ],
  "クリックで代理モードを停止 (L)": [
    "クリックで代理モードを停止 (L)",
    "Click to stop Away mode (L)"
  ],
  "構成主義": [
    "構成主義",
    "Constructivism"
  ],
  "上書き・削除": [
    "上書き・削除",
    "Overwrite / delete"
  ],
  "表示": [
    "表示",
    "Shown"
  ],
  "非表示": [
    "非表示",
    "Hidden"
  ],
  "Bank {n} を上書き保存しますか？（既存の保存は消えます）": [
    "Bank {n} を上書き保存しますか？（既存の保存は消えます）",
    "Overwrite Bank {n}? This replaces its saved state."
  ],
  "Bank {n} に現在の状態を保存しますか？": [
    "Bank {n} に現在の状態を保存しますか？",
    "Save the current state to Bank {n}?"
  ],
  "代理中 次まで {sec} 秒": [
    "代理中 次まで {sec} 秒",
    "Away · next in {sec}s"
  ],
  "表示中": [
    "表示中",
    "Shown"
  ],
  "このブラウザは画面音声キャプチャに非対応": [
    "このブラウザは画面音声キャプチャに非対応",
    "This browser does not support system audio capture"
  ],
  "システム音声を取得できません: システム設定 → プライバシーとセキュリティ → 画面収録とシステムオーディオ録音 で GARA を許可 → アプリ再起動": [
    "システム音声を取得できません: システム設定 → プライバシーとセキュリティ → 画面収録とシステムオーディオ録音 で GARA を許可 → アプリ再起動",
    "System audio unavailable. Allow GARA in System Settings → Privacy & Security → Screen & System Audio Recording, then restart."
  ],
  "権限拒否: ピッカーで「タブ」を選び「タブの音声を共有」にチェック (Window/Screen は音声非対応)": [
    "権限拒否: ピッカーで「タブ」を選び「タブの音声を共有」にチェック (Window/Screen は音声非対応)",
    "Permission denied. Choose a tab and enable Share tab audio; Window / Screen does not provide audio."
  ],
  "共有可能なソースが見つかりません": [
    "共有可能なソースが見つかりません",
    "No shareable source found"
  ],
  "共有がキャンセルされました": [
    "共有がキャンセルされました",
    "Sharing canceled"
  ],
  "音声トラックなし: 「タブの音声を共有」にチェックを入れて再試行": [
    "音声トラックなし: 「タブの音声を共有」にチェックを入れて再試行",
    "No audio track. Enable Share tab audio and try again."
  ],
  "マイク権限が拒否されました (ブラウザの URL 横の鍵アイコンから許可してください)": [
    "マイク権限が拒否されました (ブラウザの URL 横の鍵アイコンから許可してください)",
    "Microphone permission denied. Allow it in the browser site settings."
  ],
  "0台": [
    "0台",
    "0 devices"
  ],
  "Esc 全リセット": [
    "Esc 全リセット",
    "Esc reset all"
  ],
  "このスロットが相手のパレットで再彩色されて出力されます (プレビューは素の絵)": [
    "このスロットが相手のパレットで再彩色されて出力されます (プレビューは素の絵)",
    "Output uses the other slot’s palette; the preview keeps original colors"
  ],
  " (反転)": [
    " (反転)",
    " (reversed)"
  ],
  "IMAGON 描画中": [
    "IMAGON 描画中",
    "IMAGON drawing"
  ],
  "Draw フリーズ中 (Space)": [
    "Draw フリーズ中 (Space)",
    "Animation frozen (Space)"
  ],
  "Auto Fade (自動クロスフェード)": [
    "Auto Fade (自動クロスフェード)",
    "Auto Fade (automatic crossfade)"
  ],
  "Slot A 非表示 ([ で切替)": [
    "Slot A 非表示 ([ で切替)",
    "Slot A hidden ([ to toggle)"
  ],
  "Slot B 非表示 (] で切替)": [
    "Slot B 非表示 (] で切替)",
    "Slot B hidden (] to toggle)"
  ],
  "— なし —": [
    "— なし —",
    "— None —"
  ],
  "Feedback (前フレーム)": [
    "Feedback (前フレーム)",
    "Feedback (previous frame)"
  ],
  "入力なし (Mic / System をON)": [
    "入力なし (Mic / System をON)",
    "No input (enable Mic / System)"
  ],
  "… 解析中 ": [
    "… 解析中 ",
    "… Listening "
  ],
  "… 解析中": [
    "… 解析中",
    "… Listening"
  ],
  " (クリックで適用)": [
    " (クリックで適用)",
    " (click to apply)"
  ],
  "現在": [
    "現在",
    "Current"
  ],
  "(空)": [
    "(空)",
    "(Empty)"
  ],
  "通常色 (Grad Map OFF / Hue Shift は映像へ)": [
    "通常色 (Grad Map OFF / Hue Shift は映像へ)",
    "Original colors (Grad Map off; Hue Shift stays active)"
  ],
  "名前を変更": [
    "名前を変更",
    "Rename"
  ],
  "現在のグラデで上書き更新": [
    "現在のグラデで上書き更新",
    "Overwrite with the current gradient"
  ],
  "現在の状態で上書き保存(更新)": [
    "現在の状態で上書き保存(更新)",
    "Overwrite with the current state"
  ],
  "Defaults JSON の形式またはバージョンが不正です": [
    "Defaults JSON の形式またはバージョンが不正です",
    "Invalid Defaults JSON format or version"
  ],
  "対象外のキーです: ": [
    "対象外のキーです: ",
    "Unsupported key: "
  ],
  "保存値はオブジェクトで指定してください: ": [
    "保存値はオブジェクトで指定してください: ",
    "Saved defaults must be an object: "
  ],
  "保存値に不正な数値があります": [
    "保存値に不正な数値があります",
    "Saved defaults contain an invalid number"
  ],
  "保存値に不正なキーがあります": [
    "保存値に不正なキーがあります",
    "Saved defaults contain an invalid key"
  ],
  "images/manga/ 未検出 — D&D or ボタンで読込": [
    "images/manga/ 未検出 — D&D or ボタンで読込",
    "No images/manga/ folder — drop files or use the load button"
  ],
  "images/manga/ 未検出": [
    "images/manga/ 未検出",
    "No images/manga/ folder found"
  ],
  " (呼出でサムネ生成)": [
    " (呼出でサムネ生成)",
    " (load to generate thumbnail)"
  ]
};
  const dictionaries = { ja: Object.create(null), en: Object.create(null) };
  for (const [key, pair] of Object.entries(pairs)) {
    dictionaries.ja[key] = pair[0];
    dictionaries.en[key] = pair[1];
  }
  const storageKey = 'gara.lang';
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch (_) {}
  let language = saved === 'ja' || saved === 'en' ? saved
    : /^ja/i.test(navigator.language || '') ? 'ja' : 'en';
  document.documentElement.lang = language;
  const normalize = s => s.replace(/\s+/g, ' ').trim();
  const has = key => Object.prototype.hasOwnProperty.call(pairs, key);
  function t(key, values) {
    const message = dictionaries[language][key] ?? dictionaries.ja[key] ?? key;
    return values ? message.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match) : message;
  }
  let bindings = [];
  let initialized = false;
  // Only explicitly bound UI is changed. No observer scans user names, media or editable text.
  function bind(node, key, attr = 'textContent', values) {
    const read = () => attr === 'nodeValue' || attr === 'textContent' || attr === 'innerHTML'
      ? node[attr] : node.getAttribute(attr);
    const write = value => {
      if (attr === 'nodeValue' || attr === 'textContent' || attr === 'innerHTML') node[attr] = value;
      else node.setAttribute(attr, value);
    };
    const previous = bindings.find(b => b.node === node && b.attr === attr);
    if (previous) bindings.splice(bindings.indexOf(previous), 1);
    const original = read();
    const padding = attr === 'nodeValue' ? [original.match(/^\s*/)[0], original.match(/\s*$/)[0]] : ['', ''];
    const binding = { node, attr, last: original, update() {
      // A later application write owns this field; never restore stale state over it.
      if (read() !== this.last) return;
      const value = padding[0] + t(key, typeof values === 'function' ? values() : values) + padding[1];
      if (value !== this.last) write(value);
      this.last = value;
    }};
    bindings.push(binding);
    binding.update();
    return node;
  }
  function updateButtons() {
    document.querySelectorAll('#setLang [data-lang]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.lang === language));
    });
  }
  function setLanguage(next) {
    if (next !== 'ja' && next !== 'en') return;
    language = next;
    try { localStorage.setItem(storageKey, next); } catch (_) {}
    document.documentElement.lang = next;
    bindings = bindings.filter(b => b.node.isConnected);
    bindings.forEach(b => b.update());
    updateButtons();
    document.dispatchEvent(new CustomEvent('languagechange', { detail: { language: next } }));
    if (window.PseudoScroll) window.PseudoScroll.refresh();
  }
  function init() {
    if (initialized) return;
    initialized = true;
    document.querySelectorAll('[data-i18n-html]').forEach(el => bind(el, el.dataset.i18nHtml, 'innerHTML'));
    // This runs once, before app.js creates user content. Attributes and text nodes retain their identity.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, textarea, [contenteditable], [data-i18n-html]')) return;
      const key = normalize(node.nodeValue);
      if (has(key)) {
        // Translated option labels must never change the value submitted to application logic.
        if (parent.tagName === 'OPTION' && !parent.hasAttribute('value')) parent.value = parent.textContent;
        bind(node, key, 'nodeValue');
      }
    });
    document.querySelectorAll('[title], [placeholder], [aria-label], [alt], optgroup[label]').forEach(el => {
      for (const attr of ['title', 'placeholder', 'aria-label', 'alt', 'label']) {
        if (!el.hasAttribute(attr)) continue;
        const key = normalize(el.getAttribute(attr));
        if (has(key)) bind(el, key, attr);
      }
    });
    document.querySelectorAll('#setLang [data-lang]').forEach(button => {
      button.addEventListener('click', () => setLanguage(button.dataset.lang));
    });
    updateButtons();
  }
  window.I18n = { t, bind, init, setLanguage, get language() { return language; } };
})();
