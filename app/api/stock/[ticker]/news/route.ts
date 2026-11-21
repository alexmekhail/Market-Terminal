import { NextRequest, NextResponse } from 'next/server';
import { fetchNews } from '@/lib/alpaca';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: symbol } = await params;
  const ticker = symbol.toUpperCase();
  try {
    const news = await fetchNews(ticker, 20);
    return NextResponse.json({ news }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`[/api/stock/${ticker}/news]`, err);
    return NextResponse.json({ error: 'Failed to fetch news' }, { status: 502 });
  }
}
