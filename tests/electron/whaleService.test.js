'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createWhaleService, createWhaleCredentials, usageProjection} = require('../../src/electron/whale/service');
const {sanitizeRegions} = require('../../src/electron/whale/geometry');
const {allowWhaleRequest, privateResponse} = require('../../src/electron/whale/requestPolicy');

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-service-'));
  const service = await createWhaleService({dataDir: root, ...options});
  t.after(() => { service.dispose(); fs.rmSync(root, {recursive: true, force: true}); });
  return {root, service, json: async (url, init) => {
    const response = await service.request(url, init);
    assert.equal(response.status, 200);
    return response.json();
  }};
}

test('standalone whale mounts original UI, image, resource editors and independent settings', async t => {
  const {json, service, root} = await fixture(t);
  const script = await (await service.request('/dsh-whale/widget.js')).text();
  assert(script.includes('if (window.whaleDesktop) return true'));
  const image = await service.request('/dsh-whale/image.png');
  assert.equal(image.status, 200);
  assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  const before = await json('/dsh-whale/size.json');
  const saved = await json('/dsh-whale/size.json', {method: 'PUT', body: JSON.stringify({scale: 1.75, sound: false})});
  assert(saved.ok);
  const after = await json('/dsh-whale/size.json');
  assert.equal(after.scale, 1.75); assert.equal(after.sound, false);
  assert.equal(after.bubbleOn, before.bubbleOn !== false);
  assert(fs.existsSync(path.join(root, '.dshw-size.json')));
  for (const route of ['roles.json', 'audio.json', 'bubble.json', 'usage-settings.json']) {
    assert.equal((await service.request('/dsh-whale/' + route)).status, 200, route);
  }
  assert.equal((await service.request('/../../credentials.json')).status, 404);
});

test('pet credentials stay separate from renderer settings and main settings', async t => {
  const {root, json} = await fixture(t);
  await json('/dsh-whale/api-models.json', {method: 'POST', body: JSON.stringify({action: 'set-key', keyRef: 'DEEPSEEK_API_KEY', keyValue: 'test-only-secret'})});
  const credentials = createWhaleCredentials(root);
  assert.equal((await credentials.resolve('DEEPSEEK_API_KEY')).value, 'test-only-secret');
  const settings = await json('/dsh-whale/usage-settings.json');
  assert(!JSON.stringify(settings).includes('test-only-secret'));
  await credentials.unset('DEEPSEEK_API_KEY');
  assert.equal(await credentials.resolve('DEEPSEEK_API_KEY'), null);
  await assert.rejects(credentials.set('__proto__', 'invalid'));
});

test('local accounting keeps failures but completion snapshot only reports success', async t => {
  const {json, service} = await fixture(t);
  const session = {id: 'main', title: '本地会话'};
  const event = (type, data) => service.emit('session/event', session, {type, data});
  const message = turn => event('assistant/message', {turn, usage: {inputTokens: 1000, outputTokens: 100}, message: {source: {model: 'deepseek-flash'}}});
  for (const reason of ['error', 'aborted']) { message(1); event('turn/end', {turn: 1, reason: {kind: reason}}); }
  assert.equal((await json('/dsh-whale/last-turn.json')).seq, 0);
  message(2); event('turn/end', {turn: 2, reason: {kind: 'completed'}});
  const result = await json('/dsh-whale/last-turn.json');
  assert.equal(result.seq, 1); assert.equal(result.sessionName, '本地会话');
  assert.equal(result.reason, 'completed'); assert(result.epoch);
  event('turn/start', {turn: 3});
  assert.equal((await json('/dsh-whale/last-turn.json')).reason, null);
});

test('Token Monitor usage projection does not mutate its immutable snapshot', () => {
  const stats = Object.freeze({periods: Object.freeze({today: Object.freeze({costUsd: 1.25})})});
  const result = usageProjection({totalBalance: 42, todayUsage: 0.1}, stats);
  assert.equal(result.todayUsage, 1.25); assert.equal(result.todayUsageCurrency, 'USD');
  assert.equal(result.totalBalance, 42);
  assert.equal(result.budgetUsage, 0.1, 'original CNY budgets keep their own ledger');
  assert.deepEqual(usageProjection({ok: false}, null), {ok: false});
});

test('native regions reject malformed input and clip mixed-DPI logical bounds', () => {
  assert.deepEqual(sanitizeRegions([{x: -5, y: -2, width: 20, height: 10}, {x: 50, y: 50, width: 0, height: 0}, {x: NaN, y: 0, width: 1, height: 1}], {width: 100, height: 80}), [{x: 0, y: 0, width: 15, height: 8}]);
  assert.deepEqual(sanitizeRegions(null, {width: 100, height: 100}), []);
});

test('other renderer origins cannot use the local whale protocol or permissive vendor CORS', () => {
  const request = headers => ({url: 'whale://app/dsh-whale/size.json', headers: new Headers(headers)});
  assert(allowWhaleRequest(request({origin: 'whale://app', referer: 'whale://app/'})));
  assert(allowWhaleRequest(request({})));
  assert(!allowWhaleRequest(request({origin: 'https://untrusted.example'})));
  assert(!allowWhaleRequest(request({origin: 'null'})));
  assert(!allowWhaleRequest(request({referer: 'https://untrusted.example'})));
  const response = privateResponse(Response.json({}, {headers: {'Access-Control-Allow-Origin': '*'}}));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'whale://app');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
});

test('no balance key is needed for local statistics and upstream plugin updates are disabled', async t => {
  const {json} = await fixture(t, {getStats: () => ({periods: {today: {costUsd: 3}}})});
  const balance = await json('/dsh-whale/balance.json');
  assert.equal(balance.ok, true); assert.equal(balance.localUsageOnly, true);
  assert.equal(balance.totalBalance, null); assert.equal(balance.todayUsageCurrency, 'USD');
  const update = await json('/dsh-whale/update-check.json');
  assert.equal(update.hasUpdate, false);
  assert.equal(update.source, 'https://github.com/Ksanadu/Whale-Monitor/releases');
});
