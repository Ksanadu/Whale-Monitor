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

test('adding a completed session title preserves separate cost lines and explicit inline groups', () => {
  for (const modules of [
    [{type:'text',text:'上一轮对话消耗:'},{type:'text',text:'¥ 1.23'},{type:'today',tpl:'今日已用'}],
    [{type:'text',text:'消耗',row:1},{type:'text',text:'¥ 1.23',row:1},{type:'today',tpl:'今日已用'}]
  ]) {
    let rendered;
    const context = vm.createContext({window:{},usageTurnCostLines:()=>modules,
      usageAlertModsResolved:value=>JSON.parse(JSON.stringify(value)),usageCostValue:()=> '1.23',
      bubbleRenderModules:value=>{rendered=value;},WAIT_SESSION_MAX:24});
    vm.runInContext(section(widget,'function bubbleRowKeyOf(m) {','// F2 行模型→'), context);
    vm.runInContext(section(widget,'function bubbleRenderCostMods(amount, sessionName, tokens) {','// 等待交互提示'), context);
    const expectedRows=context.bubbleRowsOf(modules).length+1;
    context.bubbleRenderCostMods(1.23,'需要显示任务完成状态的对话');
    assert.equal(context.bubbleRowsOf(rendered).length,expectedRows,'completion title must not merge unrelated content into one oversized line');
  }
});

test('queued desktop completions retain their own token count and use the daily card typography', () => {
  const usage = require('../../src/electron/renderer/whale/usage');
  const queued = [], rendered = [];
  const context = vm.createContext({window:{whaleDesktop:true,whaleLocalUsage:usage},
    bubbleOn:true,turnCostOn:true,turnCostCloseMs:0,soundEventCfg:()=>({}),sysFrameIdOf:()=>'',
    whaleSysPush:item=>queued.push(item),sceneOpen:(_kind,render)=>render(),
    bubbleRenderModules:modules=>rendered.push(modules)});
  vm.runInContext(section(widget,'function showCostBubble(amount, sessionName, tokens) {','function hideCostBubble()'),context);
  vm.runInContext(section(widget,'function whaleSysOpenItem(item) {','function whaleSysPush(item) {'),context);
  vm.runInContext(section(widget,'function bubbleRenderCostMods(amount, sessionName, tokens) {','// 等待交互提示'),context);
  context.showCostBubble(1.23,'first task',123456);
  context.showCostBubble(9.99,'second task',0);
  context.whaleSysOpenItem(queued[1]);
  context.whaleSysOpenItem(queued[0]);
  assert.deepEqual(rendered.map(modules=>modules.map(module=>module.text)),[
    ['任务已完成','花费Token：','0'],['任务已完成','花费Token：','123.46K']
  ]);
  const daily=usage.defaultModules();
  for(const modules of rendered){
    assert(modules.every(module=>module.fontFamily===daily[0].fontFamily));
    assert.equal(modules[0].size,daily[0].size);
    assert.equal(modules[2].size,daily[1].size);
  }
});

test('only the statistics main frame can inspect or change the whale display', () => {
  let advances=0;
  const contents={mainFrame:{}};
  const context=vm.createContext({WHALE_DESKTOP:true,mainWindow:{isDestroyed:()=>false,webContents:contents},
    whaleDesktop:{displayState:()=>({count:2,index:1}),nextDisplay:()=>{advances++;return {count:2,index:2};}}});
  vm.runInContext(section(main,'function whaleDisplayForMonitor(event, advance) {',"  ipcMain.handle('whale:display'"),context);
  const trusted={sender:contents,senderFrame:contents.mainFrame};
  assert.equal(context.whaleDisplayForMonitor(trusted,false).index,1);
  assert.equal(context.whaleDisplayForMonitor(trusted,true).index,2);
  for(const event of [{sender:{},senderFrame:contents.mainFrame},{sender:contents,senderFrame:{}}]){
    assert.throws(()=>context.whaleDisplayForMonitor(event,true),/Untrusted/);
  }
  context.WHALE_DESKTOP=false;
  assert.throws(()=>context.whaleDisplayForMonitor(trusted,true),/Untrusted/);
  assert.equal(advances,1);
});

test('settings display changes cycle screens, persist the selection and survive removal', () => {
  const controller=fs.readFileSync(path.join(__dirname,'../../src/electron/whale/controller.js'),'utf8');
  let displays=[{id:1},{id:2}],saved,placements=0;
  const context=vm.createContext({screen:{getAllDisplays:()=>displays,getPrimaryDisplay:()=>displays[0]},
    displayId:1,win:{isDestroyed:()=>false},fs:{writeFileSync:(_path,value)=>{saved=JSON.parse(value);}},
    stateFile:'state',place:()=>{placements++;}});
  vm.runInContext(section(controller,'function display() {','  const trusted ='),context);
  vm.runInContext(section(controller,'function displayState() {','  function place() {'),context);
  assert.equal(context.nextDisplay().index,2);
  assert.equal(saved.displayId,2);
  assert.equal(context.nextDisplay().index,1);
  assert.equal(placements,2);
  context.nextDisplay();
  displays=[{id:1}];
  assert.equal(context.displayState().index,1);
  assert.equal(context.nextDisplay().count,1);
});

test('desktop menu gestures open the native monitor without replaying size or anchors', () => {
  for (const desktop of [true, false]) {
    let reads = 0, opened = 0;
    const position = {left: 300, top: 400};
    const context = vm.createContext({window: {whaleDesktop: desktop ? {openMonitor:()=>{opened++;}} : null}, menuOpen: false, menuBtnHide: true,
      menuBox: {classList: {toggle() {}}}, positionMenu() {}, closeUsagePanel() {}, closeAboutPanel() {},
      resyncSizeCfg() { reads++; position.left = 0; position.top = 0; }});
    vm.runInContext(section(widget, 'function toggleMenu() {', '\nfunction closeMenu()'), context);
    context.toggleMenu();
    assert.equal(context.menuOpen, !desktop);
    context.toggleMenu();
    assert.equal(context.menuOpen, false);
    assert.equal(reads, desktop ? 0 : 2, 'web plugin retains its original synchronization');
    assert.equal(opened, desktop ? 2 : 0);
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
