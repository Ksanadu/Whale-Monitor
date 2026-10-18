'use strict';

const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const {OWNER, REPO, RELEASES_URL, RELEASES_API, APP_ID} = require('./releaseInfo');

function initializeWhaleUpdatePreference(settings) {
  if (settings.whaleUpdatesConfigured === true) return false;
  settings.automaticAppUpdates = true;
  settings.whaleUpdatesConfigured = true;
  return true;
}

function installationKind({isPackaged, platform = process.platform, env = process.env, execPath = process.execPath}) {
  if (!isPackaged || platform !== 'win32') return 'unpackaged';
  if (env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(path.dirname(execPath), 'whale-installation.json'), 'utf8'));
    if (marker.kind === 'nsis' && marker.appId === APP_ID) return 'installed';
  } catch (_) {}
  // Unpacked builds must never silently install themselves into the user's PC.
  return 'portable';
}

function latestWhaleRelease(releases, {currentVersion, installed = false}) {
  if (!Array.isArray(releases)) throw new Error('Invalid GitHub release response');
  return releases.flatMap(release => {
    const version = semver.valid(String(release.tag_name || '').replace(/^v/, ''));
    if (release.draft || !version || !semver.gt(version, currentVersion)) return [];
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assets.find(asset => asset.name === `Whale-Monitor-${version}-x64-nsis.exe` && asset.state === 'uploaded' && asset.size > 0);
    const portable = assets.find(asset => asset.name === `Whale-Monitor-${version}-x64-portable.exe` && asset.state === 'uploaded' && asset.size > 0);
    if (!installer || !portable || (installed && !assets.some(asset => asset.name === 'whale.yml' && asset.state === 'uploaded'))) return [];
    return [{version, tagName: release.tag_name, installerSize: installer.size,
      htmlUrl: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`, releaseNotes: {}}];
  }).sort((a, b) => semver.rcompare(a.version, b.version))[0] || null;
}

function validateNativeUpdate(result, latest) {
  const info = result?.updateInfo;
  if (!result?.isUpdateAvailable || info?.version !== latest.version) throw new Error('Update feed and release do not match');
  const files = Array.isArray(info.files) ? info.files : [];
  const expected = `Whale-Monitor-${latest.version}-x64-nsis.exe`;
  const installer = files.find(file => file.url === expected);
  if (!installer || Buffer.from(String(installer.sha512 || ''), 'base64').length !== 64 || installer.size !== latest.installerSize) {
    throw new Error('Invalid Whale Monitor installer metadata');
  }
  // NsisUpdater picks the first exe. Refuse manifests that could select another one.
  if (files.some(file => file !== installer && /\.exe(?:$|[?#])/i.test(file.url))) throw new Error('Ambiguous update installer');
}

function createWhaleUpdater({currentVersion, mode, dataDir, fetcher, openExternal,
  createNativeUpdater = () => new (require('electron-updater').NsisUpdater)({provider: 'github', owner: OWNER, repo: REPO, channel: 'whale'}),
  isAutomatic = () => true, beforeInstall = () => true, installFailed = () => {},
  onChange = () => {}, logger = () => {}, startupMs = 15000, intervalMs = 5 * 60 * 1000}) {
  const stateFile = path.join(dataDir, 'whale-updates.json');
  let remembered = {};
  try { remembered = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  let state = {latest: null, checking: false, installPhase: 'idle', installProgress: null,
    lastError: null, installError: null, lastCheckedAt: null};
  let pending = null, native = null, token = null, controller = null;
  let startup = null, interval = null, started = false, stopped = false, attempted = false;
  const handlers = [];
  function persist() {
    fs.mkdirSync(dataDir, {recursive: true});
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(remembered));
    fs.renameSync(stateFile + '.tmp', stateFile);
  }
  function getState() {
    const downloaded = state.installPhase === 'downloaded';
    return {...state, currentVersion, releasesUrl: RELEASES_URL, whaleDesktop: true, updateMode: mode,
      hasUpdate: Boolean(state.latest), showUpdateNotice: Boolean(state.latest), downloaded,
      installVersion: state.latest?.version || null, lastAttemptAt: state.lastCheckedAt,
      installSupported: mode === 'installed', installSupportReason: mode === 'portable' ? 'windows-portable' : mode === 'installed' ? null : 'unpackaged',
      installBusy: state.checking || ['downloading', 'installing'].includes(state.installPhase),
      installStarting: state.installPhase === 'installing', installRetryBlocked: attempted && state.installPhase === 'error',
      installErrorKind: attempted && state.installPhase === 'error' ? 'attempt-spent' : null};
  }
  function update(patch) {
    if (stopped) return;
    state = {...state, ...patch};
    onChange(getState());
  }
  function setupNative() {
    if (native) return native;
    native = createNativeUpdater();
    native.channel = 'whale'; native.allowDowngrade = false; native.allowPrerelease = true;
    native.autoDownload = false; native.autoInstallOnAppQuit = false;
    native.disableDifferentialDownload = true; native.disableWebInstaller = true;
    const progress = value => update({installProgress: Math.max(0, Math.min(100, Number(value.percent) || 0))});
    const error = value => {
      if (stopped) return;
      installFailed();
      update({installPhase: 'error', installError: value.message || String(value)});
    };
    for (const [name, fn] of [['download-progress', progress], ['error', error]]) {
      native.on(name, fn); handlers.push([name, fn]);
    }
    return native;
  }
  function install() {
    if (stopped || mode !== 'installed' || state.installPhase !== 'downloaded') return getState();
    if (attempted || !beforeInstall()) return getState();
    attempted = true;
    update({installPhase: 'installing', installError: null});
    try { native.quitAndInstall(true, true); }
    catch (error) { installFailed(); update({installPhase: 'error', installError: error.message}); }
    return getState();
  }
  async function perform({manual, installRequested}) {
    if (mode === 'unpackaged') return getState();
    update({checking: true, lastError: null, lastCheckedAt: new Date().toISOString()});
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    let latest;
    try {
      const response = await fetcher(RELEASES_API, {headers: {Accept: 'application/vnd.github+json'}, credentials: 'omit', signal: controller.signal});
      if (!response.ok) throw new Error(`GitHub release check failed (${response.status})`);
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new Error('Release metadata too large');
      latest = latestWhaleRelease(JSON.parse(text), {currentVersion, installed: mode === 'installed'});
    } finally { clearTimeout(timeout); controller = null; }
    if (stopped) return getState();
    const sameDownload = state.installPhase === 'downloaded' && state.latest?.version === latest?.version;
    update({checking: false, latest, installPhase: sameDownload ? 'downloaded' : 'idle', installError: null});
    if (!latest || (!isAutomatic() && !installRequested)) return getState();
    if (mode === 'portable') {
      if (manual || remembered.openedVersion !== latest.version) {
        await openExternal(latest.htmlUrl);
        if (!stopped) { remembered.openedVersion = latest.version; persist(); }
      }
      return getState();
    }
    if (!sameDownload) {
      const updater = setupNative();
      // Pin the manifest to the release already selected above, including
      // prereleases. A newer release appearing mid-download cannot change it.
      updater.setFeedURL({provider: 'generic', channel: 'whale', useMultipleRangeRequest: false,
        url: `${RELEASES_URL}/download/${encodeURIComponent(latest.tagName)}/`});
      const result = await updater.checkForUpdates();
      if (stopped) return getState();
      validateNativeUpdate(result, latest);
      token = result.cancellationToken;
      update({installPhase: 'downloading', installProgress: 0});
      await updater.downloadUpdate(token);
      if (stopped) return getState();
      update({installPhase: 'downloaded', installProgress: 100});
    }
    if (isAutomatic() || installRequested) install();
    return getState();
  }
  function check({manual = false, installRequested = false} = {}) {
    if (stopped || state.installPhase === 'installing' || (attempted && state.installPhase === 'error') || (!manual && !installRequested && !isAutomatic())) return Promise.resolve(getState());
    if (pending) return pending;
    pending = perform({manual, installRequested}).catch(error => {
      if (!stopped) {
        logger('[whale-update] ' + error.message);
        installFailed();
        update({checking: false, lastError: error.message, installPhase: 'error', installError: error.message});
      }
      return getState();
    }).finally(() => { pending = null; token = null; });
    return pending;
  }
  return {
    getState, check, install,
    reportInstallFailure(message) { update({installPhase: 'error', installError: message}); },
    noteHandoff() { update({installPhase: 'installing', installError: null}); },
    start() {
      if (started || stopped || mode === 'unpackaged') return;
      started = true;
      startup = setTimeout(() => void check(), startupMs); startup.unref?.();
      interval = setInterval(() => void check(), intervalMs); interval.unref?.();
    },
    stop() {
      stopped = true; clearTimeout(startup); clearInterval(interval); controller?.abort(); token?.cancel();
      // Keep the no-op error listener through cancellation/installer shutdown;
      // EventEmitter's late error must not become an uncaught exception.
      for (const [name, fn] of handlers) if (name !== 'error') native?.removeListener(name, fn);
    }
  };
}

module.exports = {initializeWhaleUpdatePreference, installationKind, latestWhaleRelease, validateNativeUpdate, createWhaleUpdater};
