import { asPuypExamType, viennaToday } from "@/lib/exam-dates";
import { audienceOf, canUse } from "@/lib/entitlements";
import { isUiLanguage, renderLang } from "@/lib/language-model";
import { buildDueSummary } from "@/lib/master-learning/due-summary";
import { loadDueRows } from "@/lib/master-learning/due-rows-server";
import { renderStudyNudge, renderStudyNudgeTelegram, studyNudgeHref, type NudgeLang } from "@/lib/email/study-nudge-template";
import { sendCustomerBotMessage } from "@/lib/telegram";
import { assertDb, deliverBatch, enabled, loadSubscriptions, SITE, unsubscribeUrl, type Delivery, type ReminderDb } from "./common";
import { deliverableDestination } from "./study-consent";
import { normalizeEmail } from "./tokens";
import { isStudyNudgeHour, viennaHour } from "./schedule";

const OWNER_COLUMNS = "email,email_status,language_code,active_exam,is_banned,role,tier,tier_expires_at,telegram_id,telegram_chat_id_confirmed";
type Owner = {
  email?: string | null; email_status?: string | null; language_code?: string | null; active_exam?: string | null;
  is_banned?: boolean | null; role?: string | null; tier?: string | null; tier_expires_at?: string | null;
  telegram_id?: number | string | null; telegram_chat_id_confirmed?: string | null;
};
type Pref = Record<string, unknown>;

/** The account's own private chat with the customer bot, only after the learner started the bot. */
export function telegramDestination(owner: Owner | null): number | null {
  const id = Number(owner?.telegram_id);
  return owner?.telegram_chat_id_confirmed && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Does the stored consent still match the account's current destination on this channel? */
export function consentMatches(pref: Pref, owner: Owner | null): boolean {
  if (!owner || owner.is_banned || !pref.consent_confirmed_at || pref.consent_version !== 1) return false;
  if (pref.channel === "telegram") return pref.consent_telegram_id != null && Number(pref.consent_telegram_id) === telegramDestination(owner);
  return typeof pref.consent_email === "string" && deliverableDestination(owner) === pref.consent_email;
}

/** Vienna day before `day` (YYYY-MM-DD). */
function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const EMPTY_STUDY_COUNTS = { eligible: 0, pending: 0, sent: 0, failed: 0, skipped: 0 } as const;

/**
 * LX-11 study nudge, hourly (a30). For the prefs whose chosen Vienna hour is
 * now: one message per learner and Vienna day, only when they have not
 * practised today and either reviews are due (Pro cells, the same N as Home's
 * "Heute fällig") or their streak is open today (studied yesterday). Email
 * goes through the do-not-email list; Telegram only with
 * STUDY_NUDGE_TELEGRAM_ENABLED, through the customer bot.
 */
export async function runStudyNudges(db: ReminderDb, now: Date, dryRun: boolean, opts: { telegram?: boolean } = {}) {
  const hour = viennaHour(now);
  if (!isStudyNudgeHour(hour)) return { ...EMPTY_STUDY_COUNTS };
  const telegramOn = opts.telegram ?? enabled("STUDY_NUDGE_TELEGRAM_ENABLED");
  const rows = await loadSubscriptions(db, "study_nudge_prefs", "id,user_id,channel,hour,unsub_token,last_sent,consent_email,consent_telegram_id,consent_confirmed_at,consent_version", "study", hour);
  const day = viennaToday(now);
  const yesterday = previousDay(day);
  const deliveries: Delivery[] = [];
  for (const row of rows) {
    const channel = row.channel === "telegram" ? "telegram" : row.channel === "email" ? "email" : null;
    if (!channel || typeof row.unsub_token !== "string") continue;
    if (channel === "telegram" && !telegramOn) continue;
    if (row.last_sent && viennaToday(new Date(String(row.last_sent))) >= day) continue;
    const { data: user, error } = await db.from("users").select(OWNER_COLUMNS).eq("id", row.user_id).maybeSingle();
    assertDb(error);
    const owner = user as Owner | null;
    if (!consentMatches(row, owner)) continue;

    const gam = await db.from("user_gamification").select("current_streak,last_study_date").eq("user_id", row.user_id).maybeSingle();
    assertDb(gam.error);
    const lastStudy = typeof gam.data?.last_study_date === "string" ? gam.data.last_study_date.slice(0, 10) : null;
    // Practised today already: no nudge (the mail promises this).
    if (lastStudy === day) continue;
    const streak = lastStudy === yesterday ? Math.max(0, Number(gam.data?.current_streak) || 0) : 0;

    const bank = asPuypExamType(owner?.active_exam);
    let due = 0;
    if (bank && canUse("spaced_repetition", audienceOf({ signedIn: true, role: owner?.role, tier: owner?.tier, tierExpiresAt: owner?.tier_expires_at }))) {
      const summary = buildDueSummary(await loadDueRows(db, String(row.user_id), bank, now), { now, entitled: true });
      due = summary.entitled ? summary.dueToday : 0;
    }
    if (due === 0 && streak === 0) continue;

    const stored = owner?.language_code;
    const lang: NudgeLang = isUiLanguage(stored) ? renderLang(stored) : "en";
    const content = { due, streak, lang, href: studyNudgeHref(due, bank), unsub: dryRun ? SITE : unsubscribeUrl("study", row.unsub_token, lang) };
    const kind = due > 0 && streak > 0 ? "due_streak" : due > 0 ? "due" : "streak";
    const pinned = { channel, consent_email: row.consent_email ?? null, consent_telegram_id: row.consent_telegram_id ?? null, consent_confirmed_at: row.consent_confirmed_at };

    const delivery: Delivery = {
      keys: { pref_id: String(row.id), nudge_day: day, channel },
      extra: { kind },
      isSubscribed: async () => {
        let query = db.from("study_nudge_prefs").select("id,channel,consent_email,consent_telegram_id,consent_confirmed_at,consent_version")
          .eq("id", row.id).eq("user_id", row.user_id).eq("unsub_token", row.unsub_token).eq("opt_in", true).eq("channel", channel)
          .eq("consent_confirmed_at", pinned.consent_confirmed_at).eq("consent_version", 1);
        query = channel === "email" ? query.eq("consent_email", pinned.consent_email) : query.eq("consent_telegram_id", pinned.consent_telegram_id);
        const pref = await query.maybeSingle();
        assertDb(pref.error);
        if (!pref.data) return false;
        const fresh = await db.from("users").select(OWNER_COLUMNS).eq("id", row.user_id).maybeSingle();
        assertDb(fresh.error);
        return consentMatches(pref.data, fresh.data as Owner | null);
      },
      onSent: async () => {
        const { error: stampError } = await db.from("study_nudge_prefs").update({ last_sent: now.toISOString() }).eq("id", row.id);
        assertDb(stampError);
      },
    };
    if (channel === "email") {
      delivery.mail = { to: normalizeEmail(String(row.consent_email)), ...renderStudyNudge(content) };
    } else {
      const chatId = Number(row.consent_telegram_id);
      const message = renderStudyNudgeTelegram(content);
      delivery.send = async () => {
        const result = await sendCustomerBotMessage(chatId, message.text, message.buttons);
        if (!result.ok && result.reason === "blocked") {
          // The learner blocked the bot: that withdraws the Telegram consent.
          assertDb((await db.from("study_nudge_prefs").update({ opt_in: false }).eq("id", row.id).eq("channel", "telegram")).error);
        }
        return result.ok;
      };
    }
    deliveries.push(delivery);
  }
  return deliverBatch(db, "study_nudge_sends", deliveries, dryRun, now);
}
