'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createCompletionBuffer} = require('../../src/electron/whale/completionBuffer');
const {createCompletionPoller} = require('../../src/electron/renderer/whale/completions');
const {createWhaleService} = require('../../src/electron/whale/service');
const {createCodexDesktopCompletions} = require('../../src/electron/whale/codexDesktop');
const vm = require('node:vm');
const id = value => String(value).padStart(64, '0');

test('completion queue keeps simultaneous tasks, rejects duplicates and bounds retained events', () => {
  const queue = createCompletionBuffer();
  for (let index = 1; index <= 140; index++) {
    const event = {id: id(index), provider: 'codex', tokens: index, secret: 'must-not-leak'};
    assert.equal(queue.push(event), true); assert.equal(queue.push(event), false);
  }
  const reply = queue.read();
  assert.equal(reply.seq, 140); assert.equal(reply.events.length, 128);
  assert.equal(reply.events[0].seq, 13);
  assert.equal(queue.read(139).events.length, 1);
  assert(!JSON.stringify(reply).includes('must-not-leak'));
});

test('poller aligns startup, retries failures, deduplicates a batch and never replays a failed presentation', async () => {
  const queue = createCompletionBuffer(), delivered = [];
  let fail = false;
  const poll = createCompletionPoller({load: async after => {if (fail) throw new Error('temporary'); return queue.read(after);},
    onComplete: event => {delivered.push(event); if (event.provider === 'zcode') throw new Error('card failure');}});
  queue.push({id: id(1), provider: 'codex', tokens: 10});
  await poll(); assert.equal(delivered.length, 0);
  for (const [index, provider] of ['codex', 'opencode', 'zcode', 'antigravity'].entries()) queue.push({id: id(index + 2), provider, tokens: index ? null : 0});
  fail = true; await poll(); assert.equal(delivered.length, 0);
  fail = false; await poll(); await poll(); assert.equal(delivered.length, 4);
  assert.equal(delivered[0].tokens, 0); assert.equal(delivered[3].tokens, null);
});

test('agent completion API is independent of DSH accounting and exposes only whitelisted fields', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-completion-api-'));
  const service = await createWhaleService({dataDir: root, definition: {apply() {}}});
  t.after(() => {service.dispose(); fs.rmSync(root, {recursive: true, force: true});});
  service.emit('agent/completed', {id: id(1), provider: 'opencode', tokens: null, sessionId: 'private-session', body: 'private-text'});
  service.emit('agent/completed', {id: id(1), provider: 'opencode', tokens: null});
  const response = await service.request('/dsh-whale/agent-completions.json?after=0');
  const reply = await response.json(); assert.equal(reply.events.length, 1);
  assert.equal(reply.events[0].tokens, null);
  assert(!JSON.stringify(reply).includes('private'));
  assert.equal((await service.request('/dsh-whale/agent-completions.json', {method: 'POST'})).status, 405);
  assert.deepEqual(fs.readdirSync(root), [], 'completion events must not write to the DSH ledger');
});

test('renderer realigns a replacement service epoch without replaying its existing queue', async () => {
  let queue = createCompletionBuffer();
  const played = [], poll = createCompletionPoller({load: after => queue.read(after), onComplete: event => played.push(event.id)});
  await poll(); queue.push({id: id(1), provider: 'codex'}); await poll();
  queue = createCompletionBuffer(); queue.push({id: id(2), provider: 'opencode'}); await poll();
  queue.push({id: id(3), provider: 'zcode'}); await poll();
  assert.deepEqual(played, [id(1), id(3)]);
});

test('the existing sound gate admits distinct completion ids while retaining global mute and duplicate suppression', () => {
  const widget = fs.readFileSync(path.join(__dirname, '../../src/electron/whale/vendor/assets/whale-widget.js'), 'utf8');
  const extract = (start, end) => widget.slice(widget.indexOf(start), widget.indexOf(end, widget.indexOf(start)));
  const played = [], values = new Map();
  const context = vm.createContext({soundOn: true, usageSet: {taskEnd: {on: true, sel: 'frag:cost_a'}},
    localStorage: {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value)},
    soundVolumeOf: () => 0, dshwvSound: url => ({play() {played.push(url); return Promise.resolve();}})});
  vm.runInContext(extract('function soundClaimOnce(', 'function soundVolumeOf('), context);
  vm.runInContext(extract('function playTaskEndSound(opts)', 'function playTaskEndGroupClick('), context);
  for (const eventId of [id(1), id(2), id(2)]) context.playTaskEndSound({eventId});
  assert.equal(played.length, 2);
  context.soundOn = false; context.playTaskEndSound({eventId: id(3)});
  assert.equal(played.length, 2);
  context.soundOn = true; context.usageSet.taskEnd.on = false; context.playTaskEndSound({eventId: id(4)});
  assert.equal(played.length, 2);
});

class FakeSocket extends EventTarget {
  readyState = 1;
  sent = [];
  threads = [];
  notify(method, params) { const event = new Event('message'); event.data = JSON.stringify({method, params}); this.dispatchEvent(event); }
  send(text) {
    const message = JSON.parse(text); this.sent.push(message);
    if (message.id == null) return;
    const result = message.method === 'thread/list' ? {data: this.threads, nextCursor: null} : {};
    queueMicrotask(() => { if (this.readyState !== 1) return; const event = new Event('message'); event.data = JSON.stringify({id: message.id, result}); this.dispatchEvent(event); });
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

test('Codex desktop watches successful live local turns without resuming history, cloud tasks or writing usage', async t => {
  const socket = new FakeSocket();
  const local = {id: 'local', originator: 'codex_work_cca', threadSource: 'aeon_child', model: 'current-config',
    environments: [{environmentId: 'this-machine', cwd: 'D:\\project'}], status: {type: 'idle'}};
  socket.threads = [local, {...local, id: 'cloud', environments: [{environmentId: 'elsewhere', cwd: 'D:\\project'}]},
    {...local, id: 'subtask', threadSource: 'subagent'}, {...local, id: 'native-rollout', path: 'native.jsonl'}];
  const source = createCodexDesktopCompletions({}, {
    readAuth: () => ({accessToken: 'test-only-token', accountId: 'test-only-account'}),
    localExecutorIds: async () => new Set(['this-machine']),
    makeSocket: () => {queueMicrotask(() => socket.dispatchEvent(new Event('open'))); return {socket};},
    now: () => new Date('2026-10-20T00:00:00Z'), pollMs: 60000
  });
  t.after(() => source.stop()); source.start();
  await new Promise(setImmediate); await source.whenIdle(); await new Promise(setImmediate);
  assert.deepEqual(socket.sent.filter(message => message.method === 'thread/resume').map(message => message.params.threadId), ['local']);
  const end = (turnId, status, error) => socket.notify('turn/completed', {threadId: 'local', turn: {id: turnId, status, ...(error ? {error} : {})}});
  end('historical', 'completed'); assert.equal(source.read().length, 0);
  const counters = total => ({inputTokens: total, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: total});
  socket.notify('thread/tokenUsage/updated', {threadId: 'local', tokenUsage: {total: counters(100), last: counters(100)}});
  socket.notify('turn/started', {threadId: 'local', turn: {id: 'success'}});
  socket.notify('thread/tokenUsage/updated', {threadId: 'local', tokenUsage: {total: counters(175), last: counters(75)}});
  end('success', 'completed'); end('success', 'completed');
  for (const status of ['failed', 'interrupted', 'unknown']) {socket.notify('turn/started', {threadId: 'local', turn: {id: status}}); end(status, status);}
  socket.notify('turn/started', {threadId: 'local', turn: {id: 'error'}}); end('error', 'completed', {message: 'failure'});
  assert.equal(source.read().length, 1); assert.equal(source.read()[0].tokens, 75);
  assert(!JSON.stringify(source.read()).includes('test-only'));
  assert(socket.sent.every(message => !message.method.startsWith('turn/')));
});
