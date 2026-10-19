'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createWhaleService} = require('./service');
const {Worker} = require('node:worker_threads');
const {sanitizeRegions} = require('./geometry');
const {allowWhaleRequest, privateResponse} = require('./requestPolicy');
const {floatingAlwaysOnTopLevel} = require('../windowBehavior');
const {installWindowsNonActivatingInput} = require('../windowsNonActivatingInput');
const {normalizeSettingsCommand} = require('./settingsCommands');
const {desktopAbout} = require('./about');

const WHALE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: blob:; connect-src 'self'; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";

async function createWhaleDesktop({app, BrowserWindow, ipcMain, protocol, screen, shell, getStats, openMonitor, logger = () => {}}) {
  const testWindow = !app.isPackaged && process.env.WHALE_DESKTOP_TEST_WINDOW === '1';
  const dataDir = path.join(app.getPath('userData'), 'whale');
  const rendererDir = path.join(__dirname, '../renderer/whale');
  const service = await createWhaleService({dataDir, getStats});
  let win = null, displayId = null, disposed = false, editing = false;
  let commandId = 0;
  const commands = new Map();
  const stateFile = path.join(dataDir, 'desktop-window.json');
  try { displayId = JSON.parse(fs.readFileSync(stateFile, 'utf8')).displayId; } catch (_) {}
  function display() {
    return screen.getAllDisplays().find(item => String(item.id) === String(displayId)) || screen.getPrimaryDisplay();
  }
  const trusted = event => win && !win.isDestroyed() && event.sender === win.webContents
    && event.senderFrame === win.webContents.mainFrame;
  const onRegions = (event, payload) => {
    if (!trusted(event)) return;
    const regions = sanitizeRegions(payload?.rects, win.getBounds());
    win.setShape(regions.length ? regions : [{x: 0, y: 0, width: 1, height: 1}]);
    const nextEditing = payload?.editing === true;
    if (nextEditing !== editing) {
      editing = nextEditing;
      win.setFocusable(editing);
      if (editing) win.focus();
    }
  };
  const onOpenMonitor = event => { if (trusted(event)) openMonitor(); };
  const onSettingsReply = (event, reply) => {
    if (!trusted(event)) return;
    const pending = commands.get(reply?.id);
    if (!pending) return;
    commands.delete(reply.id);
    clearTimeout(pending.timer);
    if (reply.error) pending.reject(new Error('桌宠设置操作失败'));
    else pending.resolve(reply.value);
  };
  function settingsCommand(command, value, importedRole) {
    const normalized = normalizeSettingsCommand(command, value);
    if (!win || win.isDestroyed() || disposed || commands.size >= 8) return Promise.reject(new Error('桌宠暂时不可用'));
    return new Promise((resolve, reject) => {
      const id = ++commandId;
      const timer = setTimeout(() => { commands.delete(id); reject(new Error('桌宠设置响应超时')); }, 10000);
      commands.set(id, {resolve, reject, timer});
      win.webContents.send('whale:settingsCommand', {...normalized, id, ...(command === 'importRole' ? {file: importedRole} : {})});
    });
  }
  function displayState() {
    const displays = screen.getAllDisplays();
    return {count: displays.length, index: displays.findIndex(item => item.id === display().id) + 1};
  }
  function nextDisplay() {
    const displays = screen.getAllDisplays();
    if (!displays.length || !win || win.isDestroyed()) return displayState();
    const current = displays.findIndex(item => item.id === display().id);
    displayId = displays[(current + 1) % displays.length].id;
    fs.writeFileSync(stateFile, JSON.stringify({displayId}));
    place();
    return displayState();
  }
  function place() {
    if (!win || win.isDestroyed()) return;
    const target = display();
    win.setBounds(target.workArea);
    win.webContents.send('whale:displayChanged');
  }
  protocol.handle('whale', async request => {
    const url = new URL(request.url);
    if (!allowWhaleRequest(request)) return new Response('Forbidden', {status: 403});
    if (url.pathname.startsWith('/dsh-whale/')) {
      try {
        return privateResponse(await service.request(url.pathname + url.search, {method: request.method, signal: request.signal,
          body: ['GET', 'HEAD'].includes(request.method) ? null : Buffer.from(await request.arrayBuffer())}));
      } catch (error) { logger(error.message); return new Response('Local operation failed', {status: 500}); }
    }
    const files = {'/': 'index.html', '/desktop/desktop.js': 'desktop.js', '/desktop/desktop.css': 'desktop.css', '/desktop/usage.js': 'usage.js'};
    const file = files[url.pathname];
    if (!file || request.method !== 'GET') return new Response('Not found', {status: 404});
    const types = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'};
    return new Response(fs.readFileSync(path.join(rendererDir, file)), {headers: {'Content-Type': types[path.extname(file)], 'Content-Security-Policy': WHALE_CSP, 'Cache-Control': 'no-store'}});
  });
  win = new BrowserWindow({...display().workArea, title: 'Whale Monitor · 小鲸鱼', show: false,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    ...(testWindow ? {} : {type: 'toolbar'}), thickFrame: false, skipTaskbar: !testWindow, focusable: testWindow,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'}});
  win.setAlwaysOnTop(true, floatingAlwaysOnTopLevel());
  win.setShape([{x: 0, y: 0, width: 1, height: 1}]);
  installWindowsNonActivatingInput(win, {logger});
  win.webContents.setWindowOpenHandler(({url}) => {
    try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch (_) {}
    return {action: 'deny'};
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('console-message', event => { if (/error|failed|失败/i.test(String(event.message))) logger(String(event.message)); });
  win.webContents.on('render-process-gone', (_event, details) => logger('桌宠渲染退出：' + details.reason));
  win.once('ready-to-show', () => { if (!disposed) win.showInactive(); });
  ipcMain.on('whale:regions', onRegions);
  ipcMain.on('whale:openMonitor', onOpenMonitor);
  ipcMain.on('whale:settingsReply', onSettingsReply);
  screen.on('display-removed', place);
  screen.on('display-metrics-changed', place);
  const events = new Worker(path.join(__dirname, 'localEventsWorker.js'));
  events.on('message', message => {
    if (disposed) return;
    if (message.error) logger(message.error);
    else if (message.name) service.emit(message.name, ...message.args);
  });
  events.on('error', error => logger('本地事件监听停止：' + error.message));
  await win.loadURL('whale://app/');
  return {
    displayState,
    nextDisplay,
    settingsCommand,
    about: () => desktopAbout({app, service, getStats, visible: Boolean(win && !win.isDestroyed() && win.isVisible()), display: displayState()}),
    show() { if (win && !win.isDestroyed()) { place(); win.showInactive(); } },
    toggle() { if (win && !win.isDestroyed()) { if (win.isVisible()) win.hide(); else win.showInactive(); } },
    isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
    owns: other => other === win,
    dispose() {
      disposed = true;
      for (const pending of commands.values()) { clearTimeout(pending.timer); pending.reject(new Error('桌宠已退出')); }
      commands.clear();
      void events.terminate(); service.dispose();
      for (const [name, fn] of [['whale:regions', onRegions], ['whale:openMonitor', onOpenMonitor], ['whale:settingsReply', onSettingsReply]]) ipcMain.removeListener(name, fn);
      screen.removeListener('display-removed', place); screen.removeListener('display-metrics-changed', place);
      protocol.unhandle('whale');
      if (win && !win.isDestroyed()) win.destroy();
    }
  };
}

module.exports = {WHALE_CSP, createWhaleDesktop};
