'use strict';

const {parentPort, workerData} = require('node:worker_threads');
const {createLocalWhaleEvents} = require('./localEvents');
const {createAgentWhaleEvents} = require('./agentEvents');

// Transcript discovery/decompression never occupies Electron's UI thread.
const observer = createLocalWhaleEvents({...workerData,
  emit: (name, ...args) => parentPort.postMessage({name, args}),
  logger: message => parentPort.postMessage({error: message})});
observer.start();
const agents = createAgentWhaleEvents({...workerData,
  emit: (name, ...args) => parentPort.postMessage({name, args}),
  logger: message => parentPort.postMessage({error: message})});
agents.start();
parentPort.postMessage({ready: true});
parentPort.on('message', message => {
  if (message === 'stop') { observer.stop(); agents.stop(); parentPort.close(); }
});
