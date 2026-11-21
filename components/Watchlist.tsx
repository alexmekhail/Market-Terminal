'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthProvider';
import type { WatchlistItem, Snapshot } from '@/types';
import { formatPrice, formatChangePercent, isPositiveChange } from '@/lib/utils';
import { Skeleton } from './Skeleton';

export function Watchlist() {
  const { user } = useAuth();
  return <WatchlistContent key={user?.id ?? 'anonymous'} userId={user?.id} />;
}

function WatchlistContent({ userId }: { userId?: string }) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [prices, setPrices] = useState<Record<string, Snapshot>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setItems([]);
    setPrices({});
    setLoading(Boolean(userId));
    if (!userId) return;
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      try {
        const response = await fetch('/api/watchlist', { signal });
        if (!response.ok) return;
        const data = await response.json();
        const list: WatchlistItem[] = data.watchlist ?? [];
        if (signal.aborted) return;
        setItems(list);
        if (!list.length) return;
        const symbols = new URLSearchParams({ symbols: list.map((item) => item.ticker).join(',') });
        const snapshots = await fetch(`/api/snapshots?${symbols}`, { signal });
        if (snapshots.ok) {
          const quotes = await snapshots.json();
          if (!signal.aborted) setPrices(quotes);
        }
      } catch (error) {
        if (!signal.aborted) console.error(error);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [userId]);

  async function removeFromWatchlist(ticker: string) {
    const response = await fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE' });
    if (!response.ok) return;
    setItems((previous) => previous.filter((item) => item.ticker !== ticker));
  }

  if (!userId) {
    return (
      <div className="border border-border rounded p-4 text-center">
        <p className="text-text-muted text-xs font-mono">Sign in to view your watchlist</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border bg-bg-tertiary">
        <span className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider">Watchlist</span>
      </div>

      {loading && (
        <div className="p-2 space-y-1">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="p-4 text-text-muted text-xs font-mono text-center">
          Your watchlist is empty. Search for a stock to add it.
        </div>
      )}

      {!loading && items.map((item) => {
        const p = prices[item.ticker];
        const positive = p ? isPositiveChange(p.change) : true;
        return (
          <div key={item.id} className="flex items-center justify-between px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-bg-hover group">
            <Link href={`/stock/${item.ticker}`} className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-semibold text-sm text-text-primary">{item.ticker}</span>
                {p ? (
                  <div className="text-right">
                    <div className="font-mono text-sm text-text-primary">{formatPrice(p.price)}</div>
                    <div className={`font-mono text-xs ${positive ? 'text-gain' : 'text-loss'}`}>
                      {formatChangePercent(p.changePercent)}
                    </div>
                  </div>
                ) : (
                  <Skeleton className="h-8 w-20" />
                )}
              </div>
            </Link>
            <button
              onClick={() => removeFromWatchlist(item.ticker)}
              className="ml-2 text-text-muted hover:text-loss opacity-0 group-hover:opacity-100 transition-all text-lg leading-none"
              title="Remove"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
