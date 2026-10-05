import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { sendZohoEmail } from "@/lib/email/zoho";
import { renderTrialReminder } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/trial-reminder
 *
 * Daily cron (registered in vercel.json at `0 7 * * *` UTC ≈ 09:00
 * Vienna in summer, 08:00 Vienna in winter — Vercel crons are UTC-only,
 * so the Vienna wall-clock drifts by an hour around DST changeovers).
 *
 * Purpose — two jobs in one sweep:
 *   1. Day-25 reminder for `first_month_19` trials: for every active
 *      trial whose expires_at falls within the next 5 days AND whose
 *      trial_reminder_sent_at is null, send a templated email asking
 *      them to pick a longer plan if they want to continue, then
 *      stamp trial_reminder_sent_at to prevent duplicate sends on
 *      cron retries.
 *   2. Trial expiry events: for every `first_month_19` row whose
 *      expires_at has passed but which is still marked status='active',
 *      emit a `trial_expired` user_event (observability) and flip
 *      the row to status='expired'. We also flip users.tier back to
 *      'free' and clear tier_expires_at so downstream paywalls kick
 *      back in — but only if the user has no OTHER active
 *      subscription (defensive; shouldn't happen in practice since
 *      NOWPayments tiers don't overlap, but better to check). Whop
 *      `notes_pro_trial` expires at the actual 7-day trial end plus one day;
 *      this sweep cleans up the ledger after that deadline.
 *
 * Auth: Bearer token equal to `process.env.CRON_SECRET`. Vercel adds
 * this header automatically to cron invocations when the env var is
 * set. Any other caller gets 401.
 *
 * Email send: Zoho is not yet plumbed into this repo (no nodemailer /
 * Resend SDK wired yet per 2026-04-24 audit). For now we TODO-stub
 * the send and record a `trial_reminder_email_pending` event so [name]
 * can drain the backlog manually from the admin UI once Zoho lands.
 * The trial_reminder_sent_at stamp happens regardless, to avoid
 * flooding the queue when the cron re-runs.
 *
 * Response shape:
 *   200 {
 *     ok: true,
 *     reminders_marked: number,
 *     expiries_processed: number,
 *     errors: string[]
 *   }
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
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  const nowIso = new Date().toISOString();
  // 14-day window covers both tiers: `first_month_19` (30-day arc, fires
  // around day 16+) and `first_3mo_27` (90-day arc, fires around day 76+).
  // The `trial_reminder_sent_at` stamp ensures every user gets exactly
  // one reminder regardless of cron retry cadence.
  const fourteenDaysIso = new Date(
    Date.now() + 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const errors: string[] = [];
  let remindersMarked = 0;
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

  // ── 2. Day-25 reminder sweep ──
  // 2026-10-02: customer emails from this sweep are OFF unless
  // TRIAL_REMINDER_EMAILS_ENABLED === 'true'. The cron never ran before the
  // redirect fix, so the first working run would otherwise email several
  // paying customers at once (incl. one whose row ends before their real,
  // extended access). [name] decides when reminders go live.
  const remindersEnabled =
    (process.env.TRIAL_REMINDER_EMAILS_ENABLED ?? "false").toLowerCase() === "true";
  if (remindersEnabled) try {
    const { data: dueTrials, error: dueErr } = await sb
      .from("subscriptions")
      .select("id, user_id, expires_at, tier")
      .in("tier", ["first_month_19", "first_3mo_27"])
      .eq("status", "active")
      .is("trial_reminder_sent_at", null)
      .gte("expires_at", nowIso)
      .lte("expires_at", fourteenDaysIso);

    if (dueErr) {
      errors.push(`due_query: ${dueErr.message}`);
      Sentry.captureException(dueErr, {
        tags: { route: "cron/trial-reminder", step: "due_query" },
      });
    } else if (dueTrials && dueTrials.length > 0) {
      for (const trial of dueTrials) {
        const subId = trial.id as string;
        const userId = trial.user_id as string;

        // Look up the user's email + first_name + endowment stats for
        // the personalized template (review-2026-04-26-C1).
        const [{ data: user, error: userErr }, { data: gam }] = await Promise.all([
          sb
            .from("users")
            .select("email, first_name, language_code")
            .eq("id", userId)
            .maybeSingle(),
          sb
            .from("user_gamification")
            .select("total_questions_answered, total_correct, current_streak")
            .eq("user_id", userId)
            .maybeSingle(),
        ]);

        if (userErr) {
          errors.push(`user_lookup:${subId}: ${userErr.message}`);
          continue;
        }
        if (!user?.email) {
          // No email on file — record the pending event but skip the
          // send. Still stamp so we don't retry forever.
          await recordEvent(sb, userId, "trial_reminder_email_skipped_no_email", {
            subscription_id: subId,
            expires_at: trial.expires_at,
            reason: "no_email",
          });
        } else {
          const lang: "de" | "en" =
            user.language_code?.startsWith("en") ? "en" : "de";
          const answered = (gam?.total_questions_answered as number | null) ?? 0;
          const correct = (gam?.total_correct as number | null) ?? 0;
          const accuracyPct = answered > 0 ? Math.round((correct / answered) * 100) : 0;
          const streakDays = (gam?.current_streak as number | null) ?? 0;

          const tpl = renderTrialReminder({
            firstName: (user.first_name as string | null) ?? null,
            lang,
            expiresAtIso: trial.expires_at as string,
            qsAnswered: answered,
            accuracyPct,
            streakDays,
          });

          const sendResult = await sendZohoEmail({
            to: user.email as string,
            subject: tpl.subject,
            htmlBody: tpl.htmlBody,
          });

          await recordEvent(
            sb,
            userId,
            sendResult.ok
              ? "trial_reminder_email_sent"
              : "trial_reminder_email_failed",
            {
              subscription_id: subId,
              expires_at: trial.expires_at,
              user_email: user.email,
              language_code: user.language_code ?? null,
              reason: "day_25_reminder",
              ok: sendResult.ok,
              ...(!sendResult.ok
                ? {
                    failure_reason: sendResult.reason,
                    failure_status: sendResult.status ?? null,
                  }
                : {}),
            },
          );

          if (!sendResult.ok && sendResult.reason !== "not_configured") {
            errors.push(
              `send:${subId}: ${sendResult.reason}${sendResult.status ? ` (HTTP ${sendResult.status})` : ""}`,
            );
            // Don't stamp on a real send failure — let the cron retry
            // tomorrow. Only "not_configured" (env vars missing) stamps,
            // because retrying won't fix it.
            continue;
          }
        }

        const { error: stampErr } = await sb
          .from("subscriptions")
          .update({
            trial_reminder_sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", subId);

        if (stampErr) {
          errors.push(`stamp:${subId}: ${stampErr.message}`);
          continue;
        }

        remindersMarked += 1;
      }
    }
  } catch (err) {
    errors.push(`reminders_sweep: ${(err as Error).message}`);
    Sentry.captureException(err, {
      tags: { route: "cron/trial-reminder", step: "reminders_sweep" },
    });
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
        const { error: flipErr } = await sb
          .from("subscriptions")
          .update({ status: "expired", updated_at: nowIso })
          .eq("id", subId);

        if (flipErr) {
          errors.push(`flip:${subId}: ${flipErr.message}`);
          continue;
        }

        // If the user has NO OTHER active subscription, clear tier +
        // tier_expires_at so downstream paywalls take effect. We do
        // this as a second read because `subscriptions.status` was
        // just changed by us, so the query is now stable.
        const { data: others } = await sb
          .from("subscriptions")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "active")
          .limit(1);

        // 2026-10-02: never downgrade a user whose denormalized
        // users.tier_expires_at is still in the future (a manual grant or an
        // ops extension that did not touch this row). The paywall reads
        // tier + tier_expires_at, so that user loses access on their own
        // date anyway; the sweep must not cut it short.
        if (!others || others.length === 0) {
          const { data: owner } = await sb
            .from("users")
            .select("tier, tier_expires_at")
            .eq("id", userId)
            .maybeSingle();
          const ownerExp = owner?.tier_expires_at
            ? Date.parse(owner.tier_expires_at as string)
            : NaN;
          const stillCovered = Number.isFinite(ownerExp) && ownerExp > Date.now();
          if (owner?.tier !== "admin" && !stillCovered) {
            await sb
              .from("users")
              .update({
                tier: "free",
                tier_expires_at: null,
                updated_at: nowIso,
              })
              .eq("id", userId);
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
