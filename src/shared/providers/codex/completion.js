'use strict';

function timestamp(value) {
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value));
  const parsed = numeric ? Number(value) * (Number(value) < 1e12 ? 1000 : 1) : Date.parse(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function tokenTotal(usage) {
  if (!usage || !['input_tokens', 'output_tokens', 'total_tokens'].every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) return null;
  const cached = usage.cached_input_tokens ?? 0, write = usage.cache_write_input_tokens ?? 0, reasoning = usage.reasoning_output_tokens ?? 0;
  if (![cached, write, reasoning].every(value => Number.isSafeInteger(value) && value >= 0)
    || cached + write > usage.input_tokens || reasoning > usage.output_tokens
    || usage.input_tokens + usage.output_tokens !== usage.total_tokens) return null;
  // Cached input and reasoning are already included in input/output.
  return usage.total_tokens;
}

// Runs inside the existing bounded rollout index, never a second transcript scan.
function applyCompletionRecord(state, entry, position) {
  if (entry.type === 'session_meta' && position === 0) {
    const p = entry.payload;
    state.completionFreshSession = Boolean(p?.id && !p.forked_from_id && !p.parent_thread_id && !p.parent_session_id);
    return;
  }
  if (entry.type === 'token_usage_record') {
    const p = entry.payload;
    if (!p || p.thread_id !== state.completionSessionId || typeof p.turn_id !== 'string' || !p.turn_id
      || p.root_turn_id !== p.turn_id || typeof p.response_id !== 'string' || !p.response_id) return;
    const total = tokenTotal(p.turn_token_usage);
    if (total === null) return;
    state.completionUsage ||= new Map();
    // Native turn counters are cumulative; repeats and out-of-order snapshots
    // must never add the same request twice or replace a later total.
    state.completionUsage.set(p.turn_id, Math.max(state.completionUsage.get(p.turn_id) ?? 0, total));
    if (state.completionUsage.size > 64) state.completionUsage.delete(state.completionUsage.keys().next().value);
    return;
  }
  if (entry.type !== 'event_msg' || !entry.payload) return;
  const p = entry.payload;
  if (p.type === 'token_count') {
    const total = p.info?.total_token_usage?.total_tokens;
    if (Number.isSafeInteger(total) && total >= 0) {
      if (state.completionFirstRequest) {
        // Full-file first turns can prove zero without trusting a repeated
        // last-request snapshot inherited from an older session or fork.
        if (tokenTotal(p.info.total_token_usage) === total && tokenTotal(p.info.last_token_usage) === total) state.completionStart = 0;
        state.completionFirstRequest = false;
      }
      state.completionTotal = total;
    }
  } else if (p.type === 'task_started') {
    state.completionStart = state.completionTotal;
    state.completionFirstRequest = state.completionFreshSession === true && !state.completionTurnId && !Number.isFinite(state.completionTotal);
    state.completionFreshSession = false;
    state.completionFailed = false;
    state.completionTurnId = p.turn_id || '';
    state.completionSubtask = Boolean(p.turn_attribution?.parent_turn_id
      || (p.root_turn_id && p.turn_id && p.root_turn_id !== p.turn_id));
  } else if (['turn_aborted', 'error', 'task_failed'].includes(p.type)) {
    state.completionFailed = true;
    const id = p.turn_id || state.completionTurnId;
    state.completions = (state.completions || []).filter(item => item.turnId !== id);
  } else if (p.type === 'task_complete') {
    const turnId = p.turn_id || state.completionTurnId;
    const completedAt = timestamp(p.completed_at) || timestamp(entry.timestamp);
    if (!turnId || !completedAt || state.completionFailed || state.completionSubtask || p.error
      || (p.root_turn_id && p.turn_id && p.root_turn_id !== p.turn_id)
      || (p.status && p.status !== 'completed')) return;
    const difference = state.completionTotal - state.completionStart;
    const tokens = state.completionUsage?.get(String(turnId))
      ?? (Number.isSafeInteger(state.completionStart) && Number.isSafeInteger(difference) && difference >= 0 ? difference : null);
    const key = String(turnId);
    const rows = (state.completions || []).filter(item => item.key !== key);
    rows.push({key, turnId: String(turnId), completedAt, tokens, position});
    state.completions = rows.slice(-64);
  }
}

module.exports = {applyCompletionRecord};
