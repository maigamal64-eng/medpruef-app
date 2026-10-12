import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { requireUser, resolveOptionalUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/waitlist
 *
 * Open endpoint (no auth) — pricing page is reachable by logged-out
 * visitors so we can't require an authenticated user. Body accepts
 * either the legacy shape (from earlier Pro-waitlist work) or the
 * 2026-04-22 Stripe-pending shape:
 *
 *   Legacy:  { email, tierInterest: 'pro' | 'group' | 'unknown', note?, userId? }
 *   Stripe:  { email, tier_interest: 'monthly' | '3mo' | '6mo' | '12mo' | 'pro' | 'group',
 *              exam_type?: 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma',
 *              exam_date?: 'YYYY-MM-DD',
 *              source?: 'stripe_pending' | ... ,
 *              note? }
 *
 * Both shapes land in `pricing_waitlist`. Exam metadata + source are
 * folded into the `note` column as a short JSON blob so we don't need
 * a migration to ship the crypto June-26-Cohort launch — when Stripe Atlas
 * clears and we actually mail these people, we parse the note server-
 * side to segment by exam and tier.
 *
 * User identity: mirrors /api/feedback — derived ONLY from the verified
 * session token (S-1, via resolveOptionalUser), and only persisted if
 * the user row actually exists. Never a client-supplied header/body id.
 *
 * Rate-limit: if the same email + tier was submitted within the last
 * 24h we return 409 (so the UI can show "already on the waitlist")
 * instead of silently swallowing.
 */
export async function POST(req: NextRequest) {
  try {
    // a26: the public Gerichtsmedizin interest form widens this anonymous
    // write; cap it per IP before reading the body.
    const ipGate = checkRateLimit({ key: rateKey("waitlist-ip", callerIp(req)), limit: 5, windowMs: 10 * 60_000 });
    if (!ipGate.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(ipGate.retryAfterSec) } });
    }
    const body = await req.json().catch(() => ({}));
    const mentorInterest = body?.source === "mentor_packages";
    let mentorUserId: string | null = null;
    let ownedEmail = "";
    if (mentorInterest) {
      const guard = await requireUser(req);
      if ("error" in guard) return guard.error;
      mentorUserId = guard.userId;
      const { data, error } = await getServiceClient().from("users").select("email").eq("id", guard.userId).maybeSingle();
      if (error || typeof data?.email !== "string") return NextResponse.json({ error: "Email unavailable" }, { status: 503 });
      ownedEmail = data.email.trim();
    }
    const emailRaw = mentorInterest ? ownedEmail : typeof body?.email === "string" ? body.email.trim() : "";
    // Accept both `tierInterest` (camelCase, legacy) and `tier_interest`
    // (snake_case, 2026-04-22 Stripe-pending shape) — whichever wins.
    const tierInterest = String(
      mentorInterest ? "unknown" : body?.tier_interest ?? body?.tierInterest ?? ""
    )
      .toLowerCase()
      .trim();
    const explicitNote =
      !mentorInterest && typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;

    // Optional Stripe-pending metadata — folded into the `note` column.
    const examType = !mentorInterest && typeof body?.exam_type === "string" ? body.exam_type.trim() : null;
    const examDate = !mentorInterest && typeof body?.exam_date === "string" ? body.exam_date.trim() : null;
    const source = typeof body?.source === "string" ? body.source.trim() : null;

    // Lightweight email check — full RFC parsing is overkill; the
    // real validation happens when we try to send mail.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRaw || emailRaw.length > 254 || !emailRe.test(emailRaw)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    const email = emailRaw.toLowerCase();

    // Tier whitelist — covers both legacy Pro/Group waitlist AND the
    // new standard-tier waitlist (monthly/3mo/6mo/12mo) that the
    // crypto June-26-Cohort pricing page opens for Stripe-pending users.
    const ALLOWED_TIERS = new Set([
      "pro",
      "group",
      "unknown",
      "monthly",
      "3mo",
      "6mo",
      "12mo",
    ]);
    if (!ALLOWED_TIERS.has(tierInterest)) {
      return NextResponse.json({ error: "Invalid tier_interest" }, { status: 400 });
    }

    // ISO-ish date guard — accept YYYY-MM-DD only.
    if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      return NextResponse.json({ error: "Invalid exam_date" }, { status: 400 });
    }

    const ALLOWED_EXAM_TYPES = new Set([
      "kenntnispruefung",
      "kmp_innsbruck",
      "pharma",
      "gerichtsmedizin",
    ]);
    if (examType && !ALLOWED_EXAM_TYPES.has(examType)) {
      return NextResponse.json({ error: "Invalid exam_type" }, { status: 400 });
    }

    // Compose the note column — free text from the user (if any) plus
    // the structured metadata appended as a JSON tail. Total <= 500 chars.
    const meta: Record<string, string> = {};
    if (source) meta.source = source.slice(0, 40);
    if (examType) meta.exam_type = examType;
    if (examDate) meta.exam_date = examDate;
    const metaTail = Object.keys(meta).length
      ? ` ${JSON.stringify(meta)}`
      : "";
    const note = ((explicitNote ?? "") + metaTail).trim().slice(0, 500) || null;

    // Optional user link from the verified session token (S-1) — never
    // a client-supplied header/body id.
    const candidate = mentorUserId ?? resolveOptionalUser(req);

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

    // Dedupe: same email + same tier inside 24h → return 409 so the UI
    // can distinguish a fresh signup from a repeat.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await sb
      .from("pricing_waitlist")
      .select("id")
      .eq("email", email)
      .eq("tier_interest", tierInterest)
      .gte("created_at", since)
      .maybeSingle();

    if (recent) {
      return NextResponse.json(
        { ok: true, deduped: true },
        { status: 409 }
      );
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
