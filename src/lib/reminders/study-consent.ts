import { randomUUID } from "node:crypto";
import { assertDb, CONFIRMATION_COOLDOWN_MS, SITE, type ReminderDb } from "./common";
import { renderReminderConfirmation } from "@/lib/email/reminder-confirm-template";
import { isUiLanguage, renderLang } from "@/lib/language-model";
import { normalizeEmail, signReminderToken, verifyReminderToken } from "./tokens";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";

type EmailOwner = { email?: string | null; email_status?: string | null };
// The emailed study-confirm link is the destination proof. users.email_verified_at
// is never set in production today, so it cannot gate opt-in; bounced addresses
// are excluded.
export function deliverableDestination(owner: EmailOwner | null): string | null {
  return owner?.email && owner.email_status !== "bounced" ? normalizeEmail(owner.email) : null;
}
export async function requestStudyConsent(db: ReminderDb, userId: string, hour = 9) {
  const owner = await db.from("users").select("email,email_status,language_code").eq("id", userId).maybeSingle();
  assertDb(owner.error);
  const email = deliverableDestination(owner.data);
  if (!email) return false;
  // One confirmation mail per address per cooldown: a repeat inside the window
  // keeps the outstanding link and sends nothing.
  const current = await db.from("study_nudge_prefs").select("pending_email,confirmation_sent_at").eq("user_id", userId).maybeSingle();
  assertDb(current.error);
  const sentAt = current.data?.confirmation_sent_at ? Date.parse(String(current.data.confirmation_sent_at)) : NaN;
  if (current.data?.pending_email === email && Date.now() - sentAt < CONFIRMATION_COOLDOWN_MS) {
    // Inside the cooldown only the chosen hour moves; the outstanding link stays.
    assertDb((await db.from("study_nudge_prefs").update({ hour }).eq("user_id", userId)).error);
    return true;
  }
  const token = randomUUID();
  const stored = owner.data?.language_code;
  const lang = isUiLanguage(stored) ? renderLang(stored) : "en";
  const url = `${SITE}/api/nudge?confirm=${encodeURIComponent(signReminderToken("study-confirm", token))}&lang=${lang}`;
  // Re-enabling requires a fresh destination confirmation, never a session alone.
  const saved = await db.from("study_nudge_prefs").upsert({ user_id: userId, opt_in: false, channel: "email", hour, pending_email: email, confirmation_token: token, consent_email: null, consent_telegram_id: null, consent_confirmed_at: null, consent_version: null, confirmation_sent_at: new Date().toISOString() }, { onConflict: "user_id" });
  assertDb(saved.error);
  // a46: transactional (the learner's own request); a bounced or complained
  // address is withheld silently, an unreadable list fails like a send failure.
  const sent = await sendUnlessSuppressed(db, "transactional", { to: email, ...renderReminderConfirmation("study", lang, url) });
  const withheld = !sent.ok && (sent.reason === "suppressed" || sent.reason === "invalid_address");
  if (!sent.ok && !withheld) {
    assertDb((await db.from("study_nudge_prefs").update({ confirmation_sent_at: null }).eq("user_id", userId)).error);
    throw new Error("Could not send confirmation");
  }
  return true;
}
/**
 * a30 Telegram channel: the customer bot writes to the chat linked to this
 * account (users.telegram_id, with telegram_chat_id_confirmed: that chat
 * started the bot). The signed-session opt-in from Settings, which shows the
 * linked @handle before the learner picks it, is the consent; no mail link is
 * involved. Returns false when the account has no started chat. The link
 * itself is only as strong as the bot's /start auth_<uuid> binding (see the
 * a30 release note).
 */
export async function grantTelegramConsent(db: ReminderDb, userId: string, hour: number, now = new Date()) {
  const owner = await db.from("users").select("telegram_id,telegram_chat_id_confirmed,is_banned").eq("id", userId).maybeSingle();
  assertDb(owner.error);
  const chat = Number(owner.data?.telegram_id);
  if (!owner.data?.telegram_chat_id_confirmed || owner.data.is_banned || !Number.isSafeInteger(chat) || chat <= 0) return false;
  const saved = await db.from("study_nudge_prefs").upsert({ user_id: userId, opt_in: true, channel: "telegram", hour, consent_telegram_id: chat, consent_confirmed_at: now.toISOString(), consent_version: 1, consent_email: null, pending_email: null, confirmation_token: randomUUID() }, { onConflict: "user_id" });
  assertDb(saved.error);
  return true;
}
export async function confirmStudyConsent(db: ReminderDb, signed: string, now = new Date()) {
  const token = verifyReminderToken(signed, "study-confirm", now);
  if (!token) return false;
  const pref = await db.from("study_nudge_prefs").select("id,user_id,pending_email").eq("confirmation_token", token).eq("channel", "email").maybeSingle();
  assertDb(pref.error);
  if (!pref.data?.pending_email) return false;
  const owner = await db.from("users").select("email,email_status").eq("id", pref.data.user_id).maybeSingle();
  assertDb(owner.error);
  if (deliverableDestination(owner.data) !== pref.data.pending_email) return false;
  const saved = await db.from("study_nudge_prefs").update({ opt_in: true, consent_email: pref.data.pending_email, consent_confirmed_at: now.toISOString(), consent_version: 1, pending_email: null, confirmation_token: randomUUID() }).eq("id", pref.data.id).eq("confirmation_token", token).eq("pending_email", pref.data.pending_email).select("id").maybeSingle();
  assertDb(saved.error);
  return !!saved.data;
}
