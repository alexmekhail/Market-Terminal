import type { Snapshot } from '@/types';

import { POLL_INTERVAL_MS, SNAPSHOT_BATCH_LIMIT, retryAfterMs } from '@/lib/market-data-config';
const MAX_BACKOFF_MS = 5 * 60_000;
const STALE_AFTER_MS = 3 * POLL_INTERVAL_MS;

export type Market = 'equity' | 'crypto';
type Quotes = Partial<Record<string, Snapshot>>;
export interface PollState {
  quotes: Quotes;
  missing: ReadonlySet<string>;
  refreshing: boolean;
  error: 'rate-limit' | 'unavailable' | 'configuration' | null;
}

export const EMPTY_POLL_STATE: PollState = {
  quotes: {}, missing: new Set(), refreshing: false, error: null,
};

type Listener = () => void;
interface PollEnvironment {
  fetch: typeof fetch;
  now: () => number;
  random: () => number;
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  visible: () => boolean;
  listenVisibility: (listener: Listener) => () => void;
}

export function quoteFreshness(quote: Snapshot, now: number, failed = false) {
  if (failed || now - quote.fetchedAt >= STALE_AFTER_MS) return 'Stale';
  if (quote.marketTime === null) return 'Timestamp unavailable';
  return now - quote.marketTime >= STALE_AFTER_MS ? 'Delayed' : 'Current snapshot';
}

function isSnapshot(value: unknown, ticker: string): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Record<string, unknown>;
  return quote.ticker === ticker
    && ['price', 'prevClose', 'change', 'changePercent', 'open', 'high', 'low', 'volume', 'fetchedAt'].every((field) =>
      typeof quote[field] === 'number' && Number.isFinite(quote[field]))
    && (quote.price as number) > 0
    && (quote.fetchedAt as number) > 0 && (quote.fetchedAt as number) <= 8.64e15
    && (quote.marketTime === null || typeof quote.marketTime === 'number' && Math.abs(quote.marketTime) <= 8.64e15);
}

export function createMarketPoller(market: Market, env: PollEnvironment) {
  const subscriptions = new Map<Listener, readonly string[]>();
  let state = EMPTY_POLL_STATE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  let requestTimeout: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  let failures = 0;
  let nextAllowed = 0;
  let terminal = false;
  let lastStart = -Infinity;

  function publish(next: PollState) {
    state = next;
    subscriptions.forEach((_symbols, listener) => listener());
  }

  function activeSymbols() {
    return [...new Set([...subscriptions.values()].flat())].sort();
  }

  function clearTimer() {
    if (timer !== undefined) env.clearTimer(timer);
    timer = undefined;
  }

  function schedule(delay: number) {
    if (!subscriptions.size || !env.visible() || request || terminal) return;
    clearTimer();
    const wait = Math.max(delay, nextAllowed - env.now(), 0);
    // Recheck the absolute deadline after long Retry-After values.
    timer = env.setTimer(() => {
      timer = undefined;
      if (env.now() < nextAllowed) schedule(0);
      else void poll();
    }, Math.min(wait, 2_147_483_647));
  }

  async function poll() {
    if (request || !subscriptions.size || !env.visible() || terminal) return;
    const symbols = activeSymbols();
    const controller = new AbortController();
    request = controller;
    lastStart = env.now();
    const timeout = env.setTimer(() => controller.abort(), 12_000);
    requestTimeout = timeout;
    publish({ ...state, refreshing: true });
    const quotes: Quotes = {};
    const missing = new Set<string>();
    let retryDelay = POLL_INTERVAL_MS;
    let error: PollState['error'] = null;
    let retryHeader: string | null = null;
    try {
      const endpoint = market === 'equity' ? '/api/snapshots' : '/api/crypto/snapshots';
      for (let i = 0; i < symbols.length; i += SNAPSHOT_BATCH_LIMIT) {
        const batch = symbols.slice(i, i + SNAPSHOT_BATCH_LIMIT);
        const query = new URLSearchParams({ symbols: batch.join(',') });
        const response = await env.fetch(`${endpoint}?${query}`, { signal: controller.signal });
        if (!response.ok) {
          terminal = [400, 401, 403, 404, 424].includes(response.status);
          error = terminal ? 'configuration' : response.status === 429 ? 'rate-limit' : 'unavailable';
          retryHeader = response.headers.get('Retry-After');
          break;
        }
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid snapshot response');
        for (const symbol of batch) {
          const value = (payload as Record<string, unknown>)[symbol];
          if (isSnapshot(value, symbol)) quotes[symbol] = value;
          else missing.add(symbol);
        }
      }
    } catch {
      error = 'unavailable';
    } finally {
      env.clearTimer(timeout);
      if (request === controller) {
        request = null;
        requestTimeout = undefined;
        if (error) {
          failures += 1;
          const backoff = POLL_INTERVAL_MS * 2 ** Math.min(failures, 4);
          retryDelay = Math.max(
            Math.min(MAX_BACKOFF_MS, backoff * (1 + env.random() * 0.2)),
            retryAfterMs(retryHeader, env.now()) ?? 0,
          );
          if (!terminal) nextAllowed = env.now() + retryDelay;
        } else {
          failures = 0;
          nextAllowed = 0;
        }
        const active = activeSymbols();
        const retained: Quotes = {};
        for (const symbol of active) {
          const next = quotes[symbol];
          const previous = state.quotes[symbol];
          // An older cached API response should never replace a newer quote.
          if (next && (!previous || next.fetchedAt >= previous.fetchedAt)) retained[symbol] = next;
          else if (previous) retained[symbol] = previous;
        }
        publish({ quotes: retained, missing, refreshing: false, error });
        const requested = new Set(symbols);
        const hasNewSymbols = active.some((symbol) => !requested.has(symbol));
        schedule(!error && hasNewSymbols ? 1000 : retryDelay);
      }
    }
  }

  function cancel() {
    clearTimer();
    const current = request;
    request = null;
    if (requestTimeout !== undefined) env.clearTimer(requestTimeout);
    requestTimeout = undefined;
    current?.abort();
  }

  function visibilityChanged() {
    if (env.visible()) schedule(Math.max(0, lastStart + 1000 - env.now()));
    else {
      cancel();
      if (state.refreshing) publish({ ...state, refreshing: false });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(symbols: readonly string[], listener: Listener) {
      if (!symbols.length) return () => {};
      subscriptions.set(listener, symbols);
      if (!unlisten) unlisten = env.listenVisibility(visibilityChanged);
      if (!request && (timer === undefined || symbols.some((symbol) => !state.quotes[symbol] && !state.missing.has(symbol)))) {
        schedule(Math.max(0, lastStart + 1000 - env.now()));
      }
      return () => {
        subscriptions.delete(listener);
        if (subscriptions.size) {
        const active = new Set(activeSymbols());
        if (state.missing.size || Object.keys(state.quotes).some((symbol) => !active.has(symbol))) {
          publish({
            ...state,
            quotes: Object.fromEntries(Object.entries(state.quotes).filter(([symbol]) => active.has(symbol))),
            missing: new Set([...state.missing].filter((symbol) => active.has(symbol))),
          });
        }
        return;
      }
        cancel();
        unlisten?.();
        unlisten = undefined;
        state = terminal ? { ...EMPTY_POLL_STATE, error: 'configuration' } : EMPTY_POLL_STATE;
      };
    },
  };
}

const browser: PollEnvironment = {
  fetch: (...args) => fetch(...args),
  now: Date.now,
  random: Math.random,
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer),
  visible: () => document.visibilityState !== 'hidden',
  listenVisibility: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export const marketPollers = {
  equity: createMarketPoller('equity', browser),
  crypto: createMarketPoller('crypto', browser),
};
