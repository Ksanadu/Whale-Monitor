'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const signals = require('./agentSignals');
const {createCodexDesktopCompletions} = require('./codexDesktop');
const PROVIDERS = ['codex', 'opencode', 'zcode', 'antigravity'];

function createAgentWhaleEvents({emit, completionStateFile, intervalMs = 2500, now = Date.now,
  readers, logger = () => {}, ...options}) {
  const seen = new Map();
  const retired = {};
  const active = new Map();
  const startedAt = now();
  let initialized = false, stopped = false, timer;
  try {
    const stored = JSON.parse(fs.readFileSync(completionStateFile, 'utf8'));
    for (const id of (Array.isArray(stored.seen) ? stored.seen : []).slice(-8192)) {
      if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) seen.set(id, {provider: '', at: 0});
    }
    for (const provider of PROVIDERS) if (Number.isFinite(stored.retired?.[provider]) && stored.retired[provider] <= startedAt) retired[provider] = stored.retired[provider];
  } catch (_) { /* Startup always aligns silently, including a missing/corrupt journal. */ }
  const desktop = readers ? null : createCodexDesktopCompletions(options);
  const sources = readers || {
    codex: () => [...signals.readCodexSignals(options), ...desktop.read()], opencode: () => signals.readOpenCodeSignals(options),
    zcode: () => signals.readZcodeSignals(options), antigravity: () => signals.readAntigravitySignals(options)
  };

  function scan() {
    if (stopped) return;
    const pending = [];
    let dirty = false;
    for (const provider of PROVIDERS) {
      if (!sources[provider]) continue;
      let rows;
      try { rows = sources[provider](); } catch (_) { logger(`${provider} 完成信号暂时不可读`); continue; }
      const nextActive = new Set();
      for (const row of (Array.isArray(rows) ? rows : []).slice(0, 16384)) {
        if (!row || typeof row.sessionId !== 'string' || !row.sessionId || row.sessionId.length > 512
          || typeof row.key !== 'string' || !row.key || row.key.length > 512) continue;
        const id = crypto.createHash('sha256').update(JSON.stringify([provider, row.sessionId, row.key])).digest('hex');
        if (row.active === true) nextActive.add(id);
        if (row.completed !== true || seen.has(id)) continue;
        const wasActive = active.get(provider)?.has(id);
        if (Number.isFinite(row.completedAt) && row.completedAt <= (retired[provider] || 0) && !wasActive) continue;
        seen.set(id, {provider, at: Number.isFinite(row.completedAt) && row.completedAt <= now() ? row.completedAt : 0}); dirty = true;
        const fresh = Number.isFinite(row.completedAt) && row.completedAt >= startedAt && row.completedAt <= now() + 60000;
        if (!initialized || (!fresh && !wasActive)) continue;
        pending.push({id, provider, sessionId: row.sessionId,
          tokens: Number.isSafeInteger(row.tokens) && row.tokens >= 0 ? row.tokens : null});
      }
      active.set(provider, nextActive);
    }
    while (seen.size > 8192) {
      const [id, metadata] = seen.entries().next().value;
      retired[metadata.provider] = Math.max(retired[metadata.provider] || 0, metadata.at);
      seen.delete(id);
    }
    initialized = true;
    if (dirty && completionStateFile) {
      const temporary = `${completionStateFile}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify({version: 1, seen: [...seen.keys()], retired}));
        fs.renameSync(temporary, completionStateFile);
      } catch (_) { logger('完成提醒去重记录暂时无法保存'); return; }
    }
    for (const event of pending) emit('agent/completed', event);
  }
  return {
    scan,
    start() { if (timer || stopped) return; scan(); desktop?.start(); timer = setInterval(scan, intervalMs); timer.unref?.(); },
    stop() { stopped = true; clearInterval(timer); desktop?.stop(); active.clear(); }
  };
}

module.exports = {createAgentWhaleEvents};
