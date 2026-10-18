'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {dshSessionFiles, decodeSessionText, resolveDshSessionsRoot} = require('../../shared/providers/dsh/sessionFiles');

// Uses Token Monitor's version selection and zstd decoder. Only new durable
// records reach the whale's accounting/notification logic; startup is silent.
function createLocalWhaleEvents({emit, sessionsRoot = resolveDshSessionsRoot(), intervalMs = 2500,
  maxFiles = 128, maxBytes = 32 * 1024 * 1024, logger = () => {}}) {
  const states = new Map();
  const startedAt = Date.now();
  let initialized = false, stopped = false, timer = null;
  function scan() {
    if (stopped) return;
    const candidates = [];
    const directories = new Set();
    for (const file of dshSessionFiles(sessionsRoot)) {
      const directory = path.dirname(file);
      if (directories.has(directory)) continue;
      directories.add(directory);
      try { const stat = fs.statSync(file); candidates.push({file, stat}); } catch (_) {}
    }
    candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const selected = candidates.slice(0, maxFiles);
    const retained = new Set();
    const sessions = new Set();
    for (const {file, stat} of selected) {
      retained.add(file);
      const previous = states.get(file);
      if (stat.size > maxBytes || (previous?.size === stat.size && previous?.mtime === stat.mtimeMs && previous?.ino === stat.ino)) continue;
      try {
        const text = decodeSessionText(file, fs.readFileSync(file));
        const lines = text.split(/\r?\n/);
        lines.pop(); // An uncommitted trailing record is retried on the next append.
        const records = lines.flatMap(line => {
          try { const record = JSON.parse(line); return record && typeof record === 'object' ? [record] : []; } catch (_) { return []; }
        });
        const header = records.find(record => record.type === 'session');
        if (!header?.id || sessions.has(header.id)) continue;
        sessions.add(header.id);
        let title = previous?.title || '';
        const reset = previous && (previous.ino !== stat.ino || stat.size < previous.size || previous.id !== header.id);
        let lastSeq = reset ? -1 : previous?.seq ?? -1;
        const baseline = !initialized || reset || (!previous && !(Number(header.createdAt) >= startedAt));
        const session = {id: header.id, title};
        if (Number(header.delegationDepth) > 0) emit('subagent/start', {id: header.id});
        let inheritedEnd = -1;
        if (header.isSeeded) for (const record of records) {
          if (record.type === 'session/end-seed' && record.data?.inherited === true) inheritedEnd = Math.max(inheritedEnd, Number(record.seq) || 0);
        }
        for (const record of records) {
          const seq = Number(record.seq);
          if (!Number.isFinite(seq)) continue;
          if (record.type === 'session/title' && typeof record.data?.title === 'string') { title = record.data.title; session.title = title; }
          if (!baseline && seq > lastSeq && seq > inheritedEnd && ['turn/start', 'turn/end', 'assistant/message', 'session/title', 'tool/call', 'tool/result', 'approval/asked', 'approval/decided'].includes(record.type)) {
            emit('session/event', session, {type: record.type, data: record.data || {}});
          }
          lastSeq = Math.max(lastSeq, seq);
        }
        states.set(file, {id: header.id, seq: lastSeq, title, size: stat.size, mtime: stat.mtimeMs, ino: stat.ino});
      } catch (error) { logger('本地会话暂时无法读取：' + error.message); }
    }
    for (const key of states.keys()) if (!retained.has(key)) states.delete(key);
    initialized = true;
  }
  return {
    scan,
    start() { scan(); timer = setInterval(scan, intervalMs); timer.unref?.(); },
    stop() { stopped = true; clearInterval(timer); states.clear(); }
  };
}

module.exports = {createLocalWhaleEvents};
