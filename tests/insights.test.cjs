const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { loadRoute } = require('./load-route.cjs');

const metrics = { ticker: 'AAPL', price: 100, open: 99, high: 101, low: 98, prevClose: 99, volume: 1000, changePercent: 1 };
const insight = { signal: 'Buy', sentiment: 'Bullish', confidence: 75, reasons: ['a', 'b', 'c', 'd'], summary: 'Example' };
const request = (payload = metrics) => new NextRequest('http://localhost/api/insights', {
  method: 'POST', body: JSON.stringify(payload),
});
const providerResponse = (value = insight) => Response.json({ content: [{ text: JSON.stringify(value) }] });

function setup(fetch, configured = true) {
  let now = 100_000;
  const route = loadRoute('app/api/insights/route.ts', {}, {
    fetch, AbortSignal, Date: { now: () => now },
    process: { env: configured ? { ANTHROPIC_API_KEY: 'synthetic-test-key' } : {} },
  });
  return { post: route.POST, advance: (ms) => { now += ms; } };
}

test('invalid metrics and unconfigured providers do not make upstream requests', async () => {
  const neverFetch = () => assert.fail('Unexpected provider call');
  const { post } = setup(neverFetch);
  for (const payload of [null, {}, { ...metrics, ticker: 'AAPL\nOTHER' }, { ...metrics, price: '100' }]) {
    assert.equal((await post(request(payload))).status, 400);
  }
  assert.equal((await (await setup(neverFetch, false).post(request())).json()).signal, 'Hold');
});

test('blocks concurrent duplicates and changed metrics, then refreshes after cache expiry', async () => {
  let resolveProvider;
  let calls = 0;
  const { post, advance } = setup(() => {
    calls += 1;
    if (calls > 1) return providerResponse();
    return new Promise((resolve) => { resolveProvider = resolve; });
  });
  const first = post(request());
  while (!resolveProvider) await new Promise(setImmediate);
  assert.equal((await post(request())).status, 429);
  resolveProvider(providerResponse());
  assert.equal((await (await first).json()).signal, 'Buy');
  assert.equal((await (await post(request())).json()).signal, 'Buy');
  assert.equal((await post(request({ ...metrics, price: 101 }))).headers.get('Retry-After'), '60');
  assert.equal(calls, 1);
  advance(60_000);
  assert.equal((await post(request({ ...metrics, price: 101 }))).status, 200);
  assert.equal(calls, 2);
});

test('provider errors and invalid responses fall back and still consume the local budget', async () => {
  let calls = 0;
  const { post, advance } = setup((_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    calls += 1;
    if (calls % 3 === 0) throw new DOMException('Mocked provider timeout', 'TimeoutError');
    if (calls % 3 === 1) return new Response(null, { status: 502 });
    return providerResponse({ ...insight, reasons: ['a'.repeat(81), 'b', 'c', 'd'] });
  });
  for (let i = 0; i < 60; i++) {
    assert.equal((await (await post(request({ ...metrics, ticker: 'T' + i }))).json()).signal, 'Hold');
  }
  assert.equal((await post(request())).status, 429);
  assert.equal(calls, 60);
  advance(60_000);
  assert.equal((await post(request())).status, 200);
  assert.equal(calls, 61);
});

test('caps total in-flight provider calls across different symbols', async () => {
  const waiting = [];
  const { post } = setup(() => new Promise((resolve) => waiting.push(resolve)));
  const requests = Array.from({ length: 8 }, (_, i) => post(request({ ...metrics, ticker: 'T' + i })));
  while (waiting.length < requests.length) await new Promise(setImmediate);
  assert.equal((await post(request())).status, 429);
  waiting.forEach((resolve) => resolve(providerResponse()));
  for (const response of await Promise.all(requests)) assert.equal(response.status, 200);
});
