'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {normalizeSettingsCommand} = require('../../src/electron/whale/settingsCommands');
const {desktopAbout, brandDesktopDiagnostic} = require('../../src/electron/whale/about');
const vm = require('node:vm');

test('desktop appearance commands reject arbitrary actions, files and malformed values', () => {
  for (const [command, value] of [['eval', 'code'], ['scale', '1'], ['scale', NaN], ['scale', 3],
    ['role', '../credentials'], ['bubble', 1], ['scrollGap', 'true'], ['scrollGapPx', -1], ['scrollGapPx', 1.5]]) {
    assert.throws(() => normalizeSettingsCommand(command, value), /Invalid whale/);
  }
  assert.deepEqual(normalizeSettingsCommand('importRole', {path: 'credentials.json'}), {command: 'importRole'}, 'only a native file dialog can supply role bytes');
  assert.deepEqual(normalizeSettingsCommand('scale', 2.5), {command: 'scale', value: 2.5});
  assert.deepEqual(normalizeSettingsCommand('bubble', false), {command: 'bubble', value: false});
  assert.deepEqual(normalizeSettingsCommand('role', 'default'), {command: 'role', value: 'default'});
});

test('desktop about information uses packaged metadata and exposes only file facts and public usage totals', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-about-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({key: 'must-never-reach-about'}));
  const calls = [];
  const app = {isPackaged: true, getVersion: () => '0.75.7', getAppPath: () => root,
    getPath: key => key === 'userData' ? root : path.join(root, 'Whale Monitor.exe')};
  const result = await desktopAbout({app, service: {request: async route => {
    calls.push(route); return Response.json({ok: true, ignoredSecret: 'must-never-reach-about'});
  }}, getStats: () => ({periods: {today: {totalTokens: 12345}}, secret: 'must-never-reach-about'}),
  visible: true, display: {count: 2, index: 1}});
  assert.equal(result.name, 'Whale Monitor');
  assert.equal(result.version, '0.75.7');
  assert.equal(result.todayTokens, 12345);
  assert.equal(result.repository, 'https://github.com/Ksanadu/Whale-Monitor');
  assert(result.checks.every(check => check.ok));
  assert.equal(calls.length, 4);
  assert(result.files.find(file => file.label === '统计设置').bytes > 0);
  assert(!JSON.stringify(result).includes('must-never-reach-about'));
});

test('appearance replies must come from the pet and timed-out requests cannot apply late replies', async () => {
  const controller=fs.readFileSync(path.join(__dirname,'../../src/electron/whale/controller.js'),'utf8');
  const start=controller.indexOf('  const onSettingsReply ='),end=controller.indexOf('  function displayState()',start);
  const commands=new Map(),sent=[],timers=[];
  const context=vm.createContext({commands,commandId:0,disposed:false,normalizeSettingsCommand,
    trusted:event=>event.pet===true,win:{isDestroyed:()=>false,webContents:{send:(_name,payload)=>sent.push(payload)}},
    setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout(){}});
  vm.runInContext(controller.slice(start,end)+'\nglobalThis.reply=onSettingsReply;',context);
  const first=context.settingsCommand('bubble',false);
  context.reply({pet:false},{id:sent[0].id,value:'spoofed'});
  assert.equal(commands.size,1);
  context.reply({pet:true},{id:sent[0].id,value:{bubble:false}});
  assert.equal((await first).bubble,false);
  assert.equal(commands.size,0);
  const timed=context.settingsCommand('snapshot');
  const rejected=assert.rejects(timed,/响应超时/);
  timers[1]();
  await rejected;
  context.reply({pet:true},{id:sent[1].id,value:'late'});
  assert.equal(commands.size,0);
});

test('desktop diagnostic branding changes the report title while preserving its redacted payload and byte limit', () => {
  const original='Token Monitor Diagnostic Report\r\nschemaVersion: 1\r\nsource: Token Monitor\r\n[redacted]';
  const branded=brandDesktopDiagnostic(original);
  assert(branded.startsWith('Whale Monitor Diagnostic Report\r\n'));
  assert.equal(branded.slice(branded.indexOf('\r\n')),original.slice(original.indexOf('\r\n')));
  assert.equal(Buffer.byteLength(branded),Buffer.byteLength(original));
});
