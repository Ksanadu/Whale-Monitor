'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {parseUpdateInfo} = require('electron-updater/out/providers/Provider');

function verifyWhaleRelease(directory, version) {
  const manifestFile = path.join(directory, 'whale.yml');
  const raw = fs.readFileSync(manifestFile, 'utf8');
  const manifest = parseUpdateInfo(raw, 'whale.yml', 'https://github.com/Ksanadu/Whale-Monitor/releases');
  if (manifest.version !== version) throw new Error('Manifest version does not match release version');
  const installer = `Whale-Monitor-${version}-x64-nsis.exe`;
  const portable = `Whale-Monitor-${version}-x64-portable.exe`;
  const entry = manifest.files?.find(file => file.url === installer);
  const bytes = fs.readFileSync(path.join(directory, installer));
  if (!entry || entry.size !== bytes.length || entry.sha512 !== createHash('sha512').update(bytes).digest('base64')) {
    throw new Error('Installer does not match update manifest');
  }
  if (manifest.files.some(file => file !== entry && /\.exe(?:$|[?#])/i.test(file.url))) throw new Error('Manifest includes another installer');
  const sums = [installer, portable].map(name => {
    const data = fs.readFileSync(path.join(directory, name));
    if (!data.length) throw new Error('Empty release asset');
    return `${createHash('sha256').update(data).digest('hex')}  ${name}`;
  });
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  // Keep stable and whale channels pointing to the same verified NSIS payload.
  fs.writeFileSync(path.join(directory, 'latest.yml'), raw);
  return {version, installer, portable};
}

if (require.main === module) {
  const {VERSION} = require('../src/electron/whale/releaseInfo');
  console.log(verifyWhaleRelease(process.argv[2] || 'dist/whale', process.argv[3] || process.env.WHALE_BUILD_VERSION || VERSION));
}
module.exports = {verifyWhaleRelease};
