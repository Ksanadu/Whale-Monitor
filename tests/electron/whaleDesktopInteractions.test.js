'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const widget = fs.readFileSync(path.join(__dirname, '../../src/electron/whale/vendor/assets/whale-widget.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from);
  return source.slice(from, to);
}

test('opening and closing the desktop menu never replays saved size or anchors', () => {
  for (const desktop of [true, false]) {
    let reads = 0;
    const position = {left: 300, top: 400};
    const context = vm.createContext({window: {whaleDesktop: desktop}, menuOpen: false, menuBtnHide: true,
      menuBox: {classList: {toggle() {}}}, positionMenu() {}, closeUsagePanel() {}, closeAboutPanel() {},
      resyncSizeCfg() { reads++; position.left = 0; position.top = 0; }});
    vm.runInContext(section(widget, 'function toggleMenu() {', '\nfunction closeMenu()'), context);
    context.toggleMenu();
    assert.equal(context.menuOpen, true);
    context.toggleMenu();
    assert.equal(context.menuOpen, false);
    assert.equal(reads, desktop ? 0 : 2, 'web plugin retains its original synchronization');
    if (desktop) assert.deepEqual(position, {left: 300, top: 400});
  }
});

test('the former ledger button opens the native monitor and never the legacy history panel', () => {
  let clicked, opened = 0, closed = 0;
  const button = {addEventListener(_name, fn) { clicked = fn; }};
  const context = vm.createContext({window: {whaleDesktop: {openMonitor() { opened++; }}},
    document: {createElement() { return button; }}, aboutPanelOpen: false,
    closeMenu() { closed++; }, toggleUsagePanel() { assert.fail('legacy ledger must be unreachable'); }});
  vm.runInContext(section(widget, 'var usageRecBtn = document.createElement', '// —— 任务结束音'), context);
  assert.equal(button.textContent, '统计与账户');
  clicked({stopPropagation() {}});
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test('an initially hidden monitor stays hidden across ready, load, failure and fallback events', () => {
  for (const initiallyHidden of [true, false]) {
    let reveals = 0;
    const timers = [];
    const target = new EventEmitter();
    target.webContents = new EventEmitter();
    target.loadFile = () => Promise.resolve();
    const context = vm.createContext({settings: {}, WHALE_DESKTOP: true, path, __dirname: '/test',
      floatingBubbleState: {collapsed: false}, ipcMain: new EventEmitter(),
      restoreWindowMaximizedForReveal: () => false, revealWindow: () => { reveals++; },
      applyZoomFactor() {}, console: {log() {}},
      setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}});
    vm.runInContext(section(main, 'function loadWindowFile(target, options = {}) {', '\nfunction createWindow('), context);
    context.loadWindowFile(target, {initiallyHidden});
    target.emit('ready-to-show');
    target.webContents.emit('did-finish-load');
    target.webContents.emit('did-fail-load', {}, -1, 'test');
    timers.forEach(fn => fn());
    assert.equal(reveals, initiallyHidden ? 0 : 1);
  }
});
