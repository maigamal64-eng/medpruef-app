import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { sendZohoEmail } from "@/lib/email/zoho";
import { prechargeRemindersEnabled, sendPrechargeTrialReminder } from "@/lib/precharge-trial-reminder";
import { loadRenewalOfferSuppression } from "@/lib/billing-cadence";
import { BILLING_SUPPORT_EMAIL, WHOP_MANAGE_URL, WHOP_MANAGE_TEXT } from "@/lib/billing-copy";
import { COMPANY, formatEuro, TIERS, FREE_TIER } from "@/lib/content-truth";
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

        // i-MP-TRUTH-19 (2026-10-10): this email asks the user to pick a
        // longer plan. Never send it to someone whose plan renews by itself
        // (or whose cadence we cannot read): it would sell a second plan on
        // top of one that auto-renews. Skipped rows are NOT stamped, so a
        // user who later cancels can still get the reminder.
        // Everyone who passes this gate holds ONLY one-time / non-Whop
        // rows, which is why renderOneTimeReminder below states that
        // nothing renews and never says the current plan does.
        try {
          const { suppressed } = await loadRenewalOfferSuppression(sb, userId);
          if (suppressed) {
            remindersSkippedRenewing += 1;
            continue;
          }
        } catch (cadenceErr) {
          errors.push(`cadence:${subId}: ${(cadenceErr as Error).message}`);
          continue;
        }

        // Look up the user's email + first_name + endowment stats for
        // the personalized template (review-2026-04-26-C1).
        const [{ data: user, error: userErr }, { data: gam }] = await Promise.all([
          sb
            .from("users")
            .select("email, first_name, language_code, tier_expires_at")
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
        // R4-01: the email states an end date, so it must be the END OF THE
        // USER'S COVERAGE, not this row's date. If another active row or an
        // extended users.tier_expires_at reaches past this row, skip WITHOUT
        // stamping (the row may still become the last one later). Also skip
        // when another active row already carries a reminder stamp, so a user
        // with two rows in the window gets one email, not two.
        {
          const rowEndMs = new Date(trial.expires_at as string).getTime();
          let coverageEndMs = rowEndMs;
          let alreadyReminded = false;
          const tierEnd = user?.tier_expires_at
            ? new Date(user.tier_expires_at as string).getTime()
            : NaN;
          if (Number.isFinite(tierEnd)) coverageEndMs = Math.max(coverageEndMs, tierEnd);
          const { data: activeRows, error: covErr } = await sb
            .from("subscriptions")
            .select("id, expires_at, trial_reminder_sent_at")
            .eq("user_id", userId)
            .eq("status", "active")
            .gt("expires_at", nowIso);
          if (covErr) {
            errors.push(`coverage:${subId}: ${covErr.message}`);
            continue;
          }
          for (const r of activeRows ?? []) {
            const endMs = new Date(r.expires_at as string).getTime();
            if (Number.isFinite(endMs)) coverageEndMs = Math.max(coverageEndMs, endMs);
            if (r.id !== subId && r.trial_reminder_sent_at) alreadyReminded = true;
          }
          if (coverageEndMs > rowEndMs || alreadyReminded) {
            remindersSkippedCovered += 1;
            continue;
          }
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

          const tpl = renderOneTimeReminder({
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

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface OneTimeReminderArgs {
  firstName: string | null;
  lang: "de" | "en";
  expiresAtIso: string;
  qsAnswered: number;
  accuracyPct: number;
  streakDays: number;
}

/**
 * Reminder text for ONE-TIME buyers (DB-TIMEOUTS item 4, 2026-10-10).
 *
 * The earlier shared template told every recipient that "Single Month and
 * 3-Month are subscriptions, if you are on one of those you do not need to
 * do anything". After the cadence gate above the only recipients left are
 * people whose access does NOT renew, so that sentence was both irrelevant
 * and a false comfort. This text says the current access is a one-time
 * payment that is not charged again, and describes the subscription plans
 * only as options they could choose (billed until they cancel).
 *
 * Deliberately contains no "renew/verlängern/erneuern" wording at all;
 * tests/unit/cron/trial-reminder.test.ts enforces that on the sent body.
 * The days-left figure is computed, not hardcoded (the sweep window is 14
 * days, the old subject said "5 Tagen" regardless).
 */
function renderOneTimeReminder(args: OneTimeReminderArgs): { subject: string; htmlBody: string } {
  const { firstName, lang, expiresAtIso, qsAnswered, accuracyPct, streakDays } = args;
  const expires = new Date(expiresAtIso);
  const daysLeft = Math.max(1, Math.ceil((expires.getTime() - Date.now()) / 86_400_000));
  const expiresFmt = expires.toLocaleDateString(lang === "de" ? "de-AT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const greetingName = firstName ? `, ${escapeHtml(firstName)}` : "";

  const stats: string[] = [];
  if (qsAnswered > 0) stats.push(lang === "de" ? `${qsAnswered} Fragen beantwortet` : `${qsAnswered} questions answered`);
  if (accuracyPct > 0) stats.push(lang === "de" ? `${accuracyPct} % richtig` : `${accuracyPct}% correct`);
  if (streakDays > 0) stats.push(lang === "de" ? `${streakDays}-Tage-Streak` : `${streakDays}-day streak`);
  const statsLine = stats.length > 0 ? stats.join(" · ") : null;

  const cohort = formatEuro(TIERS.premium_pass_guaranteed.price_cents);
  const threeMonth = formatEuro(TIERS.first_3mo_27.price_cents);
  const singleMonth = formatEuro(TIERS.first_month_19.price_cents);
  const wrapStyle =
    "font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#1a2b3c; line-height:1.55; max-width:560px; margin:0 auto; padding:24px;";
  const btnStyle =
    "display:inline-block; background:#003a8c; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:600;";

  if (lang === "de") {
    const subject = `Ihr MedPrüf Pro-Zugang endet in ${daysLeft} ${daysLeft === 1 ? "Tag" : "Tagen"}`;
    const htmlBody = `<!DOCTYPE html>
<html><body style="${wrapStyle}">
<p>Hallo${greetingName},</p>

<p>kurzer Hinweis: Ihr <strong>MedPrüf Pro-Zugang</strong> endet am <strong>${expiresFmt}</strong>, also in ca. ${daysLeft} ${daysLeft === 1 ? "Tag" : "Tagen"}. Sie haben einmalig bezahlt, es gibt keine automatische Abbuchung. Wenn Sie nichts tun, endet der Zugang an diesem Datum und es wird nichts mehr abgebucht.</p>

${statsLine ? `<p><strong>Was Sie in dieser Zeit aufgebaut haben:</strong> ${statsLine}.<br>Das alles bleibt erhalten, wenn Sie weitermachen.</p>` : ""}

<p>Wenn Sie weitermachen möchten, können Sie selbst einen neuen Tarif wählen:</p>

<ul>
  <li><strong>Prüfungs-Kohorte</strong> (${cohort} einmalig, 6 Monate, Pass-Until-You-Pass-Garantie): Einmalzahlung, kein Abo, Karten-Checkout über Whop, sofortiger Vollzugang.</li>
  <li><strong>Monatsabo</strong> (${singleMonth} pro Monat) und <strong>3-Monats-Tarif</strong> (${threeMonth} pro Quartal): das sind Abos, die bis zur Kündigung weiterlaufen. Kündigen können Sie bei Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (Mitgliedschaft auswählen, dann „Cancel membership“; die Seite ist auf Englisch).</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="${btnStyle}">Tarife ansehen →</a></p>

<p>Falls Sie nicht weitermachen möchten, ist das in Ordnung. Ihr Konto bleibt bestehen, Sie können die kostenlose Version (${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank) weiter nutzen, und wenn Sie später zurückkommen, ist alles noch da.</p>

<p>Bei Fragen: einfach auf diese Mail antworten (${BILLING_SUPPORT_EMAIL}).</p>

<p>Viele Grüße, [name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.de}</small></p>
</body></html>`;
    return { subject, htmlBody };
  }

  const subject = `Your MedPrüf Pro access ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  const htmlBody = `<!DOCTYPE html>
<html><body style="${wrapStyle}">
<p>Hi${greetingName},</p>

<p>quick heads-up: your <strong>MedPrüf Pro access</strong> ends on <strong>${expiresFmt}</strong>, about ${daysLeft} ${daysLeft === 1 ? "day" : "days"} from now. You paid once, so nothing is charged automatically. If you do nothing, access simply ends on that date and you will not be charged again.</p>

${statsLine ? `<p><strong>What you've built so far:</strong> ${statsLine}.<br>All of it stays if you continue.</p>` : ""}

<p>If you want to keep going, you can choose a new plan yourself:</p>

<ul>
  <li><strong>Exam Cohort</strong> (${cohort} once, 6 months, Pass-Until-You-Pass guarantee): one-time payment, no subscription, card checkout via Whop, instant full access.</li>
  <li><strong>Single Month</strong> (${singleMonth} per month) and <strong>3-Month plan</strong> (${threeMonth} per quarter): these are subscriptions that keep running until you cancel. You can cancel any time at Whop: <a href="${WHOP_MANAGE_URL}">${WHOP_MANAGE_TEXT}</a> (select your membership, then "Cancel membership").</li>
</ul>

<p><a href="https://medpruf.com/pricing" style="${btnStyle}">See plans →</a></p>

<p>If you want to stop, that's fine. Your account stays, you can keep using the free tier (${FREE_TIER.questions_per_exam_type} questions per exam) anytime, and if you come back in six months everything is still there.</p>

<p>Questions: just reply to this email (${BILLING_SUPPORT_EMAIL}).</p>

<p>Best, [name]<br>
<small style="color:#4a5568;">${COMPANY.one_line.en}</small></p>
</body></html>`;
  return { subject, htmlBody };
}
