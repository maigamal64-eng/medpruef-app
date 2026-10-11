import { randomUUID } from "node:crypto";
import { assertDb, SITE, type ReminderDb } from "./common";
import { normalizeEmail, signReminderToken, verifyReminderToken } from "./tokens";
import { sendZohoEmail } from "@/lib/email/zoho";

type EmailOwner = { email?: string | null; email_status?: string | null };
// The emailed study-confirm link is the destination proof. users.email_verified_at
// is never set in production today, so it cannot gate opt-in; bounced addresses
// are excluded.
export function deliverableDestination(owner: EmailOwner | null): string | null {
  return owner?.email && owner.email_status !== "bounced" ? normalizeEmail(owner.email) : null;
}
export async function requestStudyConsent(db: ReminderDb, userId: string) {
  const owner = await db.from("users").select("email,email_status,language_code").eq("id", userId).maybeSingle();
  assertDb(owner.error);
  const email = deliverableDestination(owner.data);
  if (!email) return false;
  const token = randomUUID();
  const url = `${SITE}/api/nudge?confirm=${encodeURIComponent(signReminderToken("study-confirm", token))}`;
  // Re-enabling requires a fresh destination confirmation, never a session alone.
  const saved = await db.from("study_nudge_prefs").upsert({ user_id: userId, opt_in: false, channel: "email", pending_email: email, confirmation_token: token, consent_email: null, consent_confirmed_at: null, consent_version: null }, { onConflict: "user_id" });
  assertDb(saved.error);
  const de = owner.data?.language_code === "de";
  const sent = await sendZohoEmail({ to: email, subject: de ? "Lernerinnerungen bestätigen" : "Confirm study reminders", htmlBody: `<p>${de ? "Bitte bestätigen Sie Lernerinnerungen für diese E-Mail-Adresse." : "Please confirm study reminders for this email address."}</p><p><a href="${url}">${de ? "Bestätigen" : "Confirm"}</a></p>` });
  if (!sent.ok) throw new Error("Could not send confirmation");
  return true;
}
export async function confirmStudyConsent(db: ReminderDb, signed: string, now = new Date()) {
  const token = verifyReminderToken(signed, "study-confirm", now);
  if (!token) return false;
  const pref = await db.from("study_nudge_prefs").select("id,user_id,pending_email").eq("confirmation_token", token).maybeSingle();
  assertDb(pref.error);
  if (!pref.data?.pending_email) return false;
  const owner = await db.from("users").select("email,email_status").eq("id", pref.data.user_id).maybeSingle();
  assertDb(owner.error);
  if (deliverableDestination(owner.data) !== pref.data.pending_email) return false;
  const saved = await db.from("study_nudge_prefs").update({ opt_in: true, consent_email: pref.data.pending_email, consent_confirmed_at: now.toISOString(), consent_version: 1, pending_email: null, confirmation_token: randomUUID() }).eq("id", pref.data.id).eq("confirmation_token", token).eq("pending_email", pref.data.pending_email).select("id").maybeSingle();
  assertDb(saved.error);
  return !!saved.data;
}
