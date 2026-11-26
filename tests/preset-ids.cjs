// presetid.js の単体テスト: 古い一覧の端末が送り直しても、削除 id は戻らない
const assert = require('assert');
const P = require('../presetid.js');
const mk = (name, extra) => Object.assign({ name, state: { v: Math.random() } }, extra);

// 1. id の付与は決定的で、中身 (state) に左右されない。一度付いた id は変えない
const a = [mk('A'), mk('B'), mk('B'), mk('C', { id: 'p1' })];
const b = JSON.parse(JSON.stringify(a)); b.forEach(p => { if(p.state) p.state.v = Math.random(); });
P.ensureIds(a); P.ensureIds(b);
assert.deepStrictEqual(a.map(p => p.id), b.map(p => p.id));
assert.strictEqual(new Set(a.map(p => p.id)).size, 4);
assert.strictEqual(a[3].id, 'p1');
const before = a.map(p => p.id); P.ensureIds(a);
assert.deepStrictEqual(a.map(p => p.id), before);

// 2. 端末 A が id なし 2 件を消す → サーバーの削除 id へ。端末 B (古い一覧・控えあり) が同期しても戻らない
const server = [mk('A'), mk('B'), mk('B'), mk('D'), mk('E', { id: 'p9' })];
const devB = JSON.parse(JSON.stringify(server));
P.ensureIds(devB);
const synced = new Set(devB.map(p => p.id));
const devA = JSON.parse(JSON.stringify(server)); P.ensureIds(devA);
const del = [devA[1], devA[4]];
let tombs = P.mergeTombs([], del.map(p => ({ k: P.key(p), t: 1 })));
const serverAfter = devA.filter(p => !del.includes(p));
const dead = P.deadSet(tombs);
let m = P.mergeLibs(JSON.parse(JSON.stringify(serverAfter)), devB, dead, synced);
assert.deepStrictEqual(m.lib.map(p => p.name + ':' + p.id).sort(), serverAfter.map(p => p.name + ':' + p.id).sort());

// 3. サーバーが古い一覧で上書きされていても (1 秒後に保存された事故)、削除 id の分は表示しない
const stale = JSON.parse(JSON.stringify(server));   // id なし 5 件のまま戻ってきたサーバー
m = P.mergeLibs(stale, [], dead, null);
assert.ok(!m.lib.some(p => dead.has(P.key(p))));
assert.strictEqual(m.lib.length, 3);
assert.ok(m.remoteHadDead);

// 4. 保存時の濾過 (送る一覧から除く) と、控えが無い端末は何も戻さない
const send = P.filterAlive(devB, dead);
assert.strictEqual(send.length, 3);
m = P.mergeLibs(JSON.parse(JSON.stringify(serverAfter)), JSON.parse(JSON.stringify(devB)), dead, null);
assert.strictEqual(m.localOnly.length, 0);
// この端末で足した分 (控えに無い) は残る。削除 id のものは足してあっても残らない
const added = mk('NEW', { id: 'pnew' });
m = P.mergeLibs(JSON.parse(JSON.stringify(serverAfter)), devB.concat([added]), dead, synced);
assert.deepStrictEqual(m.localOnly.map(p => p.id), ['pnew']);

// 5. 削除 id は追記のみ。旧 nk: キーは読み捨て。復元は別の id
tombs = P.mergeTombs(tombs, [{ k: 'nk:X:abc', t: 5 }, { k: 'id:zz', t: 9 }]);
assert.deepStrictEqual(tombs.map(t => t.k).sort(), [...del.map(P.key), 'id:zz'].sort());
assert.ok(P.mergeTombs(tombs, []).length === tombs.length);
const back = P.revive(Object.assign({}, del[0]), P.deadSet(tombs));
assert.notStrictEqual(back.id, del[0].id);
assert.ok(!P.deadSet(tombs).has(P.key(back)));
console.log('preset-ids: OK');
