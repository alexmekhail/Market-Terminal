import { NextRequest, NextResponse } from 'next/server';
import { fetchSnapshots } from '@/lib/alpaca';
import { snapshotErrorResponse, snapshotResponse, snapshotSymbols } from '@/lib/snapshot-response';

export async function GET(req: NextRequest) {
  const symbols = snapshotSymbols(req.nextUrl.searchParams.get('symbols'));
  if (!symbols) return NextResponse.json({ error: 'Valid symbols required' }, { status: 400 });
  try {
    return snapshotResponse(await fetchSnapshots(symbols));
  } catch (error) {
    return snapshotErrorResponse(error);
  }
}
