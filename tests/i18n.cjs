'use strict';
// Dependency-free checks for the language preference and explicit UI bindings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../i18n.js'), 'utf8');
function boot(locale, saved, blocked = false) {
  const storage = new Map(saved === undefined ? [] : [['gara.lang', saved]]);
  const events = [];
  const document = { documentElement: {}, querySelectorAll: () => [], dispatchEvent: event => events.push(event) };
  const context = vm.createContext({
    document, navigator: { language: locale }, window: {},
    localStorage: {
      getItem(key) { if (blocked) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error('blocked'); storage.set(key, value); }
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  });
  vm.runInContext(source, context);
  return { api: context.window.I18n, document, storage, events };
}
for (const [locale, saved, expected] of [
  ['ja-JP', undefined, 'ja'], ['en-US', undefined, 'en'], ['fr-FR', undefined, 'en'],
  ['ja-JP', 'en', 'en'], ['en-US', 'ja', 'ja'], ['ja', 'invalid', 'ja']
]) {
  const { api, document } = boot(locale, saved);
  assert.equal(api.language, expected);
  assert.equal(document.documentElement.lang, expected);
}
for (const locale of ['ja-JP', 'en-US']) {
  const { api } = boot(locale, undefined, true);
  api.setLanguage('ja'); api.setLanguage('en');
  assert.equal(api.language, 'en');
}
const { api, document, storage, events } = boot('ja-JP');
const node = { textContent: '設定', isConnected: true };
const user = { textContent: '設定', isConnected: true };
api.bind(node, '設定');
for (let i = 0; i < 10; i++) {
  api.setLanguage('en'); assert.equal(node.textContent, 'Settings');
  api.setLanguage('ja'); assert.equal(node.textContent, '設定');
}
assert.equal(user.textContent, '設定'); // Unbound user content is never scanned.
assert.equal(events.length, 20);
assert.equal(storage.get('gara.lang'), 'ja');
assert.equal(document.documentElement.lang, 'ja');
node.textContent = 'changed by the app';
api.setLanguage('en'); assert.equal(node.textContent, 'changed by the app');
assert.equal(api.t('MIDI Learn → {0}: CCを動かして', {0: '私の素材 {x}'}), 'MIDI Learn → 私の素材 {x}: move a CC knob');
assert.equal(api.t('missing.key'), 'missing.key');
api.setLanguage('invalid'); assert.equal(api.language, 'en');
// Values are evaluated again on a language switch, so state labels follow the UI language.
const title = { textContent: '', isConnected: true };
api.bind(title, 'Slot {0}: {1} ({2} で切替)', 'textContent', () => ({0: 'A', 1: api.t('表示中'), 2: '['}));
assert.equal(title.textContent, 'Slot A: Shown ([ to toggle)');
api.setLanguage('ja'); assert.equal(title.textContent, 'Slot A: 表示中 ([ で切替)');
console.log('PASS: language detection, persistence, blocked storage, switching, bindings, user content and interpolation');
