'use strict';

const semver = require('semver');
const {VERSION} = require('../src/electron/whale/releaseInfo');

function nextWhaleVersion(releases, baseline = VERSION) {
  const published = releases.filter(release => !release.draft && !release.prerelease)
    .map(release => semver.valid(String(release.tag_name || '').replace(/^v/, '')))
    .filter(version => version && !semver.prerelease(version)).sort(semver.rcompare);
  return published[0] && semver.gte(published[0], baseline) ? semver.inc(published[0], 'patch') : baseline;
}

if (require.main === module) {
  const fs = require('node:fs');
  console.log(nextWhaleVersion(JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''))));
}
module.exports = {nextWhaleVersion};
