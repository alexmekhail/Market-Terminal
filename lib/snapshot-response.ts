import { NextResponse } from 'next/server';
import { SnapshotError } from '@/lib/alpaca';
import type { Snapshot } from '@/types';
import { isSnapshotSymbol, SNAPSHOT_BATCH_LIMIT } from '@/lib/market-data-config';

export function snapshotSymbols(input: string | null, crypto = false) {
  if (!input || input.length > SNAPSHOT_BATCH_LIMIT * 21) return null;
  const symbols = input.split(',').map((symbol) => symbol.trim().toUpperCase());
  if (symbols.length > SNAPSHOT_BATCH_LIMIT || symbols.some((symbol) => !isSnapshotSymbol(symbol, crypto))) return null;
  return [...new Set(symbols)].sort();
}

export function snapshotResponse(data: Record<string, Snapshot> | { snapshot: Snapshot | null }) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15' },
  });
}

export function snapshotErrorResponse(error: unknown) {
  const status = error instanceof SnapshotError ? error.status : 502;
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (error instanceof SnapshotError && error.retryAfter) headers.set('Retry-After', error.retryAfter);
  return NextResponse.json({ error: 'Market snapshots unavailable' }, { status, headers });
}
