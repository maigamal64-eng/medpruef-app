import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { assertDb, enabled, noStore } from "@/lib/reminders/common";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("unsub");
  if (token !== null) {
    if (!uuid.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 400, headers: noStore });
    try {
      // Opt-out always works, including while the sending flag is OFF.
      const { error } = await getServiceClient().from("study_nudge_prefs").update({ opt_in: false }).eq("unsub_token", token);
      assertDb(error);
      return new NextResponse("Study nudges have been turned off for this link.", { headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });
    } catch { return NextResponse.json({ error: "Could not save preference" }, { status: 503, headers: noStore }); }
  }
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!enabled("STUDY_NUDGE_ENABLED")) return NextResponse.json({ enabled: false, opt_in: null, channel: "email" }, { headers: noStore });
  try {
    const { data, error } = await getServiceClient().from("study_nudge_prefs").select("opt_in,channel,last_sent").eq("user_id", guard.userId).maybeSingle();
    assertDb(error);
    return NextResponse.json({ enabled: true, opt_in: false, channel: "email", ...data }, { headers: noStore });
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
      const owner = await db.from("users").select("email").eq("id", guard.userId).maybeSingle();
      assertDb(owner.error);
      if (!owner.data?.email) return NextResponse.json({ error: "Add an email to your account first" }, { status: 400, headers: noStore });
      const { error } = await db.from("study_nudge_prefs").upsert({ user_id: guard.userId, opt_in: true, channel: "email" }, { onConflict: "user_id" });
      assertDb(error);
    } else {
      const { error } = await db.from("study_nudge_prefs").update({ opt_in: false }).eq("user_id", guard.userId);
      assertDb(error);
    }
    return NextResponse.json({ ok: true, opt_in: body.opt_in, channel: "email" }, { headers: noStore });
  } catch { return NextResponse.json({ error: "Could not save preference" }, { status: 503, headers: noStore }); }
}
