/* ================= Ugomeki (kind:'ugomeki') =================
 * Text Concreter (moji_ugomeki) の文字アニメーションエンジンを VJ 向けに移植。
 *   1文字ずつのループノイズ変形(揺れ/回転/切断/グリッチ/波/残像/明滅/浮遊/ビーム…)、
 *   シードによるパラメータ一括生成、文字種別の字面(仮想ボディ%)。
 *   テキストは TextDeform と同じ md プリセット群を共有し、md ごとの
 *   パラメータ調整を localStorage に保存できる。
 *   行長×行数のグリッドに収まらないテキストはタイピング表示(1文字ずつ出現)。
 *   毎フレーム 2D canvas に描画 → テクスチャ → スロット FBO へ転写。
 * ==================================================================== */
// Unicode カバレッジ用フォールバック(style.css の @font-face "Lucida Sans Unicode VJ"=l_10646.ttf 等)。
// 各書体に付けることで、書体側に無い記号/結合文字も Unicode フォントで描画される。
// 末尾の "Unifont VJ" は全 Unicode をカバーする最終フォールバック (style.css の @font-face)。
const MT_UNICODE_FB = '"Lucida Sans Unicode VJ","Lucida Sans Unicode","Apple Symbols","Noto Sans Symbols 2","Noto Sans Symbols","Segoe UI Symbol","Unifont VJ"';
const MT_FONTS = [
  {name:'DNP / Yu Mincho',  ff:'"yu-mincho-pr6n","dnp-shuei-nmincho-std","Zen Old Mincho","Hiragino Mincho ProN","Yu Mincho",'+MT_UNICODE_FB+',serif'},
  {name:'DNP Shuei Gothic', ff:'"dnp-shuei-gothic-gin-std","Zen Kaku Gothic New","Noto Sans JP","Yu Gothic",'+MT_UNICODE_FB+',sans-serif'},
  {name:'Zen Old Mincho',   ff:'"Zen Old Mincho","Hiragino Mincho ProN",'+MT_UNICODE_FB+',serif'},
  {name:'Noto Sans JP',     ff:'"Noto Sans JP",'+MT_UNICODE_FB+',sans-serif'},
  {name:'Zen Kaku Gothic',  ff:'"Zen Kaku Gothic New",'+MT_UNICODE_FB+',sans-serif'},
  {name:'MS Gothic',        ff:'"MS Gothic","ＭＳ ゴシック","Osaka-Mono",'+MT_UNICODE_FB+',monospace'},
  {name:'Space Mono',       ff:'"Space Mono",'+MT_UNICODE_FB+',monospace'},
  {name:'EB Garamond',      ff:'"EB Garamond",'+MT_UNICODE_FB+',serif'},
  {name:'Unicode',          ff:MT_UNICODE_FB+',sans-serif'},   // 記号/結合文字向け(最大カバレッジ)
];
const MT_FONT_MINCHO = MT_FONTS[0].ff;
const MT_FONT_GOTHIC = MT_FONTS[1].ff;

/* ---- ループするノイズ / 乱数 (moji_ugomeki より) ---- */
function mtHash(n){
  const x = Math.sin(n*127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function mtN1(seed, t, T){
  let v=0, a=0;
  for(let k=1;k<=3;k++){
    const ph = mtHash(seed*31.7 + k*7.3) * 6.28318;
    const w = 1/k;
    v += w * Math.sin(6.28318*k*t/T + ph);
    a += w;
  }
  return v/a; // -1〜1
}
function mtMulberry(seed){
  return function(){
    seed|=0; seed = seed+0x6D2B79F5|0;
    let t = Math.imul(seed^seed>>>15, 1|seed);
    t = t+Math.imul(t^t>>>7, 61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
/* ツメ・タメ：ループ位相を周期的にリマップして緩急をつける */
function mtWarpTs(ts, T, tame){
  if(!tame) return ts;
  const a = Math.max(-0.95, Math.min(0.95, tame/100 * 0.9));
  const p = ((ts % T) + T) % T / T;
  const q = p + (a/12.56637) * Math.sin(12.56637 * p);
  return q * T;
}

/* ---- 縦書き用の文字分類 ---- */
const MT_ROT_CHARS = 'ー―‐−ｰ〜～…‥＝=（）()「」『』［］〔〕【】＜＞〈〉《》｛｝｢｣→←';
const MT_PUNCT     = '、。，．,.';
const MT_SMALL     = 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ';

/* ---- ランダム生成用: 書体プール(UIの Typeface と同一。MT_FONTS から生成) ---- */
const MT_FONT_POOL = MT_FONTS.map(f => f.ff);
/* 書体スタックの末尾に Unicode フォールバックを保証する (保存済み md の素の family 対策) */
function mtFontStack(ff){
  const f = String(ff || MT_FONT_MINCHO);
  return /Unifont VJ/.test(f) ? f : f + ',' + MT_UNICODE_FB;
}
function mtHsl(h, s, l){
  h = ((h % 360) + 360) % 360; s = Math.max(0,Math.min(1,s)); l = Math.max(0,Math.min(1,l));
  const c = (1 - Math.abs(2*l-1)) * s, x = c * (1 - Math.abs((h/60)%2 - 1)), m = l - c/2;
  let r=0,g=0,b=0;
  if(h<60){ r=c; g=x; } else if(h<120){ r=x; g=c; } else if(h<180){ g=c; b=x; }
  else if(h<240){ g=x; b=c; } else if(h<300){ r=x; b=c; } else { r=c; b=x; }
  const hex = v => Math.round((v+m)*255).toString(16).padStart(2,'0');
  return '#' + hex(r) + hex(g) + hex(b);
}

/* ---- 書記素クラスタ分割: 結合文字/合成絵文字/異体字セレクタ等を1文字として扱う ----
   (Zalgo や結合ダイアクリティカルの Unicode をグリッド/メトリクスで分解せず「そのまま」描画) */
let _mtSeg = null;
function mtGraphemes(str){
  str = String(str);
  if(_mtSeg === null){ try{ _mtSeg = new Intl.Segmenter(undefined, {granularity:'grapheme'}); }catch(e){ _mtSeg = false; } }
  if(_mtSeg){ const out = []; for(const s of _mtSeg.segment(str)) out.push(s.segment); return out; }
  // フォールバック: 結合マーク・ZWJ・異体字セレクタを直前の基底へ連結
  const out = [];
  for(const ch of str){
    const c = ch.codePointAt(0);
    const comb = (c>=0x0300&&c<=0x036F)||(c>=0x0483&&c<=0x0489)||(c>=0x1AB0&&c<=0x1AFF)
      ||(c>=0x1DC0&&c<=0x1DFF)||(c>=0x20D0&&c<=0x20FF)||(c>=0xFE00&&c<=0xFE2F)||c===0x200D||(c>=0xE0100&&c<=0xE01EF);
    if(comb && out.length) out[out.length-1] += ch; else out.push(ch);
  }
  return out;
}

/* ---- 文字種別の仮想ボディ(字面)スケール ---- */
function mtClassifyChar(ch){
  const c = ch.codePointAt(0);
  if(c>=0x3040 && c<=0x309F) return 'hira';
  if((c>=0x30A0 && c<=0x30FF) || (c>=0xFF66 && c<=0xFF9D)) return 'kana';
  if((c>=0x4E00 && c<=0x9FFF) || (c>=0x3400 && c<=0x4DBF) || ch==='々' || ch==='〆') return 'kanji';
  if((c>=0x30&&c<=0x39)||(c>=0x41&&c<=0x5A)||(c>=0x61&&c<=0x7A)
     ||(c>=0xFF10&&c<=0xFF19)||(c>=0xFF21&&c<=0xFF3A)||(c>=0xFF41&&c<=0xFF5A)) return 'latin';
  return 'other';
}

/* ---- 1セル(文字)を全エフェクト込みで描く (moji_ugomeki drawCellFX 移植) ----
   直列(入れ子合成)/並列(効果ごとに別像)の振り分けは A.mix。 */
/* 再描画系エフェクトの inner 呼び出し回数(コスト見積り)。直列入れ子は乗算になるため、
   予算(budget)を超える場合は重いものから並列へ逃がしてコストを加算に抑える。
   1フレームが長すぎると ANGLE/Chrome が GL コンテキストを破棄する(TDR)ため必須の保護。 */
const MT_FX_COST = {208:8, 209:13, 210:3, 211:4, 212:4, 213:4, 214:2};

function mtDrawCellFX(ctx, A, s, bSeed, ts, cx, cy, cellW, cellH, baseRot, pulse, drawFn, layerAlpha, budget){
  const T = A.dur;
  const ref = Math.max(cellW, cellH);
  if(layerAlpha === undefined) layerAlpha = 1;

  let alpha = 1;
  if(A.blink > 0){
    alpha = Math.max(0, Math.min(1, 1 - A.blink/100*(0.5 + 0.5*mtN1(s+5, ts, T))));
    if(alpha <= 0.003) return;
  }

  // 高速パス：再描画系・フィルタ・並列が無いときは1回の変換で描画
  if((A.mix||0)===0 && !(A.cutV>0||A.cutH>0||A.cutD>0||A.float>0||A.glitch>0||A.dbl>0) && !(A.hue>0||A.blur>0)){
    let dx=0, dy=0;
    if(A.amp>0){ dx=A.amp/100*ref*mtN1(s+1,ts,T); dy=A.amp/100*ref*mtN1(s+2,ts,T); }
    if(A.wave>0){ const L=ref*6; dy+=A.wave/100*ref*Math.sin(6.28318*((cx+cy)/L)-12.566*ts/T+mtHash(bSeed)*6.28318); }
    const jr = A.rot>0 ? A.rot*Math.PI/180*mtN1(s+3,ts,T) : 0;
    let sc = 1; if(A.scale>0){ sc=1+A.scale/100*mtN1(s+4,ts,T); if(sc<0.02)sc=0.02; }
    sc *= (1+pulse);
    let sx=sc, sy=sc;
    if(A.aspect>0){ sx*=Math.max(0.05,1+A.aspect/100*mtN1(s+10,ts,T)); sy*=Math.max(0.05,1+A.aspect/100*mtN1(s+11,ts,T)); }
    if(A.flipH>0 && (0.5+0.5*mtN1(s+30,ts,T))<A.flipH/100*0.9) sx=-sx;
    if(A.flipV>0 && (0.5+0.5*mtN1(s+31,ts,T))<A.flipV/100*0.9) sy=-sy;
    ctx.save();
    ctx.globalAlpha *= alpha*layerAlpha;
    ctx.translate(cx+dx, cy+dy);
    if(baseRot||jr) ctx.rotate(baseRot+jr);
    if(sx!==1||sy!==1) ctx.scale(sx,sy);
    drawFn();
    ctx.restore();
    return;
  }

  const parProb = (A.mix||0)/100;
  const isPar = salt => parProb>0 && mtHash(s+salt) < parProb;

  const effs = [];
  if(A.amp>0){
    const dx=A.amp/100*ref*mtN1(s+1,ts,T), dy=A.amp/100*ref*mtN1(s+2,ts,T);
    effs.push({salt:201, fn:inner=>{ ctx.translate(dx,dy); inner(); }});
  }
  if(A.wave>0){
    const L=ref*6, wy=A.wave/100*ref*Math.sin(6.28318*((cx+cy)/L)-12.566*ts/T+mtHash(bSeed)*6.28318);
    effs.push({salt:202, fn:inner=>{ ctx.translate(0,wy); inner(); }});
  }
  if(A.rot>0){
    const jr=A.rot*Math.PI/180*mtN1(s+3,ts,T);
    effs.push({salt:203, fn:inner=>{ ctx.rotate(jr); inner(); }});
  }
  if(A.scale>0){
    let sc=1+A.scale/100*mtN1(s+4,ts,T); if(sc<0.02)sc=0.02;
    effs.push({salt:204, fn:inner=>{ ctx.scale(sc,sc); inner(); }});
  }
  if(A.aspect>0){
    const ax=Math.max(0.05,1+A.aspect/100*mtN1(s+10,ts,T)), ay=Math.max(0.05,1+A.aspect/100*mtN1(s+11,ts,T));
    effs.push({salt:205, fn:inner=>{ ctx.scale(ax,ay); inner(); }});
  }
  if(A.flipH>0 && (0.5+0.5*mtN1(s+30,ts,T))<A.flipH/100*0.9)
    effs.push({salt:206, fn:inner=>{ ctx.scale(-1,1); inner(); }});
  if(A.flipV>0 && (0.5+0.5*mtN1(s+31,ts,T))<A.flipV/100*0.9)
    effs.push({salt:207, fn:inner=>{ ctx.scale(1,-1); inner(); }});
  // 浮遊：多層の残像がふわりと下へ漂う
  if(A.float>0){
    const g=A.float/100*Math.max(0,mtN1(s+40,ts,T));
    if(g>0.02){
      const gCl=Math.min(g,4);
      effs.push({salt:208, fn:inner=>{
        for(let j=6;j>=1;j--){ const f=j/6;
          ctx.save();
          ctx.globalAlpha*=Math.pow(0.62,j);
          ctx.translate(g*ref*0.12*mtN1(s+50+j*1.9,ts,T), g*ref*0.6*f*f*(1+0.3*mtN1(s+52+j,ts,T)));
          ctx.scale(Math.max(0.05,1-0.05*f*gCl),1+0.12*f*gCl);
          inner(); ctx.restore();
        }
        inner();
      }});
    }
  }
  // ビーム：ランダムな方向へ尾を引く
  if(A.beam>0){
    const inten=A.beam/100*Math.max(0,mtN1(s+72,ts,T));
    const D=A.beamDist*Math.min(inten,3);
    if(D>0.5){
      const ang=6.28318*mtHash(s+70)+1.4*mtN1(s+71,ts,T);
      const ux=Math.cos(ang), uy=Math.sin(ang);
      effs.push({salt:209, fn:inner=>{
        for(let j=12;j>=1;j--){ const f=j/12;
          ctx.save();
          ctx.globalAlpha*=(1-f)*0.5+0.12;
          ctx.translate(ux*D*f,uy*D*f);
          ctx.rotate(ang); ctx.scale(1+0.5*f,Math.max(0.2,1-0.15*f)); ctx.rotate(-ang);
          inner(); ctx.restore();
        }
        inner();
      }});
    }
  }
  // グリッチ：横スライスずれ＋ジャンプ
  if(A.glitch>0){
    const gl=A.glitch/100, gate=0.5+0.5*mtN1(s+8,ts,T);
    if(gate<gl*0.75){
      const frameH=Math.floor(ts*37);
      effs.push({salt:210, fn:inner=>{
        const NH=3, gw=cellW*1.8, gh=cellH*1.8;
        const big=gate<gl*0.28 ? (mtHash(s+91+frameH)-0.5)*cellW*1.3*gl : 0;
        for(let j=0;j<NH;j++){
          const ys=-gh/2+j*gh/NH;
          const dxg=big+(mtHash(s*7.3+j*13.7+frameH)-0.5)*cellW*0.85*gl;
          ctx.save();
          ctx.beginPath(); ctx.rect(-gw/2,ys,gw,gh/NH+0.5); ctx.clip();
          ctx.translate(dxg,0); inner(); ctx.restore();
        }
      }});
    }
  }
  // 切断：縦・横・斜めの切れ目でスパッとずれる
  [['cutV',0,6,211],['cutH',Math.PI/2,45,212],['cutD',Math.PI/4,48,213]].forEach(([key,ang,ns,salt],ci)=>{
    if(A[key]>0){
      const m=A[key]/100*Math.max(0,mtN1(s+ns,ts,T));
      if(m>0.02){
        effs.push({salt, fn:inner=>{
          const NS=4, span=ref*1.8;
          for(let j=0;j<NS;j++){
            ctx.save(); ctx.rotate(ang);
            ctx.beginPath(); ctx.rect(-span/2+j*span/NS,-span*2.5,span/NS+0.5,span*5); ctx.clip();
            ctx.translate(0, m*ref*1.1*mtN1(s+80+ci*31+j*2.71,ts,T));
            ctx.rotate(-ang); inner(); ctx.restore();
          }
        }});
      }
    }
  });
  // 二重(ゴースト)
  if(A.dbl>0){
    const off=A.dbl/100*ref*0.6, gx=off*mtN1(s+20,ts,T), gy=off*mtN1(s+21,ts,T);
    effs.push({salt:214, fn:inner=>{
      inner();
      ctx.save(); ctx.globalAlpha*=0.45; ctx.translate(gx,gy); inner(); ctx.restore();
    }});
  }

  const serial=[], parallel=[];
  for(const e of effs){ (isPar(e.salt)?parallel:serial).push(e); }

  // 予算超過分は重い再描画系から順に並列へ逃がす(乗算コスト→加算コスト)
  if(budget){
    const prod = ()=> serial.reduce((a,e)=> a*(MT_FX_COST[e.salt]||1), 1);
    while(prod() > budget){
      let hi=-1, hc=1;
      serial.forEach((e,i)=>{ const c=MT_FX_COST[e.salt]||1; if(c>hc){ hc=c; hi=i; } });
      if(hi<0) break;
      parallel.push(serial.splice(hi,1)[0]);
    }
  }

  ctx.save();
  let filt='';
  if(A.hue>0){ const deg=180*(A.hue/100)*mtN1(s+32,ts,T); filt+=`hue-rotate(${deg.toFixed(1)}deg) `; }
  if(A.blur>0){ const bp=Math.min(120,Math.max(0,A.blur/100*ref*0.12*(0.5+0.5*mtN1(s+33,ts,T)))); if(bp>0.15) filt+=`blur(${bp.toFixed(2)}px)`; }
  if(filt) ctx.filter=filt;
  ctx.globalAlpha*=alpha*layerAlpha;
  ctx.translate(cx,cy);
  ctx.rotate(baseRot);
  if(pulse) ctx.scale(1+pulse,1+pulse);

  ctx.save();
  let chain=drawFn;
  for(let i=serial.length-1;i>=0;i--){ const e=serial[i], inner=chain; chain=()=>e.fn(inner); }
  chain();
  ctx.restore();

  for(const e of parallel){
    ctx.save();
    ctx.globalAlpha*=0.82;
    e.fn(drawFn);
    ctx.restore();
  }

  ctx.restore();
}

/* md ごとに保存するパラメータのキー */
const MT_MD_KEYS = ['amp','rot','scale','blink','cutV','cutH','cutD','float','beam','beamDist',
  'echo','echoLen','aspect','dbl','glitch','wave','hue','blur','flipH','flipV','mix','tame',
  'fps','dur','perChar','vertical','align','spacing','overflow','lineLen','lineCount','letterSpace','lineSpace','fontScale',
  'fontFamily','bold','ink','paper','marginPct','bodyKanji','bodyHira','bodyKana','bodyLatin',
  'typeCps','typeHold','cutBeats','animSeed'];

const Ugomeki = {
  initialized: false,
  gl: null,

  P: {
    // アニメーション (0-1000 系は % 値。初期値はすべて0=静止)
    amp: 0, rot: 0, scale: 0, blink: 0,
    cutV: 0, cutH: 0, cutD: 0, float: 0,
    beam: 0, beamDist: 60, echo: 0, echoLen: 150,
    aspect: 0, dbl: 0, glitch: 0, wave: 0, hue: 0, blur: 0,
    flipH: 0, flipV: 0, mix: 0, tame: 0,
    fps: 30, dur: 6, perChar: true,
    // 組版
    fontFamily: MT_FONT_MINCHO, bold: false,
    vertical: false, letterSpace: 0.9, lineSpace: 1.0,
    align: 'center',   // start=左(上) | center=中央 | end=右(下) | justify=均等
    spacing: 'grid',   // grid=等幅ベタ組み | metrics=字幅メトリクス(横組のみ)
    overflow: 'page',  // あふれ時: page=画面リセットして次ページ | scroll=1行ずつスクロール
    lineLen: 16,       // 行長(1行の最大字数)。0=改行のまま(折返しなし)
    lineCount: 8,      // 行数(表示領域の行数)。超過分はタイピング表示
    fontScale: 100,    // 自動フォントサイズへの倍率%
    marginPct: 8,
    ink: '#17140f', paper: '#f4f3ef', transparentBg: false,
    // 字面(仮想ボディ%)
    bodyKanji: 100, bodyHira: 100, bodyKana: 100, bodyLatin: 100,
    // タイピング
    typeCps: 4,        // 1秒あたりの出現文字数(あふれ時)。最大 3600字/分 = 60字/秒。0=カット表示
    typeHold: 0,       // 1ページ表示しきった後の保持秒数
    cutBeats: 4,       // typeCps=0(カット表示)時、1キャンバスを何拍表示して次へ送るか
    // シード
    animSeed: 1,
    // VJ 駆動
    beatSync: true,    // beatモード時、拍頭でノイズをコマ送り
    beatPulse: 0.3,    // 拍で文字が脈動する量
    beatReload: false, // beatモード時、拍ごとにランダム md を読み直す
    mdMode: 'random', mdIndex: -1,
    text: 'もじ、うごめく。'
  },
  PDefaults: null,
  _mdParamStoreKey: 'vj.ugomeki.mdParams',

  /* TextDeform と同じ md プリセット群(name/text)を共有 */
  get mdSources(){
    if(typeof TextDeform !== 'undefined' && TextDeform.presets) return TextDeform.presets;
    return [{name:'(builtin)', text: this.P.text}];
  },

  // ================= GL =================
  VS: `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = vec2(a_pos.x*0.5+0.5, 0.5 - a_pos.y*0.5); gl_Position = vec4(a_pos,0.0,1.0); }`,
  FS: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag; uniform sampler2D u_tex;
void main(){ frag = texture(u_tex, clamp(v_uv,0.0,1.0)); }`,

  init(gl){
    if(this.initialized) return true;
    this.gl = gl;
    // PDefaults はスクリプト読込時に確定済み(下部)。init 時に取り直すと、
    // 先に走る state 復元で書き換わった P を「デフォルト」として焼き付けてしまう。

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.VS); gl.compileShader(vs);
    if(!__glReady(gl, vs, false)){ console.error('Ugomeki vs:', gl.getShaderInfoLog(vs)); return false; }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this.FS); gl.compileShader(fs);
    if(!__glReady(gl, fs, false)){ console.error('Ugomeki fs:', gl.getShaderInfoLog(fs)); return false; }
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, vs); gl.attachShader(this.prog, fs); gl.linkProgram(this.prog);
    if(!__glReady(gl, this.prog, true)){ console.error('Ugomeki link:', gl.getProgramInfoLog(this.prog)); return false; }
    this.locPos = gl.getAttribLocation(this.prog, 'a_pos');
    this.locTex = gl.getUniformLocation(this.prog, 'u_tex');
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([244,243,239,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 2; this.canvas.height = 2;
    this.ctx = this.canvas.getContext('2d');

    this._t = 0;
    this._typeT = 0;
    this._beatT = 0;
    this._lastBeatInt = -1;
    this._seed = Math.random()*1000;
    this.initialized = true;
    this.loadRandom();
    return true;
  },

  // ================= md プリセット選択 (TextDeform 互換 API) =================
  loadPreset(i){
    const list = this.mdSources;
    i = Math.max(0, Math.min((list.length || 1) - 1, parseInt(i, 10) || 0));
    const src = list[i];
    if(!src) return;
    const mdMode = this.P.mdMode === 'fixed' ? 'fixed' : 'random';
    // デフォルトへ戻す → md 別の保存パラメータを適用
    const base = JSON.parse(JSON.stringify(this.PDefaults || this.P));
    const saved = this._storedMdParams()[src.name];
    if(saved) for(const k of MT_MD_KEYS){ if(saved[k] !== undefined) base[k] = saved[k]; }
    base.text = src.text;
    base.mdMode = mdMode;
    base.mdIndex = i;
    // ランタイム系は現在値を引き継ぐ
    base.beatSync = this.P.beatSync; base.beatPulse = this.P.beatPulse; base.beatReload = this.P.beatReload;
    this.P = base;
    this._lastPresetI = i;
    this._typeT = 0;
    this._mdStartBeat = null;   // beat モードの「書き終わり」判定を新 md で初期化
    this._layout = null;
  },

  loadSelected(){
    const i = parseInt(this.P.mdIndex, 10);
    if(this.P.mdMode === 'fixed' && this.mdSources[i]){ this.loadPreset(i); return; }
    this.P.mdMode = 'random'; this.P.mdIndex = -1;
    this.loadRandom();
  },

  loadRandom(){
    const n = this.mdSources.length; if(!n) return;
    if(this.P.mdMode === 'fixed' && this.mdSources[this.P.mdIndex]){ this.loadPreset(this.P.mdIndex); return; }
    this.P.mdMode = 'random';
    let i = Math.floor(Math.random()*n);
    if(n > 1 && i === this._lastPresetI) i = (i+1) % n;
    this.loadPreset(i);
  },

  // 自動ローテーション用：次のランダム md へ。毎回その md の保存プリセット
  // (md別パラメータ)を完全リロードする(ライブ調整は引き継がない)。
  autoNextMd(){
    const n = this.mdSources.length; if(!n) return;
    let i = Math.floor(Math.random()*n);
    if(n > 1 && i === this._lastPresetI) i = (i+1) % n;
    this.P.mdMode = 'random';
    this.loadPreset(i);              // 既定に戻して保存済みプリセットを適用
  },

  setMdSelection(value){
    if(value === '' || value === 'random' || value == null){
      this.P.mdMode = 'random'; this.P.mdIndex = -1;
      this.loadRandom(); return;
    }
    const i = Math.max(0, Math.min(this.mdSources.length - 1, parseInt(value, 10) || 0));
    this.P.mdMode = 'fixed'; this.P.mdIndex = i;
    this.loadPreset(i);
  },

  currentMdIndex(){
    if(this.P.mdMode === 'fixed' && this.mdSources[this.P.mdIndex]) return this.P.mdIndex;
    return (this._lastPresetI != null && this.mdSources[this._lastPresetI]) ? this._lastPresetI : -1;
  },

  // ================= md ごとのパラメータ保存 =================
  _storedMdParams(){
    try{
      let s = localStorage.getItem(this._mdParamStoreKey);
      if(s == null){
        // 旧名(mojitype)からの移行
        const old = localStorage.getItem('vj.mojitype.mdParams');
        if(old != null){ localStorage.setItem(this._mdParamStoreKey, old); localStorage.removeItem('vj.mojitype.mdParams'); s = old; }
      }
      return JSON.parse(s || '{}');
    }catch(e){ return {}; }
  },
  saveMdParams(i){
    const src = this.mdSources[i]; if(!src) return false;
    const all = this._storedMdParams();
    // 初期値と同じ値も含めて全キーを保存する(差分保存にしない)。
    //   差分だと「初期値と同じ項目」が保存に含まれず、読み込み側の実装によっては
    //   前の md の値が残って一部だけ切り替わらない事故につながるため。
    const out = {};
    for(const k of MT_MD_KEYS) out[k] = this.P[k];
    all[src.name] = out;
    try{ localStorage.setItem(this._mdParamStoreKey, JSON.stringify(all)); }catch(e){ return false; }
    return true;
  },
  clearMdParams(i){
    const src = this.mdSources[i]; if(!src) return;
    const all = this._storedMdParams();
    delete all[src.name];
    try{ localStorage.setItem(this._mdParamStoreKey, JSON.stringify(all)); }catch(e){}
  },
  hasMdParams(i){
    const src = this.mdSources[i]; if(!src) return false;
    return !!this._storedMdParams()[src.name];
  },

  // ================= シードからパラメータ一括生成 =================
  randomizeAnim(seed, quiet){
    const P = this.P;
    // アニメ系だけデフォルトに戻してから生成
    const D = this.PDefaults || P;
    for(const k of ['amp','rot','scale','blink','cutV','cutH','cutD','float','beam','beamDist',
                    'echo','echoLen','aspect','dbl','glitch','wave','hue','blur','flipH','flipV','mix','tame',
                    'fontScale','letterSpace','lineSpace','lineLen','lineCount','marginPct',
                    'bodyKanji','bodyHira','bodyKana','bodyLatin'])
      P[k] = D[k];
    const rnd = mtMulberry((seed|0) + 1);
    const R = (a,b)=> a + (b-a)*rnd();
    const chance = p=> rnd() < p;
    const wild = chance(0.35) ? R(1.5, 2.6) : 1;
    P.amp   = Math.round(R(3,22) * wild * 10)/10;
    P.rot   = chance(0.85) ? Math.round(R(0,14) * wild * 10)/10 : 0;
    P.scale = chance(0.8)  ? Math.round(R(0,22) * wild)         : 0;
    const M = v=> Math.round(v * wild);
    // blur/hue は ctx.filter(GPU合成)で最も重く予算保護の対象外 → ランダム生成には含めない(常に0)。
    // echo/beam/float は描画回数の乗算要因なので低めに抑える(描画予算でも自動制限される)。
    const pool = [
      ()=> P.blink = Math.min(90, Math.round(R(20,80)*wild)),
      ()=> P.cutV  = Math.min(100, M(R(15,70))),
      ()=> P.cutH  = Math.min(100, M(R(15,70))),
      ()=> P.cutD  = Math.min(100, M(R(15,70))),
      ()=> P.float = Math.min(70, Math.round(R(15,55))),
      // beam と echo はどちらか一方だけ
      ()=> { if(rnd() < 0.5){ P.beam = Math.min(55, Math.round(R(15,45))); P.beamDist = Math.round(R(20,100)); }
             else          { P.echo = Math.min(55, Math.round(R(15,45))); P.echoLen  = Math.round(R(100,600)); } },
      ()=> P.aspect= Math.min(120, M(R(15,60))),
      ()=> P.dbl   = Math.min(100, M(R(25,80))),
      ()=> P.glitch= Math.min(100, M(R(15,70))),
      ()=> P.wave  = Math.min(120, M(R(20,90))),
      ()=> P.flipH = Math.min(60,  M(R(10,45))),
      ()=> P.flipV = Math.min(60,  M(R(10,45))),
    ];
    const idx = pool.map((_,i)=>i);
    for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
    const n = 4 + Math.floor(rnd()*(wild>1 ? 6 : 4));
    for(let k=0;k<Math.min(n,pool.length);k++) pool[idx[k]]();
    P.mix  = chance(0.6) ? Math.round(R(0,100))  : 0;
    P.tame = chance(0.6) ? Math.round(R(-80,80)) : 0;
    // 組版トグルもランダム化(縦書き/太字/揃え/字送り) → UIのチェックボックス・選択も変わる
    P.vertical = rnd() < 0.35;
    P.bold     = rnd() < 0.3;
    P.align    = ['start','center','end','justify'][Math.floor(rnd()*4)];
    P.spacing  = rnd() < 0.5 ? 'metrics' : 'grid';
    // サイズ系: フォント倍率・字送り・行間・行長/行数・余白・字面(仮想ボディ)
    P.fontScale   = Math.round(R(55, 175) * (wild > 1 && chance(0.4) ? 1.4 : 1));
    P.letterSpace = Math.round(R(0.6, 1.4) * 100) / 100;
    P.lineSpace   = Math.round(R(0.8, 1.6) * 100) / 100;
    if(chance(0.5)) P.lineLen   = Math.round(R(4, 24));
    if(chance(0.5)) P.lineCount = Math.round(R(2, 12));
    P.marginPct = Math.round(R(0, 18));
    if(chance(0.4)){
      P.bodyKanji = Math.round(R(70, 135));
      P.bodyHira  = Math.round(R(70, 135));
      P.bodyKana  = Math.round(R(70, 135));
      P.bodyLatin = Math.round(R(70, 135));
    }
    // 書体もランダム
    P.fontFamily = MT_FONT_POOL[Math.floor(rnd()*MT_FONT_POOL.length)];
    // 色もランダム(墨と紙で必ずコントラストを付ける。明地×暗字 or 暗地×明字)
    const baseH = Math.floor(rnd()*360);
    const inkH  = (baseH + (rnd()<0.3 ? 180 : 0)) % 360;   // たまに補色の字
    const tint  = rnd()*0.28;
    if(rnd() < 0.45){   // 暗地×明字
      P.paper = mtHsl(baseH, tint*0.7, 0.06 + rnd()*0.12);
      P.ink   = mtHsl(inkH,  tint,     0.82 + rnd()*0.14);
    }else{              // 明地×暗字
      P.paper = mtHsl(baseH, tint*0.4, 0.86 + rnd()*0.10);
      P.ink   = mtHsl(inkH,  tint*1.2, 0.06 + rnd()*0.14);
    }
    P.animSeed = seed|0;
    this._layout = null;                          // 組版が変わるのでレイアウト作り直し
    if(!quiet) this._seed = Math.random()*1000;   // 揺れパターンも変える
  },

  setParams(over){
    Object.assign(this.P, over || {});
    this._layout = null;
  },
  setText(text){
    this.P.text = String(text == null ? '' : text);
    this._typeT = 0;
    this._layout = null;
  },
  reseed(){ this._seed = Math.random()*1000; },

  // ================= レイアウト =================
  /* 豆腐ガード: 現フォントで描けない文字を代替グリフへ (TextDeform の判定を共用)。
     テキスト+書体単位でキャッシュするので毎フレームのラスタ判定は起きない。 */
  _tofuGuard(text){
    if(typeof TextDeform === 'undefined' || !TextDeform.fixTofu) return text;
    const P = this.P;
    const key = P.fontFamily + '|' + (P.bold ? 700 : 400) + '|' + text;
    if(this._tofuCache && this._tofuCache.key === key) return this._tofuCache.out;
    let out = text;
    try{
      out = mtGraphemes(text).map(g =>
        (g === '\n' || g === ' ' || g === '　') ? g
          : TextDeform.fixTofu(g, P.fontFamily, P.bold ? 700 : 400)).join('');
    }catch(e){}
    this._tofuCache = { key, out };
    return out;
  },

  onFontsReady(){
    this._tofuCache = null;
    this._layout = null;   // 次フレームで組み直し
  },

  /* 行長で折返し → 行数でページ分割。あふれ(2ページ以上)ならタイピング対象。 */
  _buildLayout(w, h){
    const P = this.P;
    let lines = this._tofuGuard(String(P.text)).replace(/\r\n?/g,'\n').split('\n');
    const L = Math.max(0, P.lineLen|0);
    if(L > 0){
      const wrapped = [];
      for(const para of lines){
        const chars = mtGraphemes(para);
        if(chars.length===0){ wrapped.push(''); continue; }
        for(let i=0;i<chars.length;i+=L) wrapped.push(chars.slice(i,i+L).join(''));
      }
      lines = wrapped.length ? wrapped : [''];
    }
    const N = Math.max(1, P.lineCount|0);
    const noType = P.typeCps <= 0;               // タイプ速度0 = カット表示(所定beatでページ送り)
    const pages = [];
    for(let i=0;i<lines.length;i+=N) pages.push(lines.slice(i,i+N));   // 常にN行ごとのページ(キャンバス)
    if(!pages.length) pages.push(['']);

    // テキストエリア = 行長(maxLen)×行数(N) のグリッド矩形。このグリッド枠を
    // フレーム(余白控除後)へ最大内接させたときが Size=100%。fontScale(Size%) は
    // その枠全体の拡縮比率。→「行長×行数からエリアを自動算出し、Size で比率調整」。
    //   maxLen: 横方向のマス数(行長)。lineLen=0(折返しなし)時は実文字列の最長行。
    //   N     : 縦方向のマス数(行数)。
    const maxLen = L > 0 ? L : Math.max(1, ...lines.map(l => mtGraphemes(l).length));
    const mg = Math.min(0.45, Math.max(0, P.marginPct/100));
    const availW = w*(1-2*mg), availH = h*(1-2*mg);
    const chFac = 1 + P.letterSpace, lnFac = 1 + P.lineSpace;
    // グリッド枠をフレームに内接(縦横どちらか一方が枠いっぱい)させる基準フォントサイズ。
    const fitRows = N;   // グリッド行数(1キャンバス=N行)で算出
    let fs;
    if(P.vertical) fs = Math.min(availH/(maxLen*chFac), availW/(fitRows*lnFac));
    else           fs = Math.min(availW/(maxLen*chFac), availH/(fitRows*lnFac));
    fs = Math.max(6, fs * (P.fontScale/100));   // Size% = グリッド枠の拡縮比率
    const chStep = fs*chFac, lnStep = fs*lnFac;

    // 字送り(advance): grid=等幅(chStep) / metrics=字幅+トラッキング(横組のみ)
    const track = P.letterSpace * fs;
    const useMetrics = (P.spacing === 'metrics') && !P.vertical;
    const mctx = this.ctx;
    if(useMetrics) mctx.font = (P.bold?'bold ':'') + fs + 'px ' + mtFontStack(P.fontFamily);
    const advOf = chars => useMetrics
      ? chars.map(ch => mctx.measureText(ch).width + track)
      : chars.map(()=> chStep);
    // ブロック幅: grid=最大字数×chStep / metrics=最長行の実測幅
    let blockW = maxLen*chStep;
    if(useMetrics){
      let mw = 0;
      for(const ln of lines){ const s = advOf(mtGraphemes(ln)).reduce((a,b)=>a+b,0); if(s>mw) mw=s; }
      blockW = mw>0 ? mw : chStep;
    }
    // 1行を揃え(左上/中央/右下/均等)に従って配置。advance ベースで grid/metrics 共通。
    const placeH = (chars, cy, cells)=>{
      const adv = advOf(chars), lineW = adv.reduce((a,b)=>a+b,0);
      const x0 = w/2 - blockW/2;
      let start = x0, gapExtra = 0;
      switch(P.align){
        case 'start': start = x0; break;
        case 'end':   start = x0 + (blockW - lineW); break;
        case 'justify':
          if(chars.length > 1) gapExtra = (blockW - lineW)/(chars.length - 1);
          else start = x0 + blockW/2 - (adv[0]||0)/2;
          break;
        default:      start = x0 + (blockW - lineW)/2;   // center
      }
      let cum = 0;
      chars.forEach((ch, ci)=>{ cells.push({ch, cx: start + cum + adv[ci]/2, cy}); cum += adv[ci] + gapExtra; });
    };
    // 縦組: 列内は grid(等幅) 固定で揃えを反映
    const placeV = (chars, cx, y0, cells)=>{
      const len = chars.length, blockLen = maxLen*chStep, lineLen2 = len*chStep;
      let off = (blockLen - lineLen2)/2 + chStep/2, step = chStep;
      if(P.align==='start')      { off = chStep/2; }
      else if(P.align==='end')   { off = blockLen - lineLen2 + chStep/2; }
      else if(P.align==='justify'){ if(len>1){ off = chStep/2; step = (blockLen - chStep)/(len-1); } else off = blockLen/2; }
      chars.forEach((ch, ci)=>{ cells.push({ch, cx, cy: y0 + off + ci*step}); });
    };
    // あふれ時の挙動: page=N行ごと(既存) / scroll=直近N行の窓を1行ずつずらす
    const useScroll = (P.overflow === 'scroll') && !noType && lines.length > N;
    let builtPages, scrollStart = null;
    if(useScroll){
      builtPages = []; scrollStart = [];
      const cyRow = r => h/2 - N*lnStep/2 + lnStep/2 + r*lnStep;    // グリッド行r の中心y
      const cxCol = c => w/2 + N*lnStep/2 - lnStep/2 - c*lnStep;    // グリッド列c の中心x(右→左)
      const y0v = h/2 - maxLen*chStep/2;
      for(let Lend=0; Lend<lines.length; Lend++){
        const top = Math.max(0, Lend - N + 1);
        const win = lines.slice(top, Lend+1);   // 直近 N 行(最終=最新)
        const wl = win.length, cells = [];
        if(P.vertical) win.forEach((line, i)=> placeV(mtGraphemes(line), cxCol(wl-1-i), y0v, cells));       // 最新列を右端に
        else           win.forEach((line, i)=> placeH(mtGraphemes(line), cyRow(N - wl + i), cells));        // 最新行を最下段に
        const lastLen = mtGraphemes(win[wl-1]).length;
        scrollStart.push(cells.length - lastLen);  // 最終行より前は即表示、最終行のみタイプ
        builtPages.push(cells);
      }
    }else{
      builtPages = pages.map(pgLines=>{
        const cells = [];
        const nL = pgLines.length;
        if(P.vertical){
          const totW = nL*lnStep;
          const y0 = h/2 - maxLen*chStep/2;
          pgLines.forEach((line, li)=> placeV(mtGraphemes(line), w/2 + totW/2 - lnStep/2 - li*lnStep, y0, cells));
        }else{
          const totH = nL*lnStep;
          pgLines.forEach((line, li)=> placeH(mtGraphemes(line), h/2 - totH/2 + lnStep/2 + li*lnStep, cells));
        }
        return cells;
      });
    }
    const totalChars = builtPages.reduce((a,c)=>a+c.length, 0);
    this._layout = { w, h, fs, pages: builtPages, typing: builtPages.length > 1, scroll: useScroll, scrollStart, totalChars };
  },

  // ================= 更新・描画 =================
  update(beat, dt, w, h){
    if(!this.initialized) return;
    const d = (dt > 0 && dt < 0.2) ? dt : 1/60;
    // beat scale(×A) に応じてアニメ・タイピングの時間を速める(beat駆動のカット/drawは
    // slotScaledBeat 側で既に反映済み)。
    const bScale = (typeof App !== 'undefined')
      ? (App._normalizeBeatScale ? App._normalizeBeatScale(App.beatScale) : (App.beatScale || 1)) : 1;
    this._t += d * bScale;
    this._typeT += d * bScale;
    const P = this.P;
    const beatMode = (typeof App !== 'undefined' && App.beatMode === 'beat');
    const bi = Math.floor(beat || 0);
    if(bi !== this._lastBeatInt){
      this._lastBeatInt = bi;
      this._beatT = this._t;                      // 拍頭の時刻を記録(コマ送り用)
      if(beatMode && P.beatReload && P.mdMode !== 'fixed') this.loadRandom();
    }
    this._beat = beat || 0;
    this._beatMode = beatMode;
    this._w = w; this._h = h;
  },

  _renderToCanvas(w, h){
    const P = this.P;
    const cv = this.canvas, ctx = this.ctx;
    if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; this._layout = null; }
    if(!this._layout || this._layout.w !== w || this._layout.h !== h) this._buildLayout(w, h);
    const lay = this._layout;

    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    if(P.transparentBg) ctx.clearRect(0,0,w,h);
    else { ctx.fillStyle = P.paper; ctx.fillRect(0,0,w,h); }

    // タイピング進行：ページ内 1 文字ずつ → 全字後 hold → 次ページ。
    // md がランダムなら「全文を書き終えるたび」別のランダム md へ切り替える。
    let pageIdx = 0, visChars = Infinity;
    const nPages = lay.pages.length;
    const isRandomMd = (P.mdMode !== 'fixed');
    // scroll 時は各ステップの「即表示ぶん(最終行より前)」開始位置
    const stepBase = i => (lay.scroll && lay.scrollStart) ? lay.scrollStart[i] : 0;
    if(P.typeCps <= 0){
      // カット表示：ページ全体を即表示し、所定の拍(cutBeats)ごとに次のキャンバス(ページ)へ。
      // 全キャンバス表示後は random なら別 md へ。
      const beat = Math.max(0, this._beat || 0);
      if(this._mdStartBeat == null) this._mdStartBeat = beat;
      const cb = Math.max(0.25, P.cutBeats || 4);
      const shown = Math.floor((beat - this._mdStartBeat) / cb);   // 経過キャンバス数
      // md の自動切替は beat モード限定 (drone では同じ md のページを回し続ける)
      if(isRandomMd && this._beatMode && shown >= nPages){ this.autoNextMd(); return; }
      pageIdx = ((shown % nPages) + nPages) % nPages;
      visChars = Infinity;
    }else if(this._beatMode){
      // draw(beat)モード：1拍=1ステップで書く。全ページ書き終えたら別 md。
      const beat = Math.max(0, this._beat || 0);
      if(this._mdStartBeat == null) this._mdStartBeat = Math.floor(beat);
      if(isRandomMd && (beat - this._mdStartBeat) >= nPages){   // 全ページ書き終えた
        this.autoNextMd(); return;
      }
      const whole = Math.floor(beat);
      pageIdx = ((whole % nPages) + nPages) % nPages;
      const frac = beat - whole;                       // 0→1 でその拍の間に埋まる
      const base = stepBase(pageIdx), lastLen = lay.pages[pageIdx].length - base;
      visChars = base + Math.max(1, Math.ceil(frac * lastLen));
    }else{
      // 自由タイピング(単ページでも書き出す)。scroll 時は各ステップ最終行のみタイプ。
      const cps = Math.max(0.2, Math.min(60, P.typeCps));
      const durs = lay.pages.map((c,i) => (c.length - stepBase(i))/cps + Math.max(0, P.typeHold));
      const total = durs.reduce((a,b)=>a+b,0);
      // この分岐は !this._beatMode (drone/自由タイピング) のときだけ通る。
      // md の自動切替は beat モード限定なので、書き終えたら同じ md をループする。
      if(total > 0 && this._typeT >= total) this._typeT = this._typeT % total;
      let t = this._typeT;
      for(let i=0;i<nPages;i++){
        if(t < durs[i]){ pageIdx = i; visChars = stepBase(i) + Math.floor(t*cps) + 1; break; }
        t -= durs[i];
      }
    }
    const cells = lay.pages[pageIdx] || [];
    const fs = lay.fs;

    ctx.fillStyle = P.ink;
    ctx.font = (P.bold?'bold ':'') + fs + 'px ' + mtFontStack(P.fontFamily);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // タイム：fps コマ送り + タメツメ / beatモードは拍頭で送る
    const A = P;
    let ts;
    if(this._beatMode && P.beatSync){
      ts = this._beatT;
    }else{
      const tw = mtWarpTs(this._t, A.dur, A.tame);
      ts = Math.floor(tw*A.fps)/A.fps;
    }
    ts = ((ts % A.dur) + A.dur) % A.dur;

    // 拍の脈動
    let pulse = 0;
    if(this._beatMode && P.beatPulse > 0){
      const ph = this._beat - Math.floor(this._beat);
      pulse = P.beatPulse * Math.pow(1 - ph, 1.6) * 0.35;
    }

    const bodyOf = ch => {
      const cls = mtClassifyChar(ch);
      const v = cls==='kanji'?P.bodyKanji : cls==='hira'?P.bodyHira : cls==='kana'?P.bodyKana : cls==='latin'?P.bodyLatin : 100;
      return (v==null?100:v)/100;
    };

    const n = Math.min(cells.length, visChars);
    // 1フレームの描画コール予算：文字数で割って1文字あたりの上限を決める(TDR保護)
    const perCharBudget = Math.max(16, Math.floor(6000 / Math.max(1, n)));
    for(let i=0;i<n;i++){
      const c = cells[i];
      const s = A.perChar ? this._seed + i*13.71 : this._seed;
      let ox=0, oy=0, br=0;
      if(P.vertical){
        if(MT_ROT_CHARS.includes(c.ch)) br = Math.PI/2;
        else if(MT_PUNCT.includes(c.ch)){ ox = fs*0.55; oy = -fs*0.55; }
        else if(MT_SMALL.includes(c.ch)){ ox = fs*0.1;  oy = -fs*0.1; }
      }
      const bodyS = bodyOf(c.ch);
      const drawFn = bodyS !== 1
        ? ()=>{ ctx.save(); ctx.scale(bodyS, bodyS); ctx.fillText(c.ch, 0, 0); ctx.restore(); }
        : ()=> ctx.fillText(c.ch, 0, 0);
      // 残像：過去の時刻のフレームを薄く後ろに重ねる(文字数が多いときはレイヤ数を絞る)
      // echo と beam は同時にかけない(beam 優先)
      let echoN = (A.echo>0 && !(A.beam>0)) ? Math.min(10, Math.round(A.echo/100*6)) : 0;
      if(echoN>0) echoN = Math.min(echoN, Math.max(1, Math.floor(400/Math.max(1,n))));
      const cellBudget = Math.max(8, Math.floor(perCharBudget/(echoN+1)));
      if(echoN>0){
        const gap = (A.echoLen/1000)*0.6 + 0.008;
        for(let e2=echoN; e2>=1; e2--){
          const tsE = ((ts - e2*gap)%A.dur + A.dur)%A.dur;
          mtDrawCellFX(ctx, A, s, this._seed, tsE, c.cx+ox, c.cy+oy, fs, fs, br, pulse, drawFn, Math.pow(0.62,e2)*0.85, cellBudget);
        }
      }
      mtDrawCellFX(ctx, A, s, this._seed, ts, c.cx+ox, c.cy+oy, fs, fs, br, pulse, drawFn, 1, cellBudget);
    }
  },

  render(opts){
    if(!this.initialized) return;
    const gl = this.gl, { fbo, w, h } = opts;
    this._renderToCanvas(w, h);

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try{ gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas); }
    catch(e){ return; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0,0,w,h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.locTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
};
Ugomeki.PDefaults = JSON.parse(JSON.stringify(Ugomeki.P));   // 素のデフォルトを確定(汚染前)
Ugomeki.FONTS = MT_FONTS;   // UI の書体プルダウン生成に使う
if(typeof window !== 'undefined') window.Ugomeki = Ugomeki;
