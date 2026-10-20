/**
 * Pre-charge renewal notice (a-renewal-pack-1019): the sweep.
 *
 * Called by /api/cron/trial-reminder (daily 07:00 UTC) while
 * RENEWAL_NOTICE_ENABLED is on, and by the read-only preview
 * (scripts/reminders/renewal-pack-preview.ts) with dryRun forced on.
 *
 *   1. Candidates: active Whop rows pinned to a real membership whose ledger
 *      end is within CANDIDATE_LOOKAHEAD_DAYS, one-time tiers left out, one
 *      entry per membership.
 *   2. One bounded Whop read per membership: the charge day and amount are
 *      Whop's (renewalNoticeDue).
 *   3. At most one notice per membership and charge day: a claim in
 *      processed_webhook_events (provider "renewal_notice", NOT the
 *      "mail_reminder" provider the marketing cap counts) is written before
 *      the provider call and released only when the mail certainly did not go
 *      out (list unreadable, mail env or token missing, provider 4xx), so the
 *      next daily run retries while the charge is still at least a day away.
 *   4. Sent through sendUnlessSuppressed as "transactional".
 *
 * A dry run reads and decides only: no claim, no event, no send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ONE_TIME_TIERS } from "@/lib/billing-cadence";
import { sendUnlessSuppressed, checkSuppression, type GuardedSendResult } from "@/lib/mail-suppression";
import type { SendZohoEmailArgs, SendZohoEmailResult } from "@/lib/email/zoho";
import { whopMembershipIdOrNull } from "@/lib/whop-ids";
import { loadWhopBillingSnapshot, type ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";
import { renderRenewalNotice } from "./copy";
import {
  CANDIDATE_LOOKAHEAD_DAYS, MAX_MEMBERSHIPS_PER_RUN, RECENT_CLAIM_DAYS, RENEWAL_NOTICE_CLAIM_PROVIDER, RENEWAL_NOTICE_SENT, WHOP_READ_BUDGET_MS,
  noticeLang, renewalNoticeClaimKey, renewalNoticeDue,
} from "./rules";

const DAY_MS = 86_400_000;

type EventWriter = (userId: string, eventType: string, data: Record<string, unknown>) => Promise<void>;

export interface RenewalNoticeRow {
  /** First 8 characters of the user id; never an address or a name. */
  user: string;
  /** Membership id cut to prefix + 5. */
  membership: string;
  decision: string;
  charge_day: string | null;
  days_ahead: number | null;
  amount_cents: number | null;
  lang: "de" | "en" | null;
  /** Do-not-email status (transactional scope), read in dry runs only. */
  suppression: "clear" | "suppressed" | "invalid" | "unknown" | null;
}

export interface RenewalNoticeRunResult {
  dryRun: boolean;
  candidates: number;
  wouldSend: number;
  sent: number;
  withheld: number;
  duplicates: number;
  skipped: Record<string, number>;
  errors: string[];
  rows: RenewalNoticeRow[];
}

const cut = (membershipId: string) => membershipId.slice(0, 9);

export async function runRenewalNotices(
  sb: SupabaseClient,
  opts: {
    now?: Date;
    dryRun: boolean;
    recordEvent: EventWriter;
    send?: (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;
    loadSnapshot?: (membershipId: string, tier: string) => Promise<ProviderBillingSnapshot | null>;
    /** Wall clock for the read budget (tests); defaults to Date.now. */
    clock?: () => number;
  },
): Promise<RenewalNoticeRunResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const loadSnapshot = opts.loadSnapshot ?? loadWhopBillingSnapshot;
  const result: RenewalNoticeRunResult = {
    dryRun: opts.dryRun, candidates: 0, wouldSend: 0, sent: 0, withheld: 0, duplicates: 0, skipped: {}, errors: [], rows: [],
  };
  const skip = (reason: string) => { result.skipped[reason] = (result.skipped[reason] ?? 0) + 1; };

  const { data: rows, error } = await sb.from("subscriptions")
    .select("id, user_id, tier, whop_membership_id, expires_at")
    .eq("payment_provider", "whop").eq("status", "active")
    .gt("expires_at", nowIso).lte("expires_at", new Date(nowMs + CANDIDATE_LOOKAHEAD_DAYS * DAY_MS).toISOString())
    .order("expires_at", { ascending: true }).limit(200);
  if (error) {
    result.errors.push("candidates_unreadable");
    return result;
  }

  // One entry per membership; one-time tiers never charge again.
  const byMembership = new Map<string, { subscriptionId: string; userId: string; tier: string }>();
  const disagree = new Set<string>();
  for (const r of (rows ?? []) as Array<{ id: string; user_id: string; tier: string; whop_membership_id: string | null }>) {
    if (ONE_TIME_TIERS.has(String(r.tier))) continue;
    const membershipId = whopMembershipIdOrNull(r.whop_membership_id);
    if (!membershipId) {
      // A legacy mber_ (member) pin can still renew but cannot be read as a membership: Kassa notices it by hand.
      if (typeof r.whop_membership_id === "string" && r.whop_membership_id.startsWith("mber_")) {
        skip("legacy_pin");
        result.errors.push(`legacy_pin:${String(r.user_id).slice(0, 8)}`);
      }
      continue;
    }
    const seen = byMembership.get(membershipId);
    if (seen && seen.userId !== r.user_id) disagree.add(membershipId);
    if (!seen) byMembership.set(membershipId, { subscriptionId: r.id, userId: r.user_id, tier: String(r.tier) });
  }
  // One membership on two accounts: never guess the recipient.
  for (const membershipId of disagree) {
    const row = byMembership.get(membershipId)!;
    byMembership.delete(membershipId);
    skip("rows_disagree");
    result.errors.push(`rows_disagree:${row.userId.slice(0, 8)}`);
  }
  // Already noticed this cycle: no Whop read (the claim key check below stays the guard).
  const { data: recent, error: recentError } = await sb.from("processed_webhook_events").select("event_id")
    .eq("provider", RENEWAL_NOTICE_CLAIM_PROVIDER).gte("processed_at", new Date(nowMs - RECENT_CLAIM_DAYS * DAY_MS).toISOString()).limit(500);
  if (recentError) {
    result.errors.push("claims_unreadable");
    return result;
  }
  for (const c of (recent ?? []) as Array<{ event_id: string }>) {
    const membershipId = c.event_id.split(":")[1];
    if (membershipId && byMembership.delete(membershipId)) { result.duplicates += 1; skip("already_claimed"); }
  }
  let memberships = [...byMembership.entries()];
  if (memberships.length > MAX_MEMBERSHIPS_PER_RUN) {
    result.errors.push(`truncated:${memberships.length}`);
    memberships = memberships.slice(0, MAX_MEMBERSHIPS_PER_RUN);
  }
  result.candidates = memberships.length;

  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  for (const [membershipId, row] of memberships) {
    if (clock() - startedAt > WHOP_READ_BUDGET_MS) {
      result.errors.push("time_budget");
      break;
    }
    const base: RenewalNoticeRow = {
      user: row.userId.slice(0, 8), membership: cut(membershipId), decision: "", charge_day: null, days_ahead: null,
      amount_cents: null, lang: null, suppression: null,
    };
    let snapshot: ProviderBillingSnapshot | null = null;
    try { snapshot = await loadSnapshot(membershipId, row.tier); } catch { snapshot = null; }
    const due = renewalNoticeDue(snapshot, nowMs);
    if (!due.due) {
      skip(due.reason);
      // An unreadable snapshot is worth a look; the others are normal states.
      if (due.reason === "no_snapshot" || due.reason === "no_amount") result.errors.push(`${due.reason}:${base.user}`);
      result.rows.push({ ...base, decision: due.reason });
      continue;
    }
    const amountCents = snapshot!.next_charge_amount_cents as number;
    const dueRow: RenewalNoticeRow = { ...base, charge_day: due.chargeDay, days_ahead: due.daysAhead, amount_cents: amountCents };
    const claimKey = renewalNoticeClaimKey(membershipId, due.chargeDay);

    const { data: existing, error: claimReadError } = await sb.from("processed_webhook_events")
      .select("event_id").eq("provider", RENEWAL_NOTICE_CLAIM_PROVIDER).eq("event_id", claimKey).maybeSingle();
    if (claimReadError) { result.errors.push(`claim_read:${base.user}`); result.rows.push({ ...dueRow, decision: "claim_unreadable" }); continue; }
    if (existing) { result.duplicates += 1; skip("already_claimed"); result.rows.push({ ...dueRow, decision: "already_claimed" }); continue; }

    const { data: user, error: userError } = await sb.from("users").select("id, email, language_code")
      .eq("id", row.userId).maybeSingle();
    if (userError) { result.errors.push(`user_read:${base.user}`); result.rows.push({ ...dueRow, decision: "user_unreadable" }); continue; }
    const email = typeof user?.email === "string" ? user.email.trim() : "";
    if (!email) { skip("no_email"); result.rows.push({ ...dueRow, decision: "no_email" }); continue; }
    const lang = noticeLang(user?.language_code as string | null);
    let mail: { subject: string; htmlBody: string };
    try {
      mail = renderRenewalNotice({
        lang, chargeAtIso: new Date(due.chargeMs).toISOString(), amountCents,
        intervalDays: snapshot!.billing_interval_days as number, manageUrl: snapshot!.manage_url,
      });
    } catch {
      result.errors.push(`render:${base.user}`);
      result.rows.push({ ...dueRow, lang, decision: "render_failed" });
      continue;
    }

    if (opts.dryRun) {
      let suppression: RenewalNoticeRow["suppression"];
      try { suppression = await checkSuppression(sb, email, "transactional"); } catch { suppression = "unknown"; }
      if (suppression === "clear") result.wouldSend += 1;
      result.rows.push({ ...dueRow, lang, suppression, decision: suppression === "clear" ? "would_send" : "would_withhold" });
      continue;
    }

    const eventBase = {
      subscription_id: row.subscriptionId, membership_id: membershipId, charge_at: new Date(due.chargeMs).toISOString(),
      charge_day: due.chargeDay, amount_cents: amountCents, days_ahead: due.daysAhead, language: lang,
    };
    const { data: claim, error: claimError } = await sb.from("processed_webhook_events").insert({
      provider: RENEWAL_NOTICE_CLAIM_PROVIDER, event_id: claimKey,
      payload: { reason: "renewal_notice", user_id: row.userId, subscription_id: row.subscriptionId, charge_day: due.chargeDay, claimed_at: nowIso },
    }).select("event_id").maybeSingle();
    if (claimError) {
      if (claimError.code === "23505") { result.duplicates += 1; skip("already_claimed"); }
      else result.errors.push(`claim:${base.user}`);
      continue;
    }
    if (!claim) { result.errors.push(`claim:${base.user}`); continue; }
    const release = async () => {
      const { error: releaseError } = await sb.from("processed_webhook_events").delete()
        .eq("provider", RENEWAL_NOTICE_CLAIM_PROVIDER).eq("event_id", claimKey);
      if (releaseError) result.errors.push(`release:${base.user}`);
    };

    const sent: GuardedSendResult = await sendUnlessSuppressed(sb, "transactional", { to: email, subject: mail.subject, htmlBody: mail.htmlBody }, opts.send);
    if (sent.ok) {
      result.sent += 1;
      await opts.recordEvent(row.userId, RENEWAL_NOTICE_SENT, { ...eventBase, ok: true });
      result.rows.push({ ...dueRow, lang, decision: "sent" });
      continue;
    }
    if (sent.reason === "suppressed" || sent.reason === "invalid_address") {
      // A bounce, complaint or manual block (scope all), or an unusable address. The claim stays.
      result.withheld += 1;
      await opts.recordEvent(row.userId, sent.reason === "suppressed" ? "renewal_notice_suppressed" : "renewal_notice_invalid_address", { ...eventBase, ok: false });
      result.rows.push({ ...dueRow, lang, decision: sent.reason });
      continue;
    }
    const status = "status" in sent ? sent.status ?? null : null;
    // Same rule as the access-ending reminder: release only when nothing can have reached the learner.
    const certainlyUndelivered = sent.reason === "suppression_check_failed" || sent.reason === "not_configured" || sent.reason === "auth_failed" ||
      (sent.reason === "send_failed" && status !== null && status >= 400 && status < 500);
    if (certainlyUndelivered) await release();
    await opts.recordEvent(row.userId, "renewal_notice_failed", { ...eventBase, ok: false, failure_reason: sent.reason, failure_status: status, claim_kept: !certainlyUndelivered });
    result.errors.push(`send:${base.user}: ${sent.reason}`);
    result.rows.push({ ...dueRow, lang, decision: "failed" });
  }
  return result;
}
