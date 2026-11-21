import { NextRequest, NextResponse } from 'next/server';
import { fetchSnapshots } from '@/lib/alpaca';
import { snapshotErrorResponse, snapshotResponse, snapshotSymbols } from '@/lib/snapshot-response';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: symbol } = await params;
  const tickers = snapshotSymbols(symbol);
  if (!tickers || tickers.length !== 1) return NextResponse.json({ error: 'Valid ticker required' }, { status: 400 });
  const [ticker] = tickers;
  try {
    const data = await fetchSnapshots(tickers);
    return snapshotResponse({ snapshot: data[ticker] ?? null });
  } catch (error) {
    return snapshotErrorResponse(error);
  }
}
