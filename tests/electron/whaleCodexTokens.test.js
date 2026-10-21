'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {readCodexSignals} = require('../../src/electron/whale/agentSignals');

const at = '2026-10-21T08:00:00Z';
const header = {type: 'session_meta', payload: {id: 'root', source: 'vscode'}};
const event = (type, payload = {}) => ({type: 'event_msg', timestamp: at, payload: {type, ...payload}});
const counters = total => ({input_tokens: total - 10, cached_input_tokens: 20, cache_write_input_tokens: 0,
  output_tokens: 10, reasoning_output_tokens: 5, total_tokens: total});
const record = (turn, total, overrides = {}) => ({type: 'token_usage_record', timestamp: at, payload: {
  thread_id: 'root', turn_id: turn, root_turn_id: turn, response_id: `response-${total}`,
  usage: counters(40), turn_token_usage: counters(total), thread_token_usage: counters(total + 1000), ...overrides}});
const start = turn_id => event('task_started', {turn_id});
const end = turn_id => event('task_complete', {turn_id});
const usage = (total, last) => event('token_count', {info: {total_token_usage: counters(total), last_token_usage: counters(last)}});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-codex-tokens-')), file = path.join(dir, 'rollout.jsonl');
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const write = (records, meta = header) => fs.writeFileSync(file, [meta, ...records].map(JSON.stringify).join('\n') + '\n');
  const read = (source = file, cache = new Map()) => readCodexSignals({codexFiles: [source], codexDeps: {cache}});
  return {dir, file, write, read};
}

test('Codex first turn uses its native per-turn total without a preceding session baseline', t => {
  const f = fixture(t);
  f.write([start('one'), record('one', 100), record('one', 150), record('one', 150), end('one')]);
  assert.equal(f.read()[0].tokens, 150, 'native snapshots are cumulative, never summed');
  f.write([start('one'), record('one', 150), record('one', 100), record('one', 150), end('one')]);
  assert.equal(f.read()[0].tokens, 150, 'an older snapshot cannot lower the latest native total');
});

test('Codex cold tail and compressed rollouts recover exact turn totals without seeing the turn start', t => {
  const f = fixture(t);
  const filler = {type: 'response_item', payload: {text: 'x'.repeat(12000)}};
  f.write([start('one'), ...Array(100).fill(filler), record('one', 730147), end('one')]);
  assert.equal(f.read()[0].tokens, 730147);
  const compressed = path.join(f.dir, 'rollout.jsonl.zst');
  fs.writeFileSync(compressed, zlib.zstdCompressSync(fs.readFileSync(f.file)));
  assert.equal(f.read(compressed)[0].tokens, 730147);
});

test('Codex native usage is isolated by session and turn; child and malformed records cannot fill a missing total', t => {
  const f = fixture(t);
  for (const overrides of [{thread_id: 'other'}, {turn_id: 'other', root_turn_id: 'other'}, {root_turn_id: 'parent'},
    {turn_token_usage: {...counters(100), total_tokens: -1}}, {turn_token_usage: {...counters(100), output_tokens: 50}}]) {
    f.write([start('one'), record('one', 100, overrides), end('one')]);
    assert.equal(f.read()[0].tokens, null);
  }
  f.write([start('one'), record('one', 100), end('one'), start('two'), record('two', 250), end('two')]);
  assert.deepEqual(f.read().map(row => row.tokens), [100, 250]);
  f.write([start('one'), record('one', 100), event('error'), end('one')]);
  assert.deepEqual(f.read(), [], 'native counters never turn a failed task into a success');
});

test('Codex native totals take precedence over session deltas and survive incremental scans and duplicate records', t => {
  const f = fixture(t), cache = new Map();
  f.write([usage(1000, 100), start('one'), usage(1100, 100), record('one', 180)]);
  assert.deepEqual(f.read(f.file, cache), []);
  fs.appendFileSync(f.file, [record('one', 180), end('one')].map(JSON.stringify).join('\n') + '\n');
  assert.equal(f.read(f.file, cache)[0].tokens, 180);
  assert.equal(f.read(f.file, cache)[0].tokens, 180);
});

test('Codex legacy first turns establish a zero baseline only from a verified new session and first request counters', t => {
  const f = fixture(t);
  f.write([start('one'), usage(100, 100), usage(100, 100), usage(150, 50), end('one')]);
  assert.equal(f.read()[0].tokens, 150);
  f.write([start('one'), usage(1100, 100), end('one')]);
  assert.equal(f.read()[0].tokens, null, 'inherited counters are not the first turn spend');
  f.write([usage(1000, 100), start('one'), usage(1100, 100), usage(1100, 100), end('one')]);
  assert.equal(f.read()[0].tokens, 100, 'legacy cumulative differences remain supported');
  f.write([start('one'), usage(100, 100), end('one')], {...header, payload: {...header.payload, forked_from_id: 'parent'}});
  assert.equal(f.read()[0].tokens, null, 'forked history cannot prove a zero starting point');
});
