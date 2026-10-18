'use strict';

const packageJson = require('../package.json');

module.exports = {
  ...packageJson.build,
  appId: 'com.ksanadu.whalemonitor',
  productName: 'Whale Monitor',
  executableName: 'Whale Monitor',
  extraMetadata: {name: 'whale-monitor', version: '0.74.0-whale.1', productName: 'Whale Monitor'},
  artifactName: 'Whale-Monitor-${version}-${arch}-${target}.${ext}',
  directories: {output: 'dist/whale'},
  publish: null,
  win: {target: [{target: 'portable', arch: ['x64']}, {target: 'nsis', arch: ['x64']}],
    icon: 'src/electron/whale/vendor/icon.png', signAndEditExecutable: true,
    signtoolOptions: {publisherName: 'Ksanadu'}},
  nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    include: 'scripts/nsis-whale-installer.nsh',
    artifactName: 'Whale-Monitor-${version}-${arch}-nsis.${ext}',
    createDesktopShortcut: true, shortcutName: 'Whale Monitor'},
  portable: {artifactName: 'Whale-Monitor-${version}-${arch}-portable.${ext}'},
  files: [...packageJson.build.files, 'src/electron/whale/vendor/**/*', 'LICENSE', 'README.md', 'README.whale.md', 'docs/whale-desktop.md']
};
