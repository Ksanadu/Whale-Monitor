'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {VERSION, OWNER, REPO, RELEASES_URL} = require('./releaseInfo');
const {installationKind} = require('./updater');

async function desktopAbout({app, service, getStats, visible, display}) {
  const dataDir = app.getPath('userData');
  const mask = value => String(value).split(os.homedir()).join('%USERPROFILE%');
  const files = [
    ['程序', path.join(app.getAppPath(), 'package.json')],
    ['桌宠界面', path.join(__dirname, 'vendor/assets/whale-widget.js')],
    ['统计设置', path.join(dataDir, 'settings.json')],
    ['外观设置', path.join(dataDir, 'whale/.dshw-size.json')],
    ['气泡配置', path.join(dataDir, 'whale/.dshw-bubble.json')],
    ['提示与音效设置', path.join(dataDir, 'whale/.dshw-usage.json')],
    ['完成通知序号', path.join(dataDir, 'whale/.dshw-turn.json')],
    ['显示器设置', path.join(dataDir, 'whale/desktop-window.json')]
  ].map(([label, filename]) => {
    try {
      const stat = fs.statSync(filename);
      return {label, path: mask(filename), found: true, bytes: stat.size, modified: stat.mtime.toISOString()};
    } catch (_) { return {label, path: mask(filename), found: false}; }
  });
  const checks = await Promise.all(['/size.json', '/wait.json', '/roles.json', '/audio.json'].map(async route => {
    try {
      const response = await service.request('/dsh-whale' + route);
      const value = await response.json();
      return {route, ok: response.ok && value.ok !== false};
    } catch (_) { return {route, ok: false}; }
  }));
  const today = getStats()?.periods?.today;
  return {name: 'Whale Monitor', version: app.isPackaged ? app.getVersion() : VERSION,
    channel: app.isPackaged ? '正式版' : '开发版', platform: process.platform, arch: process.arch,
    electron: process.versions.electron || '—', chrome: process.versions.chrome || '—', node: process.versions.node,
    uptime: Math.round(process.uptime()), installation: installationKind({isPackaged: app.isPackaged}),
    dataDir: mask(dataDir), executable: mask(app.getPath('exe')), visible, display,
    todayTokens: typeof today?.totalTokens === 'number' ? today.totalTokens : null,
    repository: `https://github.com/${OWNER}/${REPO}`, releases: RELEASES_URL,
    checks, files, checkedAt: new Date().toISOString(),
    license: '代码采用 MIT 许可；内置美术与音效按原项目声明原样提供。',
    credits: '基于 Token Monitor 的本地统计能力与小鲸鱼桌宠界面，独立运行，无需 DSH 后端。'};
}

function brandDesktopDiagnostic(text) {
  return String(text).replace(/^Token Monitor Diagnostic Report(?=\r?\n|$)/, 'Whale Monitor Diagnostic Report');
}

module.exports = {desktopAbout, brandDesktopDiagnostic};
