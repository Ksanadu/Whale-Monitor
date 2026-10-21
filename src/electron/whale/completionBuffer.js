'use strict';

const {randomUUID} = require('node:crypto');

function createCompletionBuffer() {
  const epoch = randomUUID(), events = [], seen = new Set();
  let seq = 0;
  return {
    push(event) {
      if (!event || !['codex', 'opencode', 'zcode', 'antigravity'].includes(event.provider)
        || !/^[a-f0-9]{64}$/.test(event.id || '') || seen.has(event.id)) return false;
      seen.add(event.id);
      while (seen.size > 8192) seen.delete(seen.values().next().value);
      events.push({seq: ++seq, id: event.id, provider: event.provider,
        tokens: Number.isSafeInteger(event.tokens) && event.tokens >= 0 ? event.tokens : null});
      if (events.length > 128) events.shift();
      return true;
    },
    read(after = 0) {
      const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
      return {ok: true, epoch, seq, events: events.filter(event => event.seq > cursor).map(event => ({...event}))};
    }
  };
}

module.exports = {createCompletionBuffer};
