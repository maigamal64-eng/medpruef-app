import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/waitlist
 *
 * Open endpoint (no auth) — pricing page is reachable by logged-out
 * visitors so we can't require an authenticated user. Body:
 *
 *   { email, tierInterest: 'pro' | 'group', note?, userId? }
 *
 * User identity: mirrors /api/feedback — prefer the `x-user-id` header
 * (set by authFetch for logged-in users) over any body-supplied userId,
 * and only persist the link if the UUID actually exists in users.
 * Unverified UUIDs are silently dropped (NOT rejected) so a malformed
 * session never stops a signup.
 *
 * Rate-limit: if the same email was submitted within the last 24h we
 * return `{ok: true}` without re-inserting — this keeps the UX silent
 * for users who click twice and stops someone from hammering the
 * endpoint to fill the table.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
    const tierInterest = String(body?.tierInterest || "").toLowerCase();
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
    const bodyUserId = typeof body?.userId === "string" ? body.userId : null;

    // Lightweight email check — full RFC parsing is overkill; the
    // real validation happens when we try to send mail.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRaw || emailRaw.length > 254 || !emailRe.test(emailRaw)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    const email = emailRaw.toLowerCase();

    if (!["pro", "group", "unknown"].includes(tierInterest)) {
      return NextResponse.json({ error: "Invalid tierInterest" }, { status: 400 });
    }

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const headerId = req.headers.get("x-user-id");
    const candidate =
      headerId && uuidRe.test(headerId)
        ? headerId
        : bodyUserId && uuidRe.test(bodyUserId)
          ? bodyUserId
          : null;

    const sb = getServiceClient();

    let userId: string | null = null;
    if (candidate) {
      const { data } = await sb
        .from("users")
        .select("id")
        .eq("id", candidate)
        .maybeSingle();
      if (data) userId = candidate;
    }

    // Dedupe: same email + same tier inside 24h → return success silently.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await sb
      .from("pricing_waitlist")
      .select("id")
      .eq("email", email)
      .eq("tier_interest", tierInterest)
      .gte("created_at", since)
      .maybeSingle();

    if (recent) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    const { error } = await sb.from("pricing_waitlist").insert({
      user_id: userId,
      email,
      tier_interest: tierInterest,
      note,
    });

    if (error) {
      console.error("[waitlist POST]", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[waitlist POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
