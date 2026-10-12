import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { getServiceClient } from '@/lib/supabase';
import { isUiLanguage } from '@/lib/language-model';
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const maxDuration = 30;

async function handlePATCH(req: NextRequest) {
  const guard = await requireUser(req);
  if ('error' in guard) return guard.error;
  const body = await req.json().catch(() => null);
  if (!isUiLanguage(body?.language)) return NextResponse.json({ error: 'Invalid language' }, { status: 400 });
  const { error } = await getServiceClient().from('users').update({ language_code: body.language }).eq('id', guard.userId);
  if (error) return NextResponse.json({ error: 'Language could not be saved' }, { status: 503 });
  return NextResponse.json({ ok: true });
}

export const PATCH = withDbUnavailable(handlePATCH);
