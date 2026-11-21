import { NextRequest, NextResponse } from 'next/server';
import { normalizeStockSymbol } from '@/lib/stock-symbol';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
  return NextResponse.json({ watchlist: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ticker = normalizeStockSymbol(body?.ticker);
  if (!ticker) return NextResponse.json({ error: 'Valid ticker required' }, { status: 400 });

  const { data, error } = await supabase
    .from('watchlist')
    .insert({ user_id: user.id, ticker })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already in watchlist' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
  }
  return NextResponse.json({ item: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ticker = normalizeStockSymbol(req.nextUrl.searchParams.get('ticker'));
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const { error } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', user.id)
    .eq('ticker', ticker);

  if (error) return NextResponse.json({ error: 'Database operation failed' }, { status: 500 });
  return NextResponse.json({ success: true });
}
