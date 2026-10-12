import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { getServiceClient } from '@/lib/supabase';
import { pendingCheckout } from '@/lib/checkout-pending';
export const dynamic = 'force-dynamic';
/** A signed, bounded ledger read. Redirects are pending, never paid receipts. */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ('error' in guard) return guard.error;
  try {
    const { data, error } = await getServiceClient().from('payment_events')
      .select('event,created_at,tier,checkout_session_id,reason,metadata').eq('user_id', guard.userId)
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60_000).toISOString())
      .in('event', ['checkout_redirected', 'grant_succeeded', 'checkout_failed']).order('created_at', { ascending: false }).limit(100);
    if (error) return NextResponse.json({ error: 'Status unavailable' }, { status: 503 });
    const pending = pendingCheckout(data ?? [], Date.now(), 48 * 60 * 60_000);
    const meta = (pending as { metadata?: { extends_from?: unknown } } | null)?.metadata;
    const extendsFrom = typeof meta?.extends_from === 'string' ? meta.extends_from : null;
    return NextResponse.json({ pending: pending ? { tier: pending.tier, created_at: pending.created_at, reference: pending.checkout_session_id ?? null, extends_from: extendsFrom, expired: Date.now() - Date.parse(pending.created_at) >= 24 * 60 * 60_000 } : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Status unavailable' }, { status: 503 }); }
}
