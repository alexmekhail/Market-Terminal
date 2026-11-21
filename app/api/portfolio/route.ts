import { NextRequest, NextResponse } from 'next/server';
import { normalizeStockSymbol } from '@/lib/stock-symbol';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('portfolio')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
  return NextResponse.json({ positions: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ticker = normalizeStockSymbol(body?.ticker);
  const { shares, avg_buy_price } = body ?? {};
  if (!ticker || typeof shares !== 'number' || !Number.isFinite(shares) || shares <= 0
    || typeof avg_buy_price !== 'number' || !Number.isFinite(avg_buy_price) || avg_buy_price <= 0) {
    return NextResponse.json({ error: 'Valid ticker, shares and average price required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('portfolio')
    .upsert(
      { user_id: user.id, ticker, shares, avg_buy_price },
      { onConflict: 'user_id,ticker' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
  return NextResponse.json({ position: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Valid position id required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('portfolio')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
  return NextResponse.json({ success: true });
}
