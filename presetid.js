// プリセットの不変 id と削除 id の純粋な処理 (app.js の App が使う。Node のテストからも読む)
//   id: 保存時に 'p' + 乱数。id の無い古いプリセットには 名前 + 同名 (id なし同士) の出現順 から決定的に付ける
//   (中身のハッシュは使わない: state は保存のたびに少し変わる)。一度付いた id は変えない。
//   削除 id: { k: 'id:<id>', t: 時刻 } の追記のみの一覧。減らさない (和集合で統合)。
const PresetIds = (() => {
  const hash = (s) => {
    let a = 5381, b = 52711;
    for(let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); a = ((a * 33) ^ c) >>> 0; b = ((b * 31) + c) >>> 0; }
    return a.toString(36) + b.toString(36);
  };
  const randomId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const key = (p) => 'id:' + p.id;
  // list の id の無いプリセットへ id を付ける (list を直接書き換える)。付けた件数を返す
  function ensureIds(list){
    let n = 0;
    const used = new Set(list.filter(p => p && p.id).map(p => p.id));
    const seen = {};
    for(const p of list){
      if(!p || p.id) continue;
      const nm = p.name || '';
      const c = (seen[nm] = (seen[nm] || 0) + 1);
      let id = 'n' + hash(nm + '#' + c);
      while(used.has(id)) id += '_';
      p.id = id; used.add(id); n++;
    }
    return n;
  }
  // 削除 id の一覧 (配列 / 墓標の配列) を Set にする
  const deadSet = (tombs) => new Set((tombs || []).map(t => t && t.k).filter(Boolean));
  const isDead = (p, dead) => !!(p && p.id && dead.has(key(p)));
  const filterAlive = (list, dead) => list.filter(p => !isDead(p, dead));
  // 追記のみの和集合。id 以外のキー (旧 nk:) は読み捨てる。同じ id は古い時刻を残す
  function mergeTombs(a, b){
    const m = {};
    for(const tb of [].concat(a || [], b || [])){
      if(!tb || typeof tb.k !== 'string' || tb.k.indexOf('id:') !== 0) continue;
      if(!m[tb.k] || (tb.t || 0) < m[tb.k].t) m[tb.k] = { k: tb.k, t: tb.t || 0 };
    }
    return Object.values(m);
  }
  // 削除済みの id のプリセットを、明示操作 (Cmd+Z / 履歴復元) で戻すときの新しい id (決定的)。墓標は消さない
  function revive(p, dead){
    while(p.id && dead.has(key(p))) p.id += 'r';
    return p;
  }
  // サーバーとの同期。remote / local は書き換える (id を付ける)。
  //   削除 id に載っているものは両側から除く。サーバーに無いローカルは、前回サーバーと一致したときの控え (synced = id の Set) に
  //   無いものだけを残す (控えが無ければ何も戻さない)。
  function mergeLibs(remote, local, dead, synced){
    const assigned = ensureIds(remote) + ensureIds(local);
    const remoteAlive = filterAlive(remote, dead);
    const rk = new Set(remoteAlive.map(key));
    const localOnly = synced ? local.filter(p => p && !rk.has(key(p)) && !dead.has(key(p)) && !synced.has(p.id)) : [];
    return { lib: localOnly.length ? remoteAlive.concat(localOnly) : remoteAlive, localOnly,
             remoteHadDead: remoteAlive.length !== remote.length, assigned };
  }
  return { hash, randomId, key, ensureIds, deadSet, isDead, filterAlive, mergeTombs, revive, mergeLibs };
})();
if(typeof module !== 'undefined') module.exports = PresetIds;
