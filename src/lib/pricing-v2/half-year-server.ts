/**
 * The 6-month plan's two promises (a-pricing-v2):
 *   1. The renewal stops by itself once the learner's exam date has passed:
 *      POST /v1/memberships/{id}/cancel {cancel_at_period_end: true} at Whop
 *      (access runs to the end of the paid period). An outbound provider
 *      write, so it needs HALF_YEAR_AUTO_STOP_ENABLED and, to actually call
 *      Whop, HALF_YEAR_AUTO_STOP_DRY_RUN=false. One claim per membership.
 *   2. A reminder 7 days before every renewal (HALF_YEAR_REMINDER_EMAILS_ENABLED),
 *      one claim per membership and charge date.
 * The exam date is the later of users.exam_date (the learner's own saved
 * date) and the sitting chosen at checkout (payment_events metadata; the
 * checkout requires one); with neither, nothing is stopped and the plan
 * renews until cancelled. Only real mem_ pins are touched.
 *
 * a-pricing-v2-fit, the renewal guard (decision renewal-guard,
 * renewal-guard.ts): a renewal inside the 14 days before that sitting does
 * not charge either. Same switches and 8-day window as the stop, its own
 * claim per membership and charge date (half_year_guard:<mem>:<day>). The
 * sittings: the checkout sitting and a saved exam date that is an official
 * sitting (guardSittings). In order: (1) the claim, whose payload is the
 * audit record (before and after images, phase); (2) access first: a
 * zero-amount manual subscriptions row (payment_method renewal_guard) to the
 * end of the day after the sitting, so Whop's membership.deactivated at the
 * period end finds other coverage and keeps Pro, plus a compare-and-set on
 * users.tier_expires_at; (3) cancel_at_period_end at Whop, confirmed on a
 * fresh read, never an immediate cancel and no refund; (4) a user_events row
 * and the guard mail, which replaces the 7-day reminder (reminderDue is false
 * once cancel_at_period_end is set). A transient Whop failure releases the
 * claim; the next run finds the extension already in place and only retries
 * the stop. Any guard that does not complete falls through to the 7-day
 * reminder, so a renewal that will charge is never silent. Known gap: a
 * refund or chargeback of the 6-month payment after the guard leaves the
 * zero-amount row covering to the day after the sitting (the atomic revoke
 * SQL counts it; changing that needs a migration).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { loadWhopBillingRead, type ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";
import { cancelMembershipAtPeriodEnd } from "@/lib/whop-membership-cancel";
import { WHOP_CHECKOUT_CREATE_TIMEOUT_MS } from "@/lib/whop-timeouts";
import { halfYearAutoStopDryRun, halfYearAutoStopEnabled, halfYearReminderEmailsEnabled } from "./flag";
import { halfYearGuardMail, halfYearRenewalMail, halfYearStoppedMail } from "./emails";
import { dayAfterEnd, viennaMidnight } from "./sitting-pass";
import { guardAccessUntil, guardDue, type GuardSitting } from "./renewal-guard";
import { OFFICIAL_SITTINGS, type OfficialSitting } from "@/lib/exam-dates";
import * as Sentry from "@sentry/nextjs";

const DAY_MS = 86_400_000;
export const HALF_YEAR_REMINDER_DAYS = 7;

/** Has the exam day passed (the whole Vienna day after it has begun)? */
export function examDatePassed(examDate: string | null | undefined, now: Date = new Date()): boolean {
  if (typeof examDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(examDate)) return false;
  // dayAfterEnd(d) = start of d + 2 in Vienna; the stop waits one full day after the exam.
  return dayAfterEnd(examDate.slice(0, 10)).getTime() <= now.getTime();
}

/**
 * Stop the renewal (review P2): the exam is over before the next charge (the
 * charge falls on or after the first Vienna day after the exam) and either
 * that charge is within 8 days or the exam has already passed. Stopping no
 * earlier than the reminder window lets a learner who rebooks a later sitting
 * update the date before anything is cancelled.
 */
export function stopDue(examDate: string | null | undefined, nextChargeAt: string | null | undefined, now: Date = new Date()): boolean {
  if (typeof examDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(examDate) || !nextChargeAt) return false;
  const charge = Date.parse(nextChargeAt);
  if (!Number.isFinite(charge)) return false;
  const day = examDate.slice(0, 10);
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  if (viennaMidnight(next).getTime() > charge) return false;
  return charge - now.getTime() <= 8 * DAY_MS || examDatePassed(examDate, now);
}

/** A reminder is due when the charge is 6 to 7 days away. */
export function reminderDue(snapshot: ProviderBillingSnapshot | null, now: Date = new Date()): boolean {
  if (!snapshot?.provider_state_verified || snapshot.cancel_at_period_end || !snapshot.next_charge_at) return false;
  const left = Date.parse(snapshot.next_charge_at) - now.getTime();
  return Number.isFinite(left) && left > (HALF_YEAR_REMINDER_DAYS - 1) * DAY_MS && left <= HALF_YEAR_REMINDER_DAYS * DAY_MS;
}

type Fetch = typeof fetch;

// The Whop call is shared (whop-membership-cancel.ts); this key is unchanged.
// A cron, not a webhook: it keeps the longer checkout-create deadline.
function cancelAtPeriodEnd(membershipId: string, fetchImpl: Fetch): Promise<{ ok: boolean; status: number }> {
  return cancelMembershipAtPeriodEnd(membershipId, `half-year-stop:${membershipId}`, fetchImpl, WHOP_CHECKOUT_CREATE_TIMEOUT_MS);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The sitting chosen at checkout: first and last day (metadata written by /api/whop/checkout). */
async function checkoutSitting(sb: SupabaseClient, userId: string): Promise<GuardSitting | null> {
  const { data } = await sb.from("payment_events").select("metadata")
    .eq("user_id", userId).eq("event", "checkout_session_created").eq("tier", "half_year")
    .order("created_at", { ascending: false }).limit(1);
  const meta = (data?.[0]?.metadata as Record<string, unknown> | null) ?? null;
  const lastDay = meta?.sitting_last_day;
  if (typeof lastDay !== "string" || !ISO_DAY.test(lastDay)) return null;
  const date = typeof meta?.sitting_date === "string" && ISO_DAY.test(meta.sitting_date) && meta.sitting_date <= lastDay ? meta.sitting_date : lastDay;
  return { date, lastDay };
}

/**
 * The sittings the guard protects (review P2): the sitting bought at
 * checkout, and the learner's saved exam date only when it is an official
 * sitting (a free planning date in Settings never moves or widens the
 * guard). A renewal inside either window is guarded, for that sitting, so
 * the total /pricing showed at purchase holds and a learner who rebooked a
 * later official sitting is guarded for it too.
 */
export function guardSittings(savedExamDate: string | null | undefined, checkout: GuardSitting | null, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): GuardSitting[] {
  const out: GuardSitting[] = checkout ? [checkout] : [];
  const saved = typeof savedExamDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(savedExamDate) ? savedExamDate.slice(0, 10) : null;
  if (saved) {
    const row = sittings.find((r) => r.date <= saved && saved <= (r.date_end ?? r.date));
    if (row) {
      const official = { date: row.date, lastDay: row.date_end ?? row.date };
      if (!out.some((s) => s.date === official.date && s.lastDay === official.lastDay)) out.push(official);
    }
  }
  return out;
}

/** The sitting whose guard window holds this charge, if any. */
export function guardSittingFor(sittings: readonly GuardSitting[], nextChargeAt: string | null | undefined, now: Date): GuardSitting | null {
  return sittings.find((s) => guardDue(s, nextChargeAt, now)) ?? null;
}

/** The later of two ISO days (either may be missing). */
export function laterDay(a: string | null | undefined, b: string | null | undefined): string | null {
  const days = [a, b].filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
  return days.length ? days.sort().at(-1)! : null;
}

export interface HalfYearRunResult {
  rows: number;
  /** Rows with no mem_ pin or an unreadable Whop state: no reminder, no stop (reported). */
  skippedNoPin: number;
  skippedUnverified: number;
  stopped: number;
  wouldStop: number;
  /** a-pricing-v2-fit: renewals inside the 14 days before the sitting, stopped with free access to the day after it. */
  guarded: number;
  wouldGuard: number;
  reminded: number;
  failed: number;
  autoStop: "off" | "dry_run" | "live";
  reminders: boolean;
}

export async function runHalfYearRenewals(
  sb: SupabaseClient,
  now: Date = new Date(),
  deps: { loadSnapshot?: typeof loadWhopBillingRead; fetchImpl?: Fetch } = {},
): Promise<HalfYearRunResult> {
  const autoStop = !halfYearAutoStopEnabled() ? "off" : halfYearAutoStopDryRun() ? "dry_run" : "live";
  const reminders = halfYearReminderEmailsEnabled();
  const result: HalfYearRunResult = { rows: 0, skippedNoPin: 0, skippedUnverified: 0, stopped: 0, wouldStop: 0, guarded: 0, wouldGuard: 0, reminded: 0, failed: 0, autoStop, reminders };
  if (autoStop === "off" && !reminders) return result;
  const loadSnapshot = deps.loadSnapshot ?? loadWhopBillingRead;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { data, error } = await sb.from("subscriptions")
    .select("id, user_id, whop_membership_id, expires_at")
    .eq("tier", "half_year").eq("status", "active").eq("payment_provider", "whop")
    .gt("expires_at", now.toISOString()).limit(500);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ id: string; user_id: string; whop_membership_id: string | null; expires_at: string | null }>) {
    const pin = whopMembershipIdOrNull(row.whop_membership_id);
    if (!pin) { result.skippedNoPin++; continue; }
    result.rows++;
    const { snapshot } = await loadSnapshot(pin, "half_year");
    if (!snapshot?.provider_state_verified) { result.skippedUnverified++; continue; }
    if (snapshot.cancel_at_period_end) continue;
    const { data: user, error: userError } = await sb.from("users").select("email, language_code, exam_date").eq("id", row.user_id).maybeSingle();
    if (userError || !user) { result.failed++; continue; }
    // The later of the saved exam date and the sitting chosen at checkout:
    // a stale past date in Settings never stops a plan bought for a later sitting.
    const fromCheckout = await checkoutSitting(sb, row.user_id);
    const examDate = laterDay(user.exam_date as string | null, fromCheckout?.lastDay ?? null);
    // Dry run: count it and still send the 7-day reminder below, because the
    // renewal will charge (a-pricing-v2-fit: never a silent charge).
    if (autoStop === "dry_run" && stopDue(examDate, snapshot.next_charge_at, now)) result.wouldStop++;
    if (autoStop === "live" && stopDue(examDate, snapshot.next_charge_at, now)) {
      const key = `half_year_stop:${pin}`;
      const { data: claim, error: claimError } = await sb.from("processed_webhook_events")
        .insert({ provider: "billing_action", event_id: key, payload: { reason: "half_year_exam_passed", subscription_id: row.id, exam_date: examDate, claimed_at: now.toISOString() } })
        .select("event_id").maybeSingle();
      if (claimError || !claim) continue;
      const cancel = await cancelAtPeriodEnd(pin, fetchImpl);
      if (cancel.ok) {
        // Confirm on a fresh read that Whop scheduled the end of the period and
        // did not end the membership at once (the request body is checked
        // against the live API in the release gate, never assumed).
        const after = (await loadSnapshot(pin, "half_year")).snapshot;
        const scheduled = Boolean(after?.provider_state_verified && after.cancel_at_period_end &&
          (after.provider_status === "active" || after.provider_status === "canceling" || after.provider_status === "trialing"));
        if (scheduled) {
          result.stopped++;
          await sb.from("user_events").insert({ user_id: row.user_id, event_type: "half_year_renewal_stopped", event_data: { subscription_id: row.id, membership_id: pin, exam_date: examDate } });
          // Tell the learner (transactional; with the reminder mails on). Best effort.
          if (reminders && user.email) {
            const lang = user.language_code === "de" || !user.language_code ? "de" : "en";
            const mail = halfYearStoppedMail({ lang, accessUntil: row.expires_at });
            await sendUnlessSuppressed(sb, "transactional", { to: String(user.email), subject: mail.subject, htmlBody: mail.htmlBody }).catch(() => undefined);
          }
        } else {
          result.failed++;
          Sentry.captureMessage(`half-year renewal stop not confirmed for ${pin} (status ${after?.provider_status ?? "unreadable"}): check the membership at Whop by hand`, "error");
        }
      } else {
        result.failed++;
        // A refused or failed call is retried on the next run.
        if (cancel.status === 0 || cancel.status >= 500 || cancel.status === 429) {
          await sb.from("processed_webhook_events").delete().eq("provider", "billing_action").eq("event_id", key);
        }
      }
      continue;
    }
    // a-pricing-v2-fit: the renewal guard (14 days before the sitting).
    const sitting = guardSittingFor(guardSittings(user.exam_date as string | null, fromCheckout), snapshot.next_charge_at, now);
    if (autoStop === "dry_run" && sitting) result.wouldGuard++;
    if (autoStop === "live" && sitting) {
      const outcome = await applyRenewalGuard(sb, {
        row, pin, sitting, chargeAt: String(snapshot.next_charge_at), now, loadSnapshot, fetchImpl,
      });
      if (outcome === "guarded") {
        result.guarded++;
        if (reminders && user.email) {
          const lang = user.language_code === "de" || !user.language_code ? "de" : "en";
          const mail = halfYearGuardMail({ lang, chargeAt: String(snapshot.next_charge_at), accessUntil: guardAccessUntil(sitting).toISOString() });
          await sendUnlessSuppressed(sb, "transactional", { to: String(user.email), subject: mail.subject, htmlBody: mail.htmlBody }).catch(() => undefined);
        }
        continue;
      }
      if (outcome === "failed") result.failed++;
      // Review P2: a guard that did not complete (Whop refused or did not
      // confirm the stop, a failed read) falls through to the 7-day reminder
      // below, so a renewal that will charge is never silent. The reminder
      // has its own claim, so it goes out once.
    }
    if (reminders && reminderDue(snapshot, now) && user.email) {
      const key = `half_year_renewal:${pin}:${String(snapshot.next_charge_at).slice(0, 10)}`;
      const { data: claim, error: claimError } = await sb.from("processed_webhook_events")
        .insert({ provider: "mail_reminder", event_id: key, payload: { reason: "half_year_renewal", subscription_id: row.id, claimed_at: now.toISOString() } })
        .select("event_id").maybeSingle();
      if (claimError || !claim) continue;
      const lang = user.language_code === "de" || !user.language_code ? "de" : "en";
      const mail = halfYearRenewalMail({ lang, chargeAt: String(snapshot.next_charge_at), amountCents: snapshot.next_charge_amount_cents, manageUrl: snapshot.manage_url });
      const sent = await sendUnlessSuppressed(sb, "transactional", { to: String(user.email), subject: mail.subject, htmlBody: mail.htmlBody });
      if (sent.ok) result.reminded++; else result.failed++;
    }
  }
  if (result.skippedNoPin > 0 || result.skippedUnverified > 0) {
    Sentry.captureMessage(`half-year upkeep skipped ${result.skippedNoPin} row(s) without a membership pin and ${result.skippedUnverified} with an unreadable Whop state: no reminder or stop for them`, "warning");
  }
  return result;
}

type GuardOutcome = "guarded" | "claimed_elsewhere" | "failed";

/**
 * The renewal guard for one membership (live mode). Order: claim, access,
 * Whop stop. Every write is a compare-and-set on what was read; the claim
 * payload carries the before and after images (the audit record: no admin
 * actor exists for a cron, and admin_audit_log needs one).
 */
export async function applyRenewalGuard(
  sb: SupabaseClient,
  args: {
    row: { id: string; user_id: string; expires_at: string | null };
    pin: string;
    sitting: GuardSitting;
    chargeAt: string;
    now: Date;
    loadSnapshot: typeof loadWhopBillingRead;
    fetchImpl: Fetch;
  },
): Promise<GuardOutcome> {
  const { row, pin, sitting, chargeAt, now } = args;
  const accessUntil = guardAccessUntil(sitting).toISOString();
  // Its own key (review P2): the post-exam stop keeps half_year_stop:<pin>,
  // so a learner who resumes the membership at Whop is still stopped after it.
  const key = `half_year_guard:${pin}:${chargeAt.slice(0, 10)}`;
  const marker = `renewal_guard:${pin}:${chargeAt.slice(0, 10)}`;
  const { data: owner, error: ownerError } = await sb.from("users")
    .select("tier, role, tier_expires_at").eq("id", row.user_id).maybeSingle();
  if (ownerError || !owner) return "failed";
  const before = { user_tier: owner.tier ?? null, user_tier_expires_at: owner.tier_expires_at ?? null, subscription_expires_at: row.expires_at };
  const audit = { reason: "half_year_renewal_guard", subscription_id: row.id, membership_id: pin, charge_at: chargeAt, sitting, access_until: accessUntil, before, claimed_at: now.toISOString() };
  const { data: claim, error: claimError } = await sb.from("processed_webhook_events")
    .insert({ provider: "billing_action", event_id: key, payload: { ...audit, phase: "claimed" } })
    .select("event_id").maybeSingle();
  if (claimError && claimError.code !== "23505") return "failed";
  if (claimError || !claim) return "claimed_elsewhere";
  const phase = async (name: string, extra: Record<string, unknown> = {}) => {
    await sb.from("processed_webhook_events").update({ payload: { ...audit, phase: name, ...extra } })
      .eq("provider", "billing_action").eq("event_id", key);
  };
  const release = async () => {
    await sb.from("processed_webhook_events").delete().eq("provider", "billing_action").eq("event_id", key);
  };

  // (2) Access first. A separate zero-amount row, so the Whop deactivation
  // at the period end (which flips the Whop row) keeps Pro to this date.
  const { data: existing, error: existingError } = await sb.from("subscriptions").select("id")
    .eq("user_id", row.user_id).eq("payment_method", "renewal_guard").eq("provider_payment_id", marker).limit(1);
  if (existingError) { await release(); return "failed"; }
  if (!existing || existing.length === 0) {
    const { error: insertError } = await sb.from("subscriptions").insert({
      user_id: row.user_id, tier: "half_year", status: "active", payment_provider: "manual", payment_method: "renewal_guard",
      amount_cents: 0, currency: "EUR", started_at: chargeAt, expires_at: accessUntil, provider_payment_id: marker,
    });
    if (insertError) { await release(); return "failed"; }
  }
  // Compare-and-set on the paywall date: only forward, only from the value
  // read above, never for admins or open-ended access.
  let userExtended = false;
  const extendable = (o: { tier: string | null; role: string | null; tier_expires_at: string | null }) => {
    const at = o.tier_expires_at ? Date.parse(o.tier_expires_at) : NaN;
    return o.role !== "admin" && o.tier !== "admin" && Number.isFinite(at) && at < Date.parse(accessUntil);
  };
  // One retry from a fresh read (review P3): a profile write between the
  // read and the update must not leave the date to the webhook alone.
  let current: { tier: string | null; role: string | null; tier_expires_at: string | null } | null = owner;
  for (let attempt = 0; attempt < 2 && current && extendable(current) && !userExtended; attempt++) {
    const { data: changed, error: casError } = await sb.from("users")
      .update({ tier: "pro", tier_expires_at: accessUntil, updated_at: now.toISOString() })
      .eq("id", row.user_id).eq("tier", current.tier).eq("tier_expires_at", current.tier_expires_at)
      .select("id");
    if (casError) { await release(); return "failed"; }
    userExtended = (changed?.length ?? 0) === 1;
    if (!userExtended && attempt === 0) {
      const { data: fresh } = await sb.from("users").select("tier, role, tier_expires_at").eq("id", row.user_id).maybeSingle();
      current = fresh ?? null;
    }
  }
  if (current && extendable(current) && !userExtended) {
    // The date moved twice in between: the guard row still covers the
    // learner at the deactivation; report it for a look by hand.
    Sentry.captureMessage(`half-year renewal guard: tier_expires_at changed during the guard for ${row.user_id.slice(0, 8)}; guard row written, user date left as is`, "warning");
  }
  await phase("extended", { after: { access_until: accessUntil, user_tier_expires_at: userExtended ? accessUntil : before.user_tier_expires_at, guard_row: marker } });
  await sb.from("user_events").insert({ user_id: row.user_id, event_type: "half_year_renewal_guard", event_data: { subscription_id: row.id, membership_id: pin, charge_at: chargeAt, access_until: accessUntil, before, user_extended: userExtended } });

  // (3) The Whop stop, scheduled for the period end, confirmed on a fresh read.
  const cancel = await cancelAtPeriodEnd(pin, args.fetchImpl);
  if (!cancel.ok) {
    if (cancel.status === 0 || cancel.status >= 500 || cancel.status === 429) {
      await release();
    } else {
      await phase("stop_refused", { status: cancel.status });
      Sentry.captureMessage(`half-year renewal guard: Whop refused the stop for ${pin} (HTTP ${cancel.status}); the renewal may still charge, check the membership by hand`, "error");
    }
    return "failed";
  }
  const after = (await args.loadSnapshot(pin, "half_year")).snapshot;
  const scheduled = Boolean(after?.provider_state_verified && after.cancel_at_period_end &&
    (after.provider_status === "active" || after.provider_status === "canceling" || after.provider_status === "trialing"));
  if (!scheduled) {
    await phase("stop_unconfirmed", { provider_status: after?.provider_status ?? null });
    Sentry.captureMessage(`half-year renewal guard not confirmed for ${pin} (status ${after?.provider_status ?? "unreadable"}): check the membership at Whop by hand`, "error");
    return "failed";
  }
  await phase("stopped", { after: { access_until: accessUntil, user_tier_expires_at: userExtended ? accessUntil : before.user_tier_expires_at, guard_row: marker, cancel_at_period_end: true } });
  await sb.from("user_events").insert({ user_id: row.user_id, event_type: "half_year_renewal_stopped", event_data: { subscription_id: row.id, membership_id: pin, reason: "renewal_guard", sitting, access_until: accessUntil } });
  return "guarded";
}
