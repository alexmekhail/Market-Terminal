'use client';

import { useEffect, useState } from 'react';
import type { Snapshot } from '@/types';
import { formatPrice, formatChangePercent, isPositiveChange } from '@/lib/utils';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'GOOGL', 'META', 'SPY'];

export function TickerBar() {
  const [prices, setPrices] = useState<Record<string, Snapshot>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/snapshots?symbols=${DEFAULT_TICKERS.join(',')}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Snapshots unavailable')))
      .then((snapshots) => { if (!controller.signal.aborted) setPrices(snapshots); })
      .catch((error) => { if (!controller.signal.aborted) console.error(error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const tickers = DEFAULT_TICKERS.filter((t) => prices[t]);

  if (tickers.length === 0) {
    return (
      <div className="h-8 bg-bg-secondary border-b border-border flex items-center px-4">
        <span className="text-text-muted text-xs font-mono animate-pulse">{loading ? 'Loading market data…' : 'Market data unavailable'}</span>
      </div>
    );
  }

  // Duplicate for seamless loop
  const items = [...tickers, ...tickers];

  return (
    <div className="h-8 bg-bg-secondary border-b border-border overflow-hidden flex items-center">
      <div className="flex animate-ticker-scroll whitespace-nowrap" style={{ width: 'max-content' }}>
        {items.map((ticker, idx) => {
          const p = prices[ticker];
          if (!p) return null;
          const positive = isPositiveChange(p.change);
          return (
            <span
              key={`${ticker}-${idx}`}
              className="inline-flex items-center gap-2 px-5 border-r border-border/50 text-xs font-mono"
            >
              <span className="text-text-secondary font-semibold tracking-wider">{ticker}</span>
              <span className="text-text-primary">{formatPrice(p.price)}</span>
              <span className={positive ? 'text-gain' : 'text-loss'}>
                {formatChangePercent(p.changePercent)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
