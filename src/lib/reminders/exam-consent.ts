import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { resolveOptionalUser } from "@/lib/auth-guard";
import { sanitizeAttribution } from "@/lib/attribution";
import { EXAM_SOURCE_IDS } from "@/lib/topics";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { checkRateLimit, callerIdentity, rateKey } from "@/lib/rate-limit";
import { assertDb, CONFIRMATION_COOLDOWN_MS, enabled, noStore, SITE } from "./common";
import { renderReminderConfirmation } from "@/lib/email/reminder-confirm-template";
import { confirmFormPage, linkLang, readConfirmForm, resultPage } from "./link-page";
import { normalizeEmail, signReminderToken, unsubscribeCredential, verifyReminderToken } from "./tokens";

const exams = new Set<string>([...EXAM_SOURCE_IDS, "all"]);
const response = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });
export async function subscribeExamReminder(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Invalid email" }, 400);
    const exam = exams.has(String(body?.exam_type)) ? String(body.exam_type) : "all";
    const locale = ["de", "en", "ru", "uk", "tr", "ar"].includes(String(body?.locale)) ? String(body.locale) : "de";
    // Per-IP burst limit (per instance). The durable per-address cooldown below
    // is the real fence against confirmation-mail flooding.
    if (!checkRateLimit({ key: rateKey("exam-reminder-signup", callerIdentity(req)), limit: 10, windowMs: 10 * 60_000 }).allowed) return response({ error: "Too many requests; please retry later" }, 429);
    const db = getServiceClient();
    const userId = resolveOptionalUser(req);
    let linkedUserId: string | null = null;
    if (userId) {
      const user = await db.from("users").select("id").eq("id", userId).maybeSingle();
      assertDb(user.error);
      if (user.data) linkedUserId = userId;
    }
    const existing = await db.from("exam_reminders").select("id,confirmation_token,confirmed,consent_email,consent_confirmed_at,consent_version,unsubscribed_at").eq("email", email).eq("exam_type", exam).maybeSingle();
    assertDb(existing.error);
    let row = existing.data;
    if (!row) {
      const created = await db.from("exam_reminders").insert({ email, exam_type: exam, locale, source: typeof body?.source === "string" ? body.source.trim().slice(0, 40) : "landing", utm: sanitizeAttribution(body?.attribution) ?? null, user_id: linkedUserId, confirmed: false, confirmation_token: randomUUID() }).select("id,confirmation_token,confirmed,consent_email,consent_confirmed_at,consent_version,unsubscribed_at").single();
      if (created.error?.code === "23505") return response({ ok: true, confirmation_pending: true });
      assertDb(created.error);
      row = created.data;
    }
    if (!row) throw new Error("Missing subscription");
    // Anonymous repeats NEVER clear an unsubscribe or activate a historical row.
    // Only possession of the emailed, purpose-bound credential grants consent.
    const alreadyConfirmed = row?.confirmed === true && !row.unsubscribed_at && (row.consent_version == null || row.consent_email === email);
    if (!alreadyConfirmed && enabled("EXAM_REMINDERS_ENABLED") && await claimConfirmationSlot(db, row.id, email)) {
      const lang = locale === "de" ? "de" : "en";
      const url = `${SITE}/api/reminders?confirm=${encodeURIComponent(signReminderToken("exam-confirm", row.confirmation_token))}&lang=${lang}`;
      // a46: the confirmation answers the visitor's own request (transactional),
      // but a bounced or complained address is still never mailed. A withheld
      // address answers like a sent one, so the form never reveals the list.
      const sent = await sendUnlessSuppressed(db, "transactional", { to: email, ...renderReminderConfirmation("exam", lang, url) });
      const withheld = !sent.ok && (sent.reason === "suppressed" || sent.reason === "invalid_address");
      if (!sent.ok && !withheld) {
        // Release the slot so a genuine retry is possible; no mail was accepted.
        assertDb((await db.from("exam_reminders").update({ confirmation_sent_at: null }).eq("id", row.id)).error);
        return response({ error: "Could not send confirmation; please retry" }, 503);
      }
    }
    return response({ ok: true, confirmation_pending: !alreadyConfirmed });
  } catch { return response({ error: "Could not save reminder; please retry" }, 503); }
}
// At most one confirmation mail per normalized address per cooldown, across
// every exam type row; the slot is claimed by a conditional UPDATE before the
// provider call so concurrent requests cannot both send.
async function claimConfirmationSlot(db: ReturnType<typeof getServiceClient>, id: number, email: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - CONFIRMATION_COOLDOWN_MS).toISOString();
  const recent = await db.from("exam_reminders").select("id").eq("email", email).gte("confirmation_sent_at", cutoff).limit(1);
  assertDb(recent.error);
  if (recent.data?.length) return false;
  const claim = await db.from("exam_reminders").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", id).or(`confirmation_sent_at.is.null,confirmation_sent_at.lt."${cutoff}"`).select("id").maybeSingle();
  assertDb(claim.error);
  return !!claim.data;
}
export async function examReminderLink(req: NextRequest) {
  const confirmation = req.nextUrl.searchParams.get("confirm");
  const unsub = req.nextUrl.searchParams.get("unsub");
  const lang = linkLang(req.nextUrl.searchParams.get("lang"));
  if (confirmation === null && unsub === null) return response({ error: "Missing token" }, 400);
  if (confirmation !== null) {
    // a30 (b19 S4): a GET only shows the button; the POST below confirms.
    try {
      return verifyReminderToken(confirmation, "exam-confirm") ? confirmFormPage(lang, "exam", "/api/reminders", confirmation) : resultPage(lang, "exam", "invalid");
    } catch { return resultPage(lang, "exam", "retry"); }
  }
  try {
    const token = unsubscribeCredential(unsub!, "exam");
    if (!token) return resultPage(lang, "exam", "invalid");
    // The RPC revokes overlapping subscriptions for this normalized address.
    // No recipient address or row-existence signal is returned to this handler.
    const result = await getServiceClient().rpc("unsubscribe_exam_reminders", { p_token: token });
    assertDb(result.error);
    return resultPage(lang, "exam", "unsubscribed");
  } catch { return resultPage(lang, "exam", "retry"); }
}
/** Form POST from the confirmation page; null when the request is not that form. */
export async function confirmExamReminderForm(req: NextRequest) {
  const form = await readConfirmForm(req);
  if (!form) return null;
  try {
    const token = verifyReminderToken(form.token, "exam-confirm");
    if (!token) return resultPage(form.lang, "exam", "invalid");
    const result = await getServiceClient().rpc("confirm_exam_reminder", { p_token: token });
    assertDb(result.error);
    return resultPage(form.lang, "exam", result.data ? "confirmed" : "invalid");
  } catch { return resultPage(form.lang, "exam", "retry"); }
}
