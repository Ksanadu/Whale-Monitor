'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {readCodexSignals, readOpenCodeSignals, readZcodeSignals, readAntigravitySignals} = require('../../src/electron/whale/agentSignals');
const {createAgentWhaleEvents} = require('../../src/electron/whale/agentEvents');

function fixture(t, cleanup = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-agents-'));
  t.after(() => { for (const close of cleanup) close(); fs.rmSync(root, {recursive: true, force: true}); });
  return root;
}

test('Codex observes explicit successful turns, keeps individual token deltas and excludes subagents', t => {
  const root = fixture(t), file = path.join(root, 'rollout.jsonl');
  const header = source => ({type: 'session_meta', payload: {id: 'native-root', source}});
  const entry = (type, extra = {}) => ({type: 'event_msg', timestamp: '2026-10-20T00:00:00Z', payload: {type, ...extra}});
  const usage = total_tokens => entry('token_count', {info: {total_token_usage: {total_tokens}}});
  const records = [header('cli'), usage(100), entry('task_started', {turn_id: 'one'}), usage(175), entry('task_complete', {turn_id: 'one'}),
    entry('task_started', {turn_id: 'two'}), usage(210), entry('task_complete', {turn_id: 'two'})];
  fs.writeFileSync(file, records.map(JSON.stringify).join('\n') + '\n');
  assert.deepEqual(readCodexSignals({codexFiles: [file]}).map(row => [row.key, row.tokens]), [['one', 75], ['two', 35]]);
  fs.appendFileSync(file, [entry('task_started', {turn_id: 'bad'}), entry('error'), entry('task_complete', {turn_id: 'bad'}),
    entry('task_started', {turn_id: 'cancel'}), entry('turn_aborted', {turn_id: 'cancel'}),
    entry('task_started', {turn_id: 'review', root_turn_id: 'parent', turn_attribution: {parent_turn_id: 'parent'}}),
    entry('task_complete', {turn_id: 'review', root_turn_id: 'parent'})].map(JSON.stringify).join('\n') + '\n');
  assert.equal(readCodexSignals({codexFiles: [file]}).length, 2);
  const child = path.join(root, 'child.jsonl');
  fs.writeFileSync(child, [header({subagent: {thread_spawn: {parent_thread_id: 'parent'}}}), ...records.slice(1)].map(JSON.stringify).join('\n'));
  assert.deepEqual(readCodexSignals({codexFiles: [child]}), []);
  fs.writeFileSync(file, JSON.stringify(header('cli')) + '\n');
  assert.deepEqual(readCodexSignals({codexFiles: [file]}), [], 'truncation cannot retain old completions');
});

function openCodeDb(t) {
  const cleanup = [], file = path.join(fixture(t, cleanup), 'opencode.db'), db = new DatabaseSync(file);
  cleanup.push(() => db.close());
  db.exec(`CREATE TABLE session_v2(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER,time_updated INTEGER,time_archived INTEGER,idle_outcome TEXT);
    CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT);
    INSERT INTO session_v2 VALUES ('root',NULL,1,10,NULL,NULL),('child','root',1,10,NULL,NULL);`);
  const add = (id, role, seq, data, session = 'root') => db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?,?,?)')
    .run(id, session, role, seq, seq, seq, JSON.stringify(data));
  return {file, db, add};
}

test('OpenCode tool calls are not completions; a normal stop aggregates the whole user turn', t => {
  const f = openCodeDb(t);
  f.add('user', 'user', 1, {});
  f.add('tool', 'assistant', 2, {finish: 'tool-calls', tokens: {input: 10, output: 5}, time: {completed: 100}});
  assert.deepEqual(readOpenCodeSignals({opencodeDbPaths: [f.file]}), []);
  f.add('final', 'assistant', 3, {finish: 'stop', tokens: {input: 20, output: 5, reasoning: 99}, time: {completed: 200}});
  f.add('child-user', 'user', 1, {}, 'child');
  f.add('child-final', 'assistant', 2, {finish: 'stop', time: {completed: 200}}, 'child');
  const rows = readOpenCodeSignals({opencodeDbPaths: [f.file]});
  assert.equal(rows.length, 1); assert.equal(rows[0].tokens, 40); assert.equal(rows[0].key, 'user');
  f.add('later-error', 'assistant', 4, {finish: 'stop', error: {name: 'MessageAbortedError'}, time: {completed: 210}});
  assert.deepEqual(readOpenCodeSignals({opencodeDbPaths: [f.file]}), [], 'a later error invalidates the same turn');
});

test('OpenCode refuses truncated, filtered, compaction and unfinished responses', t => {
  const f = openCodeDb(t);
  for (const [index, data] of [{finish: 'length'}, {finish: 'content-filter'}, {finish: 'stop', agent: 'compaction'}, {finish: 'stop'}].entries()) {
    f.add(`user-${index}`, 'user', index * 2, {});
    f.add(`assistant-${index}`, 'assistant', index * 2 + 1, index === 3 ? data : {...data, time: {completed: 100}});
  }
  assert.deepEqual(readOpenCodeSignals({opencodeDbPaths: [f.file]}), []);
});

test('OpenCode legacy subtask turns are excluded and migrated current sessions are never counted twice', t => {
  const f = openCodeDb(t);
  f.add('user', 'user', 1, {}); f.add('final', 'assistant', 2, {finish: 'stop', time: {completed: 200}});
  f.db.exec(`CREATE TABLE session(id TEXT,parent_id TEXT,time_created INTEGER,time_updated INTEGER,time_archived INTEGER);
    CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);
    CREATE TABLE part(id TEXT,session_id TEXT,message_id TEXT,data TEXT);
    INSERT INTO session VALUES ('root',NULL,1,2,NULL),('legacy',NULL,1,2,NULL);`);
  const add = f.db.prepare('INSERT INTO message VALUES(?,?,?,?)');
  add.run('old-user', 'root', 1, JSON.stringify({role: 'user'}));
  add.run('old-final', 'root', 2, JSON.stringify({role: 'assistant', finish: 'stop', time: {completed: 200}}));
  add.run('subtask', 'legacy', 1, JSON.stringify({role: 'user'}));
  add.run('subtask-final', 'legacy', 2, JSON.stringify({role: 'assistant', finish: 'stop', time: {completed: 200}}));
  f.db.prepare('INSERT INTO part VALUES(?,?,?,?)').run('p', 'legacy', 'subtask', JSON.stringify({type: 'subtask'}));
  assert.equal(readOpenCodeSignals({opencodeDbPaths: [f.file]}).length, 1);
  add.run('legacy-main', 'legacy', 3, JSON.stringify({role: 'user'}));
  add.run('legacy-final', 'legacy', 4, JSON.stringify({role: 'assistant', finish: 'stop', time: {completed: 300}}));
  assert.equal(readOpenCodeSignals({opencodeDbPaths: [f.file]}).length, 2);
});

test('ZCode admits only successful root turns, with explicit cancellations/errors/linked subtasks excluded', t => {
  const cleanup = [], file = path.join(fixture(t, cleanup), 'zcode.db'), db = new DatabaseSync(file);
  cleanup.push(() => db.close());
  db.exec(`CREATE TABLE session(id TEXT,parent_id TEXT,time_archived INTEGER);
    CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,cancelled_by_user INTEGER,error_type TEXT,error_code TEXT,context_exceeded INTEGER,tool_error_count INTEGER,completed_at INTEGER,computed_total_tokens INTEGER);
    CREATE TABLE session_task_link(child_session_id TEXT);
    CREATE TABLE dwf_actor(session_id TEXT);
    INSERT INTO session VALUES ('root',NULL,NULL),('child','root',NULL),('linked',NULL,NULL),('workflow',NULL,NULL);
    INSERT INTO session_task_link VALUES ('linked'); INSERT INTO dwf_actor VALUES ('workflow');`);
  const insert = db.prepare('INSERT INTO turn_usage VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const [id, status, cancelled, error, toolErrors] of [['ok', 'completed', 0, null, 0], ['cancel', 'completed', 1, null, 0],
    ['error', 'error', 0, 'failed', 0], ['recovered', 'completed', 0, null, 1]]) insert.run('root', id, status, cancelled, error, null, 0, toolErrors, 100, 200);
  for (const session of ['child', 'linked', 'workflow']) insert.run(session, 'ok', 'completed', 0, null, null, 0, 0, 100, 200);
  assert.deepEqual(readZcodeSignals({zcodeDbPaths: [file]}).map(row => [row.key, row.tokens]), [['ok', 200]]);
});

function antigravityDb(t) {
  const cleanup = [], root = fixture(t, cleanup), file = path.join(root, 'conversation_summaries.db');
  fs.mkdirSync(path.join(root, 'conversations'));
  const db = new DatabaseSync(file), conversation = new DatabaseSync(path.join(root, 'conversations/root.db'));
  cleanup.push(() => {db.close(); conversation.close();});
  db.exec(`CREATE TABLE conversation_summaries(conversation_id TEXT,status TEXT,not_fully_idle INTEGER,killed INTEGER,parent_conversation_id TEXT,nesting_depth INTEGER,last_user_input_time INTEGER,last_user_input_step_index INTEGER);
    INSERT INTO conversation_summaries VALUES ('root','CASCADE_RUN_STATUS_IDLE',0,0,NULL,0,100,0),('child','CASCADE_RUN_STATUS_IDLE',0,0,'root',1,100,0);`);
  conversation.exec('CREATE TABLE steps(idx INTEGER,step_type INTEGER,status INTEGER,error_details BLOB); INSERT INTO steps VALUES(1,15,3,NULL)');
  return {file, db, conversation};
}

test('Antigravity requires an idle root with a completed final response, not merely idle metadata', t => {
  const f = antigravityDb(t), read = () => readAntigravitySignals({antigravityDbPaths: [f.file]});
  assert.equal(read().length, 1); assert.equal(read()[0].completed, true);
  for (const status of [4, 6, 7, 12]) {
    f.conversation.prepare('UPDATE steps SET status=?').run(status);
    assert.equal(read()[0].completed, false);
  }
  f.conversation.exec('UPDATE steps SET status=3,step_type=132');
  assert.equal(read()[0].completed, false, 'completed tools are not final answers');
  f.conversation.exec('UPDATE steps SET step_type=15; INSERT INTO steps VALUES(0.5,17,3,NULL)');
  assert.equal(read()[0].completed, false, 'a turn with a durable error is suppressed');
  f.conversation.exec('DELETE FROM steps WHERE idx=0.5');
  f.db.exec('UPDATE conversation_summaries SET killed=1');
  assert.equal(read()[0].completed, false);
});

test('completion journal silently baselines history, deduplicates bursts and survives restarts', t => {
  const root = fixture(t), journal = path.join(root, 'seen.json'), calls = [];
  let rows = [{sessionId: 'root', key: 'old', completed: true, completedAt: 100}];
  const options = {completionStateFile: journal, now: () => 1000, readers: {codex: () => rows}, emit: (...args) => calls.push(args)};
  const observer = createAgentWhaleEvents(options);
  observer.scan(); assert.equal(calls.length, 0);
  rows = [...rows, ...['one', 'two', 'three'].map(key => ({sessionId: 'root', key, completed: true, completedAt: 1001, tokens: 0}))];
  observer.scan(); observer.scan(); assert.equal(calls.length, 3);
  assert(calls.every(call => call[1].tokens === 0));
  observer.stop(); observer.scan(); assert.equal(calls.length, 3);
  const durableRows = rows; rows = [];
  const restarted = createAgentWhaleEvents(options);
  restarted.scan(); rows = durableRows; restarted.scan(); assert.equal(calls.length, 3, 'a temporarily missing source after restart still uses the persisted ids');
  const persisted = JSON.parse(fs.readFileSync(journal));
  assert(persisted.seen.every(id => /^[a-f0-9]{64}$/.test(id)));
});

test('an Antigravity task already running at launch can finish, but renaming old idle history cannot notify', () => {
  let rows = [{sessionId: 'task', key: '1', completedAt: 100, completed: false, active: true}];
  const calls = [], observer = createAgentWhaleEvents({now: () => 1000, readers: {antigravity: () => rows}, emit: (...args) => calls.push(args)});
  observer.scan(); rows = [{...rows[0], completed: true, active: false}]; observer.scan();
  assert.equal(calls.length, 1);
  rows = [...rows, {sessionId: 'old-unreadable-at-startup', key: '1', completedAt: 100, completed: true}];
  observer.scan(); assert.equal(calls.length, 1);
});

test('completion journal remains bounded without replaying evicted completed turns', () => {
  let clock = 1000, rows = [];
  const calls = [], observer = createAgentWhaleEvents({now: () => clock, readers: {codex: () => rows}, emit: (...args) => calls.push(args)});
  observer.scan(); clock = 1002;
  rows = Array.from({length: 9000}, (_, index) => ({sessionId: 'root', key: String(index), completed: true, completedAt: 1001}));
  observer.scan(); assert.equal(calls.length, 9000);
  observer.scan(); assert.equal(calls.length, 9000);
});
