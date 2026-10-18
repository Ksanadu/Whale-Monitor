'use strict';

const packageJson = require('../package.json');
const {VERSION, OWNER, REPO} = require('../src/electron/whale/releaseInfo');
const semver = require('semver');
const version = process.env.WHALE_BUILD_VERSION || VERSION;
if (!semver.valid(version)) throw new Error('Invalid WHALE_BUILD_VERSION');

module.exports = {
  ...packageJson.build,
  appId: 'com.ksanadu.whalemonitor',
  productName: 'Whale Monitor',
  executableName: 'Whale Monitor',
  extraMetadata: {name: 'whale-monitor', version, productName: 'Whale Monitor'},
  artifactName: 'Whale-Monitor-${version}-${arch}-${target}.${ext}',
  directories: {output: 'dist/whale'},
  publish: [{provider: 'github', owner: OWNER, repo: REPO, channel: 'whale', releaseType: 'prerelease'}],
  generateUpdatesFilesForAllChannels: true,
  win: {target: [{target: 'portable', arch: ['x64']}, {target: 'nsis', arch: ['x64']}],
    icon: 'src/electron/whale/vendor/icon.png', signAndEditExecutable: true,
    // Releases currently have no Authenticode certificate. electron-updater
    // still verifies the SHA-512 in our HTTPS GitHub release manifest.
    verifyUpdateCodeSignature: false,
    signtoolOptions: {publisherName: 'Ksanadu'}},
  nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    include: 'scripts/nsis-whale-installer.nsh',
    artifactName: 'Whale-Monitor-${version}-${arch}-nsis.${ext}',
    createDesktopShortcut: true, shortcutName: 'Whale Monitor'},
  portable: {artifactName: 'Whale-Monitor-${version}-${arch}-portable.${ext}'},
  files: [...packageJson.build.files, 'src/electron/whale/vendor/**/*', 'LICENSE', 'README.md', 'README.whale.md', 'docs/whale-desktop.md']
};
