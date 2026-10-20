'use strict';

const {createLocalUsageSource} = require('../../shared/providers/codex/localUsageSource');

// Reuse the existing read-only App Server protocol and local-executor admission.
// No usage ledger/observer lease is opened and no accounting setting is changed.
function createCodexDesktopCompletions(options = {}, deps = {}) {
  const rows = [];
  const store = {
    agentObserverRequested: () => false, claimObserver: () => true, releaseObserver() {},
    updateThread: () => false, observe: () => false
  };
  const source = createLocalUsageSource({...options, homeDir: options.home || options.homeDir, store,
    onCompletion: event => {
      rows.push({provider: 'codex', ...event, completed: true});
      if (rows.length > 128) rows.shift();
    }}, deps);
  return {start: source.start, stop: source.stop, read: () => [...rows],
    whenIdle: source.whenIdle, getDiagnostics: source.getDiagnostics};
}

module.exports = {createCodexDesktopCompletions};
