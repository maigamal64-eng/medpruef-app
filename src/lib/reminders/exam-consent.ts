import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { resolveOptionalUser } from "@/lib/auth-guard";
import { sanitizeAttribution } from "@/lib/attribution";
import { sendZohoEmail } from "@/lib/email/zoho";
import { assertDb, enabled, noStore, SITE } from "./common";
import { normalizeEmail, signReminderToken, unsubscribeCredential, verifyReminderToken } from "./tokens";

const exams = new Set(["kenntnispruefung", "kmp_innsbruck", "pharma", "all"]);
const response = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });
export async function subscribeExamReminder(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: "Invalid email" }, 400);
    const exam = exams.has(String(body?.exam_type)) ? String(body.exam_type) : "all";
    const locale = ["de", "en", "ru", "uk", "tr", "ar"].includes(String(body?.locale)) ? String(body.locale) : "de";
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
    const alreadyConfirmed = row?.confirmed === true && row.consent_email === email && row.consent_confirmed_at && row.consent_version === 1 && !row.unsubscribed_at;
    if (!alreadyConfirmed && enabled("EXAM_REMINDERS_ENABLED")) {
      const url = `${SITE}/api/reminders?confirm=${encodeURIComponent(signReminderToken("exam-confirm", row.confirmation_token))}`;
      const de = locale === "de";
      const sent = await sendZohoEmail({ to: email, subject: de ? "Prüfungserinnerungen bestätigen" : "Confirm exam reminders", htmlBody: `<p>${de ? "Bitte bestätige Prüfungserinnerungen für diese E-Mail-Adresse." : "Please confirm exam reminders for this email address."}</p><p><a href="${url}">${de ? "Bestätigen" : "Confirm"}</a></p>` });
      if (!sent.ok) return response({ error: "Could not send confirmation; please retry" }, 503);
    }
    return response({ ok: true, confirmation_pending: !alreadyConfirmed });
  } catch { return response({ error: "Could not save reminder; please retry" }, 503); }
}
export async function examReminderLink(req: NextRequest) {
  const confirmation = req.nextUrl.searchParams.get("confirm");
  const unsub = req.nextUrl.searchParams.get("unsub");
  if (confirmation === null && unsub === null) return response({ error: "Missing token" }, 400);
  try {
    if (confirmation !== null) {
      const token = verifyReminderToken(confirmation, "exam-confirm");
      if (!token) return response({ error: "Invalid or expired confirmation" }, 400);
      const result = await getServiceClient().rpc("confirm_exam_reminder", { p_token: token });
      assertDb(result.error);
      return result.data ? response({ ok: true }) : response({ error: "Invalid or expired confirmation" }, 400);
    }
    const token = unsubscribeCredential(unsub!, "exam");
    if (!token) return response({ error: "Invalid link" }, 400);
    // The RPC revokes overlapping subscriptions for this normalized address.
    // No recipient address or row-existence signal is returned to this handler.
    const result = await getServiceClient().rpc("unsubscribe_exam_reminders", { p_token: token });
    assertDb(result.error);
    return new NextResponse("You have been unsubscribed from MedPrüf exam reminders.", { headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" } });
  } catch { return response({ error: "Could not unsubscribe or confirm; please retry" }, 503); }
}
