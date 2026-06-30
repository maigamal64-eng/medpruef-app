import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * /api/trial/activate — the Telegram-gated 1-week full-Pro trial (Notes feature
 * P5; the conversion mechanism, signed §6).
 *
 * GET  → eligibility/state for the activation UI.
 * POST → activate: grants 7 days of Pro.
 *
 * The wall (signed): ONE telegram_id = ONE trial, EVER. The `trials` table
 * (telegram_id PRIMARY KEY) is the anti-abuse record; it OUTLIVES the user
 * account (user_id ON DELETE SET NULL), so deleting + re-creating an account
 * can't free the telegram to trial again.
 *
 * Requirements to activate:
 *   - a linked + confirmed Telegram (users.telegram_id + telegram_chat_id_confirmed)
 *     — triple duty: anti-abuse, the bot notification channel, and "real person".
 *   - not already Pro, and that telegram has never trialed.
 *
 * Expiry: we set users.tier='pro' + tier_expires_at=now+7d AND insert a
 * `subscriptions` row (tier='notes_free_trial', status='active', expires_at).
 * The existing trial-reminder cron's expiry sweep flips users.tier back to
 * 'free' for any expired active subscription — so the trial reverts through the
 * SAME proven path as every other subscription (not a bespoke expiry).
 */

const TRIAL_DAYS = 7;
const BOT_USERNAME = "MedPruefBot";

function deepLink(userId: string): string {
  return `https://t.me/${BOT_USERNAME}?start=auth_${userId}`;
}

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();
    const { data: user, error } = await sb
      .from("users")
      .select("id, tier, tier_expires_at, telegram_id, telegram_chat_id_confirmed")
      .eq("id", userId)
      .maybeSingle();
    if (error || !user) {
      console.error("[trial/activate GET] user", error);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    const telegramLinked =
      user.telegram_id != null && user.telegram_chat_id_confirmed != null;
    const isPro = user.tier === "pro" || user.tier === "admin";

    // Has THIS telegram (or this account) ever trialed?
    let alreadyTrialed = false;
    let trialExpiresAt: string | null = null;
    if (user.telegram_id != null) {
      const { data: trial } = await sb
        .from("trials")
        .select("expires_at")
        .eq("telegram_id", user.telegram_id)
        .maybeSingle();
      if (trial) {
        alreadyTrialed = true;
        trialExpiresAt = trial.expires_at as string;
      }
    }
    if (!alreadyTrialed) {
      const { data: byUser } = await sb
        .from("trials")
        .select("expires_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (byUser) {
        alreadyTrialed = true;
        trialExpiresAt = byUser.expires_at as string;
      }
    }

    const eligible = !isPro && !alreadyTrialed;

    return NextResponse.json({
      eligible,
      is_pro: isPro,
      telegram_linked: telegramLinked,
      already_trialed: alreadyTrialed,
      trial_expires_at: trialExpiresAt,
      tier_expires_at: user.tier_expires_at ?? null,
      trial_days: TRIAL_DAYS,
      telegram_deep_link: telegramLinked ? null : deepLink(userId),
    });
  } catch (err) {
    console.error("[trial/activate GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const gate = checkRateLimit({
    key: rateKey("trial-activate", userId),
    limit: 5,
    windowMs: 60_000,
  });
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment." },
      { status: 429, headers: rateLimitHeaders(gate, { limit: 5 }) },
    );
  }

  try {
    const sb = getServiceClient();
    const { data: user, error: uErr } = await sb
      .from("users")
      .select("id, tier, tier_expires_at, telegram_id, telegram_chat_id_confirmed")
      .eq("id", userId)
      .maybeSingle();
    if (uErr || !user) {
      console.error("[trial/activate POST] user", uErr);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    // Already Pro/admin → nothing to grant.
    if (user.tier === "pro" || user.tier === "admin") {
      return NextResponse.json(
        { error: "You already have Pro access.", code: "ALREADY_PRO" },
        { status: 409 },
      );
    }

    // Telegram must be linked + confirmed (the wall + the bot channel).
    const telegramId = user.telegram_id as number | null;
    if (telegramId == null || user.telegram_chat_id_confirmed == null) {
      return NextResponse.json(
        {
          error: "Link your Telegram to start the free trial.",
          code: "TELEGRAM_REQUIRED",
          telegram_deep_link: deepLink(userId),
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const expires = new Date(now.getTime() + TRIAL_DAYS * 86400_000);
    const nowIso = now.toISOString();
    const expiresIso = expires.toISOString();

    // ── The wall FIRST: one telegram = one trial ever. A unique violation
    //    (PK telegram_id, or UNIQUE user_id) means already trialed. ──────────
    const { error: trialErr } = await sb.from("trials").insert({
      telegram_id: telegramId,
      user_id: userId,
      started_at: nowIso,
      expires_at: expiresIso,
    });
    if (trialErr) {
      if ((trialErr as { code?: string }).code === "23505") {
        return NextResponse.json(
          {
            error: "This Telegram has already used its free trial.",
            code: "ALREADY_TRIALED",
          },
          { status: 409 },
        );
      }
      console.error("[trial/activate POST] trials insert", trialErr);
      return NextResponse.json({ error: "Failed to start trial" }, { status: 500 });
    }

    // ── Grant: subscription row (so the cron expires it) + tier flip. If the
    //    grant fails, roll the wall back so the user can retry. ──────────────
    const { error: subErr } = await sb.from("subscriptions").insert({
      user_id: userId,
      tier: "notes_free_trial",
      status: "active",
      payment_provider: "trial",
      payment_method: "telegram_trial",
      amount_cents: 0,
      started_at: nowIso,
      expires_at: expiresIso,
    });
    if (subErr) {
      console.error("[trial/activate POST] subscription insert", subErr);
      await sb.from("trials").delete().eq("telegram_id", telegramId);
      return NextResponse.json({ error: "Failed to start trial" }, { status: 500 });
    }

    const { error: tierErr } = await sb
      .from("users")
      .update({ tier: "pro", tier_expires_at: expiresIso })
      .eq("id", userId);
    if (tierErr) {
      console.error("[trial/activate POST] tier update", tierErr);
      // Best-effort rollback of the wall + sub so a retry can succeed.
      await sb.from("trials").delete().eq("telegram_id", telegramId);
      await sb
        .from("subscriptions")
        .update({ status: "cancelled", cancelled_at: nowIso })
        .eq("user_id", userId)
        .eq("tier", "notes_free_trial")
        .eq("status", "active");
      return NextResponse.json({ error: "Failed to start trial" }, { status: 500 });
    }

    // Telemetry (best-effort).
    try {
      await sb.from("user_events").insert({
        user_id: userId,
        event_type: "notes_trial_activated",
        event_data: { expires_at: expiresIso, days: TRIAL_DAYS },
      });
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({
      ok: true,
      tier: "pro",
      tier_expires_at: expiresIso,
      trial_days: TRIAL_DAYS,
    });
  } catch (err) {
    console.error("[trial/activate POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
