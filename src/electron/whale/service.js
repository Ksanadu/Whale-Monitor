'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pathToFileURL} = require('node:url');
const {CredentialStore} = require('../../shared/credentialStore');
const {VERSION, RELEASES_URL} = require('./releaseInfo');
const {createCompletionBuffer} = require('./completionBuffer');

function createWhaleCredentials(dataDir) {
  const store = new CredentialStore(dataDir);
  const key = ref => {
    const value = String(ref || '');
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Invalid credential reference');
    return value;
  };
  return {
    async resolve(ref) {
      const value = store.readDocument().credentials.whale?.[key(ref)];
      return value ? {value} : null;
    },
    async set(ref, value) {
      const document = store.readDocument();
      document.credentials.whale ||= {};
      document.credentials.whale[key(ref)] = String(value);
      store.writeDocument(document);
    },
    async unset(ref) {
      const document = store.readDocument();
      if (document.credentials.whale) delete document.credentials.whale[key(ref)];
      store.writeDocument(document);
    }
  };
}

function usageProjection(payload, stats) {
  const today = stats?.periods?.today;
  return {...payload, budgetUsage: payload.todayUsage ?? null,
    todayUsage: typeof today?.costUsd === 'number' && Number.isFinite(today.costUsd) && today.costUsd >= 0 ? today.costUsd : null,
    todayUsageCurrency: 'USD',
    todayTokens: typeof today?.totalTokens === 'number' && Number.isFinite(today.totalTokens) && today.totalTokens >= 0 ? today.totalTokens : null,
    usageSource: 'local-transcripts', usageLabel: '今日估算费用'};
}

// The retained route names are an in-process compatibility contract, never an
// HTTP listener. The renderer has no access to the host's credential service.
async function createWhaleService({dataDir, getStats = () => null, definition}) {
  fs.mkdirSync(dataDir, {recursive: true});
  const routes = new Map(), listeners = new Map(), disposers = [];
  const completions = createCompletionBuffer();
  const ctx = {
    credentials: createWhaleCredentials(dataDir),
    connection: {requestRejection: () => null},
    get(name) {
      if (name === 'connection') return ctx.connection;
      if (name === 'sessionTitle') return {get: session => session.title || ''};
      return null;
    },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    effect(fn) { disposers.push(fn()); },
    inject(_names, fn) { fn(ctx); },
    webServer: {
      register(route) { routes.set(route.path, route); return () => routes.delete(route.path); },
      tapIndex() { return () => {}; }
    }
  };
  if (!definition) {
    // Required before evaluating the vendored module. DSH_HOME is deliberately
    // untouched: the independent collector still uses it only as a log source.
    const previous = process.env.WHALE_DATA_HOME;
    process.env.WHALE_DATA_HOME = dataDir;
    try {
      const url = pathToFileURL(path.join(__dirname, 'vendor/lib/index.js'));
      definition = (await import(url.href + '?home=' + encodeURIComponent(dataDir))).default;
    } finally {
      if (previous === undefined) delete process.env.WHALE_DATA_HOME;
      else process.env.WHALE_DATA_HOME = previous;
    }
  }
  definition.apply(ctx);
  return {
    emit(name, ...args) {
      if (name === 'agent/completed') completions.push(args[0]);
      for (const fn of listeners.get(name) || []) fn(...args);
    },
    async request(url, {method = 'GET', body, signal} = {}) {
      const pathname = new URL(url, 'http://localhost').pathname;
      if (pathname === '/dsh-whale/agent-completions.json') {
        if (method !== 'GET') return new Response('Method not allowed', {status: 405});
        return Response.json(completions.read(Number(new URL(url, 'http://localhost').searchParams.get('after') || 0)));
      }
      // Never advertise/install a DSH plugin update into the standalone app.
      if (pathname === '/dsh-whale/update-check.json') return Response.json({ok: true,
        current: VERSION, latest: VERSION, hasUpdate: false,
        source: RELEASES_URL});
      const route = routes.get(pathname) || [...routes.values()].find(item => item.kind === 'prefix' && pathname.startsWith(item.path));
      if (!route) return new Response('Not found', {status: 404});
      const bytes = body == null ? Buffer.alloc(0) : Buffer.from(body);
      if (bytes.length > 24 * 1024 * 1024) return new Response('Payload too large', {status: 413});
      const req = Readable.from(bytes.length ? [bytes] : []);
      Object.assign(req, {url: new URL(url, 'http://localhost').pathname + new URL(url, 'http://localhost').search,
        method, headers: {host: '127.0.0.1', origin: 'http://127.0.0.1'}});
      return new Promise((resolve, reject) => {
        let done = false, status = 200, headers = {};
        const finish = (error, value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          req.destroy();
          if (error) reject(error); else resolve(value);
        };
        const abort = () => finish(new Error('Request aborted'));
        const timer = setTimeout(() => finish(new Error('Local request timed out')), 30000);
        signal?.addEventListener('abort', abort, {once: true});
        if (signal?.aborted) { abort(); return; }
        const res = {
          writeHead(code, values) { status = code; headers = {...headers, ...values}; },
          end(value) {
            try {
              if (pathname === '/dsh-whale/balance.json' && status === 200) {
                let payload = JSON.parse(String(value));
                payload = usageProjection(payload, getStats());
                // Usage is available independently of whether a balance key has been configured.
                if (!payload.ok) payload = {...payload, ok: true, balanceError: payload.error, totalBalance: null, currency: 'CNY', localUsageOnly: true};
                value = JSON.stringify(payload);
              }
              finish(null, new Response([204, 205, 304].includes(status) ? null : value, {status, headers}));
            } catch (error) { finish(error); }
          }
        };
        Promise.resolve(route.handler(req, res)).catch(error => finish(error));
      });
    },
    dispose() { for (const dispose of disposers.reverse()) dispose?.(); routes.clear(); listeners.clear(); }
  };
}

module.exports = {createWhaleCredentials, createWhaleService, usageProjection};
