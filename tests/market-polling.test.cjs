const assert = require('node:assert/strict');
const test = require('node:test');
const { loadRoute } = require('./load-route.cjs');

const config = loadRoute('lib/market-data-config.ts');
const { createMarketPoller, quoteFreshness } = loadRoute('lib/market-polling.ts',
  { '@/lib/market-data-config': config }, { AbortController, URLSearchParams });
const { POLL_INTERVAL_MS } = config;
const { valuePosition } = loadRoute('lib/portfolio-valuation.ts');

function setup() {
  let now = 1_000_000;
  let visible = true;
  let id = 0;
  const timers = new Map();
  const listeners = new Set();
  const calls = [];
  const poller = createMarketPoller('equity', {
    now: () => now,
    random: () => 0,
    fetch: (url, { signal }) => new Promise((resolve, reject) => {
      calls.push({ url, signal, resolve });
      signal.addEventListener('abort', reject, { once: true });
    }),
    setTimer: (callback, delay) => {
      timers.set(++id, { callback, endsAt: now + delay });
      return id;
    },
    clearTimer: (timer) => timers.delete(timer),
    visible: () => visible,
    listenVisibility: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  return {
    poller, calls, timers, listeners,
    changeVisibility(value) {
      visible = value;
      listeners.forEach((listener) => listener());
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].endsAt - b[1].endsAt)[0];
        if (!next || next[1].endsAt > end) break;
        const [key, timer] = next;
        now = timer.endsAt;
        timers.delete(key);
        timer.callback();
        await flush();
      }
      now = end;
      await flush();
    },
    quote(ticker, price = 100) {
      return { ticker, price, marketTime: now, fetchedAt: now, prevClose: 100, change: price - 100,
        changePercent: price - 100, open: 100, high: 100, low: 100, volume: 1000 };
    },
  };
}

const flush = () => new Promise(setImmediate);

test('batches overlapping subscriptions, waits for completion, and polls at 30 seconds', async () => {
  const h = setup();
  const removeA = h.poller.subscribe(['MSFT', 'AAPL'], () => {});
  const removeB = h.poller.subscribe(['AAPL'], () => {});
  await h.advance(0);
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0].url, 'https://example.test').searchParams.get('symbols'), 'AAPL,MSFT');
  await h.advance(5000);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve(Response.json({ AAPL: h.quote('AAPL'), MSFT: h.quote('MSFT') }));
  await flush();
  await h.advance(POLL_INTERVAL_MS - 1);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  assert.equal(h.calls.length, 2);
  removeA();
  assert.equal(h.calls[1].signal.aborted, false);
  removeB();
  assert.equal(h.calls[1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
});

test('visibility changes abort pending work and resume immediately when visible', async () => {
  const h = setup();
  const unsubscribe = h.poller.subscribe(['AAPL'], () => {});
  await h.advance(0);
  h.changeVisibility(false);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
  await h.advance(120_000);
  assert.equal(h.calls.length, 1);
  h.changeVisibility(true);
  await h.advance(0);
  assert.equal(h.calls.length, 2);
  unsubscribe();
});

test('honors Retry-After across visibility changes and backs off repeated failures', async () => {
  const h = setup();
  const unsubscribe = h.poller.subscribe(['AAPL'], () => {});
  await h.advance(0);
  h.calls[0].resolve(new Response(null, { status: 429, headers: { 'Retry-After': '150' } }));
  await flush();
  assert.equal(h.poller.getSnapshot().error, 'rate-limit');
  h.changeVisibility(false);
  h.changeVisibility(true);
  await h.advance(149_999);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  h.calls[1].resolve(new Response(null, { status: 502 }));
  await flush();
  await h.advance(119_999);
  assert.equal(h.calls.length, 2);
  await h.advance(1);
  assert.equal(h.calls.length, 3);
  unsubscribe();
});

test('retains valid quotes on missing data and times out slow requests before retrying', async () => {
  const h = setup();
  const unsubscribe = h.poller.subscribe(['AAPL'], () => {});
  await h.advance(0);
  h.calls[0].resolve(Response.json({ AAPL: h.quote('AAPL') }));
  await flush();
  await h.advance(POLL_INTERVAL_MS);
  h.calls[1].resolve(Response.json({ AAPL: { price: 999 } }));
  await flush();
  assert.equal(h.poller.getSnapshot().quotes.AAPL.price, 100);
  assert.equal(h.poller.getSnapshot().missing.has('AAPL'), true);
  await h.advance(POLL_INTERVAL_MS + 12_000);
  assert.equal(h.calls[2].signal.aborted, true);
  assert.equal(h.poller.getSnapshot().error, 'unavailable');
  assert.equal(h.poller.getSnapshot().quotes.AAPL.price, 100);
  unsubscribe();
});

test('stops polling on permanent authentication or configuration errors', async () => {
  for (const status of [401, 403, 424]) {
    const h = setup();
    const unsubscribe = h.poller.subscribe(['AAPL'], () => {});
    await h.advance(0);
    h.calls[0].resolve(new Response(null, { status }));
    await flush();
    assert.equal(h.poller.getSnapshot().error, 'configuration');
    h.changeVisibility(false);
    h.changeVisibility(true);
    await h.advance(600_000);
    assert.equal(h.calls.length, 1);
    unsubscribe();
  }
});

test('switching symbols discards the old subscription data', async () => {
  const h = setup();
  const removeA = h.poller.subscribe(['AAPL'], () => {});
  await h.advance(0);
  const removeB = h.poller.subscribe(['MSFT'], () => {});
  removeA();
  h.calls[0].resolve(Response.json({ AAPL: h.quote('AAPL') }));
  await flush();
  assert.equal(h.poller.getSnapshot().quotes.AAPL, undefined);
  await h.advance(1000);
  h.calls[1].resolve(Response.json({ MSFT: h.quote('MSFT') }));
  await flush();
  assert.equal(h.poller.getSnapshot().quotes.MSFT.ticker, 'MSFT');
  removeB();
});

test('distinguishes delayed market times from stale refreshes and parses Retry-After dates', () => {
  const h = setup();
  const quote = h.quote('AAPL');
  const now = quote.fetchedAt;
  assert.equal(quoteFreshness(quote, now), 'Current snapshot');
  assert.equal(quoteFreshness({ ...quote, marketTime: now - 90_000 }, now), 'Delayed');
  assert.equal(quoteFreshness(quote, now + 90_000), 'Stale');
  assert.equal(quoteFreshness(quote, now, true), 'Stale');
  assert.equal(quoteFreshness({ ...quote, marketTime: null }, now), 'Timestamp unavailable');
  assert.equal(config.retryAfterMs(new Date(now + 120_000).toUTCString(), now), 120_000);
});

test('portfolio valuation recalculates from new prices without altering saved shares or cost', () => {
  const position = { id: 'position', ticker: 'AAPL', shares: 2, avg_buy_price: 100 };
  assert.equal(valuePosition(position, 90).gainLoss, -20);
  const updated = valuePosition(position, 125);
  assert.equal(updated.currentValue, 250);
  assert.equal(updated.gainLoss, 50);
  assert.equal(updated.gainLossPercent, 25);
  assert.equal(position.shares, 2);
  assert.equal(position.avg_buy_price, 100);
  assert.equal(valuePosition(position).currentValue, undefined);
});
