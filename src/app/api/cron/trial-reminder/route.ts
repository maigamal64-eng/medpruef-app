import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { sendZohoEmail } from "@/lib/email/zoho";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { runAccessEndingReminders } from "@/lib/reminders/access-ending";
import { prechargeRemindersEnabled, sendPrechargeTrialReminder } from "@/lib/precharge-trial-reminder";
import { safeEqual } from "@/lib/security/timing-safe";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily authenticated sweep: retain legacy one-time renewal offers and access
 * expiry cleanup, and prepare the card-trial precharge reminder. Card trials
 * use Whop's exact membership amount/date, two days before the first charge.
 * Cron and webhook share one membership-key claim before any send attempt.
 * The card reminder requires both TRIAL_REMINDER_EMAILS_ENABLED and the
 * reviewed cancellation release gate; neither is enabled by this change.
 */
export async function GET(req: NextRequest) {
  // ── 1. Authenticate the cron invocation ──
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret) {
    // Fail CLOSED — if CRON_SECRET isn't set, block the endpoint
    // entirely. Better to see a visible 503 in Vercel logs than to
    // silently accept unauthenticated requests.
    console.error(
      "[cron/trial-reminder] CRON_SECRET not configured",
    );
    Sentry.captureMessage(
      "CRON_SECRET not set — /api/cron/trial-reminder disabled",
      "error",
    );
    return NextResponse.json(
      { error: "Cron secret not configured" },
      { status: 503 },
    );
  }
  // Constant-time compare (contract C11); null header fails closed.
  if (!safeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
  const nowIso = new Date().toISOString();
  const errors: string[] = [];
  let remindersMarked = 0;
  let remindersSent = 0;
  let remindersWithheld = 0;
  let remindersDuplicate = 0;
  let remindersSkipped: Record<string, number> = {};
  let remindersSkippedRenewing = 0;
  let remindersSkippedCovered = 0;
  let expiriesProcessed = 0;

  // ── 1b. Invocation heartbeat ──
  // DIAGNOSTIC (2026-09-20): the sweep code was verified correct (the expiry
  // pass is tier-agnostic) yet produced ZERO events ever — stale active rows
  // sat unflipped for months, so either the Vercel cron never invoked this
  // route or every invocation failed before the sweep. This heartbeat row is
  // the first thing the route does on a SUCCESSFUL authenticated invocation,
  // so `SELECT count(*) FROM user_events WHERE event_type='cron_trial_reminder_heartbeat'`
  // answers "did it fire today?" without touching Vercel logs. Best-effort.
  try {
    await recordEvent(sb, "cron", "cron_trial_reminder_heartbeat", { at: nowIso });
  } catch {
    /* observability only */
  }

  // ── 2. Access-ending reminder sweep (a46) ──
  // Customer emails from this sweep are OFF unless
  // TRIAL_REMINDER_EMAILS_ENABLED === 'true' (pick-reminder-go: [name]'s GO).
  // Audience, stated date, do-not-email check and the at-most-once claim live
  // in src/lib/reminders/access-ending.ts, shared with the read-only preview
  // (scripts/reminders/access-ending-preview.ts) so the preview is exactly
  // the audience a sending run acts on.
  const remindersEnabled =
    (process.env.TRIAL_REMINDER_EMAILS_ENABLED ?? "false").toLowerCase() === "true";
  if (remindersEnabled) try {
    const run = await runAccessEndingReminders(sb, {
      now: new Date(nowIso),
      recordEvent: (userId, eventType, data) => recordEvent(sb, userId, eventType, data),
    });
    remindersMarked = run.sent + run.withheld;
    remindersSent = run.sent;
    remindersWithheld = run.withheld;
    remindersDuplicate = run.duplicates;
    remindersSkipped = run.skipped;
    remindersSkippedRenewing = run.skipped.skip_renewing ?? 0;
    remindersSkippedCovered = (run.skipped.skip_rows_disagree ?? 0) + (run.skipped.skip_already_reminded ?? 0) + (run.skipped.skip_already_claimed ?? 0);
    errors.push(...run.errors);
  } catch (err) {
    errors.push(`reminders_sweep: ${(err as Error).message}`);
    Sentry.captureException(err, {
      tags: { route: "cron/trial-reminder", step: "reminders_sweep" },
    });
  }

  // Card trials: exact Whop first-charge date, two-day window, shared atomic claim.
  // Default OFF until the existing email flag and verified cancellation release gate pass.
  let prechargeRemindersSent = 0;
  if (prechargeRemindersEnabled()) {
    const { data: cardTrials, error: cardError } = await sb.from("subscriptions")
      .select("user_id, whop_membership_id")
      .eq("tier", "notes_pro_trial").eq("payment_provider", "whop").eq("status", "active")
      .is("trial_reminder_sent_at", null).gt("expires_at", nowIso).lte("expires_at", new Date(Date.now() + 4 * 86400_000).toISOString());
    if (cardError) errors.push("precharge_query_failed");
    else for (const trial of cardTrials ?? []) {
      // a-stability: a legacy mber_ member pin is no membership; skip it quietly.
      const membershipId = whopMembershipIdOrNull(trial.whop_membership_id);
      if (!membershipId) continue;
      const result = await sendPrechargeTrialReminder(sb, { userId: trial.user_id, membershipId });
      if (result === "sent") prechargeRemindersSent += 1;
      else if (result === "failed" || result === "unavailable") errors.push(`precharge_${result}`);
    }
  }

  // ── 3. Expiry sweep ──
  //
  // We intentionally DON'T restrict by tier here — every expired
  // active subscription should be flipped to 'expired', not just
  // first_month_19. But the `trial_expired` event is emitted only
  // for the trial tier (non-trial expiries get a generic
  // `subscription_expired` event for observability parity).
  try {
    const { data: expired, error: expErr } = await sb
      .from("subscriptions")
      .select("id, user_id, tier, expires_at")
      .eq("status", "active")
      .lt("expires_at", nowIso);

    if (expErr) {
      errors.push(`expiry_query: ${expErr.message}`);
      Sentry.captureException(expErr, {
        tags: { route: "cron/trial-reminder", step: "expiry_query" },
      });
    } else if (expired && expired.length > 0) {
      for (const row of expired) {
        const subId = row.id as string;
        const userId = row.user_id as string;
        const tier = row.tier as string;

        // Flip the subscription row.
        const { data: flipped, error: flipErr } = await sb
          .from("subscriptions")
          .update({ status: "expired", updated_at: nowIso })
          .eq("id", subId)
          .eq("status", "active")
          .eq("expires_at", row.expires_at)
          .select("id");

        if (flipErr) {
          errors.push(`flip:${subId}: ${flipErr.message}`);
          continue;
        }

        // A renewal/refund changed this snapshot. Do not expire or downgrade it.
        if (!flipped || flipped.length === 0) continue;

        // If the user has NO OTHER active subscription, clear tier +
        // tier_expires_at so downstream paywalls take effect. We do
        // this as a second read because `subscriptions.status` was
        // just changed by us, so the query is now stable.
        const { data: others, error: othersError } = await sb
          .from("subscriptions")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "active")
          .limit(1);

        if (othersError) {
          errors.push(`coverage:${subId}: ${othersError.message}`);
          continue;
        }

        // 2026-10-02: never downgrade a user whose denormalized
        // users.tier_expires_at is still in the future (a manual grant or an
        // ops extension that did not touch this row). The paywall reads
        // tier + tier_expires_at, so that user loses access on their own
        // date anyway; the sweep must not cut it short.
        if (!others || others.length === 0) {
          const { data: owner, error: ownerError } = await sb
            .from("users")
            .select("tier, role, tier_expires_at")
            .eq("id", userId)
            .maybeSingle();
          if (ownerError || !owner) {
            errors.push(`owner:${subId}: ${ownerError?.message ?? "User not found"}`);
            continue;
          }
          const ownerExp = owner?.tier_expires_at
            ? Date.parse(owner.tier_expires_at as string)
            : NaN;
          const stillCovered =
            (owner.tier === "pro" && owner.tier_expires_at == null) ||
            (Number.isFinite(ownerExp) && ownerExp > Date.now());
          if (owner.role !== "admin" && owner.tier !== "admin" && !stillCovered) {
            await sb
              .from("users")
              .update({
                tier: "free",
                tier_expires_at: null,
                updated_at: nowIso,
              })
              .eq("id", userId)
              .eq("tier", owner.tier)
              .eq("role", owner.role)
              .eq("tier_expires_at", owner.tier_expires_at);
          }
        }

        await recordEvent(
          sb,
          userId,
          tier === "first_month_19" || tier === "first_3mo_27"
            ? "trial_expired"
            : "subscription_expired",
          {
            subscription_id: subId,
            tier,
            expired_at: row.expires_at,
          },
        );

        expiriesProcessed += 1;
      }
    }
  } catch (err) {
    errors.push(`expiry_sweep: ${(err as Error).message}`);
    Sentry.captureException(err, {
      tags: { route: "cron/trial-reminder", step: "expiry_sweep" },
    });
  }

  return NextResponse.json({
    ok: true,
    reminders_marked: remindersMarked,
    reminders_sent: remindersSent,
    reminders_withheld: remindersWithheld,
    reminders_duplicate: remindersDuplicate,
    reminders_skipped: remindersSkipped,
    precharge_reminders_sent: prechargeRemindersSent,
    precharge_release_enabled: prechargeRemindersEnabled(),
    reminders_skipped_renewing: remindersSkippedRenewing,
    reminders_skipped_covered: remindersSkippedCovered,
    expiries_processed: expiriesProcessed,
    errors,
    ran_at: nowIso,
  });
}

/**
 * Small local telemetry helper — mirrors the one in the checkout and
 * webhook routes. Writes directly to user_events because there's no
 * browser context available inside a cron.
 */
async function recordEvent(
  sb: ReturnType<typeof getServiceClient>,
  userId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("user_events").insert({
      user_id: userId,
      event_type: eventType,
      event_data: data,
    });
  } catch (err) {
    console.error(`[cron/trial-reminder:${eventType}]`, err);
  }
}
