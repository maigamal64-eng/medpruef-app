import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { assertDb, enabled, noStore } from "@/lib/reminders/common";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { confirmFormPage, linkLang, readConfirmForm, resultPage } from "@/lib/reminders/link-page";
import { isStudyNudgeHour, STUDY_NUDGE_HOURS } from "@/lib/reminders/schedule";
import { consentMatches, telegramDestination } from "@/lib/reminders/study";
import { unsubscribeCredential, verifyReminderToken } from "@/lib/reminders/tokens";
import { confirmStudyConsent, grantTelegramConsent, requestStudyConsent, deliverableDestination } from "@/lib/reminders/study-consent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });
const telegramOn = () => enabled("STUDY_NUDGE_TELEGRAM_ENABLED");

export async function GET(req: NextRequest) {
  const lang = linkLang(req.nextUrl.searchParams.get("lang"));
  const confirmation = req.nextUrl.searchParams.get("confirm");
  if (confirmation !== null) {
    // a30 (b19 S4): a GET only shows the button; the form POST confirms.
    try {
      return verifyReminderToken(confirmation, "study-confirm") ? confirmFormPage(lang, "study", "/api/nudge", confirmation) : resultPage(lang, "study", "invalid");
    } catch { return resultPage(lang, "study", "retry"); }
  }
  const token = req.nextUrl.searchParams.get("unsub");
  if (token !== null) {
    try {
      const credential = unsubscribeCredential(token, "study");
      if (!credential) return resultPage(lang, "study", "invalid");
      // Opt-out always works, including while the sending flag is OFF.
      const { error } = await getServiceClient().from("study_nudge_prefs").update({ opt_in: false, pending_email: null, confirmation_token: randomUUID() }).eq("unsub_token", credential);
      assertDb(error);
      return resultPage(lang, "study", "unsubscribed");
    } catch { return resultPage(lang, "study", "retry"); }
  }
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  // UX-GLOBAL-40: while the sender is off the Settings row does not render.
  if (!enabled("STUDY_NUDGE_ENABLED")) return json({ enabled: false, opt_in: null, channel: "email" });
  try {
    const db = getServiceClient();
    const { data, error } = await db.from("study_nudge_prefs").select("opt_in,channel,hour,last_sent,pending_email,consent_email,consent_telegram_id,consent_confirmed_at,consent_version").eq("user_id", guard.userId).maybeSingle();
    assertDb(error);
    const owner = await db.from("users").select("email,email_status,is_banned,telegram_id,telegram_chat_id_confirmed,telegram_username").eq("id", guard.userId).maybeSingle();
    assertDb(owner.error);
    const channel = data?.channel === "telegram" ? "telegram" : "email";
    // A Telegram preference sends nothing while its flag is off, so it never reads as on.
    const active = !!data?.opt_in && consentMatches(data, owner.data) && (channel === "email" || telegramOn());
    const destination = deliverableDestination(owner.data);
    const telegramAvailable = telegramOn() && telegramDestination(owner.data) != null;
    const handle = typeof owner.data?.telegram_username === "string" && /^[A-Za-z0-9_]{1,64}$/.test(owner.data.telegram_username) ? `@${owner.data.telegram_username}` : null;
    return json({
      enabled: true,
      opt_in: active,
      channel,
      hour: isStudyNudgeHour(data?.hour) ? data.hour : STUDY_NUDGE_HOURS.fallback,
      // A sent confirmation for the account's current address that is not yet clicked.
      confirmation_pending: !active && channel === "email" && !!data?.pending_email && data.pending_email === destination,
      email_available: !!destination,
      telegram_available: telegramAvailable,
      // The learner's own linked Telegram account, shown before they pick it (reviewer P2).
      telegram_handle: telegramAvailable ? handle : null,
      last_sent: data?.last_sent ?? null,
    });
  } catch { return json({ error: "Could not load preference" }, 503); }
}

export async function POST(req: NextRequest) {
  // a30: the confirmation page's form POST (no session; the signed token is the proof).
  const form = await readConfirmForm(req);
  if (form) {
    try {
      if (!verifyReminderToken(form.token, "study-confirm")) return resultPage(form.lang, "study", "invalid");
      return resultPage(form.lang, "study", await confirmStudyConsent(getServiceClient(), form.token) ? "confirmed" : "invalid");
    } catch { return resultPage(form.lang, "study", "retry"); }
  }

  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const body = await req.json().catch(() => null);
  const channel = body?.channel === undefined ? "email" : body.channel;
  const hour = body?.hour === undefined ? STUDY_NUDGE_HOURS.fallback : body.hour;
  if (typeof body?.opt_in !== "boolean" || (channel !== "email" && channel !== "telegram") || !isStudyNudgeHour(hour)) return json({ error: "Choose a reminder preference" }, 400);
  // Disabling remains possible during a rollout hold. No opt-in while OFF.
  if (body.opt_in && !enabled("STUDY_NUDGE_ENABLED")) return json({ error: "Study nudges are not enabled" }, 409);
  if (body.opt_in && channel === "telegram" && !telegramOn()) return json({ error: "Telegram reminders are not enabled" }, 409);
  const overLimit = () => !checkRateLimit({ key: rateKey("nudge-optin", guard.userId), limit: 5, windowMs: 60 * 60_000 }).allowed;
  try {
    const db = getServiceClient();
    if (!body.opt_in) {
      const { error } = await db.from("study_nudge_prefs").update({ opt_in: false, pending_email: null, confirmation_token: randomUUID() }).eq("user_id", guard.userId);
      assertDb(error);
      return json({ ok: true, opt_in: false, channel });
    }
    // Same channel, consent still bound: only the hour changes, no new confirmation.
    const current = await db.from("study_nudge_prefs").select("opt_in,channel,consent_email,consent_telegram_id,consent_confirmed_at,consent_version").eq("user_id", guard.userId).maybeSingle();
    assertDb(current.error);
    if (current.data?.opt_in && current.data.channel === channel) {
      const owner = await db.from("users").select("email,email_status,is_banned,telegram_id,telegram_chat_id_confirmed").eq("id", guard.userId).maybeSingle();
      assertDb(owner.error);
      if (consentMatches(current.data, owner.data)) {
        assertDb((await db.from("study_nudge_prefs").update({ hour }).eq("user_id", guard.userId)).error);
        return json({ ok: true, opt_in: true, channel, hour });
      }
    }
    // The limit counts new consents and confirmation mails, not hour changes above.
    if (overLimit()) return json({ error: "Too many requests; please retry later" }, 429);
    if (channel === "telegram") {
      if (!await grantTelegramConsent(db, guard.userId, hour)) return json({ error: "Start the MedPrüf bot in Telegram first" }, 400);
      return json({ ok: true, opt_in: true, channel, hour });
    }
    if (!await requestStudyConsent(db, guard.userId, hour)) return json({ error: "Verify your account email first" }, 400);
    return json({ ok: true, opt_in: false, confirmation_pending: true, channel, hour });
  } catch { return json({ error: "Could not save preference" }, 503); }
}
