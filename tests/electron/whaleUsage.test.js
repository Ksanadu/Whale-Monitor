'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {defaultModules, tokensText, migrateFirst, fitScale} = require('../../src/electron/renderer/whale/usage');

test('desktop click card shows only today tokens without cost or explanatory text', () => {
  const modules = defaultModules();
  assert.equal(modules.length, 1);
  assert.equal(modules[0].tpl, '{local_today_tokens}');
  assert.equal(modules[0].text, undefined);
  modules[0].tpl = 'custom';
  assert.equal(defaultModules()[0].tpl, '{local_today_tokens}');
});

test('missing token counts are distinct from zero and large totals fit a bubble', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '100']) assert.equal(tokensText(value), '— Tokens');
  assert.equal(tokensText(0), '0 Tokens');
  assert.equal(tokensText(1234567), '1.23M Tokens');
});

test('saved factory card upgrades without changing later steps, frames or custom content', () => {
  const original = [{type: 'text', text: 'DeepSeek 余额'}, {type: 'balance', tpl: '{balance_ds}'}];
  const later = {kind: 'random'};
  const items = [{kind: 'custom', modules: original, frameId: 'mine'}, later];
  const migrated = migrateFirst(items, original);
  assert.equal(migrated[0].modules[0].tpl, '{local_today_tokens}');
  assert.equal(migrated[0].frameId, 'mine');
  assert.equal(migrated[1], later);
  assert.equal(items[0].modules, original);
  const custom = [{kind: 'custom', modules: [{type: 'text', text: 'my own card'}]}, later];
  assert.equal(migrateFirst(custom, original), custom);
  assert.equal(migrateFirst([], original).length, 0);
});

test('usage text fits both dimensions without enlarging short values', () => {
  for (const [width, height, contentWidth, contentHeight] of [[120, 70, 240, 60], [120, 70, 100, 140], [80, 40, 300, 180]]) {
    const scale = fitScale(width, height, contentWidth, contentHeight);
    assert(contentWidth * scale <= width);
    assert(contentHeight * scale <= height);
    assert(scale > 0 && scale <= 1);
  }
  assert.equal(fitScale(120, 70, 100, 60), 1);
  assert.equal(fitScale(0, 0, 100, 60), 1, 'hidden bubbles wait for measurable geometry');
});

test('the saved whale.4 factory card gets smaller Codex typography without overwriting custom cards', () => {
  const old = [
    {type: 'text', text: '今日本机用量', size: 8, bold: true},
    {type: 'today', tpl: '{local_today_tokens}', size: 16, rgb: 'indigo'},
    {type: 'today', tpl: '估算费用 {expense_ds}', size: 6, color: '#9fb0d9'},
    {type: 'text', text: '已识别客户端合计', size: 4, color: '#9fb0d9'}
  ];
  const migrated = migrateFirst([{kind: 'custom', modules: old}], []);
  assert(migrated[0].modules[0].size < old[1].size);
  assert(migrated[0].modules.every(module => module.fontFamily.includes('Segoe UI')));
  const custom = [{kind: 'custom', modules: old.map(module => ({...module, fontFamily: 'my font'}))}];
  assert.equal(migrateFirst(custom, []), custom);
});

test('the saved whale.5 typography card also migrates to a token-only card', () => {
  const fontFamily = '"Segoe UI", "Microsoft YaHei UI", sans-serif';
  const old = [
    {type: 'text', text: '今日本机用量', size: 4, bold: true},
    {type: 'today', tpl: '{local_today_tokens}', size: 8, rgb: 'indigo'},
    {type: 'today', tpl: '估算费用 {expense_ds}', size: 3, color: '#536ba9'},
    {type: 'text', text: '已识别客户端合计', size: 1, color: '#536ba9'}
  ].map(module => ({...module, fontFamily}));
  assert.deepEqual(migrateFirst([{kind: 'custom', modules: old}], [])[0].modules, defaultModules());
});
