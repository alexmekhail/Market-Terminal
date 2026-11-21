'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { EMPTY_POLL_STATE, marketPollers, type Market } from '@/lib/market-polling';

import { isSnapshotSymbol } from '@/lib/market-data-config';

const getEmptyState = () => EMPTY_POLL_STATE;

export function useMarketPolling(symbols: readonly string[], market: Market = 'equity') {
  const key = [...new Set(symbols.filter((symbol) => isSnapshotSymbol(symbol, market === 'crypto')))].sort().join(',');
  const requested = useMemo(() => key ? key.split(',') : [], [key]);
  const poller = marketPollers[market];
  const subscribe = useCallback((listener: () => void) => poller.subscribe(requested, listener), [poller, requested]);
  const state = useSyncExternalStore(subscribe, key ? poller.getSnapshot : getEmptyState, getEmptyState);
  return useMemo(() => ({
    ...state,
    quotes: Object.fromEntries(requested.map((ticker) => [ticker, state.quotes[ticker]])),
    loading: requested.length > 0 && !state.error && requested.some((ticker) => !state.quotes[ticker] && !state.missing.has(ticker)),
  }), [state, requested]);
}
