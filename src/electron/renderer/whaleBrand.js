'use strict';

if (new URLSearchParams(location.search).get('whaleDesktop') === '1') {
  document.documentElement.classList.add('whale-desktop');
  document.title = 'Whale Monitor · 统计与账户';
  document.addEventListener('DOMContentLoaded', () => {
    for (const element of document.querySelectorAll('.app-title-text,.app-title-measure')) element.textContent = 'Whale Monitor';
    const automaticLabel = document.querySelector('#automaticAppUpdatesRow [data-i18n]');
    if (automaticLabel) {
      automaticLabel.removeAttribute('data-i18n');
      automaticLabel.textContent = '自动更新';
    }
    const panel = document.getElementById('settingsPanel');
    const group = document.createElement('div');
    group.className = 'settings-group whale-display-settings';
    const row = document.createElement('div');
    row.className = 'settings-item';
    const text = document.createElement('span');
    text.className = 'settings-item-text';
    const title = document.createElement('span');
    title.className = 'settings-item-title';
    title.textContent = '桌宠显示器';
    const status = document.createElement('span');
    status.className = 'settings-item-desc';
    status.setAttribute('role', 'status');
    text.append(title, status);
    const button = document.createElement('button');
    button.id = 'whaleNextDisplayButton';
    button.type = 'button';
    button.textContent = '切换显示器';
    row.append(text, button);
    group.append(row);
    panel.prepend(group);
    let busy = false;
    async function refreshDisplay(advance = false) {
      if (busy) return;
      busy = true;
      button.disabled = true;
      try {
        const state = await window.tokenMonitor[advance ? 'nextWhaleDisplay' : 'getWhaleDisplay']();
        status.textContent = state.count > 1 ? `显示器 ${state.index} / ${state.count}` : '当前仅连接一台显示器';
        button.disabled = state.count <= 1;
      } catch (_) {
        status.textContent = '暂时无法读取显示器，请重试';
        button.disabled = false;
      } finally { busy = false; }
    }
    button.addEventListener('click', () => void refreshDisplay(true));
    new MutationObserver(() => {
      if (!panel.classList.contains('hidden')) void refreshDisplay();
    }).observe(panel, {attributes: true, attributeFilter: ['class']});
    addEventListener('focus', () => { if (!panel.classList.contains('hidden')) void refreshDisplay(); });
    void refreshDisplay();
  }, {once: true});
}
