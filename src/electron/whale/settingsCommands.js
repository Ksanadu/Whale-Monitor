'use strict';

const ACTIONS = new Set(['snapshot', 'sound', 'pressBubble', 'snap', 'resources', 'importRole']);

function normalizeSettingsCommand(command, value) {
  if (ACTIONS.has(command)) return {command};
  if (command === 'scale' && typeof value === 'number' && Number.isFinite(value) && value >= 0.6 && value <= 2.5) return {command, value};
  if (command === 'role' && typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)) return {command, value};
  if (['bubble', 'scrollGap'].includes(command) && typeof value === 'boolean') return {command, value};
  if (command === 'scrollGapPx' && Number.isInteger(value) && value >= 0 && value <= 1000) return {command, value};
  throw new Error('Invalid whale settings command');
}

module.exports = {normalizeSettingsCommand};
