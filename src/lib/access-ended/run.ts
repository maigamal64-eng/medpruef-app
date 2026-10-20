/**
 * Post-expiry mail (a-renewal-pack-1019): the sweep.
 *
 * Called by /api/cron/trial-reminder after the expiry sweep while
 * ACCESS_ENDED_EMAILS_ENABLED is on, and by the read-only preview
 * (scripts/reminders/renewal-pack-preview.ts) with dryRun forced on.
 *
 *   1. Paid one-time pass rows that ended 1 to 3 Vienna days ago (isPaidPass),
 *      grouped by learner (latest end wins).
 *   2. Per learner: the account, every other subscription row, the claim, the
 *      L0 cap (loadMarketingCapHits) and the sitting week, then
 *      decideAccessEnded.
 *   3. At most one mail per learner and end day: a claim under the
 *      "mail_reminder" provider (counted by the cap) is written before the
 *      provider call and released only when the mail certainly did not go out.
 *      Holds (cap, cap unreadable, sitting week) write nothing and may clear
 *      on a later day inside the window.
 *   4. Sent through sendUnlessSuppressed as "marketing".
 *
 * A dry run reads and decides only: no claim, no event, no send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadMarketingCapHits } from "@/lib/day1-ask/run";
import { resumeExcludedIds } from "@/lib/checkout-resume";
import { isSittingWeek, resolveNamedSitting } from "@/lib/journey/moments";
import { checkSuppression, sendUnlessSuppressed, type GuardedSendResult } from "@/lib/mail-suppression";
import { reminderLang } from "@/lib/reminders/access-ending";
import type { SendZohoEmailArgs, SendZohoEmailResult } from "@/lib/email/zoho";
import { AUTO_RENEWING_TIERS } from "@/lib/billing-cadence";
import { renderAccessEnded } from "./copy";
import {
  ACCESS_ENDED_CLAIM_PROVIDER, ACCESS_ENDED_SENT, ACCESS_ENDED_TIERS, LAST_DAY_AFTER, MAX_ENDED_ROWS,
  accessEndedClaimKey, decideAccessEnded, isPaidPass, type EndedRow, type LearnerAccount, type OtherRow,
} from "./rules";

const DAY_MS = 86_400_000;
const ID_CHUNK = 100;
const USER_COLUMNS = "id, email, role, tier, tier_expires_at, is_banned, language_code, exam_date, active_exam";

type EventWriter = (userId: string, eventType: string, data: Record<string, unknown>) => Promise<void>;

export interface AccessEndedRow {
  /** First 8 characters of the user id; never an address or a name. */
  user: string;
  decision: string;
  end_day: string;
  lang: "de" | "en" | null;
  /** Do-not-email status (marketing scope), read in dry runs only. */
  suppression: "clear" | "suppressed" | "invalid" | "unknown" | null;
}

export interface AccessEndedRunResult {
  dryRun: boolean;
  candidates: number;
  wouldSend: number;
  sent: number;
  withheld: number;
  held: Record<string, number>;
  skipped: Record<string, number>;
  duplicates: number;
  errors: string[];
  rows: AccessEndedRow[];
}

function chunks<T>(list: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const viennaDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });

export async function runAccessEndedMails(
  sb: SupabaseClient,
  opts: {
    now?: Date;
    dryRun: boolean;
    recordEvent: EventWriter;
    send?: (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;
    excluded?: ReadonlySet<string>;
  },
): Promise<AccessEndedRunResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const result: AccessEndedRunResult = {
    dryRun: opts.dryRun, candidates: 0, wouldSend: 0, sent: 0, withheld: 0, held: {}, skipped: {}, duplicates: 0, errors: [], rows: [],
  };
  const fail = (step: string) => { result.errors.push(step); return result; };

  // 1. Ended pass rows (the sweep has already flipped today's ends to expired; an unflipped active row counts too).
  const since = new Date(nowMs - (LAST_DAY_AFTER + 1) * DAY_MS).toISOString();
  const { data: ended, error: endedError } = await sb.from("subscriptions")
    .select("id, user_id, tier, status, payment_provider, provider_payment_id, amount_cents, expires_at")
    .in("tier", [...ACCESS_ENDED_TIERS]).in("status", ["expired", "active"])
    .gte("expires_at", since).lt("expires_at", nowIso)
    .order("expires_at", { ascending: true }).limit(MAX_ENDED_ROWS);
  if (endedError) return fail("ended_rows_unreadable");
  const endedRows = (ended ?? []) as Array<Omit<EndedRow, "plan_id"> & { user_id: string }>;
  if (endedRows.length >= MAX_ENDED_ROWS) result.errors.push("ended_rows_truncated");

  // Plan ids for Whop rows on the shared v1 keys (one-time and renewing plans share them).
  const needPlan = endedRows.filter((r) => r.payment_provider === "whop" && !AUTO_RENEWING_TIERS.has(r.tier) && r.provider_payment_id)
    .map((r) => r.provider_payment_id as string);
  const planByPayment = new Map<string, string>();
  for (const part of chunks([...new Set(needPlan)])) {
    const { data, error } = await sb.from("payment_events").select("payment_id, plan_id").in("payment_id", part).not("plan_id", "is", null);
    if (error) return fail("plans_unreadable");
    for (const e of (data ?? []) as Array<{ payment_id: string; plan_id: string | null }>) {
      if (e.plan_id && !planByPayment.has(e.payment_id)) planByPayment.set(e.payment_id, e.plan_id);
    }
  }

  const endByUser = new Map<string, number>();
  const passRowIds = new Set<string>();
  for (const r of endedRows) {
    const row: EndedRow = { ...r, plan_id: r.provider_payment_id ? planByPayment.get(r.provider_payment_id) ?? null : null };
    if (!isPaidPass(row)) continue;
    const endMs = Date.parse(row.expires_at);
    if (!Number.isFinite(endMs)) continue;
    passRowIds.add(row.id);
    endByUser.set(r.user_id, Math.max(endByUser.get(r.user_id) ?? 0, endMs));
  }
  const userIds = [...endByUser.keys()].sort();
  result.candidates = userIds.length;
  if (userIds.length === 0) return result;

  // 2. Accounts, other rows, claims, cap.
  const accounts = new Map<string, LearnerAccount & { language_code: string | null; exam_date: string | null; active_exam: string | null }>();
  const others = new Map<string, OtherRow[]>();
  const claimed = new Set<string>();
  for (const part of chunks(userIds)) {
    const { data: users, error: usersError } = await sb.from("users").select(USER_COLUMNS).in("id", part);
    if (usersError) return fail("users_unreadable");
    for (const u of (users ?? []) as Array<LearnerAccount & { language_code: string | null; exam_date: string | null; active_exam: string | null }>) accounts.set(u.id, u);
    const { data: subs, error: subsError } = await sb.from("subscriptions").select("id, user_id, status, expires_at, created_at").in("user_id", part);
    if (subsError) return fail("rows_unreadable");
    for (const s of (subs ?? []) as Array<OtherRow & { user_id: string }>) {
      if (passRowIds.has(s.id)) continue;
      const list = others.get(s.user_id) ?? [];
      list.push({ id: s.id, status: s.status, expires_at: s.expires_at, created_at: s.created_at });
      others.set(s.user_id, list);
    }
    const keys = part.map((id) => accessEndedClaimKey(id, endByUser.get(id) as number));
    const { data: claims, error: claimsError } = await sb.from("processed_webhook_events").select("event_id")
      .eq("provider", ACCESS_ENDED_CLAIM_PROVIDER).in("event_id", keys);
    if (claimsError) return fail("claims_unreadable");
    for (const c of (claims ?? []) as Array<{ event_id: string }>) claimed.add(c.event_id);
  }
  let capHits: Set<string> | null = null;
  try { capHits = await loadMarketingCapHits(sb, userIds, now); } catch { capHits = null; result.errors.push("cap_unreadable"); }
  const excluded = opts.excluded ?? resumeExcludedIds();

  // 3. Decide and act.
  for (const userId of userIds) {
    const endMs = endByUser.get(userId) as number;
    const account = accounts.get(userId) ?? null;
    const claimKey = accessEndedClaimKey(userId, endMs);
    const named = account ? resolveNamedSitting({ examDate: account.exam_date, activeExam: account.active_exam }, now) : null;
    const decision = decideAccessEnded({
      account, endMs, otherRows: others.get(userId) ?? [], claimed: claimed.has(claimKey),
      capHit: capHits ? capHits.has(userId) : null, sittingWeek: isSittingWeek(named, now), excluded, nowMs,
    });
    const base: AccessEndedRow = { user: userId.slice(0, 8), decision: "", end_day: viennaDayFmt.format(new Date(endMs)), lang: null, suppression: null };
    if (decision.act === "skip") {
      result.skipped[decision.reason] = (result.skipped[decision.reason] ?? 0) + 1;
      if (decision.reason === "already_claimed") result.duplicates += 1;
      result.rows.push({ ...base, decision: decision.reason });
      continue;
    }
    if (decision.act === "hold") {
      result.held[decision.reason] = (result.held[decision.reason] ?? 0) + 1;
      result.rows.push({ ...base, decision: `hold_${decision.reason}` });
      continue;
    }
    const email = (account?.email ?? "").trim();
    const lang = reminderLang(account?.language_code);

    if (opts.dryRun) {
      let suppression: AccessEndedRow["suppression"];
      try { suppression = await checkSuppression(sb, email, "marketing"); } catch { suppression = "unknown"; }
      if (suppression === "clear") result.wouldSend += 1;
      result.rows.push({ ...base, lang, suppression, decision: suppression === "clear" ? "would_send" : "would_withhold" });
      continue;
    }

    const endIso = new Date(endMs).toISOString();
    const { data: claim, error: claimError } = await sb.from("processed_webhook_events").insert({
      provider: ACCESS_ENDED_CLAIM_PROVIDER, event_id: claimKey,
      payload: { reason: "access_ended", user_id: userId, access_ended_at: endIso, claimed_at: nowIso },
    }).select("event_id").maybeSingle();
    if (claimError) {
      if (claimError.code === "23505") { result.duplicates += 1; result.skipped.already_claimed = (result.skipped.already_claimed ?? 0) + 1; }
      else result.errors.push(`claim:${base.user}`);
      continue;
    }
    if (!claim) { result.errors.push(`claim:${base.user}`); continue; }
    const release = async () => {
      const { error } = await sb.from("processed_webhook_events").delete().eq("provider", ACCESS_ENDED_CLAIM_PROVIDER).eq("event_id", claimKey);
      if (error) result.errors.push(`release:${base.user}`);
    };

    const { data: gam } = await sb.from("user_gamification").select("total_questions_answered").eq("user_id", userId).maybeSingle();
    const answered = typeof gam?.total_questions_answered === "number" ? gam.total_questions_answered : null;
    let mail: { subject: string; htmlBody: string };
    try {
      mail = renderAccessEnded({ lang, endedAtIso: endIso, answered, activeExam: account?.active_exam ?? null });
    } catch {
      await release();
      result.errors.push(`render:${base.user}`);
      continue;
    }
    const eventBase = { access_ended_at: endIso, days_after: decision.daysAfter, language: lang, reason: "access_ended" };
    const sent: GuardedSendResult = await sendUnlessSuppressed(sb, "marketing", { to: email, subject: mail.subject, htmlBody: mail.htmlBody }, opts.send);
    if (sent.ok) {
      result.sent += 1;
      await opts.recordEvent(userId, ACCESS_ENDED_SENT, { ...eventBase, ok: true });
      result.rows.push({ ...base, lang, decision: "sent" });
      continue;
    }
    if (sent.reason === "suppressed" || sent.reason === "invalid_address") {
      // The learner asked not to be mailed, or the address is unusable. The claim stays.
      result.withheld += 1;
      await opts.recordEvent(userId, sent.reason === "suppressed" ? "access_ended_email_suppressed" : "access_ended_email_invalid_address", { ...eventBase, ok: false });
      result.rows.push({ ...base, lang, decision: sent.reason });
      continue;
    }
    const status = "status" in sent ? sent.status ?? null : null;
    const certainlyUndelivered = sent.reason === "suppression_check_failed" || sent.reason === "not_configured" || sent.reason === "auth_failed" ||
      (sent.reason === "send_failed" && status !== null && status >= 400 && status < 500);
    if (certainlyUndelivered) await release();
    await opts.recordEvent(userId, "access_ended_email_failed", { ...eventBase, ok: false, failure_reason: sent.reason, failure_status: status, claim_kept: !certainlyUndelivered });
    result.errors.push(`send:${base.user}: ${sent.reason}`);
    result.rows.push({ ...base, lang, decision: "failed" });
  }
  return result;
}
