import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/non-crypto-waitlist
 *
 * Email capture for users who hit the pre-checkout trust dialog and
 * tap "Ich habe keine Krypto." Stores email + provider context so we
 * can email them with a Stripe link as soon as Atlas clears.
 *
 * Open endpoint (no auth required) — pricing page is reachable
 * logged-out. If `x-user-id` is present we link the row to the user.
 *
 * Body: { email: string, tier_interest?: string,
 *         current_provider?: 'binance'|'kraken'|'coinbase'|'other'|'none',
 *         notes?: string }
 *
 * Rate-limit: 3 submissions per IP per minute (not per user — most
 * callers will be logged-out). The form is intentionally low-friction
 * so we don't want to mistake a normal repeat-submission pattern for
 * abuse, but a flood from one IP is suspicious.
 */

const RATE_LIMIT = { limit: 3, windowMs: 60_000 };
const ALLOWED_PROVIDERS = new Set([
  "binance",
  "kraken",
  "coinbase",
  "other",
  "none",
]);
const ALLOWED_TIERS = new Set([
  "first_month_19",
  "monthly",
  "three_month",
  "six_month",
  "twelve_month",
  "premium_pass_guaranteed",
  "unknown",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const gate = checkRateLimit({
    key: rateKey("non-crypto-waitlist", ip),
    ...RATE_LIMIT,
  });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many submissions, please wait." },
      { status: 429, headers: rateLimitHeaders(gate, RATE_LIMIT) }
    );
  }

  let body: {
    email?: string;
    tier_interest?: string;
    current_provider?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const tierInterest = (body.tier_interest || "").toLowerCase().trim();
  if (tierInterest && !ALLOWED_TIERS.has(tierInterest)) {
    return NextResponse.json({ error: "Invalid tier_interest" }, { status: 400 });
  }

  const currentProvider = (body.current_provider || "").toLowerCase().trim();
  if (currentProvider && !ALLOWED_PROVIDERS.has(currentProvider)) {
    return NextResponse.json(
      { error: "Invalid current_provider" },
      { status: 400 }
    );
  }

  const notes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null;

  // Optional user link — header takes precedence; if it's a valid uuid
  // and the row exists, we set user_id.
  const headerId = req.headers.get("x-user-id");
  let userId: string | null = null;
  if (headerId && UUID_RE.test(headerId)) {
    const sb = getServiceClient();
    const { data } = await sb
      .from("users")
      .select("id")
      .eq("id", headerId)
      .maybeSingle();
    if (data) userId = headerId;
  }

  try {
    const sb = getServiceClient();
    const { error: insertErr } = await sb.from("non_crypto_waitlist").insert({
      email,
      user_id: userId,
      tier_interest: tierInterest || null,
      current_provider: currentProvider || null,
      notes,
    });
    if (insertErr) {
      captureServerError(insertErr, {
        route: "/api/non-crypto-waitlist",
        phase: "insert",
      });
      return NextResponse.json(
        { error: "Failed to save" },
        { status: 500 }
      );
    }

    // Telemetry — feeds the daily digest + admin overview tile.
    if (userId) {
      try {
        await sb.from("user_events").insert({
          user_id: userId,
          event_type: "non_crypto_waitlist_signed",
          event_data: {
            tier_interest: tierInterest || null,
            current_provider: currentProvider || null,
          },
        });
      } catch {
        /* non-blocking */
      }
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    captureServerError(err, { route: "/api/non-crypto-waitlist" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
