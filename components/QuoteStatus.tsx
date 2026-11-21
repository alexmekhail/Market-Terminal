import { quoteFreshness, type PollState } from '@/lib/market-polling';
import type { Snapshot } from '@/types';

export function QuoteStatus({ state }: { state: PollState & { loading?: boolean } }) {
  const values = Object.values(state.quotes).filter((quote): quote is Snapshot => Boolean(quote));
  const missing = Object.keys(state.quotes).some((symbol) => state.missing.has(symbol));
  const now = Date.now();
  const freshness = values.map((quote) => quoteFreshness(quote, now, Boolean(state.error) || state.missing.has(quote.ticker)));
  const status = freshness.includes('Stale') ? 'Stale quotes'
    : missing ? 'Some quotes unavailable'
    : freshness.includes('Delayed') ? 'Delayed quotes'
    : freshness.includes('Timestamp unavailable') ? 'Market time unavailable' : 'Current snapshot';
  const marketTimes = values.flatMap((quote) => quote.marketTime === null ? [] : [quote.marketTime]);
  const timestamp = marketTimes.length ? Math.min(...marketTimes)
    : values.length ? Math.min(...values.map((quote) => quote.fetchedAt)) : null;
  const warning = state.error === 'rate-limit' ? 'Rate limited'
    : state.error === 'configuration' ? 'Quote service unavailable'
    : state.error ? 'Refresh failed' : null;

  return (
    <span role="status" className={`text-[10px] font-mono ${warning || status === 'Stale quotes' || missing ? 'text-amber-400' : 'text-text-muted'}`}>
      {values.length ? status : (state.loading || state.refreshing) ? 'Loading quotes…' : 'Quotes unavailable'}
      {timestamp !== null && (
        <> · {marketTimes.length ? 'Market' : 'Snapshot'} as of <time dateTime={new Date(timestamp).toISOString()}>
          {new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </time></>
      )}
      {warning && <> · {warning}</>}
      {state.refreshing && values.length > 0 && <> · Refreshing…</>}
    </span>
  );
}
