import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { verifySession, SESSION_HEADER } from "@/lib/session";
import { createHash } from "node:crypto";
import { isUiLanguage, renderLang } from "@/lib/language-model";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/link-email/verify  { token, lang }
 *
 * Commits email+password_hash to the authenticated user's row.
 * Session is OPTIONAL: the link may be opened on a different device or in a
 * mail webview where the session token is not available. In that case we rely
 * on the token binding (pending.user_id) set during the requireUser-gated
 * start call.
 *
 * If a session IS present, we assert session.userId === pending.user_id as an
 * extra consistency check — but we do NOT gate on the session being present.
 *
 * Auth guardrails:
 *   - Commit uses WHERE id = pending.user_id AND email IS NULL
 *     → can never overwrite an existing email on any user (TOCTOU-safe)
 *   - users_email_key UNIQUE constraint is the DB-level backstop
 *   - session_invalidated_at is NEVER written (Telegram session keeps working)
 *   - email_verified_at is set here but NEVER checked as a login gate
 *   - Token is single-use: used_at is set before the UPDATE, and the DB
 *     pending_email unique index prevents parallel commits on the same address
 */
/**
 * UX-ONB-40: confirmation is a POST sent by the "E-Mail bestätigen" button,
 * never a GET on page load, so mail and link scanners that prefetch the link
 * cannot consume the single-use token. The token travels in the body, not in
 * a URL that proxies and logs keep.
 */
export async function GET() {
  return jsonResp({ error: "use_post" }, 405);
}

export async function POST(req: NextRequest) {
  let body: { token?: unknown; lang?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty body: invalid token below */ }
  const rawToken = typeof body.token === "string" ? body.token : "";
  const requested = typeof body.lang === "string" ? body.lang : null;
  const lang = isUiLanguage(requested) ? renderLang(requested) : "en";

  if (!rawToken || rawToken.length < 32) {
    return jsonResp({ error: "invalid_token" }, 400);
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const sb = getServiceClient();

  // Look up the pending token
  const { data: pending, error: lookupErr } = await sb
    .from("email_link_tokens")
    .select("id, user_id, pending_email, password_hash, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (lookupErr) {
    console.error("[link-email/verify] DB lookup error:", lookupErr);
    return jsonResp({ error: "server_error" }, 500);
  }
  if (!pending) {
    return jsonResp({ error: "invalid_token" }, 400);
  }
  if (pending.used_at) {
    return jsonResp({ error: "token_already_used" }, 409);
  }
  if (new Date(pending.expires_at) < new Date()) {
    return jsonResp({ error: "token_expired" }, 410);
  }

  // Optional session check — do NOT gate on session presence (cross-device use)
  const sessionToken = req.headers.get(SESSION_HEADER);
  if (sessionToken) {
    const session = verifySession(sessionToken);
    if (session && session.userId !== pending.user_id) {
      // The session belongs to a DIFFERENT user — almost certainly a confused
      // browser. Refuse rather than silently writing to the wrong account.
      return jsonResp(
        {
          error: "session_mismatch",
          message: lang === "de"
            ? "Der Link gehört zu einem anderen Konto."
            : "This link belongs to a different account.",
        },
        403,
      );
    }
  }

  // Mark the token as used BEFORE the UPDATE — prevents parallel verify calls
  // from both committing (last-write wins would cause a silent email overwrite).
  // If the UPDATE fails after this, the token is consumed but the email wasn't
  // linked; the user must restart the flow. This is the safe direction: a
  // failed link attempt is recoverable, an overwrote email is not.
  const { error: markErr } = await sb
    .from("email_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", pending.id)
    .is("used_at", null); // idempotent guard

  if (markErr) {
    console.error("[link-email/verify] Could not mark token used:", markErr);
    return jsonResp({ error: "server_error" }, 500);
  }

  // TOCTOU re-check: verify the email is still unclaimed
  const { data: collision } = await sb
    .from("users")
    .select("id")
    .eq("email", pending.pending_email)
    .maybeSingle();

  if (collision) {
    // Another account claimed this email between start and verify
    return jsonResp(
      {
        error: "email_taken",
        message: lang === "de"
          ? "Diese E-Mail-Adresse ist inzwischen einem anderen Konto zugeordnet."
          : "This email address was linked to another account in the meantime.",
      },
      409,
    );
  }

  // Commit email + password_hash to the user's own row.
  // WHERE email IS NULL: if the user somehow already has an email (e.g. a
  // concurrent verify on the same token), this UPDATE is a no-op and
  // rowCount will be 0.
  const { data: updated, error: updateErr } = await sb
    .from("users")
    .update({
      email: pending.pending_email,
      password_hash: pending.password_hash,
      email_verified_at: new Date().toISOString(),
      // NEVER touch session_invalidated_at — the Telegram session stays live
    })
    .eq("id", pending.user_id)
    .is("email", null) // WHERE email IS NULL — cannot overwrite
    .select("id")
    .maybeSingle();

  if (updateErr) {
    // Unique constraint violation on users_email_key → race with another commit
    if (updateErr.code === "23505") {
      return jsonResp(
        {
          error: "email_taken",
          message: lang === "de"
            ? "Diese E-Mail-Adresse ist bereits vergeben."
            : "This email address is already in use.",
        },
        409,
      );
    }
    console.error("[link-email/verify] DB update error:", updateErr);
    return jsonResp({ error: "server_error" }, 500);
  }

  if (!updated) {
    // no-op UPDATE: the user already has an email — idempotent success
    return jsonResp({ ok: true, already_linked: true });
  }

  return jsonResp({ ok: true, email: pending.pending_email });
}

function jsonResp(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}
