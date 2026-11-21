'use client';

import { useMarketPolling } from '@/lib/use-market-polling';
import { QuoteStatus } from '@/components/QuoteStatus';

import Link from 'next/link';
import { formatPrice, formatChangePercent, isPositiveChange } from '@/lib/utils';
import { Skeleton } from './Skeleton';

const INDICES = [
  { id: 'SPY', label: 'S&P 500' },
  { id: 'QQQ', label: 'NASDAQ' },
  { id: 'DIA', label: 'DOW' },
  { id: 'IWM', label: 'RUSSELL' },
];

const SECTORS = [
  { id: 'XLK', label: 'Tech' },
  { id: 'XLF', label: 'Finance' },
  { id: 'XLV', label: 'Health' },
  { id: 'XLE', label: 'Energy' },
  { id: 'XLY', label: 'Consumer' },
];

const ALL_SYMBOLS = [...INDICES.map((i) => i.id), ...SECTORS.map((s) => s.id)];

export function MarketOverview() {
  const polling = useMarketPolling(ALL_SYMBOLS);
  const { quotes: data, loading } = polling;

  return (
    <div className="border border-border rounded overflow-hidden h-full">
      <div className="px-4 py-2.5 border-b border-border bg-bg-tertiary">
        <span className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider">
          Market Overview
        </span>
        <div><QuoteStatus state={polling} /></div>
      </div>

      <div className="p-3 space-y-1">
        {/* Major indices */}
        <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2 px-1">Indices</div>
        {INDICES.map(({ id, label }) => {
          const d = data[id];
          const pos = d ? isPositiveChange(d.change) : true;
          return (
            <Link
              key={id}
              href={`/stock/${id}`}
              className="flex items-center justify-between px-2 py-2 rounded hover:bg-bg-hover transition-colors group"
            >
              <div>
                <div className="font-mono font-bold text-sm text-text-primary tracking-wider">{id}</div>
                <div className="font-mono text-[10px] text-text-muted">{label}</div>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : d ? (
                <div className="text-right">
                  <div className="font-mono text-sm text-text-primary">{formatPrice(d.price)}</div>
                  <div className={`font-mono text-xs ${pos ? 'text-gain' : 'text-loss'}`}>
                    {formatChangePercent(d.changePercent)}
                  </div>
                </div>
              ) : (
                <span className="text-text-muted text-xs font-mono">N/A</span>
              )}
            </Link>
          );
        })}

        <div className="border-t border-border my-2" />

        {/* Sector ETFs */}
        <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2 px-1">Sectors</div>
        {SECTORS.map(({ id, label }) => {
          const d = data[id];
          const pos = d ? isPositiveChange(d.change) : true;
          return (
            <Link
              key={id}
              href={`/stock/${id}`}
              className="flex items-center justify-between px-2 py-2 rounded hover:bg-bg-hover transition-colors"
            >
              <div>
                <div className="font-mono font-bold text-sm text-text-primary tracking-wider">{id}</div>
                <div className="font-mono text-[10px] text-text-muted">{label}</div>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : d ? (
                <div className="text-right">
                  <div className="font-mono text-sm text-text-primary">{formatPrice(d.price)}</div>
                  <div className={`font-mono text-xs ${pos ? 'text-gain' : 'text-loss'}`}>
                    {formatChangePercent(d.changePercent)}
                  </div>
                </div>
              ) : (
                <span className="text-text-muted text-xs font-mono">N/A</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
