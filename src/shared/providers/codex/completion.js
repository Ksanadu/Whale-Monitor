'use strict';

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Runs inside the existing bounded rollout index, never a second transcript scan.
function applyCompletionRecord(state, entry, position) {
  if (entry.type !== 'event_msg' || !entry.payload) return;
  const p = entry.payload;
  if (p.type === 'token_count') {
    const total = p.info?.total_token_usage?.total_tokens;
    if (Number.isFinite(total) && total >= 0) state.completionTotal = total;
  } else if (p.type === 'task_started') {
    state.completionStart = state.completionTotal;
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
    const tokens = Number.isFinite(state.completionStart) && Number.isFinite(difference) && difference >= 0 ? difference : null;
    const key = String(turnId);
    const rows = (state.completions || []).filter(item => item.key !== key);
    rows.push({key, turnId: String(turnId), completedAt, tokens, position});
    state.completions = rows.slice(-64);
  }
}

module.exports = {applyCompletionRecord};
