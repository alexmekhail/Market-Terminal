const assert = require('node:assert/strict');
const test = require('node:test');
const { loadRoute } = require('./load-route.cjs');

const config = loadRoute('lib/market-data-config.ts');

test('REST snapshots use server credentials and normalize quotes', async () => {
  const { fetchSnapshots } = loadRoute('lib/alpaca.ts', { '@/lib/market-data-config': config }, {
    URLSearchParams, AbortSignal,
    process: { env: { ALPACA_API_KEY: 'synthetic-key', ALPACA_API_SECRET: 'synthetic-secret' } },
    fetch: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://data.alpaca.markets');
      assert.equal(url.searchParams.get('symbols'), 'AAPL,MSFT');
      assert.equal(options.headers['APCA-API-KEY-ID'], 'synthetic-key');
      assert.equal(options.headers['APCA-API-SECRET-KEY'], 'synthetic-secret');
      return Response.json({ AAPL: { latestTrade: { p: 105, t: '2026-01-01T00:00:00Z' }, prevDailyBar: { c: 100 } } });
    },
  });
  const result = await fetchSnapshots(['AAPL', 'MSFT']);
  assert.equal(result.AAPL.price, 105);
  assert.equal(result.AAPL.changePercent, 5);
  assert.equal(result.AAPL.marketTime, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(result.MSFT, undefined);
});

test('snapshot route coalesces identical batches, forwards provider backoff and rejects oversized batches', async () => {
  const { NextRequest } = require('next/server');
  let fetchCount = 0;
  let respond;
  const alpaca = loadRoute('lib/alpaca.ts', { '@/lib/market-data-config': config }, {
    URLSearchParams, AbortSignal,
    process: { env: { ALPACA_API_KEY: 'synthetic-key', ALPACA_API_SECRET: 'synthetic-secret' } },
    fetch: () => { fetchCount++; return new Promise((resolve) => { respond = resolve; }); },
  });
  const helpers = loadRoute('lib/snapshot-response.ts', {
    '@/lib/alpaca': alpaca, '@/lib/market-data-config': config,
  }, { Headers });
  const { GET } = loadRoute('app/api/snapshots/route.ts', {
    '@/lib/alpaca': alpaca, '@/lib/snapshot-response': helpers,
  });
  const request = (symbols) => new NextRequest('http://localhost/api/snapshots?' + new URLSearchParams({ symbols }));
  const first = GET(request('MSFT,AAPL'));
  const duplicate = GET(request('AAPL,MSFT'));
  assert.equal(fetchCount, 1);
  respond(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
  for (const response of await Promise.all([first, duplicate])) {
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '120');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await GET(request('TSLA'))).status, 429);
  assert.equal((await GET(request(Array.from({ length: 201 }, (_, i) => 'S' + i).join(',')))).status, 400);
  assert.equal(fetchCount, 1);
});

test('crypto snapshots normalize bare symbols and fall back to the minute bar timestamp', async () => {
  const { fetchCryptoSnapshots } = loadRoute('lib/alpaca.ts', { '@/lib/market-data-config': config }, {
    URLSearchParams, AbortSignal,
    process: { env: { ALPACA_API_KEY: 'synthetic-key', ALPACA_API_SECRET: 'synthetic-secret' } },
    fetch: async (input) => {
      assert.equal(new URL(input).searchParams.get('symbols'), 'BTC/USD');
      return Response.json({ snapshots: { 'BTC/USD': {
        latestTrade: { p: 'invalid' },
        minuteBar: { c: 99000, t: '2026-01-01T00:01:00Z' },
      } } });
    },
  });
  const snapshots = await fetchCryptoSnapshots(['BTC']);
  assert.equal(snapshots.BTC.price, 99000);
  assert.equal(snapshots.BTC.marketTime, Date.parse('2026-01-01T00:01:00Z'));
});
