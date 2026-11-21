'use client';

import { useMarketPolling } from '@/lib/use-market-polling';
import { QuoteStatus } from '@/components/QuoteStatus';

import { memo } from 'react';
import { formatPrice, formatChangePercent, isPositiveChange } from '@/lib/utils';

const DEFAULT_TICKERS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN', 'GOOGL', 'META', 'SPY'];

export function TickerBar() {
  const polling = useMarketPolling(DEFAULT_TICKERS);
  const { quotes: prices } = polling;

  const tickers = DEFAULT_TICKERS.filter((t) => prices[t]);

  if (tickers.length === 0) {
    return (
      <div className="h-8 bg-bg-secondary border-b border-border flex items-center px-4">
        <QuoteStatus state={polling} />
      </div>
    );
  }

  return (
    <div className="h-8 bg-bg-secondary border-b border-border overflow-hidden flex items-center">
      <div className="shrink-0 px-3 bg-bg-secondary"><QuoteStatus state={polling} /></div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex animate-ticker-scroll whitespace-nowrap" style={{ width: 'max-content' }}>
          {[...tickers, ...tickers].map((ticker, index) => {
            const quote = prices[ticker];
            return quote && (
              <TickerQuote key={`${ticker}-${index}`} ticker={ticker} price={quote.price} changePercent={quote.changePercent} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const TickerQuote = memo(function TickerQuote({ ticker, price, changePercent }: {
  ticker: string;
  price: number;
  changePercent: number;
}) {
  return (
    <span className="inline-flex items-center gap-2 px-5 border-r border-border/50 text-xs font-mono">
      <span className="text-text-secondary font-semibold tracking-wider">{ticker}</span>
      <span className="text-text-primary">{formatPrice(price)}</span>
      <span className={isPositiveChange(changePercent) ? 'text-gain' : 'text-loss'}>
        {formatChangePercent(changePercent)}
      </span>
    </span>
  );
});
