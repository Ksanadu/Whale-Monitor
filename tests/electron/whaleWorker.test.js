'use strict';

const {Worker} = require('node:worker_threads');
const {once} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('the standalone observer reads local files in a worker without a server', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-worker-'));
  const dir = path.join(root, 'project', 'session'); fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({type: 'session', id: 'local', createdAt: 1}) + '\n');
  const worker = new Worker(path.resolve(__dirname, '../../src/electron/whale/localEventsWorker.js'),
    {workerData: {sessionsRoot: root, intervalMs: 25, home: root,
      env: {HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, '.codex')}}});
  t.after(async () => { await worker.terminate(); fs.rmSync(root, {recursive: true, force: true}); });
  const messages = [];
  worker.on('message', message => messages.push(message));
  const timeout = AbortSignal.timeout(5000);
  while (!messages.some(message => message.ready)) await once(worker, 'message', {signal: timeout});
  assert.equal(messages.filter(message => message.name).length, 0);
  fs.appendFileSync(file, JSON.stringify({seq: 0, type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}}) + '\n');
  while (!messages.some(message => message.name)) await once(worker, 'message', {signal: timeout});
  const event = messages.find(message => message.name);
  assert.equal(event.name, 'session/event');
  assert.equal(event.args[0].id, 'local');
  assert.equal(event.args[1].data.reason.kind, 'completed');
  const exited = once(worker, 'exit', {signal: timeout});
  worker.postMessage('stop');
  assert.equal((await exited)[0], 0, 'normal shutdown closes all observers without forced termination');
});
