/**
 * Access-ending reminder (the existing day-25 trial/renewal sender), a46.
 *
 * One owner for who gets the "your Pro access ends" mail and which date it
 * states, shared by the cron (/api/cron/trial-reminder), the read-only
 * audience preview (scripts/reminders/access-ending-preview.ts) and the admin
 * paid roster (effectiveAccessEnd).
 *
 * Rules (OW-16, pick-renewal-copy A, pick-suppression-shape A):
 *   - The stated date is the EFFECTIVE access end: what the paywall enforces
 *     (users.tier + users.tier_expires_at, see isPaidTier). A subscription
 *     row's own expires_at is provenance, never the date we tell a learner.
 *     Rows that end later than the paywall date mean the data disagrees; the
 *     learner is skipped (and listed in the preview) instead of told either.
 *   - Audience: learners whose effective end is inside the 14-day window and
 *     who hold (or held) a first_month_19 / first_3mo_27 row. Selecting by
 *     the users date, not by the row, keeps a learner whose end date was moved
 *     by hand (row 17 Oct, access 17 Nov) in the audience when the real end
 *     approaches, after the row itself has expired.
 *   - Admins, Pro without an end date and anyone holding a plan that charges
 *     again (or whose cadence is unknown) are skipped.
 *   - Every send goes through the shared do-not-email list as "marketing":
 *     opt-outs, hard bounces, complaints and manual blocks are withheld,
 *     including addresses that match no account (the list is keyed by the
 *     address hash), and an address that cannot be keyed is withheld too.
 *     An unreadable list fails closed.
 *   - At most one mail per learner and end date: a claim row
 *     (processed_webhook_events, provider "mail_reminder") is written before
 *     the provider call and released only when the mail certainly did not go
 *     out (list unreadable, mail env/token missing, provider 4xx), so the next
 *     daily run retries. The preview reads the same claims.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadRenewalOfferSuppression } from "@/lib/billing-cadence";
import { renderAccessEndingReminder } from "@/lib/email/access-ending-template";
import { checkSuppression, sendUnlessSuppressed, type GuardedSendResult } from "@/lib/mail-suppression";
import type { SendZohoEmailArgs, SendZohoEmailResult } from "@/lib/email/zoho";

export const ACCESS_ENDING_TIERS: readonly string[] = ["first_month_19", "first_3mo_27"];
export const ACCESS_ENDING_WINDOW_DAYS = 14;
export const ACCESS_ENDING_CLAIM_PROVIDER = "mail_reminder";
/** Rows that stood for real access; a pending or failed checkout does not count. */
const POPULATION_STATUSES: readonly string[] = ["active", "expired", "cancelled"];
const DAY_MS = 86_400_000;
/** Rows written by one grant carry the same instant; allow clock noise only. */
const SAME_END_TOLERANCE_MS = 60_000;

export interface AccessOwner {
  tier?: string | null;
  role?: string | null;
  tier_expires_at?: string | null;
}

export type AccessEnd = { kind: "permanent" } | { kind: "ends"; endMs: number } | { kind: "none" };

/**
 * The access end the paywall enforces (mirror of isPaidTier + the admin role
 * check in isPaidAccess). Corrupt dates count as no access, like the paywall.
 */
export function effectiveAccessEnd(owner: AccessOwner | null | undefined, nowMs: number = Date.now()): AccessEnd {
  if (!owner) return { kind: "none" };
  if (owner.role === "admin" || owner.tier === "admin") return { kind: "permanent" };
  if (owner.tier !== "pro") return { kind: "none" };
  if (!owner.tier_expires_at) return { kind: "permanent" };
  const endMs = Date.parse(owner.tier_expires_at);
  if (!Number.isFinite(endMs) || endMs <= nowMs) return { kind: "none" };
  return { kind: "ends", endMs };
}

/** ISO end for display (admin roster): null when permanent or no access. */
export function effectiveAccessEndIso(owner: AccessOwner | null | undefined, nowMs: number = Date.now()): string | null {
  const end = effectiveAccessEnd(owner, nowMs);
  return end.kind === "ends" ? new Date(end.endMs).toISOString() : null;
}

const viennaDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
export function viennaDayOf(ms: number): string {
  return viennaDayFmt.format(new Date(ms));
}

export function accessEndingClaimKey(userId: string, endMs: number): string {
  return `access_ending:${userId}:${viennaDayOf(endMs)}`;
}

export type AccessEndingDecision =
  | "send"
  | "skip_no_user"
  | "skip_permanent"
  | "skip_no_access"
  | "skip_out_of_window"
  | "skip_rows_disagree"
  | "skip_renewing"
  | "skip_cadence_unreadable"
  | "skip_already_reminded"
  | "skip_already_claimed"
  | "no_email";

export interface ActiveRow {
  id: string;
  tier: string | null;
  expires_at: string | null;
  trial_reminder_sent_at: string | null;
}

export interface DecideInput {
  owner: (AccessOwner & { email?: string | null }) | null;
  /** The learner's active subscription rows that have not ended yet. */
  activeRows: ActiveRow[];
  /** true: a plan that charges again (or unknown cadence) is active; null: unreadable. */
  cadenceSuppressed: boolean | null;
  nowMs: number;
  windowDays?: number;
}

export interface DecideOutput {
  decision: AccessEndingDecision;
  endMs: number | null;
}

/** Pure decision for one learner. Order matters: the first failing rule wins. */
export function decideAccessEnding(input: DecideInput): DecideOutput {
  const { owner, activeRows, cadenceSuppressed, nowMs } = input;
  const windowMs = (input.windowDays ?? ACCESS_ENDING_WINDOW_DAYS) * DAY_MS;
  if (!owner) return { decision: "skip_no_user", endMs: null };
  const end = effectiveAccessEnd(owner, nowMs);
  if (end.kind === "permanent") return { decision: "skip_permanent", endMs: null };
  if (end.kind === "none") return { decision: "skip_no_access", endMs: null };
  const endMs = end.endMs;
  if (endMs > nowMs + windowMs) return { decision: "skip_out_of_window", endMs };
  for (const r of activeRows) {
    // An open-ended or unreadable row date cannot agree with a dated end.
    const rowEnd = r.expires_at ? Date.parse(r.expires_at) : NaN;
    if (!Number.isFinite(rowEnd) || rowEnd > endMs + SAME_END_TOLERANCE_MS) return { decision: "skip_rows_disagree", endMs };
  }
  if (cadenceSuppressed === null) return { decision: "skip_cadence_unreadable", endMs };
  if (cadenceSuppressed) return { decision: "skip_renewing", endMs };
  const endDay = viennaDayOf(endMs);
  const legacyStamp = activeRows.some((r) => {
    if (!r.trial_reminder_sent_at || !r.expires_at) return false;
    return viennaDayOf(Date.parse(r.expires_at)) === endDay;
  });
  if (legacyStamp) return { decision: "skip_already_reminded", endMs };
  if (!owner.email || owner.email.trim().length === 0) return { decision: "no_email", endMs };
  return { decision: "send", endMs };
}

// ── Loading ────────────────────────────────────────────────────────────

export interface AudienceUser {
  id: string;
  email: string | null;
  first_name: string | null;
  language_code: string | null;
  tier: string | null;
  role: string | null;
  tier_expires_at: string | null;
}

export interface AudienceEntry {
  user: AudienceUser | null;
  userId: string;
  activeRows: ActiveRow[];
  /** Reminder-tier rows of the learner that are still active (stamped on send). */
  reminderRowIds: string[];
  decision: AccessEndingDecision;
  endMs: number | null;
}

class AudienceReadError extends Error {
  constructor(step: string) {
    super(`access-ending audience read failed: ${step}`);
    this.name = "AudienceReadError";
  }
}

const ID_CHUNK = 100;
function chunks<T>(list: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Candidate learners and their decision. Throws AudienceReadError when a
 * candidate read fails (the caller sends nothing then). A cadence read failure
 * for one learner only skips that learner.
 */
export async function loadAccessEndingAudience(
  sb: SupabaseClient,
  now: Date,
  windowDays: number = ACCESS_ENDING_WINDOW_DAYS,
): Promise<AudienceEntry[]> {
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + windowDays * DAY_MS).toISOString();

  // 1. Learners whose paywall date is inside the window.
  const { data: endingUsers, error: endingErr } = await sb
    .from("users")
    .select("id")
    .eq("tier", "pro")
    .gt("tier_expires_at", nowIso)
    .lte("tier_expires_at", untilIso)
    .limit(1000);
  if (endingErr) throw new AudienceReadError("users_window");

  // 2. Learners with an active reminder-tier row inside the window (kept so a
  //    learner whose rows and users date disagree shows up in the preview).
  const { data: dueRows, error: dueErr } = await sb
    .from("subscriptions")
    .select("user_id")
    .in("tier", [...ACCESS_ENDING_TIERS])
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .lte("expires_at", untilIso)
    .limit(1000);
  if (dueErr) throw new AudienceReadError("rows_window");

  const fromUsers = new Set(((endingUsers ?? []) as Array<{ id: string }>).map((u) => u.id));
  const fromRows = new Set(((dueRows ?? []) as Array<{ user_id: string | null }>).map((r) => r.user_id).filter((v): v is string => Boolean(v)));

  // Only learners who hold or held a reminder-tier plan belong to this sender.
  const inTierPopulation = new Set<string>(fromRows);
  const needCheck = [...fromUsers].filter((id) => !inTierPopulation.has(id));
  for (const ids of chunks(needCheck)) {
    const { data, error } = await sb
      .from("subscriptions")
      .select("user_id")
      .in("user_id", ids)
      .in("tier", [...ACCESS_ENDING_TIERS])
      .in("status", [...POPULATION_STATUSES]);
    if (error) throw new AudienceReadError("tier_population");
    for (const r of (data ?? []) as Array<{ user_id: string | null }>) if (r.user_id) inTierPopulation.add(r.user_id);
  }
  const candidateIds = [...new Set([...fromUsers, ...fromRows])].filter((id) => inTierPopulation.has(id)).sort();
  if (candidateIds.length === 0) return [];

  // 3. Owner rows and active rows for every candidate.
  const users = new Map<string, AudienceUser>();
  const active = new Map<string, ActiveRow[]>();
  for (const ids of chunks(candidateIds)) {
    const { data: userRows, error: userErr } = await sb
      .from("users")
      .select("id, email, first_name, language_code, tier, role, tier_expires_at")
      .in("id", ids);
    if (userErr) throw new AudienceReadError("users");
    for (const u of (userRows ?? []) as AudienceUser[]) users.set(u.id, u);
    const { data: rows, error: rowsErr } = await sb
      .from("subscriptions")
      .select("id, user_id, tier, expires_at, trial_reminder_sent_at")
      .in("user_id", ids)
      .eq("status", "active")
      .gt("expires_at", nowIso);
    if (rowsErr) throw new AudienceReadError("active_rows");
    for (const r of (rows ?? []) as Array<ActiveRow & { user_id: string }>) {
      const list = active.get(r.user_id) ?? [];
      list.push({ id: r.id, tier: r.tier, expires_at: r.expires_at, trial_reminder_sent_at: r.trial_reminder_sent_at });
      active.set(r.user_id, list);
    }
  }

  const out: AudienceEntry[] = [];
  for (const userId of candidateIds) {
    const user = users.get(userId) ?? null;
    const activeRows = active.get(userId) ?? [];
    let cadenceSuppressed: boolean | null = null;
    try {
      cadenceSuppressed = (await loadRenewalOfferSuppression(sb, userId)).suppressed;
    } catch {
      cadenceSuppressed = null;
    }
    const { decision, endMs } = decideAccessEnding({ owner: user, activeRows, cadenceSuppressed, nowMs: now.getTime(), windowDays });
    out.push({
      user,
      userId,
      activeRows,
      reminderRowIds: activeRows.filter((r) => r.tier && ACCESS_ENDING_TIERS.includes(r.tier)).map((r) => r.id),
      decision,
      endMs,
    });
  }

  // 4. A learner already claimed (mailed or withheld) for this end date is
  //    done; the preview must show that, not a second "send".
  const claimKeys = new Map<string, AudienceEntry>();
  for (const e of out) if (e.decision === "send" && e.endMs !== null) claimKeys.set(accessEndingClaimKey(e.userId, e.endMs), e);
  for (const keys of chunks([...claimKeys.keys()])) {
    const { data, error } = await sb
      .from("processed_webhook_events")
      .select("event_id")
      .eq("provider", ACCESS_ENDING_CLAIM_PROVIDER)
      .in("event_id", keys);
    if (error) throw new AudienceReadError("claims");
    for (const row of (data ?? []) as Array<{ event_id: string }>) {
      const e = claimKeys.get(row.event_id);
      if (e) e.decision = "skip_already_claimed";
    }
  }
  return out;
}

// ── Preview (read-only) ────────────────────────────────────────────────

export type PreviewSuppression = "clear" | "suppressed" | "invalid" | "unknown";

export interface PreviewRow {
  /** First 8 characters of the user id; never an address or a name. */
  user: string;
  decision: AccessEndingDecision;
  access_end_day: string | null;
  days_left: number | null;
  row_end_days: string[];
  lang: "de" | "en";
  suppression: PreviewSuppression | null;
  subject: string | null;
}

export interface AccessEndingPreview {
  generated_at: string;
  window_days: number;
  counts: Record<string, number>;
  would_send: number;
  withheld_by_list: number;
  list_unreadable: number;
  rows: PreviewRow[];
}

/** German for German or unknown accounts; every other language reads the English mail (the app's reviewed fallback). */
export function reminderLang(languageCode: string | null | undefined): "de" | "en" {
  const code = (languageCode ?? "").trim().toLowerCase();
  return code === "" || code.startsWith("de") ? "de" : "en";
}

/**
 * The exact audience a sending run would act on, with the do-not-email
 * status of every would-be recipient. Reads only: no claim, no stamp, no
 * event, no provider call.
 */
export async function previewAccessEndingAudience(
  sb: SupabaseClient,
  now: Date = new Date(),
  windowDays: number = ACCESS_ENDING_WINDOW_DAYS,
): Promise<AccessEndingPreview> {
  const audience = await loadAccessEndingAudience(sb, now, windowDays);
  const counts: Record<string, number> = {};
  let wouldSend = 0;
  let withheld = 0;
  let unreadable = 0;
  const rows: PreviewRow[] = [];
  for (const e of audience) {
    counts[e.decision] = (counts[e.decision] ?? 0) + 1;
    const lang = reminderLang(e.user?.language_code);
    let suppression: PreviewSuppression | null = null;
    let subject: string | null = null;
    if (e.decision === "send" && e.endMs !== null) {
      try {
        suppression = await checkSuppression(sb, e.user?.email, "marketing");
      } catch {
        suppression = "unknown";
      }
      if (suppression === "clear") wouldSend += 1;
      else if (suppression === "unknown") unreadable += 1;
      else withheld += 1;
      subject = renderAccessEndingReminder({
        firstName: null,
        lang,
        accessEndsAtIso: new Date(e.endMs).toISOString(),
        qsAnswered: 0,
        accuracyPct: 0,
        streakDays: 0,
        now,
      }).subject;
    }
    rows.push({
      user: e.userId.slice(0, 8),
      decision: e.decision,
      access_end_day: e.endMs !== null ? viennaDayOf(e.endMs) : null,
      days_left: e.endMs !== null ? Math.max(1, Math.ceil((e.endMs - now.getTime()) / DAY_MS)) : null,
      row_end_days: e.activeRows.map((r) => (r.expires_at ? viennaDayOf(Date.parse(r.expires_at)) : "open")).sort(),
      lang,
      suppression,
      subject,
    });
  }
  return {
    generated_at: now.toISOString(),
    window_days: windowDays,
    counts,
    would_send: wouldSend,
    withheld_by_list: withheld,
    list_unreadable: unreadable,
    rows,
  };
}

// ── Sending run ────────────────────────────────────────────────────────

export interface AccessEndingRunResult {
  sent: number;
  withheld: number;
  skipped: Record<string, number>;
  duplicates: number;
  errors: string[];
}

type EventWriter = (userId: string, eventType: string, data: Record<string, unknown>) => Promise<void>;

/**
 * The sending run behind TRIAL_REMINDER_EMAILS_ENABLED. Callers check the flag;
 * this function sends whenever it is called.
 */
export async function runAccessEndingReminders(
  sb: SupabaseClient,
  opts: {
    now?: Date;
    recordEvent: EventWriter;
    send?: (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;
  },
): Promise<AccessEndingRunResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const result: AccessEndingRunResult = { sent: 0, withheld: 0, skipped: {}, duplicates: 0, errors: [] };
  let audience: AudienceEntry[];
  try {
    audience = await loadAccessEndingAudience(sb, now);
  } catch (err) {
    result.errors.push((err as Error).message);
    return result;
  }

  for (const entry of audience) {
    if (entry.decision !== "send" || entry.endMs === null || !entry.user?.email) {
      result.skipped[entry.decision] = (result.skipped[entry.decision] ?? 0) + 1;
      if (entry.decision === "skip_cadence_unreadable") result.errors.push(`cadence:${entry.userId.slice(0, 8)}`);
      continue;
    }
    const user = entry.user;
    const endIso = new Date(entry.endMs).toISOString();
    const claimKey = accessEndingClaimKey(entry.userId, entry.endMs);

    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({
        provider: ACCESS_ENDING_CLAIM_PROVIDER,
        event_id: claimKey,
        payload: { reason: "access_ending_reminder", user_id: entry.userId, access_ends_at: endIso, claimed_at: nowIso },
      })
      .select("event_id")
      .maybeSingle();
    if (claimErr) {
      if (claimErr.code === "23505") result.duplicates += 1;
      else result.errors.push(`claim:${entry.userId.slice(0, 8)}`);
      continue;
    }
    if (!claim) {
      result.errors.push(`claim:${entry.userId.slice(0, 8)}`);
      continue;
    }
    const release = async () => {
      const { error } = await sb
        .from("processed_webhook_events")
        .delete()
        .eq("provider", ACCESS_ENDING_CLAIM_PROVIDER)
        .eq("event_id", claimKey);
      if (error) result.errors.push(`release:${entry.userId.slice(0, 8)}`);
    };

    const { data: gam } = await sb
      .from("user_gamification")
      .select("total_questions_answered, total_correct, current_streak")
      .eq("user_id", entry.userId)
      .maybeSingle();
    const answered = (gam?.total_questions_answered as number | null) ?? 0;
    const correct = (gam?.total_correct as number | null) ?? 0;
    const lang = reminderLang(user.language_code);
    const tpl = renderAccessEndingReminder({
      firstName: user.first_name,
      lang,
      accessEndsAtIso: endIso,
      qsAnswered: answered,
      accuracyPct: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      streakDays: (gam?.current_streak as number | null) ?? 0,
      now,
    });

    const sendResult: GuardedSendResult = await sendUnlessSuppressed(
      sb,
      "marketing",
      { to: user.email as string, subject: tpl.subject, htmlBody: tpl.htmlBody },
      opts.send,
    );
    const withheld = !sendResult.ok && (sendResult.reason === "suppressed" || sendResult.reason === "invalid_address");
    const base = {
      subscription_ids: entry.reminderRowIds,
      access_ends_at: endIso,
      language_code: user.language_code ?? null,
      reason: "access_ending_reminder",
    };

    if (sendResult.ok) {
      await opts.recordEvent(entry.userId, "trial_reminder_email_sent", { ...base, ok: true });
    } else if (withheld) {
      // No address in the event: the learner asked not to be mailed, or the
      // address is unusable. The claim stays, so the run does not retry.
      result.withheld += 1;
      await opts.recordEvent(
        entry.userId,
        sendResult.reason === "suppressed" ? "trial_reminder_email_suppressed" : "trial_reminder_email_invalid_address",
        { ...base, ok: false, failure_reason: sendResult.reason },
      );
    } else {
      const status = "status" in sendResult ? sendResult.status ?? null : null;
      // Nothing reached the learner for sure: the list was unreadable, the mail
      // env or token was missing, or the provider refused the request (4xx).
      // Release the claim so tomorrow's run retries. A timeout, a transport
      // error or a 5xx may still have delivered, so the claim stays
      // (at most one mail, as the b19 senders do).
      const certainlyUndelivered =
        sendResult.reason === "suppression_check_failed" ||
        sendResult.reason === "not_configured" ||
        sendResult.reason === "auth_failed" ||
        (sendResult.reason === "send_failed" && status !== null && status >= 400 && status < 500);
      if (certainlyUndelivered) await release();
      await opts.recordEvent(entry.userId, "trial_reminder_email_failed", {
        ...base,
        ok: false,
        failure_reason: sendResult.reason,
        failure_status: status,
        claim_kept: !certainlyUndelivered,
      });
      result.errors.push(`send:${entry.userId.slice(0, 8)}: ${sendResult.reason}`);
      continue;
    }

    if (sendResult.ok) result.sent += 1;
    if (entry.reminderRowIds.length > 0) {
      const { error: stampErr } = await sb
        .from("subscriptions")
        .update({ trial_reminder_sent_at: nowIso, updated_at: nowIso })
        .in("id", entry.reminderRowIds)
        .is("trial_reminder_sent_at", null);
      if (stampErr) result.errors.push(`stamp:${entry.userId.slice(0, 8)}`);
    }
  }
  return result;
}
