const assert = require('node:assert/strict');
const test = require('node:test');
const { NextRequest } = require('next/server');
const { loadRoute } = require('./load-route.cjs');

const userId = 'a98db4b4-1e1f-41bb-ae14-47b754e0898f';
const otherId = '95c983f7-f1d1-4e22-ab2c-643cf1753482';
const symbol = loadRoute('lib/stock-symbol.ts');

for (const table of ['watchlist', 'portfolio']) {
  const path = 'http://localhost/api/' + table;
  const query = table === 'watchlist' ? '?ticker=AAPL' : '?id=' + otherId;
  const load = (supabase) => loadRoute('app/api/' + table + '/route.ts', {
    '@/lib/stock-symbol': symbol,
    '@/lib/supabase-server': { createServerSupabase: async () => supabase },
  });

  test(table + ' denies missing, expired and invalid sessions for every method', async () => {
    for (const code of [null, 'session_expired', 'bad_jwt']) {
      const routes = load({
        auth: { getUser: async () => ({ data: { user: null }, error: code && { code } }) },
        from: () => assert.fail('Denied request reached the database'),
      });
      for (const method of ['GET', 'POST', 'DELETE']) {
        assert.equal((await routes[method](new NextRequest(path + query, { method }))).status, 401);
        assert.equal((await load(null)[method](new NextRequest(path + query, { method }))).status, 503);
      }
    }
  });

  test(table + ' scopes reads, writes and deletes to the verified user', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const operations = [];
      const result = { data: [], error: null };
      const chain = { then: (resolve) => Promise.resolve(result).then(resolve) };
      for (const operation of ['select', 'eq', 'order', 'insert', 'upsert', 'single', 'delete']) {
        chain[operation] = (...args) => {
          operations.push([operation, ...args]);
          return chain;
        };
      }
      const routes = load({
        auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
        from: (name) => { assert.equal(name, table); return chain; },
      });
      const body = method === 'POST' ? JSON.stringify({
        user_id: otherId, ticker: 'aapl', shares: 1, avg_buy_price: 100,
      }) : undefined;
      const response = await routes[method](new NextRequest(path + query, { method, body }));
      assert.equal(response.status, method === 'POST' ? 201 : 200);
      if (method === 'POST') {
        const write = operations.find(([name]) => name === 'insert' || name === 'upsert');
        assert.equal(write[1].user_id, userId);
        assert.equal(write[1].ticker, 'AAPL');
      } else {
        assert.ok(operations.some(([operation, field, value]) => operation === 'eq' && field === 'user_id' && value === userId));
      }
    }
  });

  test(table + ' rejects malformed mutation payloads before reaching the database', async () => {
    const routes = load({
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
      from: () => assert.fail('Invalid request reached the database'),
    });
    for (const body of ['{', 'null', '{"ticker":123}', '{"ticker":"AAPL&feed=sip"}']) {
      assert.equal((await routes.POST(new NextRequest(path, { method: 'POST', body }))).status, 400);
    }
  });
}
