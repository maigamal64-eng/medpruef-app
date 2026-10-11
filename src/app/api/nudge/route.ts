import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { assertDb, enabled, noStore } from "@/lib/reminders/common";

import { unsubscribeCredential, verifyReminderToken } from "@/lib/reminders/tokens";
import { confirmStudyConsent, requestStudyConsent, deliverableDestination } from "@/lib/reminders/study-consent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export async function GET(req: NextRequest) {
  const confirmation = req.nextUrl.searchParams.get("confirm");
  if (confirmation !== null) {
    try {
      if (!verifyReminderToken(confirmation, "study-confirm")) return NextResponse.json({ error: "Invalid or expired confirmation" }, { status: 400, headers: noStore });
      const ok = await confirmStudyConsent(getServiceClient(), confirmation);
      return NextResponse.json(ok ? { ok: true } : { error: "Invalid or expired confirmation" }, { status: ok ? 200 : 400, headers: noStore });
    } catch { return NextResponse.json({ error: "Could not save preference" }, { status: 503, headers: noStore }); }
  }
  const token = req.nextUrl.searchParams.get("unsub");
  if (token !== null) {
    try {
      const credential = unsubscribeCredential(token, "study");
      if (!credential) return NextResponse.json({ error: "Invalid link" }, { status: 400, headers: noStore });
      // Opt-out always works, including while the sending flag is OFF.
      const { error } = await getServiceClient().from("study_nudge_prefs").update({ opt_in: false, pending_email: null, confirmation_token: randomUUID() }).eq("unsub_token", credential);
      assertDb(error);
      return new NextResponse("Study nudges have been turned off for this link.", { headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });
    } catch { return NextResponse.json({ error: "Could not save preference" }, { status: 503, headers: noStore }); }
  }
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!enabled("STUDY_NUDGE_ENABLED")) return NextResponse.json({ enabled: false, opt_in: null, channel: "email" }, { headers: noStore });
  try {
    const { data, error } = await getServiceClient().from("study_nudge_prefs").select("opt_in,channel,last_sent,consent_email,consent_confirmed_at,consent_version").eq("user_id", guard.userId).maybeSingle();
    assertDb(error);
    const owner = await getServiceClient().from("users").select("email,email_status").eq("id", guard.userId).maybeSingle();
    assertDb(owner.error);
    const bound = !!data?.consent_email && !!data?.consent_confirmed_at && data?.consent_version === 1 && data.consent_email === deliverableDestination(owner.data);
    return NextResponse.json({ enabled: true, opt_in: !!data?.opt_in && bound, channel: "email", last_sent: data?.last_sent ?? null }, { headers: noStore });
  } catch { return NextResponse.json({ error: "Could not load preference" }, { status: 503, headers: noStore }); }
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const body = await req.json().catch(() => null);
  if (typeof body?.opt_in !== "boolean" || (body.channel !== undefined && body.channel !== "email")) return NextResponse.json({ error: "Choose an email preference" }, { status: 400, headers: noStore });
  // Disabling remains possible during a rollout hold. No opt-in while OFF.
  if (body.opt_in && !enabled("STUDY_NUDGE_ENABLED")) return NextResponse.json({ error: "Study nudges are not enabled" }, { status: 409, headers: noStore });
  try {
    const db = getServiceClient();
    if (body.opt_in) {
      if (!await requestStudyConsent(db, guard.userId)) return NextResponse.json({ error: "Verify your account email first" }, { status: 400, headers: noStore });
      return NextResponse.json({ ok: true, opt_in: false, confirmation_pending: true, channel: "email" }, { headers: noStore });
    } else {
      const { error } = await db.from("study_nudge_prefs").update({ opt_in: false, pending_email: null, confirmation_token: randomUUID() }).eq("user_id", guard.userId);
      assertDb(error);
    }
    return NextResponse.json({ ok: true, opt_in: body.opt_in, channel: "email" }, { headers: noStore });
  } catch { return NextResponse.json({ error: "Could not save preference" }, { status: 503, headers: noStore }); }
}
