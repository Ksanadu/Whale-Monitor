'use strict';

function allowWhaleRequest(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'whale:' || url.host !== 'app') return false;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  return (!origin || origin === 'whale://app') && (!referer || referer.startsWith('whale://app/'));
}

function privateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', 'whale://app');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {status: response.status, headers});
}

module.exports = {allowWhaleRequest, privateResponse};
