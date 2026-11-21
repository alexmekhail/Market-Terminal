export const POLL_INTERVAL_MS = 30_000;
export const SNAPSHOT_BATCH_LIMIT = 200;

export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const date = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}


export function isSnapshotSymbol(symbol: string, crypto = false) {
  return (crypto ? /^[A-Z0-9]{1,16}(?:\/USD)?$/ : /^[A-Z0-9][A-Z0-9.:-]{0,15}$/).test(symbol);
}
