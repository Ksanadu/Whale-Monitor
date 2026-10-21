'use strict';

const path = require('node:path');
const {app, protocol} = require('electron');

if (!process.argv.includes('--token-monitor')) {
  process.env.WHALE_DESKTOP = '1';
  const dataDir = process.env.WHALE_MONITOR_DATA_DIR || path.join(app.getPath('appData'), 'Whale Monitor');
  app.setPath('userData', dataDir);
  process.env.TOKEN_MONITOR_SHARED_DIR = dataDir;
  // The standalone desktop starts in local mode even if an unrelated shell
  // happens to carry hub configuration. Sync remains opt-in in its settings.
  delete process.env.TOKEN_MONITOR_HUB_URL;
  delete process.env.TOKEN_MONITOR_SECRET;
  protocol.registerSchemesAsPrivileged([{scheme: 'whale', privileges: {standard: true, secure: true, supportFetchAPI: true}}]);
}
require('../main');
