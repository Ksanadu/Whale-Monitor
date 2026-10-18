'use strict';

if (new URLSearchParams(location.search).get('whaleDesktop') === '1') {
  document.title = 'Whale Monitor · 统计与账户';
  document.addEventListener('DOMContentLoaded', () => {
    for (const element of document.querySelectorAll('.app-title-text,.app-title-measure')) element.textContent = 'Whale Monitor';
    const automaticLabel = document.querySelector('#automaticAppUpdatesRow [data-i18n]');
    if (automaticLabel) {
      automaticLabel.removeAttribute('data-i18n');
      automaticLabel.textContent = '自动更新';
    }
  }, {once: true});
}
