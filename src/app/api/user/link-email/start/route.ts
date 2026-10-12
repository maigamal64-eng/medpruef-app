import { NextRequest, NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { sendZohoEmail } from "@/lib/email/zoho";
import { COMPANY } from "@/lib/content-truth";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

// This route sends email to a user-supplied address, so it needs its own
// bucket separate from auth routes. 3 attempts per hour per user is generous
// for an email-linking flow (a user would rarely retry more than once or twice)
// while still blocking email-bombing a third-party inbox via a compromised token.
const LINK_EMAIL_RATE_LIMIT = { limit: 3, windowMs: 60 * 60_000 };

/**
 * POST /api/user/link-email/start
 *
 * Allows a Telegram-only user (no email, no password_hash) to initiate
 * email+password linking. Stages credentials in email_link_tokens; sends a
 * one-shot verification link via Zoho. The live Telegram session is never
 * disrupted — session_invalidated_at is never touched.
 *
 * Flow:
 *   1. requireUser — userId from signed session token (never from body)
 *   2. Reject if the user already has an email (linking is additive only)
 *   3. Collision check — reject if the email belongs to another user (409)
 *   4. bcrypt the password (rounds = 10, matching register flow)
 *   5. Stage in email_link_tokens (sha256(token) stored, not the raw token)
 *   6. Email the one-shot link to the pending address
 *
 * Auth guardrails:
 *   - userId from requireUser (server-signed token); body userId is ignored
 *   - Email collision → 409 email_taken; never merge two accounts
 *   - session_invalidated_at is never written in this route
 *   - Password committed to users only after verify confirms the email
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const { userId } = guard;

  // Rate-limit per user — prevents email-bombing a third-party inbox via a
  // compromised (but authenticated) Telegram session. Keyed on userId not IP
  // because this route is already behind requireUser.
  const gate = checkRateLimit({
    key: rateKey("link-email-start", userId),
    ...LINK_EMAIL_RATE_LIMIT,
  });
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests. Please wait before trying again.",
        retryAfter: gate.retryAfterSec,
      },
      {
        status: 429,
        headers: rateLimitHeaders(gate, LINK_EMAIL_RATE_LIMIT),
      },
    );
  }

  let email: string;
  let password: string;
  let lang: "de" | "en" = "de";

  try {
    const body = await req.json();
    email = (body.email ?? "").toLowerCase().trim();
    password = body.password ?? "";
    if (body.lang === "en") lang = "en";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Basic validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const sb = getServiceClient();

  // Re-read the user row to confirm they have no email yet (Telegram-only check)
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, email, telegram_id, language_code")
    .eq("id", userId)
    .maybeSingle();

  if (userErr || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.language_code) lang = user.language_code === "de" ? "de" : "en";
  if (user.email) {
    // Already has an email — linking is additive only, not a replacement
    return NextResponse.json(
      { error: "Account already has an email address" },
      { status: 409 },
    );
  }

  // Email collision check — never merge two accounts
  const { data: existing } = await sb
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "email_taken", message: lang === "de"
        ? "Diese E-Mail-Adresse ist bereits einem anderen Konto zugeordnet."
        : "This email address is already linked to another account." },
      { status: 409 },
    );
  }

  // Hash the password — rounds = 10 to match the register route
  const passwordHash = await bcrypt.hash(password, 10);

  // Generate a cryptographically random token (32 bytes → 64-char hex)
  // Store only the sha256 hash so a DB leak doesn't hand out valid tokens
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // Expire in 24 hours
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Upsert into email_link_tokens — the unique index on (pending_email) WHERE
  // used_at IS NULL prevents duplicate in-flight requests for the same address
  const { error: insertErr } = await sb
    .from("email_link_tokens")
    .insert({
      token_hash: tokenHash,
      user_id: userId,
      pending_email: email,
      password_hash: passwordHash,
      expires_at: expiresAt,
    });

  if (insertErr) {
    // Unique violation on pending_email_active_idx → duplicate in-flight request
    if (insertErr.code === "23505") {
      return NextResponse.json(
        {
          error: lang === "de"
            ? "Für diese E-Mail-Adresse wurde bereits eine Bestätigungs-E-Mail gesendet. Bitte prüfe deinen Posteingang."
            : "A verification email was already sent to this address. Please check your inbox.",
        },
        { status: 409 },
      );
    }
    console.error("[link-email/start] DB insert error:", insertErr);
    return NextResponse.json({ error: "Failed to create token" }, { status: 500 });
  }

  // Build the verification URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://medpruf.com";
  const verifyUrl = `${baseUrl}/verify-email?token=${rawToken}&lang=${lang}`;

  // Send the verification email
  const emailResult = await sendZohoEmail({
    to: email,
    subject: lang === "de"
      ? "MedPrüf: E-Mail-Adresse bestätigen"
      : "MedPrüf: Confirm your email address",
    htmlBody: renderLinkEmail({ lang, verifyUrl }),
  });

  if (!emailResult.ok) {
    // Roll back the staged token so the user can retry
    await sb.from("email_link_tokens").delete().eq("token_hash", tokenHash);

    if (emailResult.reason === "not_configured") {
      // Dev/test environment without Zoho — return the URL for manual testing
      console.warn("[link-email/start] Zoho not configured; token URL:", verifyUrl);
      return NextResponse.json({ ok: true, _devVerifyUrl: verifyUrl });
    }

    console.error("[link-email/start] Email send failed:", emailResult);
    return NextResponse.json(
      {
        error: lang === "de"
          ? "Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es erneut."
          : "Could not send the verification email. Please try again.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

// ── Email template (Shared transactional du style) ────
interface LinkEmailArgs {
  lang: "de" | "en";
  verifyUrl: string;
}

function renderLinkEmail({ lang, verifyUrl }: LinkEmailArgs): string {
  if (lang === "de") {
    return `<!DOCTYPE html>
<html lang="de"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">
<p>Hallo,</p>

<p>Du hast darum gebeten, eine E-Mail-Adresse und ein Passwort zu deinem MedPrüf-Konto hinzuzufügen.</p>

<p>Bestätige deine E-Mail-Adresse über diesen Link:</p>

<p><a href="${verifyUrl}" style="display:inline-block;background:#007B5F;color:white;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;">E-Mail-Adresse bestätigen</a></p>

<p style="color:#4a5568;font-size:13px;">Dieser Link ist 24 Stunden gültig. Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren. Dein Konto bleibt unverändert.</p>

<p style="margin-top:28px;">Viele Grüße,<br>[name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.de}</small></p>
</body></html>`;
  }

  return `<!DOCTYPE html>
<html lang="en"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">
<p>Hi,</p>

<p>You requested to add an email address and password to your MedPrüf account.</p>

<p>Please confirm your email address by clicking the link below:</p>

<p><a href="${verifyUrl}" style="display:inline-block;background:#007B5F;color:white;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Confirm email address</a></p>

<p style="color:#4a5568;font-size:13px;">This link is valid for 24 hours. If you did not request this, you can safely ignore this email. Your account will not be changed.</p>

<p style="margin-top:28px;">Best regards,<br>[name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.en}</small></p>
</body></html>`;
}
