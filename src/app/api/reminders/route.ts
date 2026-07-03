import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { resolveOptionalUser } from "@/lib/auth-guard";
import { sanitizeAttribution } from "@/lib/attribution";

export const dynamic = "force-dynamic";

/**
 * Exam deadline reminder signup (2026-07-03). The purest lead magnet in this
 * market: a candidate always wants "tell me before registration closes."
 *
 * POST { email, exam_type?, locale?, source?, attribution? } → upsert into
 * exam_reminders. Open endpoint (logged-out landing visitors), identity taken
 * only from the verified session when present (never a body id). Idempotent
 * per (email, exam_type): a repeat returns 200 { already: true } and revives
 * a prior unsubscribe. Sending nudges is a separate scheduled task.
 *
 * GET ?unsub=<token> → one-click unsubscribe (stamps unsubscribed_at).
 */

const EXAMS = new Set(["kenntnispruefung", "kmp_innsbruck", "pharma", "all"]);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !emailRe.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    const examType = EXAMS.has(String(body?.exam_type)) ? String(body.exam_type) : "all";
    const locale = ["de", "en", "ru", "uk", "tr", "ar"].includes(String(body?.locale))
      ? String(body.locale)
      : "de";
    const source = typeof body?.source === "string" ? body.source.trim().slice(0, 40) : "landing";
    const utm = sanitizeAttribution(body?.attribution) ?? null;

    const userId = resolveOptionalUser(req);
    const db = getServiceClient();

    // Verify the user row exists before linking (mirror /api/feedback).
    let linkedUserId: string | null = null;
    if (userId) {
      const { data } = await db.from("users").select("id").eq("id", userId).maybeSingle();
      if (data) linkedUserId = userId;
    }

    const { data: existing } = await db
      .from("exam_reminders")
      .select("id, unsubscribed_at")
      .eq("email", email)
      .eq("exam_type", examType)
      .maybeSingle();

    if (existing) {
      // Revive an unsubscribe / refresh metadata, but don't churn the row.
      await db
        .from("exam_reminders")
        .update({ unsubscribed_at: null, locale, user_id: linkedUserId ?? undefined })
        .eq("id", existing.id);
      return NextResponse.json({ ok: true, already: true });
    }

    const { error } = await db.from("exam_reminders").insert({
      email,
      exam_type: examType,
      locale,
      source,
      utm,
      user_id: linkedUserId,
    });
    if (error) {
      // Unique race → treat as success.
      if (error.code === "23505") return NextResponse.json({ ok: true, already: true });
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("unsub");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  try {
    const db = getServiceClient();
    const { data } = await db
      .from("exam_reminders")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("unsub_token", token)
      .select("email")
      .maybeSingle();
    const body = data
      ? "You have been unsubscribed from MedPrüf exam reminders."
      : "This unsubscribe link is invalid or already used.";
    return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch {
    return new NextResponse("Error processing unsubscribe.", { status: 500 });
  }
}
