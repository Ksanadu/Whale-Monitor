'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {createLocalWhaleEvents} = require('../../src/electron/whale/localEvents');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-events-'));
  const directory = path.join(root, 'project', 'session-test'); fs.mkdirSync(directory, {recursive: true});
  const file = path.join(directory, 'session.jsonl');
  const calls = [];
  const observer = createLocalWhaleEvents({sessionsRoot: root, emit: (...args) => calls.push(args)});
  t.after(() => { observer.stop(); fs.rmSync(root, {recursive: true, force: true}); });
  const write = records => fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const append = records => fs.appendFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return {file, root, calls, observer, write, append};
}
const header = {type: 'session', id: 'session-test', createdAt: 1};
const event = (seq, type, data) => ({seq, type, data, time: Date.now()});

test('existing history aligns silently; only appended durable records are dispatched once', t => {
  const f = fixture(t);
  f.write([header, event(0, 'turn/end', {turn: 1, reason: {kind: 'completed'}})]);
  f.observer.scan(); assert.equal(f.calls.length, 0);
  f.append([event(1, 'session/title', {title: '本地任务'}), event(2, 'turn/start', {turn: 2}), event(3, 'assistant/message', {turn: 2, usage: {inputTokens: 100}}), event(4, 'turn/end', {turn: 2, reason: {kind: 'completed'}})]);
  f.observer.scan();
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[3][1].title, '本地任务');
  f.observer.scan(); assert.equal(f.calls.length, 4);
});

test('truncated sessions rebaseline instead of replaying historical notifications', t => {
  const f = fixture(t);
  f.write([header, event(0, 'turn/start', {turn: 1}), event(1, 'assistant/message', {turn: 1})]);
  f.observer.scan();
  f.write([header]); f.observer.scan();
  assert.equal(f.calls.length, 0);
  f.append([event(0, 'turn/start', {turn: 2})]); f.observer.scan();
  assert.equal(f.calls.length, 1, 'new sequence after truncation remains observable');
});

test('a torn trailing record is dispatched only once its newline is committed', t => {
  const f = fixture(t);
  f.write([header]); f.observer.scan();
  fs.appendFileSync(f.file, JSON.stringify(event(0, 'turn/end', {turn: 1, reason: {kind: 'completed'}})));
  f.observer.scan(); assert.equal(f.calls.length, 0);
  fs.appendFileSync(f.file, '\n'); f.observer.scan();
  assert.equal(f.calls.length, 1);
});

test('versioned transcripts win over stale siblings and subagents are recognized', t => {
  const f = fixture(t);
  f.write([header, event(0, 'turn/start', {turn: 1})]);
  const preferred = path.join(path.dirname(f.file), 'session.v4.jsonl');
  fs.writeFileSync(preferred, JSON.stringify({...header, delegationDepth: 1}) + '\n');
  f.observer.scan();
  assert.equal(f.calls[0][0], 'subagent/start');
  f.append([event(1, 'turn/end', {turn: 1, reason: {kind: 'completed'}})]);
  f.observer.scan();
  assert(!f.calls.some(call => call[0] === 'session/event'));
});
