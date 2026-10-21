'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {resolveSqlite, openDb} = require('../../shared/sqliteReadOnly');
const {isSafeSessionId} = require('../../shared/sessionFiles');
const {discoverCompletionFiles} = require('../../shared/providers/codex/sessionActivity');
const {codexSessionIdentity} = require('../../shared/providers/codex/sessionIdentity');
const {readCodexSessionState} = require('../../shared/providers/codex/sessionContext');
const {readCompletionSignals} = require('../../shared/providers/opencode/session');
const {antigravityConversationSummaryCandidates} = require('../../shared/providers/antigravity/sessionMetadata');

function readCodexSignals(options = {}) {
  const rows = [];
  const files = options.codexFiles || discoverCompletionFiles({homeDir: options.home || os.homedir(), env: options.env || process.env, now: options.now});
  for (const entry of [...(files instanceof Map ? files.values() : files)].slice(0, 256)) {
    const file = typeof entry === 'string' ? entry : entry.file;
    const identity = codexSessionIdentity(file);
    if (identity.subagent || !identity.id) continue;
    for (const completion of readCodexSessionState(file, options.codexDeps).completions || []) {
      rows.push({provider: 'codex', sessionId: identity.id, ...completion, completed: true});
    }
  }
  return rows;
}

function readOpenCodeSignals(options = {}) {
  return readCompletionSignals({env: options.env || process.env, dbPaths: options.opencodeDbPaths, sqlite: options.sqlite})
    .map(row => ({provider: 'opencode', ...row, completed: true}));
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function readZcodeSignals(options = {}) {
  const sqlite = resolveSqlite(options), rows = [];
  if (!sqlite) return rows;
  const paths = options.zcodeDbPaths || [path.join(options.home || os.homedir(), '.zcode/cli/db/db.sqlite')];
  for (const file of paths.slice(0, 16)) {
    if (!fs.existsSync(file)) continue;
    let db;
    try {
      db = openDb(file, sqlite);
      db.exec('BEGIN');
      if (!hasTable(db, 'turn_usage')) {
        rows.push(...readCompletionSignals({dbPaths: [file], sqlite}).map(row => ({provider: 'zcode', ...row, completed: true})));
        continue;
      }
      let childFilter = hasTable(db, 'session_task_link')
        ? 'AND NOT EXISTS (SELECT 1 FROM session_task_link l WHERE l.child_session_id = s.id)' : '';
      if (hasTable(db, 'dwf_actor')) childFilter += ' AND NOT EXISTS (SELECT 1 FROM dwf_actor a WHERE a.session_id = s.id)';
      const found = db.prepare(`SELECT t.session_id AS sessionId, t.turn_id AS key,
        t.completed_at AS completedAt, t.computed_total_tokens AS tokens
        FROM turn_usage t JOIN session s ON s.id = t.session_id
        WHERE (s.parent_id IS NULL OR s.parent_id = '') AND s.time_archived IS NULL
          AND t.status = 'completed' AND COALESCE(t.cancelled_by_user, 0) = 0
          AND t.error_type IS NULL AND t.error_code IS NULL
          AND COALESCE(t.context_exceeded, 0) = 0 AND COALESCE(t.tool_error_count, 0) = 0
          AND t.completed_at > 0 ${childFilter}
        ORDER BY t.completed_at DESC LIMIT 512`).all();
      rows.push(...found.map(row => ({provider: 'zcode', ...row, sessionId: String(row.sessionId), key: String(row.key), completed: true})));
    } catch (_) { /* Unsupported or locked stores do not prove completion. */ }
    finally { if (db) { try { db.close(); } catch (_) {} } }
  }
  return rows;
}

function timeMs(value) {
  const number = typeof value === 'number' || /^\d+$/.test(value || '') ? Number(value) : Date.parse(value || '');
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Verified against the local language server's embedded protobuf descriptors:
// DONE=3, CANCELED=6, ERROR=7, INTERRUPTED=12; planner response=15, notify=82.
function readAntigravitySignals(options = {}) {
  const sqlite = resolveSqlite(options), rows = [];
  if (!sqlite) return rows;
  const paths = options.antigravityDbPaths || antigravityConversationSummaryCandidates({home: options.home || os.homedir(), env: options.env || process.env});
  for (const file of paths.slice(0, 16)) {
    if (!fs.existsSync(file)) continue;
    let db;
    try {
      db = openDb(file, sqlite);
      const summaries = db.prepare(`SELECT conversation_id, status, not_fully_idle, killed,
        last_user_input_time, last_user_input_step_index
        FROM conversation_summaries WHERE COALESCE(parent_conversation_id, '') = ''
          AND COALESCE(nesting_depth, 0) = 0 ORDER BY last_user_input_time DESC LIMIT 128`).all();
      for (const row of summaries) {
        if (!isSafeSessionId(row.conversation_id) || !Number.isInteger(row.last_user_input_step_index) || row.last_user_input_step_index < 0) continue;
        const candidate = {provider: 'antigravity', sessionId: row.conversation_id,
          key: String(row.last_user_input_step_index), completedAt: timeMs(row.last_user_input_time), tokens: null,
          completed: false, active: !row.killed && ['CASCADE_RUN_STATUS_RUNNING', 'CASCADE_RUN_STATUS_BUSY'].includes(row.status)};
        rows.push(candidate);
        if (row.status !== 'CASCADE_RUN_STATUS_IDLE' || row.not_fully_idle || row.killed) continue;
        const conversationFile = path.join(path.dirname(file), 'conversations', `${row.conversation_id}.db`);
        let conversation;
        try {
          conversation = openDb(conversationFile, sqlite);
          conversation.exec('BEGIN');
          const steps = conversation.prepare(`SELECT idx, step_type, status, LENGTH(error_details) AS errorBytes
            FROM steps WHERE idx > ? ORDER BY idx DESC LIMIT 2049`).all(row.last_user_input_step_index);
          const last = steps[0];
          candidate.completed = Boolean(last && steps.length <= 2048 && last.status === 3 && [2, 15, 82].includes(last.step_type)
            && !steps.some(step => [4, 6, 7, 12].includes(step.status) || step.step_type === 17 || step.errorBytes > 0));
        } catch (_) { /* Idle alone is never a successful completion. */ }
        finally { if (conversation) { try { conversation.close(); } catch (_) {} } }
      }
    } catch (_) { /* Keep working providers available when one source changes. */ }
    finally { if (db) { try { db.close(); } catch (_) {} } }
  }
  return rows;
}

module.exports = {readCodexSignals, readOpenCodeSignals, readZcodeSignals, readAntigravitySignals};
