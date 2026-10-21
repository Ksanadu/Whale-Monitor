'use strict';

const metadata = require('../../../package.json');

const VERSION = metadata.name === 'whale-monitor' ? metadata.version : '0.75.0';
const OWNER = 'Ksanadu';
const REPO = 'Whale-Monitor';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`;
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`;
const APP_ID = 'com.ksanadu.whalemonitor';

module.exports = {VERSION, OWNER, REPO, RELEASES_URL, RELEASES_API, APP_ID};
