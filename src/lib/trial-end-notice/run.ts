/**
 * The sweep behind TRIAL_END_NOTICE_ENABLED (a-reverse-trial-end-mail): one
 * notice per account ever, about 24 hours before a reverse trial ends.
 *
 * Idempotency lives in an existing ledger: one processed_webhook_events row
 * (provider trial_end_notice, event_id = user id) is claimed BEFORE any send
 * and decides the account for good, sent, held or holdout alike. The claim is
 * released only when the message certainly did not leave (list unreadable,
 * mail env or token missing, provider 4xx). Every read that decides a skip
 * fails the whole run closed: an unreadable cap, payment or claim table never
 * becomes a send. A dry run (the default) decides and counts only: no claim,
 * no event, no send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowPaidCents, type LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { resumeExcludedIds } from "@/lib/checkout-resume";
import { sendZohoEmail, type SendZohoEmailArgs, type SendZohoEmailResult } from "@/lib/email/zoho";
import { isSittingWeek, resolveNamedSitting } from "@/lib/journey/moments";
import { isMailSuppressed, sendUnlessSuppressed, type GuardedSendResult } from "@/lib/mail-suppression";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { reminderLang } from "@/lib/reminders/access-ending";
import { datesFrozen, sittingLinkEnabled } from "@/lib/sitting-link/flag";
import { sittingLinksConfigured, signSittingToken } from "@/lib/sitting-link/token";
import { sendCustomerBotMessage, type CustomerBotSendResult } from "@/lib/telegram";
import { noticeAppUrl, renderNoticeMail, renderNoticeTelegram } from "./copy";
import { trialEndNoticeDryRun, trialEndNoticeTelegramEnabled } from "./flag";
import {
  decideNotice, LEARNER_MAIL_EVENT_TYPES, MAIL_CAP_HOURS, NOTICE_CLAIM_PROVIDER, NOTICE_HELD, NOTICE_MAX_HOURS,
  NOTICE_MIN_HOURS, NOTICE_SENT, type HoldReason, type NoticeChannel,
} from "./rules";

const HOUR_MS = 3_600_000;
const CHUNK = 100;
const TRIAL_LIMIT = 500;
const SUB_COLUMNS = "user_id, tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, crypto_tx_hash, granted_payment_ids, expires_at";
const USER_COLUMNS = "id, email, email_verified_at, first_name, language_code, role, tier, tier_expires_at, is_banned, exam_date, active_exam, telegram_id, telegram_chat_id_confirmed";

export interface NoticeRunResult {
  dryRun: boolean;
  candidates: number;
  wouldSend: { email: number; telegram: number };
  sent: { email: number; telegram: number };
  held: Partial<Record<HoldReason, number>>;
  skipped: Record<string, number>;
  duplicates: number;
  errors: string[];
}

type EventWriter = (userId: string, eventType: string, data: Record<string, unknown>) => Promise<void>;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function runTrialEndNotices(
  sb: SupabaseClient,
  opts: {
    now?: Date;
    recordEvent: EventWriter;
    dryRun?: boolean;
    telegramEnabled?: boolean;
    send?: (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;
    sendBot?: (chatId: number, text: string, buttons: { text: string; url: string }[]) => Promise<CustomerBotSendResult>;
  },
): Promise<NoticeRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? trialEndNoticeDryRun();
  const telegramEnabled = opts.telegramEnabled ?? trialEndNoticeTelegramEnabled();
  const res: NoticeRunResult = { dryRun, candidates: 0, wouldSend: { email: 0, telegram: 0 }, sent: { email: 0, telegram: 0 }, held: {}, skipped: {}, duplicates: 0, errors: [] };
  const bump = (m: Record<string, number | undefined>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

  // 1. Trials ending in the window. A failed read ends the run.
  const lo = new Date(now.getTime() + NOTICE_MIN_HOURS * HOUR_MS).toISOString();
  const hi = new Date(now.getTime() + NOTICE_MAX_HOURS * HOUR_MS).toISOString();
  const { data: trialRows, error: trialErr } = await sb.from("trials")
    .select("user_id, started_at, expires_at").eq("kind", "reverse").gt("expires_at", lo).lte("expires_at", hi).order("expires_at").limit(TRIAL_LIMIT);
  if (trialErr) { res.errors.push("trials_read"); return res; }
  if ((trialRows ?? []).length >= TRIAL_LIMIT) res.errors.push("trials_limit_reached");
  const trials = new Map<string, { startedAt: string; endsAt: string }>();
  for (const t of (trialRows ?? []) as Array<{ user_id: string; started_at: string; expires_at: string }>) {
    if (t.user_id && t.started_at && t.expires_at) trials.set(t.user_id, { startedAt: t.started_at, endsAt: t.expires_at });
  }
  const ids = [...trials.keys()];
  res.candidates = ids.length;
  if (!ids.length) return res;

  // 2. Everything the decision needs, in bulk. Any failed read ends the run.
  type UserRow = Record<string, unknown> & { id: string };
  const users = new Map<string, UserRow>();
  const everPaid = new Set<string>();
  const checkoutAt = new Map<string, number[]>();
  const inCap = new Set<string>();
  const claimed = new Set<string>();
  const capSince = new Date(now.getTime() - MAIL_CAP_HOURS * HOUR_MS).toISOString();
  for (const part of chunks(ids)) {
    const [u, s, p, c, k, n] = await Promise.all([
      sb.from("users").select(USER_COLUMNS).in("id", part),
      sb.from("subscriptions").select(SUB_COLUMNS).in("user_id", part),
      sb.from("payment_events").select("user_id, created_at").eq("event", "checkout_session_created").in("user_id", part),
      sb.from("user_events").select("user_id").in("user_id", part).in("event_type", [...LEARNER_MAIL_EVENT_TYPES]).gte("created_at", capSince),
      sb.from("processed_webhook_events").select("event_id").eq("provider", NOTICE_CLAIM_PROVIDER).in("event_id", part),
      // The study reminder logs its sends per preference row, not in user_events.
      sb.from("study_nudge_prefs").select("user_id").in("user_id", part).gte("last_sent", capSince),
    ]);
    if (u.error || s.error || p.error || c.error || k.error || n.error) {
      res.errors.push(`read:${[u.error && "users", s.error && "subscriptions", p.error && "payment_events", c.error && "user_events", k.error && "claims", n.error && "study_nudge_prefs"].filter(Boolean).join("+")}`);
      return res;
    }
    for (const r of (u.data ?? []) as UserRow[]) users.set(r.id, r);
    for (const r of (s.data ?? []) as Array<LearnerSubscriptionRow & { user_id: string }>) if (rowPaidCents(r) > 0) everPaid.add(r.user_id);
    for (const r of (p.data ?? []) as Array<{ user_id: string; created_at: string }>) {
      const list = checkoutAt.get(r.user_id) ?? [];
      list.push(Date.parse(r.created_at));
      checkoutAt.set(r.user_id, list);
    }
    for (const r of (c.data ?? []) as Array<{ user_id: string }>) inCap.add(r.user_id);
    for (const r of (k.data ?? []) as Array<{ event_id: string }>) claimed.add(r.event_id);
    for (const r of (n.data ?? []) as Array<{ user_id: string }>) inCap.add(r.user_id);
  }

  const excluded = resumeExcludedIds();
  const sittingLinks = sittingLinkEnabled() && !datesFrozen() && sittingLinksConfigured();
  const sendMail = opts.send ?? sendZohoEmail;
  const sendBot = opts.sendBot ?? sendCustomerBotMessage;

  for (const id of ids) {
    const user = users.get(id);
    const trial = trials.get(id)!;
    if (!user) { bump(res.skipped, "no_user"); continue; }
    const startedMs = Date.parse(trial.startedAt);
    let decision = decideNotice({
      account: {
        id,
        role: (user.role as string | null) ?? null,
        tier: (user.tier as string | null) ?? null,
        tierExpiresAt: (user.tier_expires_at as string | null) ?? null,
        email: (user.email as string | null) ?? null,
        emailVerifiedAt: (user.email_verified_at as string | null) ?? null,
        isBanned: user.is_banned === true,
        telegramChatConfirmed: !!user.telegram_chat_id_confirmed,
      },
      trial,
      everPaid: everPaid.has(id),
      checkoutSinceStart: (checkoutAt.get(id) ?? []).some((t) => !Number.isFinite(startedMs) || t >= startedMs),
      mailInCap: inCap.has(id),
      sittingWeek: isSittingWeek(resolveNamedSitting({ examDate: (user.exam_date as string | null) ?? null, activeExam: (user.active_exam as string | null) ?? null }, now), now),
      decidedBefore: claimed.has(id),
      telegramEnabled,
      excluded,
      now,
    });
    if (decision.act === "skip") { bump(res.skipped, decision.reason); continue; }
    // The Telegram path honours the do-not-contact list too: a learner who replied "Stopp" by mail
    // asked for no marketing contact (reviewer P2-1). An unreadable list counts as suppressed.
    const accountEmail = (user.email as string | null) ?? null;
    if (decision.act === "send" && decision.channel === "telegram" && accountEmail && await isMailSuppressed(sb, accountEmail, "marketing")) {
      decision = { act: "hold", reason: "do_not_contact" };
    }
    if (decision.act === "send") res.wouldSend[decision.channel] += 1;
    else bump(res.held, decision.reason);
    if (dryRun) continue;

    // Holds that can clear (mail cap, sitting week, no channel yet) never use up the one notice:
    // they are recorded and the account is looked at again while its trial is still in the window.
    if (decision.act === "hold" && decision.reason !== "holdout" && decision.reason !== "do_not_contact") {
      await opts.recordEvent(id, NOTICE_HELD, { trial_ends_at: trial.endsAt, reason: decision.reason, claimed: false });
      continue;
    }

    // 3. Claim first: the account is decided for good from here on.
    const claimBase = { reason: "trial_end_notice", user_id: id, outcome: decision.act === "send" ? decision.channel : decision.reason, claimed_at: now.toISOString() };
    const { data: claim, error: claimErr } = await sb.from("processed_webhook_events")
      .insert({ provider: NOTICE_CLAIM_PROVIDER, event_id: id, payload: claimBase }).select("event_id").maybeSingle();
    if (claimErr) {
      if (claimErr.code === "23505") res.duplicates += 1; else res.errors.push(`claim:${id.slice(0, 8)}`);
      continue;
    }
    if (!claim) { res.errors.push(`claim:${id.slice(0, 8)}`); continue; }
    const release = async () => {
      const { error } = await sb.from("processed_webhook_events").delete().eq("provider", NOTICE_CLAIM_PROVIDER).eq("event_id", id);
      if (error) res.errors.push(`release:${id.slice(0, 8)}`);
    };
    const base = { trial_ends_at: trial.endsAt };

    if (decision.act === "hold") {
      await opts.recordEvent(id, NOTICE_HELD, { ...base, reason: decision.reason });
      continue;
    }

    const lang = reminderLang(user.language_code as string | null);
    const channel: NoticeChannel = decision.channel;
    const named = resolveNamedSitting({ examDate: (user.exam_date as string | null) ?? null, activeExam: (user.active_exam as string | null) ?? null }, now);
    let sittingUrl: string | null = null;
    if (!named && sittingLinks) {
      try {
        const email = (user.email as string | null) ?? null;
        const token = signSittingToken({ userId: id, emailKey: email ? trialEmailKey(email) : null, now });
        sittingUrl = `https://medpruf.com/api/sitting-link?t=${encodeURIComponent(token)}&lang=${lang}`;
      } catch { sittingUrl = null; }
    }
    let answered: number | null = null;
    const { data: gam, error: gamErr } = await sb.from("user_gamification").select("total_questions_answered").eq("user_id", id).maybeSingle();
    if (!gamErr) answered = (gam?.total_questions_answered as number | null) ?? 0;
    const args = { lang, firstName: (user.first_name as string | null) ?? null, answered, appUrl: noticeAppUrl(channel), sittingUrl };
    const meta = { ...base, channel, language: lang, sitting_link: !!sittingUrl, holdout: false };

    if (channel === "email") {
      const tpl = renderNoticeMail(args);
      const r: GuardedSendResult = await sendUnlessSuppressed(sb, "marketing", { to: user.email as string, subject: tpl.subject, htmlBody: tpl.htmlBody }, sendMail);
      if (r.ok) { res.sent.email += 1; await opts.recordEvent(id, NOTICE_SENT, meta); continue; }
      if (r.reason === "suppressed" || r.reason === "invalid_address") {
        bump(res.held, "do_not_contact");
        await opts.recordEvent(id, NOTICE_HELD, { ...base, reason: "do_not_contact" });
        continue;
      }
      const status = "status" in r ? r.status ?? null : null;
      const undelivered = r.reason === "suppression_check_failed" || r.reason === "not_configured" || r.reason === "auth_failed"
        || (r.reason === "send_failed" && status !== null && status >= 400 && status < 500);
      if (undelivered) await release();
      res.errors.push(`send:${id.slice(0, 8)}:${r.reason}`);
      continue;
    }

    const chat = Number(user.telegram_id);
    if (!Number.isSafeInteger(chat) || chat <= 0) { bump(res.held, "no_channel"); await opts.recordEvent(id, NOTICE_HELD, { ...base, reason: "no_channel" }); continue; }
    const msg = renderNoticeTelegram(args);
    const r = await sendBot(chat, msg.text, msg.buttons);
    if (r.ok) { res.sent.telegram += 1; await opts.recordEvent(id, NOTICE_SENT, meta); continue; }
    if (r.reason === "blocked") { bump(res.held, "telegram_blocked"); await opts.recordEvent(id, NOTICE_HELD, { ...base, reason: "telegram_blocked" }); continue; }
    if (r.reason === "not_configured" || r.reason === "rejected") await release();
    res.errors.push(`telegram:${id.slice(0, 8)}:${r.reason}`);
  }
  return res;
}
