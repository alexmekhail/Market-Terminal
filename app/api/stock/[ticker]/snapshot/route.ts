import { NextRequest, NextResponse } from 'next/server';
import { fetchSnapshots } from '@/lib/alpaca';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: symbol } = await params;
  const ticker = symbol.toUpperCase();
  try {
    const data = await fetchSnapshots([ticker]);
    const snapshot = data[ticker] ?? null;
    return NextResponse.json({ snapshot }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`[/api/stock/${ticker}/snapshot]`, err);
    return NextResponse.json({ error: 'Failed to fetch snapshot' }, { status: 502 });
  }
}
