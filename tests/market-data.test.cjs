const assert = require('node:assert/strict');
const test = require('node:test');
const { loadRoute } = require('./load-route.cjs');

test('REST snapshots use server credentials and normalize quotes', async () => {
  const { fetchSnapshots } = loadRoute('lib/alpaca.ts', {}, {
    URLSearchParams,
    process: { env: { ALPACA_API_KEY: 'synthetic-key', ALPACA_API_SECRET: 'synthetic-secret' } },
    fetch: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, 'https://data.alpaca.markets');
      assert.equal(url.searchParams.get('symbols'), 'AAPL,MSFT');
      assert.equal(options.headers['APCA-API-KEY-ID'], 'synthetic-key');
      assert.equal(options.headers['APCA-API-SECRET-KEY'], 'synthetic-secret');
      return Response.json({ AAPL: { latestTrade: { p: 105 }, prevDailyBar: { c: 100 } } });
    },
  });
  const result = await fetchSnapshots(['AAPL', 'MSFT']);
  assert.equal(result.AAPL.price, 105);
  assert.equal(result.AAPL.changePercent, 5);
});
