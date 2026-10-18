'use strict';

(function () {
  function defaultModules() {
    return [
      {type: 'text', text: '今日本机用量', size: 8, bold: true},
      {type: 'today', tpl: '{local_today_tokens}', size: 16, rgb: 'indigo'},
      {type: 'today', tpl: '估算费用 {expense_ds}', size: 6, color: '#9fb0d9'},
      {type: 'text', text: '已识别客户端合计', size: 4, color: '#9fb0d9'}
    ];
  }

  function tokensText(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '— Tokens';
    return new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 2}).format(value) + ' Tokens';
  }

  // Upgrade only a saved, unchanged factory card; custom modules/frames stay intact.
  function migrateFirst(items, originalModules) {
    const first = items?.[0];
    if (first?.kind !== 'custom' || JSON.stringify(first.modules) !== JSON.stringify(originalModules)) return items;
    return [{...first, modules: defaultModules()}, ...items.slice(1)];
  }

  const api = {defaultModules, tokensText, migrateFirst};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.whaleLocalUsage = api;
})();
