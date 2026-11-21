'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { StockChart } from '@/components/StockChart';
import { NewsPanel } from '@/components/NewsPanel';
import { PriceDisplay } from '@/components/PriceDisplay';
import { Skeleton } from '@/components/Skeleton';
import { StockInsights } from '@/components/StockInsights';
import { useAuth } from '@/components/AuthProvider';
import type { Snapshot, ChartDataPoint, TimeRange } from '@/types';
import { isPositiveChange, formatVolume, formatPrice } from '@/lib/utils';

const RANGES: TimeRange[] = ['1D', '1W', '1M'];

export default function StockPage() {
  const params = useParams();
  const ticker = (params.ticker as string).toUpperCase();
  const { user } = useAuth();

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [range, setRange] = useState<TimeRange>('1D');
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  // Fetch the current quote snapshot
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setSnapshotLoading(true);
    fetch(`/api/stock/${encodeURIComponent(ticker)}/snapshot`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Snapshot unavailable')))
      .then((data) => { if (!controller.signal.aborted) setSnapshot(data.snapshot ?? null); })
      .catch((error) => { if (!controller.signal.aborted) console.error(error); })
      .finally(() => { if (!controller.signal.aborted) setSnapshotLoading(false); });
    return () => controller.abort();
  }, [ticker]);

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

  // Check watchlist status
  useEffect(() => {
    setInWatchlist(false);
    if (!user) return;
    const controller = new AbortController();
    fetch('/api/watchlist', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (controller.signal.aborted) return;
        const list = d.watchlist ?? [];
        setInWatchlist(list.some((item: { ticker: string }) => item.ticker === ticker));
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
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      {/* Stock header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-mono text-3xl font-bold text-text-primary tracking-widest">{ticker}</h1>
            {user && (
              <button
                onClick={toggleWatchlist}
                disabled={watchlistLoading}
                className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
                  inWatchlist
                    ? 'border-gain text-gain hover:bg-gain hover:text-black'
                    : 'border-border text-text-muted hover:border-accent hover:text-accent'
                }`}
              >
                {inWatchlist ? '★ Watching' : '☆ Watch'}
              </button>
            )}
          </div>

          {snapshotLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : displayPrice ? (
            <PriceDisplay
              price={displayPrice.price}
              change={displayPrice.change}
              changePercent={displayPrice.changePercent}
              size="lg"
            />
          ) : (
            <span className="text-text-muted font-mono text-sm">No data available</span>
          )}
        </div>

        {/* Stats row */}
        {snapshot && (
          <div className="flex gap-6 font-mono text-xs">
            {[
              { label: 'Open', value: formatPrice(snapshot.open) },
              { label: 'High', value: formatPrice(snapshot.high) },
              { label: 'Low', value: formatPrice(snapshot.low) },
              { label: 'Volume', value: formatVolume(snapshot.volume) },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <div className="text-text-muted uppercase tracking-wider mb-0.5">{label}</div>
                <div className="text-text-primary">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="mb-6">
        {/* Range selector */}
        <div className="flex items-center gap-1 mb-3">
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

        <div className="border border-border rounded overflow-hidden">
          <StockChart data={chartData} isPositive={positive} loading={chartLoading} />
        </div>
      </div>

      {/* News (1/3) | AI Insights (2/3) */}
      <div className="border border-border rounded overflow-hidden grid grid-cols-3 min-h-[400px]">
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
