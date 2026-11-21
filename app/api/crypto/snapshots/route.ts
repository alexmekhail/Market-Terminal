import { NextRequest, NextResponse } from 'next/server';
import { fetchCryptoSnapshots } from '@/lib/alpaca';
import { snapshotErrorResponse, snapshotResponse, snapshotSymbols } from '@/lib/snapshot-response';

export async function GET(req: NextRequest) {
  const symbols = snapshotSymbols(req.nextUrl.searchParams.get('symbols'), true);
  if (!symbols) return NextResponse.json({ error: 'Valid symbols required' }, { status: 400 });
  try {
    return snapshotResponse(await fetchCryptoSnapshots(symbols));
  } catch (error) {
    return snapshotErrorResponse(error);
  }
}
