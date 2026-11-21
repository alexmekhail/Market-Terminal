'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { AddPositionModal } from './AddPositionModal';
import type { PortfolioPosition, Snapshot } from '@/types';
import { formatPrice, formatLargeNumber, isPositiveChange } from '@/lib/utils';
import { Skeleton } from './Skeleton';

interface EnrichedPosition extends PortfolioPosition {
  currentPrice?: number;
  currentValue?: number;
  gainLoss?: number;
  gainLossPercent?: number;
}

export function PortfolioTable() {
  const { user } = useAuth();
  return <PortfolioTableContent key={user?.id ?? 'anonymous'} userId={user?.id} />;
}

function PortfolioTableContent({ userId }: { userId?: string }) {
  const [positions, setPositions] = useState<EnrichedPosition[]>([]);
  const [prices, setPrices] = useState<Record<string, Snapshot>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setPositions([]);
    setPrices({});
    setLoading(Boolean(userId));
    if (!userId) return;
    const controller = new AbortController();
    const { signal } = controller;

    async function load() {
      try {
        const response = await fetch('/api/portfolio', { signal });
        if (!response.ok) return;
        const data = await response.json();
        const list: PortfolioPosition[] = data.positions ?? [];
        if (signal.aborted) return;
        setPositions(list);
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
  }, [userId, refresh]);

  async function deletePosition(id: string) {
    const response = await fetch(`/api/portfolio?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.ok) setPositions((previous) => previous.filter((position) => position.id !== id));
  }

  // Enrich positions with snapshot prices
  const enriched: EnrichedPosition[] = positions.map((pos) => {
    const currentPrice = prices[pos.ticker]?.price;
    if (currentPrice === undefined) return pos;
    const currentValue = currentPrice * pos.shares;
    const costBasis = pos.avg_buy_price * pos.shares;
    const gainLoss = currentValue - costBasis;
    const gainLossPercent = costBasis !== 0 ? (gainLoss / costBasis) * 100 : 0;
    return { ...pos, currentPrice, currentValue, gainLoss, gainLossPercent };
  });

  const totalValue = enriched.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
  const totalGainLoss = enriched.reduce((sum, p) => sum + (p.gainLoss ?? 0), 0);

  if (!userId) {
    return (
      <div className="border border-border rounded p-4 text-center">
        <p className="text-text-muted text-xs font-mono">Sign in to track your portfolio</p>
      </div>
    );
  }

  return (
    <>
      <div className="border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-bg-tertiary flex items-center justify-between">
          <span className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider">Portfolio</span>
          <div className="flex items-center gap-4">
            {totalValue > 0 && (
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-text-muted">Total:</span>
                <span className="text-text-primary font-semibold">{formatPrice(totalValue)}</span>
                <span className={isPositiveChange(totalGainLoss) ? 'text-gain' : 'text-loss'}>
                  {isPositiveChange(totalGainLoss) ? '+' : ''}{formatPrice(totalGainLoss)}
                </span>
              </div>
            )}
            <button
              onClick={() => setShowModal(true)}
              className="text-xs font-mono border border-accent text-accent px-2 py-0.5 rounded hover:bg-accent hover:text-white transition-colors"
            >
              + Add
            </button>
          </div>
        </div>

        {loading && (
          <div className="p-2 space-y-1">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {!loading && enriched.length === 0 && (
          <div className="p-6 text-text-muted text-xs font-mono text-center">
            No positions yet. Click &quot;+ Add&quot; to add your first holding.
          </div>
        )}

        {!loading && enriched.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider">Ticker</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider">Shares</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider">Avg Cost</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider">Price</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider">Value</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider">P&L</th>
                  <th className="text-right px-4 py-2 font-medium uppercase tracking-wider">P&L %</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {enriched.map((pos) => {
                  const gl = pos.gainLoss ?? 0;
                  const glPct = pos.gainLossPercent ?? 0;
                  const positive = isPositiveChange(gl);
                  return (
                    <tr key={pos.id} className="border-b border-border last:border-b-0 hover:bg-bg-hover group">
                      <td className="px-4 py-3 text-text-primary font-semibold tracking-wider">{pos.ticker}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{pos.shares}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{formatPrice(pos.avg_buy_price)}</td>
                      <td className="px-4 py-3 text-right text-text-primary">
                        {pos.currentPrice !== undefined ? formatPrice(pos.currentPrice) : <Skeleton className="h-3 w-16 ml-auto" />}
                      </td>
                      <td className="px-4 py-3 text-right text-text-primary">
                        {pos.currentValue !== undefined ? formatPrice(pos.currentValue) : '–'}
                      </td>
                      <td className={`px-4 py-3 text-right ${positive ? 'text-gain' : 'text-loss'}`}>
                        {pos.gainLoss !== undefined ? `${positive ? '+' : ''}${formatPrice(gl)}` : '–'}
                      </td>
                      <td className={`px-4 py-3 text-right ${positive ? 'text-gain' : 'text-loss'}`}>
                        {pos.gainLossPercent !== undefined ? `${positive ? '+' : ''}${glPct.toFixed(2)}%` : '–'}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={() => deletePosition(pos.id)}
                          className="text-text-muted hover:text-loss opacity-0 group-hover:opacity-100 transition-all text-base leading-none"
                          title="Remove"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <AddPositionModal
          onClose={() => setShowModal(false)}
          onSuccess={() => setRefresh((value) => value + 1)}
        />
      )}
    </>
  );
}
