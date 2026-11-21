'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { StockDetailPanel } from '@/components/StockDetailPanel';
import type { WatchlistItem, Snapshot } from '@/types';
import { formatPrice, formatChangePercent, isPositiveChange } from '@/lib/utils';
import { Skeleton } from '@/components/Skeleton';

export default function WatchlistPage() {
  const { user } = useAuth();
  return <WatchlistPageContent key={user?.id ?? 'anonymous'} userId={user?.id} />;
}

function WatchlistPageContent({ userId }: { userId?: string }) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [prices, setPrices] = useState<Record<string, Snapshot>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

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
        setSelected(list[0]?.ticker ?? null);
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
    if (selected === ticker) setSelected(items.find((item) => item.ticker !== ticker)?.ticker ?? null);
  }

  if (!userId) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 py-20 text-center">
        <p className="text-text-muted font-mono text-sm">Sign in to view your watchlist.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
          <div className="xl:col-span-2">
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-screen-xl mx-auto px-4 py-20 text-center">
        <p className="text-text-muted font-mono text-sm">
          Your watchlist is empty.{' '}
          <Link href="/search" className="text-accent hover:underline">
            Search for a stock
          </Link>{' '}
          to add it.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Watchlist sidebar */}
        <div className="xl:col-span-1">
          <div className="border border-border rounded overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-bg-tertiary">
              <span className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider">
                Watchlist ({items.length})
              </span>
            </div>
            <div className="overflow-y-auto max-h-[600px]">
              {items.map((item) => {
                const p = prices[item.ticker];
                const positive = p ? isPositiveChange(p.change) : true;
                const isSelected = selected === item.ticker;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0 transition-colors group ${
                      isSelected ? 'bg-bg-hover border-l-2 border-l-accent' : 'hover:bg-bg-hover'
                    }`}
                  >
                    <button
                      onClick={() => setSelected(item.ticker)}
                      className="flex-1 flex items-center justify-between gap-3 text-left"
                    >
                      <div>
                        <div className="font-mono font-semibold text-sm text-text-primary tracking-wider">
                          {item.ticker}
                        </div>
                      </div>
                      {p ? (
                        <div className="text-right">
                          <div className="font-mono text-sm text-text-primary">{formatPrice(p.price)}</div>
                          <div className={`font-mono text-xs ${positive ? 'text-gain' : 'text-loss'}`}>
                            {formatChangePercent(p.changePercent)}
                          </div>
                        </div>
                      ) : (
                        <Skeleton className="h-8 w-16" />
                      )}
                    </button>
                    <button
                      onClick={() => removeFromWatchlist(item.ticker)}
                      className="ml-2 text-text-muted hover:text-loss opacity-0 group-hover:opacity-100 transition-all text-lg leading-none flex-shrink-0"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-2">
          {selected ? (
            <StockDetailPanel ticker={selected} />
          ) : (
            <div className="border border-border rounded flex items-center justify-center h-64">
              <p className="text-text-muted font-mono text-sm">Select a stock to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
