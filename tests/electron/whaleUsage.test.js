'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {defaultModules, tokensText, migrateFirst} = require('../../src/electron/renderer/whale/usage');

test('desktop click card shows aggregate tokens and estimated cost without a DS balance or peak price', () => {
  const modules = defaultModules();
  assert.equal(modules[0].text, '今日本机用量');
  assert(modules.some(module => module.tpl === '{local_today_tokens}'));
  assert(modules.some(module => module.tpl === '估算费用 {expense_ds}'));
  assert(!modules.some(module => ['balance', 'peak', 'nextpeak'].includes(module.type)));
  modules[0].text = 'custom';
  assert.equal(defaultModules()[0].text, '今日本机用量');
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
  assert.equal(migrated[0].modules[0].text, '今日本机用量');
  assert.equal(migrated[0].frameId, 'mine');
  assert.equal(migrated[1], later);
  assert.equal(items[0].modules, original);
  const custom = [{kind: 'custom', modules: [{type: 'text', text: 'my own card'}]}, later];
  assert.equal(migrateFirst(custom, original), custom);
  assert.equal(migrateFirst([], original).length, 0);
});
