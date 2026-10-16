import { NextRequest, NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { emailConfirmEnabled } from "@/lib/email-confirm/flag";
import { readPendingStatus, resendAllowed, sendConfirmMail } from "@/lib/email-confirm/server";

export const dynamic = "force-dynamic";
// The resend POST calls the mail provider once.
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const RESEND_LIMIT = { limit: 3, windowMs: 60 * 60_000 };

/**
 * GET /api/email-confirm (a-email-confirm-trial): the Home line's status.
 * {enabled:false} without a read while the step is off; else pending only for
 * an unconfirmed email account at most 7 days old without Telegram.
 */
async function handleGET(req: NextRequest) {
  if (!emailConfirmEnabled()) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const status = await readPendingStatus(getServiceClient(), guard.userId);
  if (!status) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
  if (!status.pending) return NextResponse.json({ enabled: true, pending: false }, { headers: NO_STORE });
  return NextResponse.json({ enabled: true, pending: true, email: status.email, trial: status.trial, sent: status.sent }, { headers: NO_STORE });
}

/** POST /api/email-confirm {lang}: send the link again (3 an hour per instance, 1 a minute and 5 a day per account). */
async function handlePOST(req: NextRequest) {
  if (!emailConfirmEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const gate = checkRateLimit({ key: rateKey("email-confirm-resend", guard.userId), ...RESEND_LIMIT });
  if (!gate.allowed) {
    return NextResponse.json({ error: "rate_limited", retryAfter: gate.retryAfterSec }, { status: 429, headers: { ...NO_STORE, ...rateLimitHeaders(gate, RESEND_LIMIT) } });
  }
  let lang: "de" | "en" = "en";
  try {
    const body = (await req.json()) as { lang?: unknown };
    if (body?.lang === "de") lang = "de";
  } catch { /* no body: English */ }
  const sb = getServiceClient();
  const now = new Date();
  const status = await readPendingStatus(sb, guard.userId, now);
  if (!status) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { ...NO_STORE, "Retry-After": "15" } });
  if (!status.pending) return NextResponse.json({ ok: true, pending: false }, { headers: NO_STORE });
  if (!resendAllowed(status, now)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  const outcome = await sendConfirmMail(sb, {
    userId: guard.userId,
    email: status.email,
    lang,
    source: "resend",
    trial: status.trial,
    now,
  });
  if (outcome === "sent") return NextResponse.json({ ok: true, sent: true, email: status.email }, { headers: NO_STORE });
  return NextResponse.json({ error: outcome === "suppressed" ? "undeliverable" : "send_failed" }, { status: outcome === "suppressed" ? 422 : 502, headers: NO_STORE });
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
