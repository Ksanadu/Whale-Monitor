'use strict';

(function () {
  function createCompletionPoller({load, onComplete}) {
    let epoch = null, cursor = 0, pending = false;
    return async function poll() {
      if (pending) return;
      pending = true;
      try {
        const reply = await load(cursor);
        if (!reply?.ok || typeof reply.epoch !== 'string' || !Number.isSafeInteger(reply.seq) || reply.seq < 0 || !Array.isArray(reply.events)) return;
        if (epoch !== reply.epoch) { epoch = reply.epoch; cursor = reply.seq; return; }
        for (const event of [...reply.events].sort((a, b) => a.seq - b.seq)) {
          if (!Number.isSafeInteger(event.seq) || event.seq <= cursor || event.seq > reply.seq) continue;
          cursor = event.seq;
          if (!['codex', 'opencode', 'zcode', 'antigravity'].includes(event.provider) || !/^[a-f0-9]{64}$/.test(event.id || '')) continue;
          try { onComplete({...event, tokens: Number.isSafeInteger(event.tokens) && event.tokens >= 0 ? event.tokens : null}); } catch (_) { /* Never replay a sound because a card failed to render. */ }
        }
        cursor = Math.max(cursor, reply.seq);
      } catch (_) { /* Preserve the cursor and retry transient failures. */ }
      finally { pending = false; }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createCompletionPoller};
  if (typeof window !== 'undefined') window.whaleAgentCompletions = {createCompletionPoller};
})();
