'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {createHash} = require('node:crypto');
const {createWhaleUpdater, latestWhaleRelease, installationKind, initializeWhaleUpdatePreference} = require('../../src/electron/whale/updater');
const {APP_ID, RELEASES_API} = require('../../src/electron/whale/releaseInfo');
const {verifyWhaleRelease} = require('../../scripts/verify-whale-release');
const {automaticAppUpdateControlState} = require('../../src/electron/renderer/appUpdatePresentation');
const {nextWhaleVersion} = require('../../scripts/next-whale-version');

const currentVersion = '0.74.0-whale.2', version = '0.74.0-whale.3';
function release(v = version, extra = {}) {
  return {tag_name: `v${v}`, draft: false, prerelease: true,
    assets: [`Whale-Monitor-${v}-x64-nsis.exe`, `Whale-Monitor-${v}-x64-portable.exe`, 'whale.yml'].map(name => ({name, size: 1234, state: 'uploaded'})), ...extra};
}

test('stable versions supersede previews and advance from the latest published stable release', () => {
  assert.equal(nextWhaleVersion([release('0.74.0-whale.6')]), '0.75.0');
  assert.equal(nextWhaleVersion([release('0.75.0', {prerelease: false}), release('0.76.0', {draft: true, prerelease: false})]), '0.75.1');
  assert.equal(latestWhaleRelease([release('0.74.0-whale.6'), release('0.75.0', {prerelease: false})], {currentVersion, installed: true}).version, '0.75.0');
});
function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-updater-'));
  const calls = [], native = new EventEmitter();
  native.setFeedURL = feed => calls.push(['feed', feed]);
  native.checkForUpdates = async () => ({isUpdateAvailable: true, updateInfo: {version,
    files: [{url: `Whale-Monitor-${version}-x64-nsis.exe`, sha512: Buffer.alloc(64, 1).toString('base64'), size: 1234}]}});
  native.downloadUpdate = async () => { calls.push(['download']); native.emit('download-progress', {percent: 51}); };
  native.quitAndInstall = (...args) => calls.push(['install', ...args]);
  let automatic = true;
  const make = overrides => createWhaleUpdater({dataDir, currentVersion, mode: 'installed',
    fetcher: async (url, init) => { calls.push(['fetch', url, init]); return Response.json([release()]); },
    openExternal: async url => calls.push(['open', url]), createNativeUpdater: () => native,
    isAutomatic: () => automatic, beforeInstall: () => { calls.push(['guard']); return true; }, ...options, ...overrides});
  const updater = make();
  t.after(() => { updater.stop(); fs.rmSync(dataDir, {recursive: true, force: true}); });
  return {dataDir, native, updater, calls, make, setAutomatic: value => { automatic = value; }};
}

test('installed build checks own GitHub release, pins feed, verifies then downloads and silently installs once', async t => {
  const f = fixture(t);
  await Promise.all([f.updater.check(), f.updater.check({manual: true})]);
  assert.equal(f.calls.filter(call => call[0] === 'fetch').length, 1);
  assert.equal(f.calls[0][1], RELEASES_API);
  assert.equal(f.calls[0][2].credentials, 'omit');
  assert.equal(f.calls.find(call => call[0] === 'feed')[1].url, `https://github.com/Ksanadu/Whale-Monitor/releases/download/v${version}/`);
  assert.deepEqual(f.calls.slice(-3), [['download'], ['guard'], ['install', true, true]]);
  assert.equal(f.native.autoDownload, false); assert.equal(f.native.allowDowngrade, false);
  await f.updater.check(); f.updater.install();
  assert.equal(f.calls.filter(call => call[0] === 'install').length, 1);
});

test('portable opens latest valid release only once across checks and restarts, never constructs an installer', async t => {
  const f = fixture(t, {mode: 'portable', createNativeUpdater: () => { throw new Error('Portable must not install'); }});
  await f.updater.check(); await f.updater.check();
  f.updater.stop(); const restarted = f.make({mode: 'portable'}); t.after(() => restarted.stop());
  await restarted.check();
  assert.equal(f.calls.filter(call => call[0] === 'open').length, 1);
  assert.equal(restarted.getState().installSupported, false);
  assert.equal(restarted.getState().latest.version, version);
});

test('portable browser errors are retryable and do not mark that version as opened', async t => {
  let attempts = 0;
  const f = fixture(t, {mode: 'portable', openExternal: async () => { if (++attempts === 1) throw new Error('No browser'); }});
  assert.equal((await f.updater.check()).lastError, 'No browser');
  await f.updater.check(); await f.updater.check(); assert.equal(attempts, 2);
});

test('disabled automatic preference stops background actions; disabling during download prevents installation', async t => {
  const f = fixture(t);
  f.setAutomatic(false); await f.updater.check(); assert.equal(f.calls.length, 0);
  await f.updater.check({manual: true}); assert(!f.calls.some(call => call[0] === 'download'));
  f.setAutomatic(true);
  f.native.downloadUpdate = async () => { f.setAutomatic(false); };
  assert.equal((await f.updater.check()).installPhase, 'downloaded');
  assert(!f.calls.some(call => call[0] === 'install'));
  f.updater.install(); assert(f.calls.some(call => call[0] === 'install'));
});

test('mismatched feed version or another executable fails closed before any download or install', async t => {
  const f = fixture(t);
  for (const info of [{version: '0.74.0-whale.1', files: []}, {version, files: [{url: 'Token-Monitor.exe', sha512: Buffer.alloc(64).toString('base64'), size: 1234}]}]) {
    f.native.checkForUpdates = async () => ({isUpdateAvailable: true, updateInfo: info});
    assert.equal((await f.updater.check()).installPhase, 'error');
  }
  assert(!f.calls.some(call => ['download', 'install'].includes(call[0])));
});

test('GitHub failure and failed download leave app running, and a later check can recover', async t => {
  let fail = true, aborted = 0;
  const f = fixture(t, {installFailed: () => aborted++});
  f.native.downloadUpdate = async () => { if (fail) throw new Error('Download failed'); };
  assert.equal((await f.updater.check()).installPhase, 'error');
  assert(!f.calls.some(call => call[0] === 'install'));
  fail = false; await f.updater.check(); assert(f.calls.some(call => call[0] === 'install')); assert(aborted > 0);
  const unavailable = f.make({fetcher: async () => new Response('', {status: 403})}); t.after(() => unavailable.stop());
  assert.match((await unavailable.check()).lastError, /403/);
});

test('quitting during a network check cancels it and cannot later install or open a browser', async t => {
  let finish;
  const f = fixture(t, {fetcher: () => new Promise(resolve => { finish = resolve; })});
  const checked = f.updater.check(); f.updater.stop(); finish(Response.json([release()])); await checked;
  assert(!f.calls.some(call => ['download', 'install', 'open'].includes(call[0])));
});

test('an install that stalls cannot repeatedly spawn installers and late shutdown errors are harmless', async t => {
  const f = fixture(t);
  await f.updater.check();
  f.updater.reportInstallFailure('Installer did not start');
  assert.equal(f.updater.getState().installRetryBlocked, true);
  await f.updater.check({manual: true}); f.updater.install();
  assert.equal(f.calls.filter(call => call[0] === 'install').length, 1);
  f.updater.noteHandoff(); assert.equal(f.updater.getState().installPhase, 'installing');
  f.updater.stop(); assert.doesNotThrow(() => f.native.emit('error', new Error('Late cancellation')));
});

test('release discovery ignores drafts, old versions, incomplete and unrelated release assets', () => {
  assert.equal(latestWhaleRelease([release('0.74.0-whale.1'), release(version, {draft: true}), release(version, {assets: []})], {currentVersion}), null);
  const incomplete = release(version); incomplete.assets = incomplete.assets.filter(asset => asset.name !== 'whale.yml');
  assert.equal(latestWhaleRelease([incomplete], {currentVersion, installed: true}), null);
  assert.equal(latestWhaleRelease([incomplete], {currentVersion}).version, version);
  assert.equal(latestWhaleRelease([release(version), release('0.74.0-whale.10')], {currentVersion}).version, '0.74.0-whale.10');
});

test('only an NSIS marker enables auto install; portable override and unpackaged builds cannot install', t => {
  const f = fixture(t);
  const execPath = path.join(f.dataDir, 'Whale Monitor.exe');
  const input = {isPackaged: true, platform: 'win32', env: {}, execPath};
  assert.equal(installationKind(input), 'portable');
  fs.writeFileSync(path.join(f.dataDir, 'whale-installation.json'), JSON.stringify({kind: 'nsis', appId: APP_ID}));
  assert.equal(installationKind(input), 'installed');
  assert.equal(installationKind({...input, env: {PORTABLE_EXECUTABLE_FILE: 'whale.exe'}}), 'portable');
  assert.equal(installationKind({...input, isPackaged: false}), 'unpackaged');
});

test('update preference migrates old disabled feature once and preserves subsequent opt-outs', () => {
  const settings = {automaticAppUpdates: false};
  assert(initializeWhaleUpdatePreference(settings)); assert.equal(settings.automaticAppUpdates, true);
  settings.automaticAppUpdates = false;
  assert.equal(initializeWhaleUpdatePreference(settings), false); assert.equal(settings.automaticAppUpdates, false);
  const control = automaticAppUpdateControlState({preferenceEnabled: true, updateState: {whaleDesktop: true, updateMode: 'portable', installSupported: false}});
  assert.equal(control.checked, true); assert.equal(control.disabled, false); assert.match(control.description, /只打开一次/);
});

test('release verifier binds NSIS bytes to SHA-512 metadata and rejects modified installers', t => {
  const f = fixture(t);
  const installer = `Whale-Monitor-${version}-x64-nsis.exe`, portable = `Whale-Monitor-${version}-x64-portable.exe`;
  const bytes = Buffer.from('test-only-installer');
  fs.writeFileSync(path.join(f.dataDir, installer), bytes); fs.writeFileSync(path.join(f.dataDir, portable), 'portable');
  fs.writeFileSync(path.join(f.dataDir, 'whale.yml'), JSON.stringify({version, files: [{url: installer, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64')}]}));
  verifyWhaleRelease(f.dataDir, version);
  assert(fs.readFileSync(path.join(f.dataDir, 'SHA256SUMS.txt'), 'utf8').includes(createHash('sha256').update(bytes).digest('hex')));
  fs.appendFileSync(path.join(f.dataDir, installer), 'tampered');
  assert.throws(() => verifyWhaleRelease(f.dataDir, version), /does not match/);
});
