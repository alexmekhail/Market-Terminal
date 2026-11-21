import type { AlpacaBar, NewsArticle, Snapshot } from '@/types';
import { retryAfterMs } from '@/lib/market-data-config';

const BASE_URL = 'https://data.alpaca.markets';
const DATA_V2 = `${BASE_URL}/v2`;
const DATA_V1B1 = `${BASE_URL}/v1beta1`;

function alpacaHeaders(): HeadersInit {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
    Accept: 'application/json',
  };
}

export class SnapshotError extends Error {
  constructor(public status: number, public retryAfter?: string) {
    super('Market snapshots unavailable');
  }
}

let snapshotCooldownUntil = 0;
const pendingSnapshots = new Map<string, Promise<unknown>>();
const MAX_PENDING_SNAPSHOTS = 8;

async function snapshotPayload(url: string): Promise<unknown> {
  const existing = pendingSnapshots.get(url);
  if (existing) return existing;
  const remaining = snapshotCooldownUntil - Date.now();
  if (remaining > 0) throw new SnapshotError(429, String(Math.ceil(remaining / 1000)));
  if (pendingSnapshots.size >= MAX_PENDING_SNAPSHOTS) throw new SnapshotError(429, '5');
  const pending = requestSnapshot(url).finally(() => pendingSnapshots.delete(url));
  pendingSnapshots.set(url, pending);
  return pending;
}

async function requestSnapshot(url: string): Promise<unknown> {
  if (!process.env.ALPACA_API_KEY || !process.env.ALPACA_API_SECRET) throw new SnapshotError(424);
  const response = await fetch(url, {
    headers: alpacaHeaders(), cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (response.status === 429) {
    const now = Date.now();
    const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
    const delay = retryAfterMs(response.headers.get('Retry-After'), now)
      ?? (Number.isFinite(reset) && reset > now ? reset - now : 60_000);
    snapshotCooldownUntil = Math.max(snapshotCooldownUntil, now + delay, now + 1000);
    throw new SnapshotError(429, String(Math.ceil((snapshotCooldownUntil - now) / 1000)));
  }
  if ([400, 401, 403].includes(response.status)) throw new SnapshotError(424);
  if (!response.ok) throw new SnapshotError(502, response.headers.get('Retry-After') ?? undefined);
  if (response.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
    if (Number.isFinite(reset)) snapshotCooldownUntil = Math.max(snapshotCooldownUntil, reset);
  }
  return response.json();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSnapshots(
  payload: unknown,
  symbols: readonly string[],
  upstreamSymbol: (symbol: string) => string,
): Record<string, Snapshot> {
  const rows = record(payload);
  if (!rows) throw new SnapshotError(502);
  const result: Record<string, Snapshot> = {};
  const fetchedAt = Date.now();

  for (const ticker of symbols) {
    const data = record(rows[upstreamSymbol(ticker)]);
    if (!data) continue;
    const trade = record(data.latestTrade);
    const minute = record(data.minuteBar);
    const daily = record(data.dailyBar);
    const tradePrice = finite(trade?.p, 0);
    const price = tradePrice > 0 ? tradePrice : finite(minute?.c, 0);
    if (price <= 0) continue;
    const time = tradePrice > 0 ? trade?.t : minute?.t;
    const marketTime = typeof time === 'string' ? Date.parse(time) : NaN;
    const prevClose = finite(record(data.prevDailyBar)?.c, price);
    const change = price - prevClose;
    result[ticker] = {
      ticker, price, prevClose, change, fetchedAt,
      marketTime: Number.isFinite(marketTime) ? marketTime : null,
      changePercent: prevClose === 0 ? 0 : (change / prevClose) * 100,
      open: finite(daily?.o, 0),
      high: finite(daily?.h, 0),
      low: finite(daily?.l, 0),
      volume: finite(daily?.v, 0),
    };
  }
  return result;
}

export async function fetchSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
  const params = new URLSearchParams({ symbols: symbols.join(','), feed: 'iex' });
  const payload = await snapshotPayload(`${DATA_V2}/stocks/snapshots?${params}`);
  return normalizeSnapshots(payload, symbols, (symbol) => symbol);
}

export async function fetchBars(
  symbol: string,
  timeframe: string,
  start: string,
  end: string
): Promise<AlpacaBar[]> {
  const params = new URLSearchParams({
    timeframe,
    start,
    end,
    limit: '1000',
    feed: 'iex',
    adjustment: 'raw',
  });
  const res = await fetch(
    `${DATA_V2}/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
    { headers: alpacaHeaders(), next: { revalidate: 0 } }
  );
  if (!res.ok) throw new Error(`Alpaca bars error: ${res.status}`);
  const data = await res.json();
  return data.bars ?? [];
}

export async function fetchGeneralNews(limit = 20): Promise<NewsArticle[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(
    `${DATA_V1B1}/news?${params}`,
    { headers: alpacaHeaders(), next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Alpaca news error: ${res.status}`);
  const data = await res.json();
  return (data.news ?? []).map((item: any): NewsArticle => ({
    id: item.id,
    headline: item.headline,
    author: item.author ?? '',
    source: item.source ?? '',
    url: item.url,
    createdAt: item.created_at,
    summary: item.summary ?? '',
    symbols: item.symbols ?? [],
  }));
}

/** Converts bare symbol like "BTC" → "BTC/USD" for the Alpaca crypto API. */
function toCryptoSymbol(s: string) {
  return s.includes('/') ? s : `${s}/USD`;
}

export async function fetchCryptoSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
  const bareSymbols = symbols.map((symbol) => symbol.replace(/\/USD$/, ''));
  const params = new URLSearchParams({ symbols: bareSymbols.map(toCryptoSymbol).join(',') });
  const payload = await snapshotPayload(`${BASE_URL}/v1beta3/crypto/us/snapshots?${params}`);
  return normalizeSnapshots(record(payload)?.snapshots, bareSymbols, toCryptoSymbol);
}

export async function fetchCryptoBars(
  symbol: string,
  timeframe: string,
  start: string,
  end: string
): Promise<AlpacaBar[]> {
  const cryptoSym = toCryptoSymbol(symbol);
  const params = new URLSearchParams({ symbols: cryptoSym, timeframe, start, end, limit: '1000' });
  const res = await fetch(
    `${BASE_URL}/v1beta3/crypto/us/bars?${params}`,
    { headers: alpacaHeaders(), next: { revalidate: 0 } }
  );
  if (!res.ok) throw new Error(`Alpaca crypto bars error: ${res.status}`);
  const data = await res.json();
  return data.bars?.[cryptoSym] ?? [];
}

export async function fetchNews(symbol: string, limit = 15): Promise<NewsArticle[]> {
  const params = new URLSearchParams({
    symbols: symbol,
    limit: String(limit),
  });
  const res = await fetch(
    `${DATA_V1B1}/news?${params}`,
    { headers: alpacaHeaders(), next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Alpaca news error: ${res.status}`);
  const data = await res.json();
  return (data.news ?? []).map((item: any): NewsArticle => ({
    id: item.id,
    headline: item.headline,
    author: item.author ?? '',
    source: item.source ?? '',
    url: item.url,
    createdAt: item.created_at,
    summary: item.summary ?? '',
    symbols: item.symbols ?? [],
  }));
}
