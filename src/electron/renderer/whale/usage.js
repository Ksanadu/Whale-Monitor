'use strict';

(function () {
  const fontFamily = 'Consolas, "Microsoft YaHei UI", monospace';
  const previousFontFamily = '"Segoe UI", "Microsoft YaHei UI", sans-serif';
  const fitted = new WeakMap();

  function defaultModules() {
    return [
      {type: 'today', tpl: '今日Token用量：{local_today_count}', size: 8, rgb: 'indigo'}
    ].map(module => ({...module, fontFamily}));
  }

  function tokensText(value) {
    return tokenCountText(value) + ' Tokens';
  }

  function tokenCountText(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    return new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 2}).format(value);
  }

  // Upgrade only a saved, unchanged factory card; custom modules/frames stay intact.
  function migrateFirst(items, originalModules) {
    const first = items?.[0];
    const previousUsage = [
      {type: 'text', text: '今日本机用量', size: 8, bold: true},
      {type: 'today', tpl: '{local_today_tokens}', size: 16, rgb: 'indigo'},
      {type: 'today', tpl: '估算费用 {expense_ds}', size: 6, color: '#9fb0d9'},
      {type: 'text', text: '已识别客户端合计', size: 4, color: '#9fb0d9'}
    ];
    const saved = JSON.stringify(first?.modules);
    const previousTypography = [
      {type: 'text', text: '今日本机用量', size: 4, bold: true},
      {type: 'today', tpl: '{local_today_tokens}', size: 8, rgb: 'indigo'},
      {type: 'today', tpl: '估算费用 {expense_ds}', size: 3, color: '#536ba9'},
      {type: 'text', text: '已识别客户端合计', size: 1, color: '#536ba9'}
    ].map(module => ({...module, fontFamily: previousFontFamily}));
    const previousTokenOnly = [{type: 'today', tpl: '{local_today_tokens}', size: 8, rgb: 'indigo', fontFamily: previousFontFamily}];
    if (first?.kind !== 'custom' || ![originalModules, previousUsage, previousTypography, previousTokenOnly].some(modules => saved === JSON.stringify(modules))) return items;
    return [{...first, modules: defaultModules()}, ...items.slice(1)];
  }

  function fitScale(width, height, contentWidth, contentHeight) {
    if (![width, height, contentWidth, contentHeight].every(value => Number.isFinite(value) && value > 0)) return 1;
    return Math.min(1, width / contentWidth, height / contentHeight);
  }

  function fitCard(parent) {
    if (!parent.classList.contains('whale-local-usage')) return;
    const rows = Array.from(parent.children).filter(row => row.classList.contains('dshwv-trow'));
    const width = parent.clientWidth, height = parent.clientHeight;
    if (!rows.length || !width || !height) return;
    const signature = JSON.stringify([width, height, rows.map(row => [row.textContent, row.getAttribute('style')])]);
    const previous = fitted.get(parent);
    if (previous?.signature === signature && previous.row === rows[0]) return;
    parent.style.setProperty('--whale-usage-fit', '1');
    let contentWidth = 0, contentHeight = 0;
    for (const row of rows) {
      const style = getComputedStyle(row);
      contentWidth = Math.max(contentWidth, row.scrollWidth);
      contentHeight += row.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }
    const scale = fitScale(Math.max(1, width - 8), Math.max(1, height - 8), contentWidth, contentHeight);
    parent.style.setProperty('--whale-usage-fit', String(Math.floor(scale * 1000) / 1000));
    fitted.set(parent, {signature, row: rows[0]});
  }

  const api = {defaultModules, tokensText, tokenCountText, migrateFirst, fitScale, fitCard};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.whaleLocalUsage = api;
})();
