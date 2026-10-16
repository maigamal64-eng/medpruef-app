/**
 * Server side of the email confirmation step (a-email-confirm-trial).
 *
 * Why: from the reverse-trial switch-on the 3-day trial starts only for a
 * verified identity (reverse-trial-server.ts), but users.email_verified_at
 * was written only by the Telegram link-email flow, so an email registrant
 * never got a trial. This module mails one signed link at register (and on a
 * rate-limited resend from Home), and the confirmation POST writes
 * email_verified_at and starts the reverse trial in the same request.
 *
 * Never a login gate: nothing here blocks sign-in or the free sample.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import type { SendZohoEmailArgs, SendZohoEmailResult } from "@/lib/email/zoho";
import { sendZohoEmail } from "@/lib/email/zoho";
import { escapeHtml as e } from "@/lib/reminders/common";
import { COMPANY } from "@/lib/content-truth";
import { recordEventSafe } from "@/lib/user-events";
import { captureServerError } from "@/lib/sentry-capture";
import { forgetGuardUser } from "@/lib/auth-guard";
import { ensureReverseTrial, forgetReverseTrialNo } from "@/lib/pricing-v2/reverse-trial-server";
import { reverseTrialEnabled, reverseTrialSince } from "@/lib/pricing-v2/flag";
import { mayStartReverseTrial } from "@/lib/pricing-v2/reverse-trial";
import { EMAIL_CONFIRM_COPY, type ConfirmLang } from "./copy";
import { EMAIL_CONFIRM_WINDOW_DAYS, emailConfirmEnabled } from "./flag";
import { confirmEmailKey, confirmLinkUrl, signConfirmToken, verifyConfirmToken } from "./token";

const DAY_MS = 86_400_000;
/** Durable resend limits across instances (read from user_events). */
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_SENDS_PER_DAY = 5;

type Send = (mail: SendZohoEmailArgs) => Promise<SendZohoEmailResult>;

/** Mail language: the explicit UI choice (mp_lang cookie), else the browser locale; German only for de. */
export function requestMailLang(headers: Headers): ConfirmLang {
  const cookie = headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)mp_lang=([a-z]{2})/i.exec(cookie);
  if (m) return m[1].toLowerCase() === "de" ? "de" : "en";
  const accept = (headers.get("accept-language") ?? "").trim().toLowerCase();
  return accept.startsWith("de") ? "de" : "en";
}

/** True when the reverse trial is on and this account could start it now (copy only, never a promise). */
export function trialCanStart(u: { created_at: string | null; role: string | null; tier: string | null; tier_expires_at: string | null }, now: Date): boolean {
  if (!reverseTrialEnabled()) return false;
  const since = reverseTrialSince();
  if (!since) return false;
  return mayStartReverseTrial({ createdAt: u.created_at, role: u.role, tier: u.tier, tierExpiresAt: u.tier_expires_at }, since, now);
}

/**
 * Review P2: the greeting never carries the typed first name. Register accepts
 * any name, so a name like "Konto gesperrt, siehe evil.tld" would otherwise
 * reach any inbox inside a mail from our own domain.
 */
export function renderConfirmMail(args: { lang: ConfirmLang; url: string; trial: boolean }): { subject: string; htmlBody: string } {
  const t = EMAIL_CONFIRM_COPY[args.lang].mail;
  const greeting = e(t.greeting);
  const trial = args.trial ? `<p>${e(t.trial)}</p>` : "";
  const htmlBody = `<!DOCTYPE html><html lang="${args.lang}"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">`
    + `<p>${greeting}</p><p>${e(t.body)}</p>${trial}`
    + `<p><a href="${e(args.url)}" style="display:inline-block;background:#007B5F;color:white;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;">${e(t.button)}</a></p>`
    + `<p style="color:#4a5568;font-size:13px;">${e(t.expiry)}</p>`
    + `<p style="margin-top:28px;">${e(t.signoff)}<br>[name]<br><small style="color:#4a5568;">${e(COMPANY.one_line[args.lang])}</small></p>`
    + `</body></html>`;
  return { subject: t.subject, htmlBody };
}

export type SendOutcome = "sent" | "suppressed" | "failed" | "off";

const FAILURE_REPORT_MS = 60 * 60_000;
const lastFailureReport = new Map<string, number>();
/** One Sentry event per failure reason per instance and hour. */
function reportSendFailure(reason: string, userId: string): void {
  const now = Date.now();
  if ((lastFailureReport.get(reason) ?? 0) > now - FAILURE_REPORT_MS) return;
  lastFailureReport.set(reason, now);
  captureServerError(new Error(`email confirm send failed: ${reason}`), { route: "email-confirm", phase: `send_${reason}`, userId });
}
/** Test seam. */
export function resetEmailConfirmFailureReports(): void { lastFailureReport.clear(); }

/**
 * Sign and mail one confirmation link through the do-not-email list
 * (transactional). Writes email_confirm_sent only when the provider accepted
 * the mail. Never throws.
 */
export async function sendConfirmMail(
  sb: SupabaseClient,
  args: { userId: string; email: string; lang: ConfirmLang; source: "register" | "resend"; trial: boolean; now?: Date; send?: Send },
): Promise<SendOutcome> {
  if (!emailConfirmEnabled()) return "off";
  // Review P3: register does not validate the address format; an unkeyable one is skipped quietly.
  if (!confirmEmailKey(args.email)) return "suppressed";
  try {
    const token = signConfirmToken({ userId: args.userId, email: args.email, now: args.now });
    const mail = renderConfirmMail({ lang: args.lang, url: confirmLinkUrl(token, args.lang), trial: args.trial });
    const result = await sendUnlessSuppressed(sb, "transactional", { to: args.email, subject: mail.subject, htmlBody: mail.htmlBody }, args.send ?? sendZohoEmail);
    if (result.ok) {
      await recordEventSafe(sb, { userId: args.userId, eventType: "email_confirm_sent", data: { source: args.source, lang: args.lang } });
      return "sent";
    }
    if (result.reason === "suppressed" || result.reason === "invalid_address") return "suppressed";
    // A failed list read (for example the do-not-email table not applied) or
    // provider failure would otherwise stop every confirmation mail silently.
    reportSendFailure(result.reason, args.userId);
    return "failed";
  } catch (err) {
    captureServerError(err, { route: "email-confirm", phase: "send", userId: args.userId });
    return "failed";
  }
}

type UserRow = {
  id: string;
  email: string | null;
  email_verified_at: string | null;
  telegram_id: number | string | null;
  created_at: string | null;
  role: string | null;
  tier: string | null;
  tier_expires_at: string | null;
  is_banned: boolean | null;
};
const USER_COLUMNS = "id, email, email_verified_at, telegram_id, created_at, role, tier, tier_expires_at, is_banned";

export type ConfirmOutcome =
  | { outcome: "confirmed" | "already"; trialActive: boolean }
  | { outcome: "invalid" | "expired" | "retry" };

/**
 * The confirmation POST. Writes email_verified_at once (compare-and-set on
 * the address the link was mailed to and on a still empty column), then lets
 * the reverse trial start in the same request. A replayed link is an
 * idempotent "already". Never throws.
 */
export async function confirmEmail(sb: SupabaseClient, token: unknown, args: { headers: Headers; now?: Date }): Promise<ConfirmOutcome> {
  const now = args.now ?? new Date();
  const parsed = verifyConfirmToken(token, now);
  if (!parsed.ok) return { outcome: parsed.error === "expired" ? "expired" : "invalid" };
  try {
    const { data, error } = await sb.from("users").select(USER_COLUMNS).eq("id", parsed.userId).maybeSingle();
    if (error) return { outcome: "retry" };
    const user = data as UserRow | null;
    // The address changed after the mail went out: the old link proves nothing.
    if (!user || !user.email || confirmEmailKey(user.email) !== parsed.emailKey) return { outcome: "invalid" };
    let outcome: "confirmed" | "already" = "already";
    if (!user.email_verified_at) {
      const { data: updated, error: updateError } = await sb.from("users")
        .update({ email_verified_at: now.toISOString() })
        .eq("id", user.id)
        .eq("email", user.email)
        .is("email_verified_at", null)
        .select("id")
        .maybeSingle();
      if (updateError) return { outcome: "retry" };
      if (updated) {
        outcome = "confirmed";
        await recordEventSafe(sb, { userId: user.id, eventType: "email_confirmed", data: { source: "link" } });
      }
    }
    // Review P3: a replayed link ("already") does no trial work; /api/auth/me
    // handles an account that was confirmed earlier.
    if (outcome === "already") return { outcome, trialActive: false };
    forgetGuardUser(user.id);
    forgetReverseTrialNo(user.id);
    const trial = await ensureReverseTrial(sb, {
      userId: user.id,
      candidate: { createdAt: user.created_at, role: user.role, tier: user.tier, tierExpiresAt: user.tier_expires_at },
      headers: args.headers,
      now,
    });
    return { outcome, trialActive: trial.active };
  } catch (err) {
    captureServerError(err, { route: "/confirm-email", phase: "confirm", userId: parsed.userId });
    return { outcome: "retry" };
  }
}

export type PendingStatus =
  | { pending: false }
  | { pending: true; email: string; trial: boolean; sent: boolean; user: UserRow; lastSentAt: number | null; sentToday: number };

/** One users read plus one user_events read; pending only for an unconfirmed email account in the age window. */
export async function readPendingStatus(sb: SupabaseClient, userId: string, now: Date = new Date()): Promise<PendingStatus | null> {
  const { data, error } = await sb.from("users").select(USER_COLUMNS).eq("id", userId).maybeSingle();
  if (error) return null;
  const user = data as UserRow | null;
  if (!user || !user.email || user.email_verified_at) return { pending: false };
  if (user.is_banned === true || user.role === "admin" || user.tier === "admin") return { pending: false };
  if (user.telegram_id !== null && user.telegram_id !== undefined) return { pending: false };
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(created) || created < now.getTime() - EMAIL_CONFIRM_WINDOW_DAYS * DAY_MS) return { pending: false };
  const { data: sends, error: sendsError } = await sb.from("user_events")
    .select("created_at")
    .eq("user_id", userId)
    .eq("event_type", "email_confirm_sent")
    .gte("created_at", new Date(now.getTime() - EMAIL_CONFIRM_WINDOW_DAYS * DAY_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (sendsError) return null;
  const times = ((sends ?? []) as Array<{ created_at: string }>).map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  return {
    pending: true,
    email: user.email,
    trial: trialCanStart(user, now),
    sent: times.length > 0,
    user,
    lastSentAt: times.length > 0 ? Math.max(...times) : null,
    sentToday: times.filter((t) => t > now.getTime() - DAY_MS).length,
  };
}

/** Durable limit: one mail a minute, five a day per account (on top of the route's per-instance limit). */
export function resendAllowed(status: { lastSentAt: number | null; sentToday: number }, now: Date): boolean {
  if (status.sentToday >= MAX_SENDS_PER_DAY) return false;
  return status.lastSentAt === null || status.lastSentAt <= now.getTime() - RESEND_COOLDOWN_MS;
}
