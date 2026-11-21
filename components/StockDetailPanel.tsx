'use client';

import { useMarketPolling } from '@/lib/use-market-polling';
import { QuoteStatus } from '@/components/QuoteStatus';

import { useEffect, useState } from 'react';
import { StockChart } from '@/components/StockChart';
import { NewsPanel } from '@/components/NewsPanel';
import { PriceDisplay } from '@/components/PriceDisplay';
import { StockInsights } from '@/components/StockInsights';
import { Skeleton } from '@/components/Skeleton';
import { useAuth } from '@/components/AuthProvider';
import type { ChartDataPoint, TimeRange } from '@/types';
import { isPositiveChange, formatVolume, formatPrice } from '@/lib/utils';
import Link from 'next/link';

const RANGES: TimeRange[] = ['1D', '1W', '1M'];

interface Props {
  ticker: string;
}

export function StockDetailPanel({ ticker }: Props) {
  return <StockDetailContent key={ticker} ticker={ticker} />;
}

function StockDetailContent({ ticker }: Props) {
  const { user } = useAuth();
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('1D');
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  const polling = useMarketPolling([ticker]);
  const snapshot = polling.quotes[ticker];
  const snapshotLoading = polling.loading;

  useEffect(() => {
    const controller = new AbortController();
    setChartLoading(true);
    fetch(`/api/stock/${encodeURIComponent(ticker)}/bars?range=${range}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => { if (!controller.signal.aborted) setChartData(d.chartData ?? []); })
      .catch((error) => { if (!controller.signal.aborted) console.error(error); })
      .finally(() => { if (!controller.signal.aborted) setChartLoading(false); });
    return () => controller.abort();
  }, [ticker, range]);

  useEffect(() => {
    setInWatchlist(false);
    if (!user) return;
    const controller = new AbortController();
    fetch('/api/watchlist', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (controller.signal.aborted) return;
        setInWatchlist((d.watchlist ?? []).some((item: { ticker: string }) => item.ticker === ticker));
      })
      .catch((error) => { if (!controller.signal.aborted) console.error(error); });
    return () => controller.abort();
  }, [ticker, user]);

  async function toggleWatchlist() {
    if (!user) return;
    setWatchlistLoading(true);
    try {
      if (inWatchlist) {
        const response = await fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE' });
        if (response.ok) setInWatchlist(false);
      } else {
        const response = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        if (response.ok) setInWatchlist(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setWatchlistLoading(false);
    }
  }

  const displayPrice = snapshot?.ticker === ticker ? snapshot : null;
  const positive = displayPrice ? isPositiveChange(displayPrice.change) : true;

  return (
    <div className="border border-border rounded overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-bg-tertiary flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href={`/stock/${ticker}`}
            className="font-mono font-bold text-xl text-text-primary tracking-widest hover:text-accent transition-colors"
          >
            {ticker}
          </Link>
          {user && (
            <button
              onClick={toggleWatchlist}
              disabled={watchlistLoading}
              className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                inWatchlist
                  ? 'border-gain text-gain hover:bg-gain hover:text-black'
                  : 'border-border text-text-muted hover:border-accent hover:text-accent'
              }`}
            >
              {inWatchlist ? '★ Watching' : '☆ Watch'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="mb-1"><QuoteStatus state={polling} /></div>
          {snapshotLoading ? (
            <Skeleton className="h-6 w-36" />
          ) : displayPrice ? (
            <PriceDisplay
              price={displayPrice.price}
              change={displayPrice.change}
              changePercent={displayPrice.changePercent}
              size="sm"
            />
          ) : null}

          {snapshot && (
            <div className="flex gap-4 font-mono text-xs text-text-muted">
              <span>O: <span className="text-text-secondary">{formatPrice(snapshot.open)}</span></span>
              <span>H: <span className="text-text-secondary">{formatPrice(snapshot.high)}</span></span>
              <span>L: <span className="text-text-secondary">{formatPrice(snapshot.low)}</span></span>
              <span>V: <span className="text-text-secondary">{formatVolume(snapshot.volume)}</span></span>
            </div>
          )}
        </div>
      </div>

      {/* Range selector */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-bg-secondary">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`font-mono text-xs px-3 py-1 rounded transition-colors ${
              range === r
                ? 'bg-bg-tertiary text-text-primary border border-border'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Chart */}
      <StockChart data={chartData} isPositive={positive} loading={chartLoading} />

      {/* News (1/3) | AI Insights (2/3) */}
      <div className="border-t border-border grid grid-cols-3 min-h-[400px]">
        <div className="col-span-1 border-r border-border overflow-y-auto">
          <NewsPanel ticker={ticker} />
        </div>
        <div className="col-span-2 overflow-y-auto">
          <StockInsights
            key={ticker}
            ticker={ticker}
            stockData={snapshot?.ticker === ticker ? {
              price: snapshot.price,
              changePercent: snapshot.changePercent,
              volume: snapshot.volume,
              open: snapshot.open,
              high: snapshot.high,
              low: snapshot.low,
              prevClose: snapshot.prevClose,
            } : null}
          />
        </div>
      </div>
    </div>
  );
}
