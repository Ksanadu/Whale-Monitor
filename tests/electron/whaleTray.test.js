'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {buildTrayIcon} = require('../../src/electron/tray');
const builder = require('../../scripts/whale-builder.config');
const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');

function section(start, end) {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert(from >= 0 && to > from);
  return main.slice(from, to);
}

test('whale tray loads the same shipped color artwork as the desktop shortcut at Windows DPI', () => {
  const iconPath = path.resolve(__dirname, '../..', builder.win.icon);
  assert(fs.statSync(iconPath).size > 0);
  const paths = [], sizes = [];
  const image = {resize(size) { sizes.push(size); return this; }};
  const nativeImage = {createFromPath(file) { paths.push(file); return image; }};
  for (const scaleFactor of [1, 1.5, 2]) {
    assert.equal(buildTrayIcon({platform: 'win32', nativeImage, iconPath, scaleFactor}), image);
  }
  assert.deepEqual(paths, [iconPath, iconPath, iconPath]);
  assert.deepEqual(sizes.map(size => size.height), [16, 24, 32]);
});

test('the whale main process caches its desktop icon instead of the absent upstream asset', () => {
  const calls = [], icon = {};
  const context = vm.createContext({defaultTrayIcon: null, WHALE_DESKTOP: true,
    WHALE_APP_ICON_PATH: path.resolve(__dirname, '../..', builder.win.icon),
    buildTrayIcon(options) { calls.push(options); return icon; }});
  vm.runInContext(section('function getDefaultTrayIcon() {', '\nconst AGENT_PID_PATH'), context);
  assert.equal(context.getDefaultTrayIcon(), icon);
  assert.equal(context.getDefaultTrayIcon(), icon);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].iconPath, context.WHALE_APP_ICON_PATH);
});

test('statistics and custom tray refreshes keep whale artwork while upstream keeps provider icons', () => {
  for (const desktop of [true, false]) {
    for (const mode of ['tokens', 'custom', 'liveTokenRate']) {
      const images = [], tips = [], whale = {}, provider = {}, custom = {}, rate = {};
      const context = vm.createContext({WHALE_DESKTOP: desktop, APP_NAME: desktop ? 'Whale Monitor' : 'Token Monitor',
        tray: {isDestroyed: () => false, setImage: value => images.push(value), setToolTip: value => tips.push(value)},
        settings: {trayContent: mode}, latestStats: {}, process: {platform: 'win32'},
        providerTrayIcons: {claude: provider, custom, liveTokenRate: rate},
        refreshTrayContextMenu() {}, electronPresentationStats: value => value,
        normalizeCurrency: () => 'USD', compactTokenDisplayOptions: () => ({}),
        formatTrayText: () => '123 Tokens', isBarsTrayIconMode: () => false,
        trayShowsTitle: () => false, pickUsageTrayIconId: () => 'claude', getDefaultTrayIcon: () => whale});
      vm.runInContext(section('function updateTrayDisplay() {', '\nfunction recordDiagnosticEvent('), context);
      context.updateTrayDisplay();
      context.updateTrayDisplay();
      const expected = desktop ? whale : {tokens: provider, custom, liveTokenRate: rate}[mode];
      assert.deepEqual(images, [expected, expected]);
      assert(tips.every(tip => tip.startsWith(context.APP_NAME)));
    }
  }
});
