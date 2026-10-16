/**
 * Day-1 sitting ask (a-day1-sitting-ask): one onboarding mail per account
 * ever, about 24 hours after an email registration, when the account still
 * has no named future sitting.
 *
 * Audience (all must hold, silent skip otherwise; rulebook B4, Lektor):
 *   - registered 24 to 72 hours ago (a daily or hourly run that misses a day
 *     still reaches the account; after 72 hours it never will)
 *   - has a password (email registration; Telegram-only accounts belong to
 *     the Telegram welcome) and an address
 *   - users.exam_date empty or in the past (Vienna day)
 *   - not admin, staff or test, not banned
 * Then, each ends in one claim and one event, never a retry:
 *   - email_status "bounced"           held, reason "bounced"
 *   - 1 in 5 by a stable hash of the id held out for attribution
 *   - another marketing mail in the last 14 days (L0 cap), or the cap
 *     unreadable                        held, reason "cap"
 *   - do-not-email list / unusable address (inside the guarded send)
 *                                       held, reason "suppressed"
 * Everything else is sent through sendUnlessSuppressed.
 *
 *   - already used the sitting link (sitting_link_open or sitting_set event)
 *     is a silent skip (rulebook B4 point 1).
 *
 * Idempotency: processed_webhook_events provider "mail_reminder", key
 * "day1_ask:<user id>" (one per account ever; the same ledger the L0 cap
 * source reads, so a mailed learner is counted for the cap). Only a SENT
 * claim carries payload.user_id (what L0 counts); held claims carry uid8
 * only, so a holdout is never mistaken for a mailed learner. A claim is
 * released only when the mail certainly did not go out (list unreadable,
 * mail env missing, provider 4xx), as the access-ending sender does.
 *
 * Dry run: reads and decides, returns counts only. No claim, no mail, no
 * event, no write of any kind.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { sendUnlessSuppressed, checkSuppression, type GuardedSendResult, type MailCategory } from "@/lib/mail-suppression";
import type { SendZohoEmailArgs, SendZohoEmailResult } from "@/lib/email/zoho";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { sittingLinksConfigured, signSittingToken, sittingLinkUrl } from "@/lib/sitting-link/token";
import { day1Lang, type Day1Lang } from "./copy";
import { renderDay1Ask } from "./template";

export const DAY1_CLAIM_PROVIDER = "mail_reminder";
export const DAY1_MIN_AGE_H = 24;
export const DAY1_MAX_AGE_H = 72;
export const DAY1_CAP_DAYS = 14;
/** Rulebook class (Lektor ruling in the handover). Marketing is the strict default: the cap and the list scope apply. */
export const DAY1_CATEGORY: MailCategory = "marketing";
/** Vienna hours in which a send may start (inclusive start, exclusive end). */
export const DAY1_SEND_HOURS = { from: 9, to: 18 } as const;
/** Rulebook B4 point 3: at most 20 per batch; 10 keeps one run of sequential provider calls well inside the 30 s function budget. */
export const DAY1_MAX_PER_RUN = 10;
/** S08 blackouts (Vienna days, inclusive): nothing is sent; a learner whose window ends inside one is dropped. */
export const DAY1_BLACKOUTS: ReadonlyArray<readonly [string, string]> = [["2026-11-17", "2026-11-20"], ["2026-11-23", "2026-11-27"]];
export const inBlackout = (day: string) => DAY1_BLACKOUTS.some(([a, b]) => day >= a && day <= b);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const day1ClaimKey = (userId: string) => `day1_ask:${userId}`;

const viennaDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
export const viennaDay = (ms: number) => viennaDayFmt.format(new Date(ms));
const viennaHourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", hour12: false });
export function viennaHour(ms: number): number {
  return Number(viennaHourFmt.format(new Date(ms))) % 24;
}

/** Stable 1 in 5: the same account is in the same arm on every run. */
export function isHoldout(userId: string): boolean {
  return createHash("sha256").update(`day1-ask-holdout:${userId.toLowerCase()}`).digest().readUInt32BE(0) % 5 === 0;
}

export interface Day1User {
  id: string;
  email: string | null;
  language_code: string | null;
  created_at: string;
  exam_date: string | null;
  active_exam: string | null;
  role: string | null;
  tier: string | null;
  is_banned: boolean | null;
  email_status: string | null;
}

export type Day1Decision =
  | "send"
  | "holdout"
  | "held_bounced"
  | "skip_has_sitting"
  | "skip_staff_test"
  | "skip_banned"
  | "skip_no_email"
  | "skip_out_of_window";

/** Pure audience rule for one account (before cap, list and claim checks). */
export function decideDay1(u: Day1User, nowMs: number): Day1Decision {
  const age = nowMs - Date.parse(u.created_at);
  if (!Number.isFinite(age) || age < DAY1_MIN_AGE_H * HOUR_MS || age > DAY1_MAX_AGE_H * HOUR_MS) return "skip_out_of_window";
  if (u.is_banned === true) return "skip_banned";
  if (isStaffOrTestAccount({ email: u.email, role: u.role, tier: u.tier })) return "skip_staff_test";
  if (!u.email || u.email.trim() === "") return "skip_no_email";
  // A named sitting that has not passed (Vienna day): nothing to ask.
  if (u.exam_date && u.exam_date >= viennaDay(nowMs)) return "skip_has_sitting";
  if (u.email_status === "bounced") return "held_bounced";
  if (isHoldout(u.id)) return "holdout";
  return "send";
}

class ReadError extends Error {
  constructor(step: string) { super(`day1-ask read failed: ${step}`); this.name = "Day1ReadError"; }
}

const USER_COLUMNS = "id, email, language_code, created_at, exam_date, active_exam, role, tier, is_banned, email_status";
const READ_LIMIT = 2000;

export async function loadDay1Candidates(sb: SupabaseClient, now: Date): Promise<Day1User[]> {
  const from = new Date(now.getTime() - DAY1_MAX_AGE_H * HOUR_MS).toISOString();
  const to = new Date(now.getTime() - DAY1_MIN_AGE_H * HOUR_MS).toISOString();
  // Newest first: if a window ever holds more than the limit, the accounts nearest the cut-off still get their mail.
  const { data, error } = await sb.from("users").select(USER_COLUMNS)
    .gte("created_at", from).lte("created_at", to)
    .not("password_hash", "is", null).not("email", "is", null)
    .order("created_at", { ascending: false }).limit(500);
  if (error) throw new ReadError("users");
  return (data ?? []) as Day1User[];
}

/** Ids that already hold a day-1 claim (sent or held): one per account ever. */
const IN_CHUNK = 100;
const chunked = <T,>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += IN_CHUNK) out.push(list.slice(i, i + IN_CHUNK));
  return out;
};

export async function loadDay1Claimed(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunked(ids)) {
    const { data, error } = await sb.from("processed_webhook_events").select("event_id")
      .eq("provider", DAY1_CLAIM_PROVIDER).in("event_id", part.map(day1ClaimKey));
    if (error) throw new ReadError("claims");
    for (const r of (data ?? []) as Array<{ event_id: string }>) out.add(r.event_id.slice("day1_ask:".length));
  }
  return out;
}

/**
 * L0 cap, read in the app (rulebook: at most 1 marketing mail per learner per
 * 14 days, every class counted). Same sources as the L0 exclusion SQL:
 * mail_reminder claims that carry a user id, confirmed access-ending and
 * reverse-trial end notice sends (user_events, DAY1_CAP_EVENT_TYPES) and study
 * reminders (last_sent).
 * Hand notes cannot be read here; the CEO's audience files carry them.
 * Returns the ids with a marketing mail inside the window. Throws when a
 * source cannot be read completely (the caller sends nothing and writes no
 * claim, so the next run retries). Exam-reminder sends are keyed by address,
 * not by account, and hand notes live outside the database: neither is read
 * here (the L0 SQL and the CEO's audience files carry them).
 */
/**
 * Learner-mail events the L0 cap reads from user_events. The reverse-trial end
 * notice (a-reverse-trial-end-mail) claims under its own provider, not
 * "mail_reminder", so only its sent event makes it visible here
 * (a-release-int-7 seam; the notice's own cap reads "day1_ask_sent").
 */
export const DAY1_CAP_EVENT_TYPES = ["trial_reminder_email_sent", "trial_end_notice_sent"];

export async function loadMarketingCapHits(sb: SupabaseClient, ids: string[], now: Date, days = DAY1_CAP_DAYS): Promise<Set<string>> {
  const hits = new Set<string>();
  if (ids.length === 0) return hits;
  const wanted = new Set(ids);
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();

  const claims = await sb.from("processed_webhook_events").select("event_id, payload")
    .eq("provider", DAY1_CLAIM_PROVIDER).gte("processed_at", cutoff).limit(READ_LIMIT);
  if (claims.error) throw new ReadError("cap_claims");
  if ((claims.data ?? []).length >= READ_LIMIT) throw new ReadError("cap_claims_truncated");
  for (const c of (claims.data ?? []) as Array<{ event_id: string; payload: { user_id?: string } | null }>) {
    const uid = c.payload?.user_id;
    if (uid && wanted.has(uid)) hits.add(uid);
  }

  for (const part of chunked(ids)) {
    const sent = await sb.from("user_events").select("user_id").in("event_type", DAY1_CAP_EVENT_TYPES)
      .in("user_id", part).gte("created_at", cutoff).limit(READ_LIMIT);
    if (sent.error) throw new ReadError("cap_events");
    for (const r of (sent.data ?? []) as Array<{ user_id: string }>) hits.add(r.user_id);

    const nudges = await sb.from("study_nudge_prefs").select("user_id").in("user_id", part).gte("last_sent", cutoff).limit(READ_LIMIT);
    if (nudges.error) throw new ReadError("cap_nudges");
    for (const r of (nudges.data ?? []) as Array<{ user_id: string }>) hits.add(r.user_id);
  }
  return hits;
}

/** Ids that already opened or used the one-tap sitting link (rulebook B4 point 1). */
export async function loadDay1Engaged(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunked(ids)) {
    const { data, error } = await sb.from("user_events").select("user_id").in("event_type", ["sitting_link_open", "sitting_set"]).in("user_id", part).limit(READ_LIMIT);
    if (error) throw new ReadError("engaged");
    for (const r of (data ?? []) as Array<{ user_id: string }>) out.add(r.user_id);
  }
  return out;
}

export interface Day1RunResult {
  dry_run: boolean;
  candidates: number;
  /** Decision counts, plus held_cap, held_suppressed, skip_already_claimed. */
  counts: Record<string, number>;
  would_send: number;
  sent: number;
  held: number;
  errors: string[];
}

type EventWriter = (userId: string, eventType: string, data: Record<string, unknown>) => Promise<void>;

export interface Day1RunOptions {
  now?: Date;
  dryRun: boolean;
  recordEvent: EventWriter;
  send?: (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;
  /** Test seam: skip the Vienna send-hour rule. */
  ignoreSendHours?: boolean;
  maxPerRun?: number;
}

const bump = (c: Record<string, number>, k: string) => { c[k] = (c[k] ?? 0) + 1; };

export async function runDay1SittingAsk(sb: SupabaseClient, opts: Day1RunOptions): Promise<Day1RunResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const result: Day1RunResult = { dry_run: opts.dryRun, candidates: 0, counts: {}, would_send: 0, sent: 0, held: 0, errors: [] };
  let users: Day1User[];
  try { users = await loadDay1Candidates(sb, now); } catch (err) { result.errors.push((err as Error).message); return result; }
  result.candidates = users.length;

  const decided = users.map((u) => ({ u, d: decideDay1(u, nowMs) }));
  for (const x of decided) bump(result.counts, x.d);
  const pending = decided.filter((x) => x.d === "send" || x.d === "holdout" || x.d === "held_bounced");
  let claimed: Set<string>;
  try { claimed = await loadDay1Claimed(sb, pending.map((x) => x.u.id)); } catch (err) { result.errors.push((err as Error).message); return result; }

  let engaged: Set<string>;
  try { engaged = await loadDay1Engaged(sb, pending.map((x) => x.u.id)); } catch (err) { result.errors.push((err as Error).message); return result; }
  const open = pending.filter((x) => {
    if (claimed.has(x.u.id)) { bump(result.counts, "skip_already_claimed"); return false; }
    if (engaged.has(x.u.id)) { bump(result.counts, "skip_already_engaged"); return false; }
    return true;
  });
  const mailable = open.filter((x) => x.d === "send");
  let capHits: Set<string> | null = null;
  if (mailable.length > 0 && DAY1_CATEGORY === "marketing") {
    try { capHits = await loadMarketingCapHits(sb, mailable.map((x) => x.u.id), now); } catch (err) { result.errors.push((err as Error).message); capHits = null; }
  } else if (mailable.length > 0) capHits = new Set();

  const inHours = opts.ignoreSendHours === true || (viennaHour(nowMs) >= DAY1_SEND_HOURS.from && viennaHour(nowMs) < DAY1_SEND_HOURS.to && !inBlackout(viennaDay(nowMs)));
  const linksReady = sittingLinksConfigured();
  const maxPerRun = opts.maxPerRun ?? DAY1_MAX_PER_RUN;
  let attempted = 0;

  for (const { u, d } of open) {
    const uid8 = u.id.slice(0, 8);
    const lang: Day1Lang = day1Lang(u.language_code);
    // Held accounts: one held claim (no user_id, never counted by the cap) and one event.
    const hold = async (reason: string) => {
      result.held += 1;
      bump(result.counts, `held_${reason}`);
      if (opts.dryRun) return;
      const { error } = await sb.from("processed_webhook_events").insert({
        provider: DAY1_CLAIM_PROVIDER, event_id: day1ClaimKey(u.id),
        payload: { reason: "day1_ask_held", held: reason, uid8, claimed_at: now.toISOString() },
      });
      if (error) { if (error.code !== "23505") result.errors.push(`claim:${uid8}`); return; }
      await opts.recordEvent(u.id, "day1_ask_held", { reason, lang });
    };

    if (d === "holdout") { await hold("holdout"); continue; }
    if (d === "held_bounced") { await hold("bounced"); continue; }

    // d === "send"
    // An unreadable cap source is not a cap hit: no claim, no event, the next run retries (the window is 48 h wide).
    if (capHits === null) { bump(result.counts, "wait_cap_unreadable"); continue; }
    if (capHits.has(u.id)) { await hold("cap"); continue; }
    if (opts.dryRun) {
      let status: string;
      try { status = await checkSuppression(sb, u.email, DAY1_CATEGORY); } catch { status = "unknown"; }
      if (status === "clear" && linksReady && inHours) result.would_send += 1;
      else bump(result.counts, status === "clear" ? (linksReady ? "wait_send_hours" : "links_not_configured") : `held_suppressed_${status}`);
      continue;
    }
    if (!inHours) { bump(result.counts, "wait_send_hours"); continue; }
    if (!linksReady) { bump(result.counts, "links_not_configured"); continue; }
    if (attempted >= maxPerRun) { bump(result.counts, "wait_run_cap"); continue; }
    attempted += 1;

    const claimKey = day1ClaimKey(u.id);
    const { error: claimErr } = await sb.from("processed_webhook_events").insert({
      provider: DAY1_CLAIM_PROVIDER, event_id: claimKey,
      payload: { reason: "day1_ask", user_id: u.id, claimed_at: now.toISOString() },
    });
    if (claimErr) { if (claimErr.code !== "23505") result.errors.push(`claim:${uid8}`); continue; }
    const release = async () => {
      const { error } = await sb.from("processed_webhook_events").delete().eq("provider", DAY1_CLAIM_PROVIDER).eq("event_id", claimKey);
      if (error) result.errors.push(`release:${uid8}`);
    };

    let mail: { subject: string; htmlBody: string };
    try {
      const token = signSittingToken({ userId: u.id, emailKey: trialEmailKey(u.email), source: "day1", now });
      mail = renderDay1Ask({ lang, sittingUrl: sittingLinkUrl(token, lang) });
    } catch {
      await release();
      result.errors.push(`render:${uid8}`);
      continue;
    }
    const sendResult: GuardedSendResult = await sendUnlessSuppressed(sb, DAY1_CATEGORY, { to: u.email as string, subject: mail.subject, htmlBody: mail.htmlBody }, opts.send);
    if (sendResult.ok) {
      result.sent += 1;
      await opts.recordEvent(u.id, "day1_ask_sent", { lang, bank: u.active_exam ?? null, had_past_date: !!u.exam_date });
      continue;
    }
    if (sendResult.reason === "suppressed" || sendResult.reason === "invalid_address") {
      // The claim stays (never retried) but stops counting as a mailed learner: rewrite it as held.
      result.held += 1;
      bump(result.counts, "held_suppressed");
      const { error: rewriteErr } = await sb.from("processed_webhook_events").update({ payload: { reason: "day1_ask_held", held: "suppressed", uid8, claimed_at: now.toISOString() } })
        .eq("provider", DAY1_CLAIM_PROVIDER).eq("event_id", claimKey);
      if (rewriteErr) result.errors.push(`rewrite:${uid8}`);
      await opts.recordEvent(u.id, "day1_ask_held", { reason: "suppressed", lang });
      continue;
    }
    const status = "status" in sendResult ? sendResult.status ?? null : null;
    const certainlyUndelivered = sendResult.reason === "suppression_check_failed" || sendResult.reason === "not_configured"
      || sendResult.reason === "auth_failed" || (sendResult.reason === "send_failed" && status !== null && status >= 400 && status < 500);
    if (certainlyUndelivered) await release();
    result.errors.push(`send:${uid8}: ${sendResult.reason}`);
  }
  return result;
}
