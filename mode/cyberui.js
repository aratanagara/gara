/* =====================================================================
   CyberUI — p5.js ベースのサイバーパンク HUD オーディオクロック (kind:'cyberui')
   黒背景 / 白。マイク音量(FFT)に反応する放射状の長方形バー(時計回り)、
   回転する目盛り、時/分/秒/ミリ秒の針(分針 4beat 同期)、中央ラベル、
   左上 "Aratana"、左下に実コマンドのタイプアニメ端末、細い外枠、
   サイバーパンク HUD アイコン。
   p5 で 2D 描画 → テクスチャ化 → slot FBO へブリット。
===================================================================== */
const CyberUI = {
  gl: null,
  initialized: false,
  ready: false,
  p5i: null,
  canvasEl: null,
  prog: null, vbo: null, tex: null, locs: null,
  clockImg: null,
  cdEmblem: null,
  cdBarR: null, cdBarL: null, cdBarB: null,
  cdFrame: null,   // 四隅のコーナーブラケット (透明背景・白)
  startTime: 0,
  beatBase: 0,
  barH: null,                  // バー高さの平滑化用

  VS: `#version 300 es
  in vec2 a_pos; out vec2 v_uv;
  void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.,1.); }`,
  FS: `#version 300 es
  precision mediump float;
  uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_black; in vec2 v_uv; out vec4 o;
  void main(){
    // プリマルチプライ済み → a=被覆率。色を白/黒に固定したプリマルチ出力。
    // 不透明なグレー線も指定色になり、グレー/黒のフチが出ない。
    // 白: 細い線(AAで被覆が薄い)を不透明側へ持ち上げる。黒: hard threshold でAAを切る。
    float a = texture(u_tex, v_uv).a;
    float isBlack = step(0.5, u_black);
    float softA = 1.0 - pow(1.0 - a, 5.0);
    float hardA = step(0.5, a);
    a = mix(softA, hardA, isBlack);
    vec3 white = vec3(1.0);
    vec3 black = vec3(0.018, 0.022, 0.032);
    vec3 ink = mix(white, black, isBlack);
    o = vec4(ink * a, a);
  }`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.VS); gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('CyberUI vs:', gl.getShaderInfoLog(vs)); return false; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this.FS); gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('CyberUI fs:', gl.getShaderInfoLog(fs)); return false; }
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs); gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('CyberUI link:', gl.getProgramInfoLog(this.prog)); return false; }
    this.locs = {
      pos: gl.getAttribLocation(this.prog,'a_pos'),
      tex: gl.getUniformLocation(this.prog,'u_tex'),
      res: gl.getUniformLocation(this.prog,'u_res'),
      black: gl.getUniformLocation(this.prog,'u_black')
    };
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.startTime = performance.now()/1000;
    this.beatBase = (typeof App !== 'undefined' && App.visualBeat) ? App.visualBeat()
      : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0);
    this.barH = new Float32Array(this.NBARS);

    // p5 インスタンス (オフスクリーン 2D)
    const self = this;
    const sketch = (p) => {
      p.setup = () => {
        const cnv = p.createCanvas(1280, 720);
        self.canvasEl = cnv.elt;
        self.canvasEl.style.display = 'none';
        p.pixelDensity(1);
        p.noLoop();
        // 右下のパターン (nn.png, GR エンブレムの幅・位置に合わせる)
        p.loadImage('images/etc/nn.png', (img)=>{ self.clockImg = img; }, ()=>{});
        // 中央エンブレム (cd.svg から分離)
        p.loadImage('images/etc/cd_emblem.png', (img)=>{ self.cdEmblem = img; }, ()=>{});
        // フレームの帯 (aa.svg から分離, 白背景・黒文字, 縦横比保持)
        p.loadImage('images/etc/cd_bar_right.png',  (img)=>{ self.cdBarR = img; }, ()=>{});
        p.loadImage('images/etc/cd_bar_left.png',   (img)=>{ self.cdBarL = img; }, ()=>{});
        p.loadImage('images/etc/cd_bar_bottom.png', (img)=>{ self.cdBarB = img; }, ()=>{});
        // 四隅のコーナーブラケット (画像は左上向き → 回転して4隅へ)
        p.loadImage('images/etc/cd_frame.png', (img)=>{ self.cdFrame = img; }, ()=>{});
        self.ready = true;
      };
      p.draw = () => { self.draw(p); };
    };
    try { this.p5i = new p5(sketch); } catch(e){ console.error('CyberUI p5 init failed:', e); }

    // canvas 用に Aratana フォントを事前ロード
    try { if(document.fonts && document.fonts.load) document.fonts.load('26px Aratana'); } catch(e){}

    this.initialized = true;
    return true;
  },

  // ===== パラメータ =====
  NBARS: 150,
  // 調整可能オプション (CYBER UI Options パネル / デフォルト保存対応)
  P: { spin:1.0, speed:1.0, audioSync:1.0, barLen:1.0, bars:1, clock:1, emblem:1, cdBars:1, console:1, black:0 },

  // 値取得ヘルパ ----------------------------------------------------
  _now(){ return (typeof this._slotClock === 'number') ? this._slotClock : (performance.now()/1000 - this.startTime); },
  _easeOutQuint(x){ return 1.0 - Math.pow(1.0 - x, 5.0); },
  _energy(){ return (typeof Audio!=='undefined' && Audio.energy) ? Audio.energy : 0; },
  _fftAt(frac){
    // frac 0..1 → FFT bin。低域(低音)は飛ばし、近傍平均でノイズ低減。
    if(typeof Audio==='undefined' || !Audio.fft) return -1;
    const bins = Audio.fft.length;          // 512
    const lo = 10;                          // 最低域を飛ばす (始点が伸びるのを防ぐ)
    const usable = Math.min(bins, 300);
    const c = lo + Math.floor(frac * (usable - 1 - lo));
    let s = 0, n = 0;
    for(let k=-2;k<=2;k++){                  // 軽め平均: 段差(スペクトラムの高低差)を残す
      const j = c + k;
      if(j>=lo && j<usable){ s += Audio.fft[j]; n++; }
    }
    return (n>0 ? s/n : 0) / 255.0;          // 0..1 (1/f 補正なし=段差を活かす)
  },
  _beatRev(){
    // beat 同期の回転数 (呼び出し側で beatScale 反映済み)
    const srcBeat = (typeof this._slotBeat === 'number') ? this._slotBeat
      : ((typeof App !== 'undefined' && App.visualBeat) ? App.visualBeat() : ((typeof BPM!=='undefined') ? BPM.beatCount() : this._now()*2));
    const bc = srcBeat - (this.beatBase || 0);
    return bc;
  },

  reset(tSec){
    this.startTime = (typeof tSec === 'number') ? tSec : performance.now()/1000;
    this.beatBase = (typeof App !== 'undefined' && App.visualBeat) ? App.visualBeat()
      : ((typeof BPM !== 'undefined' && BPM.beatCount) ? BPM.beatCount() : 0);
    this._envSlow = 0;
    this._atkEnv = 0;
    if(this.barH && this.barH.fill) this.barH.fill(0);
    if(this._barSm && this._barSm.fill) this._barSm.fill(0);
  },

  // ===== メイン描画 (p5) =====
  draw(p){
    const P = this.P || {};
    const t = this._now() * (P.speed != null ? P.speed : 1);
    const W = p.width, H = p.height, cx = W*0.5, cy = H*0.5;   // 出力解像度に追従(4:3 等にも対応)
    const S = Math.min(W, H) / 720;                            // 短辺基準のスケール係数
    p.clear();          // 透明背景。ベクター要素は実アルファ、画像素材の黒は表示シェーダでキー
    p.noStroke();

    const energy = this._energy();
    // アタック(音の立ち上がり)検出 — 全バー共通の「まとまり」駆動に使う
    if(this._envSlow === undefined){ this._envSlow = 0; this._atkEnv = 0; }
    this._envSlow += (energy - this._envSlow) * 0.10;            // ゆっくり追従する基準
    const attack = Math.max(0, energy - this._envSlow);          // 立ち上がり量
    const atkTarget = Math.min(1.0, attack * 5.0);
    this._atkEnv += (atkTarget - this._atkEnv) * (atkTarget > this._atkEnv ? 0.5 : 0.08);  // 速く立ち上がり/ゆっくり減衰
    const atk = this._atkEnv;
    const R0 = 250;                 // リング半径
    const maxBarLen = 230;          // 最大バー長

    // ---- 放射状の長方形バー (時計回り回転) + 目盛り ----
    const CLOCK_S = 0.80 * S;      // 時計全体のスケール (短辺に追従して 4:3 でも収める)
    p.push();
    p.translate(cx, cy);
    p.scale(CLOCK_S);
    const rot = t * 0.4 * (P.spin != null ? P.spin : 1);   // 時計回り (canvas は y 下向き = 正回転=時計回り)
    p.rotate(rot);
    const N = this.NBARS;
    // 音量ゲート: audioSync=1 で音量に同期(無音時バーが引っ込む)、0 で常時アニメ
    const aS = (P.audioSync != null) ? P.audioSync : 1;
    const volGate = (1.0 - aS) + aS * (0.05 + 0.95 * Math.min(1.0, Math.pow(energy * 2.4, 0.9)));
    const barLen = (P.barLen != null) ? P.barLen : 1;
    if(P.bars){
    p.fill(255);
    for(let i=0;i<N;i++){
      const frac = i / N;
      const ang = frac * Math.PI*2;
      // FFT 周波数スペクトラムでバー高さを駆動 = グラフ感(隣接バー=隣接周波数)
      const vol = Math.min(1.0, energy * 1.8);
      const hx  = Math.sin(i*78.233 + 1.3) * 43758.5453;
      const r1  = hx - Math.floor(hx);                 // 静的ランダム 0..1
      const hy  = Math.sin(i*39.17 + 4.1) * 12793.137;
      const r2  = hy - Math.floor(hy);                 // 位相用ランダム
      // 山のエンベロープ: 複数周波数(2,3,4,5周期)を合成 → 干渉で山が3〜5個に増減し、時間位相で上下動(単調でない)
      const env = 0.55*Math.sin(ang*3.0 + t*0.55)
                + 0.45*Math.sin(ang*4.0 - t*0.42 + 1.3)
                + 0.40*Math.sin(ang*2.0 + t*0.31 + 2.7)
                + 0.30*Math.sin(ang*5.0 - t*0.25 + 0.6);
      const hill = Math.pow(Math.min(1.0, Math.max(0.0, env)/0.85), 1.4);  // 山のピークを天井(1.0)で頭打ち=山同士の高さを揃える
      const fftV = this._fftAt(frac);                       // 音マッピング: 角度=周波数(連続)
      const audio = (fftV >= 0) ? Math.pow(fftV, 1.6) : 0;  // 音による変調(あれば山を高く)
      const shuffle = 0.15 + 0.85*r1;                              // 山の中で棒の高さをランダムにシャッフル(規則的でない凸凹)
      const base = hill * (0.35 + 1.0*audio) * shuffle;            // 山(音に反応) × シャッフル
      const flick = Math.sin(t*2.6 + r2*6.2831 + i*1.7);           // バーごと位相で時間点滅
      const spike = Math.pow(Math.max(0.0, flick), 5.0) * Math.pow(r1, 1.5);  // ランダムに山並み(天井)まで伸びる棒
      const spec = base + spike * (0.4 + 0.6*audio) * 1.35;
      // 微小な揺らぎ(生命感)。スペクトラムを主役に、音量はわずかなフロアのみ。
      const pulse = 0.82 + 0.18*Math.sin(t*2.4 + r2*6.2831);
      const v = (spec*1.5 + 0.025*vol*(0.3+0.7*r1)) * pulse;
      // アタックは山(hill)のあるバーだけ指数関数的に伸ばす。谷(hill≈0)はアタック音があっても反応しない
      const common = Math.pow(atk, 2.0) * Math.pow(hill, 2.0) * 2.2;
      const vMixed = (v + common) * volGate;                                              // 音量同期
      const target = 4 + Math.min(maxBarLen*barLen, Math.max(0.0, vMixed) * maxBarLen * 1.3 * barLen);  // バー長さ(barLen)で全体スケール
      // スペクトラムに素早く追従(立ち上がり速め)、戻りは中庸でガタつき抑制
      const kUp = 0.34 + 0.16*atk, kDown = 0.17;
      this.barH[i] += (target - this.barH[i]) * ((target > this.barH[i]) ? kUp : kDown);
    }
    // 空間平滑化: 突出したバーを隣接へ散らす(まとまりは common の底上げで確保)
    const sm = this._barSm || (this._barSm = new Float32Array(N));
    for(let i=0;i<N;i++){
      sm[i] = this.barH[i];   // 平滑化オフ(鋭い山を保つ。散らしは周波数3周マッピングで担保)
    }
    const barW = (R0 * Math.PI*2 / N) * 0.55;     // 一定幅 (純粋長方形)
    for(let i=0;i<N;i++){
      p.push();
      p.rotate(i / N * Math.PI*2);
      p.rect(-barW*0.5, R0, barW, sm[i]);         // 根元 R0 から外へ
      p.pop();
    }
    }   // if(P.bars)
    // 同心リング
    p.noFill(); p.stroke(255); p.strokeWeight(1.5);
    p.ellipse(0, 0, R0*2, R0*2);
    p.strokeWeight(1.0); p.stroke(150);
    p.ellipse(0, 0, (R0-30)*2, (R0-30)*2);
    // 目盛り (60 小 / 12 大) — バーと一緒に回転。
    //   内端を内側リング(R0-30)まで伸ばして隙間を無くす。
    p.stroke(255);
    const inner = R0 - 30;
    for(let k=0;k<60;k++){
      const ang = k/60 * Math.PI*2;
      const major = (k % 5 === 0);
      p.strokeWeight(major ? 2.5 : 1.0);
      p.line(Math.cos(ang)*inner, Math.sin(ang)*inner, Math.cos(ang)*(R0-4), Math.sin(ang)*(R0-4));
    }
    p.pop();

    // ---- 中央エンブレム (cd.svg 由来, ゆっくり回転して時計と重ねる) ----
    if(P.emblem && this.cdEmblem){
      p.push();
      p.translate(cx, cy);
      p.scale(CLOCK_S);
      p.rotate(-this._beatRev() * 0.09);  // beat 同期 (テンポに比例して回転)
      p.imageMode(p.CENTER);
      p.image(this.cdEmblem, 0, 0, 460, 460);
      p.pop();
    }

    // ---- 時計の針 ----
    if(P.clock){
    p.push();
    p.translate(cx, cy);
    p.scale(CLOCK_S);
    p.stroke(255);
    // 針 + 先端に平行ラベル
    const hand = (deg, len, weight, label) => {
      const a = deg * Math.PI/180;
      p.stroke(255); p.strokeWeight(weight);
      p.line(0, 0, Math.cos(a)*len, Math.sin(a)*len);
      // 先端の下に、針と平行な文字
      p.push();
      p.translate(Math.cos(a)*len, Math.sin(a)*len);
      const up = Math.cos(a) < 0;             // 左向きは上下反転して可読に
      p.rotate(a + (up ? Math.PI : 0));
      p.noStroke(); p.fill(255);
      p.textFont('Courier New'); p.textSize(10);
      p.textAlign(up ? p.RIGHT : p.LEFT, p.TOP);
      p.text(label, up ? -7 : 7, 4);
      p.pop();
    };
    // ミリ秒(秒針): 1 秒で 1 周、easeOutQuint + 着地で約5pxの小バウンド
    const ms = t % 1.0;
    let eMs = this._easeOutQuint(ms);
    const bounceRev = 5.0 / (2*Math.PI*210);  // 先端で約5px
    eMs += bounceRev * Math.sin(Math.pow(ms, 6.0) * Math.PI * 2.0);
    hand(-90 + eMs*360, 210, 1.3, 'MSEC');
    hand(-90 + ((t/8.0)%1.0)*360, 170, 1.7, 'SEC');           // 秒
    hand(-90 + (this._beatRev()/4.0 % 1.0)*360, 130, 2.2, 'MIN'); // 分: 4beat=1周
    hand(-90 + ((t/200.0)%1.0)*360, 80, 3.0, 'HRS');          // 時
    p.pop();
    }   // if(P.clock)

    // ===== クリーンな外枠 (引き伸ばさず描画) =====
    p.noFill(); p.stroke(255); p.strokeWeight(1.2);
    const FM = 22;                       // フレーム余白
    p.rect(FM, FM, W-2*FM, H-2*FM);
    p.strokeWeight(0.8); p.stroke(120);
    p.rect(FM+5, FM+5, W-2*FM-10, H-2*FM-10);

    // ===== 四隅のコーナーブラケット (1枚絵を回転配置 → どのアスペクトでも歪まない) =====
    if(this.cdFrame){
      const BS = 120 * S;                // ブラケットの表示サイズ(短辺に追従)
      const HP = Math.PI/2;
      p.imageMode(p.CORNER);
      const corners = [[FM, FM, 0.0], [W-FM, FM, HP], [W-FM, H-FM, Math.PI], [FM, H-FM, HP*3.0]];
      for(let i=0;i<4;i++){
        p.push();
        p.translate(corners[i][0], corners[i][1]);
        p.rotate(corners[i][2]);
        p.image(this.cdFrame, 0, 0, BS, BS);
        p.pop();
      }
    }

    // ===== 共通レイアウト基準 (帯より前に定義して相互参照) =====
    const MX = 64;            // 左余白
    const TOP_BL = 58;
    const BOT_BL = H - 88;    // 下段ベースライン (コンソール/左帯の下端を揃える, 下端から一定)
    const rightX = W - MX;

    // ===== 帯: 素材を長軸方向にスクロール(マーキー)して同じ文字列を繰り返す =====
    const barV = 300 * S;                // 縦帯の窓の長さ(高さ, 短辺に追従)
    const barH = 300 * S;                // 横帯の窓の長さ(幅)
    const SPD = 38 * S;                  // スクロール速度(px/秒)
    if(P.cdBars){
    if(this.cdBarR){                     // 右辺・上寄り(縦, 上へ流す)
      const w = barV * this.cdBarR.width / this.cdBarR.height;
      this._marqueeV(p, this.cdBarR, W - FM - w - 4, H*0.28 - barV*0.5, w, barV, t*SPD, -1);
    }
    if(this.cdBarL){                     // 左辺・下端を BOT_BL に(縦, 文章方向=上から下)
      const w = barV * this.cdBarL.width / this.cdBarL.height;
      this._marqueeV(p, this.cdBarL, FM + 4, BOT_BL - barV, w, barV, t*SPD, 1);
    }
    if(this.cdBarB){                     // 下辺(横, 文章方向=左から右)
      const h = barH * this.cdBarB.height / this.cdBarB.width;
      const rightEdge = W - 64;          // _drawIcons の rightX = エンブレム右端
      this._marqueeH(p, this.cdBarB, rightEdge - barH, H - FM - h - 4, barH, h, t*SPD, 1);
    }
    }   // if(P.cdBars)

    // ---- 左上 "aratanagara" ----
    p.fill(255); p.noStroke();
    p.textFont('Aratana'); p.textAlign(p.LEFT, p.BASELINE); p.textSize(26);
    p.text('aratanagara', MX, TOP_BL);
    p.textFont('Courier New'); p.textSize(10); p.fill(170);
    p.text('audio.reactive.clock // v1', MX, TOP_BL + 16);

    // ---- HUD アイコン (右下, 下帯の右側) ----
    this._drawIcons(p, t, W - 64, BOT_BL);

    // ---- 左下 端末 (左帯の右側, 下端 BOT_BL を共有) ----
    if(P.console) this._drawConsole(p, t, 66, BOT_BL);

    // ---- nn.png (GR エンブレムの幅・x に合わせた縦パターン, エンブレムの上に配置) ----
    if(this.clockImg){
      const eS = 34;                       // _drawIcons のエンブレム幅
      const eCx = (W - 64) - eS*0.5;       // エンブレム中心 x
      const eTop = BOT_BL - eS*0.5 - 48;   // エンブレム上端からさらに上 (GRロゴと被らない)
      const iw = eS;
      const ih = this.clockImg.height * iw / this.clockImg.width;
      p.push(); p.imageMode(p.CENTER);
      p.image(this.clockImg, eCx, eTop - ih*0.5, iw, ih);  // 下端=eTop, 上方向へ
      p.pop();
    }

  },

  // 縦帯マーキー: 素材を縦に流して継ぎ目なく繰り返す。dir:+1=下へ / -1=上へ。
  // 整数 unit・整数位置でタイルするのでタイル間に線(隙間)が出ない。
  _marqueeV(p, img, x, topY, w, winH, dist, dir){
    const unit = Math.max(1, Math.round(w * img.height / img.width));
    const off = ((Math.round(dist*dir) % unit) + unit) % unit;
    const base = Math.round(topY) + off - unit;
    const ctx = p.drawingContext; ctx.save();
    ctx.beginPath(); ctx.rect(x, topY, w, winH); ctx.clip();
    p.imageMode(p.CORNER);
    for(let yy = base; yy < topY + winH; yy += unit) p.image(img, x, yy, w, unit);
    ctx.restore();
  },
  // 横帯マーキー: dir:+1=右へ / -1=左へ。
  _marqueeH(p, img, leftX, y, winW, h, dist, dir){
    const unit = Math.max(1, Math.round(h * img.width / img.height));
    const off = ((Math.round(dist*dir) % unit) + unit) % unit;
    const base = Math.round(leftX) + off - unit;
    const ctx = p.drawingContext; ctx.save();
    ctx.beginPath(); ctx.rect(leftX, y, winW, h); ctx.clip();
    p.imageMode(p.CORNER);
    for(let xx = base; xx < leftX + winW; xx += unit) p.image(img, xx, y, unit, h);
    ctx.restore();
  },

  _drawConsole(p, t, x, baseY){
    // 入力とフローを同期: 各行を高速タイプ → 完了で上へスクロール。
    const log = this._log;
    const M = log.length;
    const lineH = 13;
    const KLINES = 11;                    // 表示行数
    const tpl = 0.45;                     // 1 行の所要時間 (高速タイピング)
    const gi = Math.floor(t / tpl);       // 現在(最新)行のインデックス
    const frac = (t / tpl) % 1.0;
    const slide = frac * lineH;           // フレーム間の連続スクロール量
    const bottomY = baseY;
    const bandTop = bottomY - KLINES*lineH - 4;
    p.push();
    const ctx = p.drawingContext;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x-4, bandTop, 540, (bottomY - bandTop) + 6);
    ctx.clip();
    p.textFont('Courier New'); p.textSize(10); p.textAlign(p.LEFT, p.BASELINE);
    for(let row=0; row<=KLINES; row++){
      const idx = gi - row;
      if(idx < 0) continue;
      const line = log[((idx % M) + M) % M];
      const y = bottomY - row*lineH - slide;   // 連続して上へ流れる
      if(row === 0){
        // 最新行: タイプ中 (前半でタイプ完了 → 後半は完成して待機)
        const nv = Math.min(line.length, Math.floor(frac * line.length * 2.2) + 1);
        const shown = line.slice(0, nv);
        p.fill(line[0] === '$' ? 255 : 170);
        p.text(shown, x, y);
        // ブロックカーソル
        const cw = p.textWidth(shown);
        p.noStroke(); p.fill(255);
        p.rect(x + cw + 1, y - 9, 6, 10);
      } else {
        p.fill(line[0] === '$' ? 255 : 150);
        p.text(line, x, y);
      }
    }
    ctx.restore();
    p.pop();
  },

  // 流れるログ (擬似端末出力)
  _log: [
    '$ npm run build', '> vite build', 'transforming modules...',
    '✓ 184 modules transformed', 'dist/index.html   1.2 kB',
    'dist/assets/app.js  86 kB', '$ git add -A',
    '$ git commit -m "fx: glow"', '[main 3f9a1c2] fx: glow',
    '$ ./scripts/deploy.sh', 'lftp mirror -R /vj/ ...', 'sync complete',
    '$ ffmpeg -i in.mp4 -y out.webm', 'frame=1240 fps=60 q=28',
    'video:5.2MB done', '$ npm run dev', 'VITE v5 ready in 312 ms',
  ],

  _drawIcons(p, t, rightX, baseY){
    p.push();
    let x = rightX;
    // エンブレム (最も右, 底辺を baseY に揃える)
    const eS = 34;
    this._drawGRMark(p, x - eS/2, baseY - eS/2, eS);
    x -= eS + 20;
    // シグナルバー (底辺 baseY)
    p.noStroke(); p.fill(255);
    const sgW = 36;
    for(let k=0;k<4;k++){ const bh = 6 + k*6; p.rect(x - sgW + k*9, baseY - bh, 5, bh); }
    x -= sgW + 24;
    // REC テキスト (右寄せ, ベースライン baseY) + 点滅ドット
    p.fill(255); p.textFont('Courier New'); p.textSize(12); p.textAlign(p.RIGHT, p.BASELINE);
    p.text('REC', x, baseY);
    const tw = p.textWidth('REC');
    if((t*1.0)%1.0 < 0.5){ p.noStroke(); p.fill(255); p.ellipse(x - tw - 11, baseY - 4, 9, 9); }
    p.pop();
  },

  // GraphersRock ロゴ参考: 角丸スクエアに 180°回転対称のインターロック・フック + 斜めスラッシュ
  _drawGRMark(p, cx, cy, S){
    p.push();
    p.translate(cx, cy);
    // タイル (白い角丸スクエア)
    p.noStroke(); p.fill(255);
    p.rectMode(p.CENTER);
    p.rect(0, 0, S, S, S*0.16);
    // マーク (黒抜き)
    p.noFill(); p.stroke(0); p.strokeCap(p.ROUND); p.strokeJoin(p.ROUND);
    const wt = S*0.15;
    p.strokeWeight(wt);
    const r = S*0.24;
    // フック A (上側): 円弧 + 内向きの尾
    p.arc(-S*0.10, -S*0.08, r*2, r*2, -Math.PI*0.55, Math.PI*0.95);
    // フック B (180°回転)
    p.push(); p.rotate(Math.PI);
    p.arc(-S*0.10, -S*0.08, r*2, r*2, -Math.PI*0.55, Math.PI*0.95);
    p.pop();
    // 中央の斜めスラッシュ
    p.strokeWeight(wt*0.9);
    p.line(-S*0.26, S*0.26, S*0.20, -S*0.20);
    p.pop();
    p.rectMode(p.CORNER);
  },

  update(){ /* state は draw 内で時刻ベース算出 */ },

  render(opts){
    if(!this.initialized) return;
    const gl = this.gl;
    const { fbo, w, h } = opts;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

    if(this.ready && this.canvasEl){
      // 出力解像度にキャンバスを合わせる(アスペクト一致 → 4:3 対応)。
      // 白はスーパーサンプリングで滑らかに、黒はピクセルを立てるためAAなしで描画する。
      const blackMode = !!(this.P && this.P.black);
      const ss = blackMode ? 1 : ((Math.max(w, h) > 1280) ? 1 : 1.5);   // 1.5x スーパーサンプリング(AA と負荷の妥協点)
      // p5 の論理サイズを FBO に追従させる。pixelDensity でバッキングだけ拡大(描画座標=出力解像度)。
      // 実サイズで判定するので、リサイズが間に合わなくても次フレームでリトライ(4:3 等で円が潰れない)。
      if(this.p5i.width !== w || this.p5i.height !== h || this._css !== ss){
        try {
          if(this._css !== ss){ this.p5i.pixelDensity(ss); this._css = ss; }
          this.p5i.resizeCanvas(w, h, true);
        } catch(e){ /* ignore */ }
      }
      const prevClock = this._slotClock, prevBeat = this._slotBeat;
      this._slotClock = (typeof opts.clock === 'number') ? opts.clock : undefined;
      this._slotBeat = (typeof opts.beat === 'number') ? opts.beat : undefined;
      try { this.p5i.redraw(); } catch(e){ /* ignore */ }
      this._slotClock = prevClock;
      this._slotBeat = prevBeat;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);    // プリマルチプライ(LINEAR 縮小で縁が黒く滲まない)
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvasEl); }
      catch(e){ /* ignore */ }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, blackMode ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, blackMode ? gl.NEAREST : gl.LINEAR);
      gl.uniform1i(this.locs.tex, 0);
      gl.uniform2f(this.locs.res, w, h);
      gl.uniform1f(this.locs.black, blackMode ? 1.0 : 0.0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(this.locs.pos);
      gl.vertexAttribPointer(this.locs.pos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
