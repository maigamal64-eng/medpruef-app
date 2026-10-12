import { renderExamReminder } from "@/lib/email/exam-reminder-template";
import { assertDb, deliverBatch, loadSubscriptions, SITE, unsubscribeUrl, type Delivery, type ReminderDb } from "./common";
import { normalizeEmail, recipientKey } from "./tokens";
import { reminderSchedule } from "./schedule";

export async function runExamReminders(db: ReminderDb, now: Date, dryRun: boolean) {
  const rows = await loadSubscriptions(db, "exam_reminders", "id,email,exam_type,locale,unsub_token,confirmed,consent_email,consent_confirmed_at,consent_version", "exam");
  const groups = new Map<string, { rows: typeof rows; delivery: Delivery }>();
  for (const row of rows) {
    // Audience = confirmed, not unsubscribed ([name] pick decision:pick-predeadline-send).
    // A row confirmed through the signed link must still match its consented address.
    if (typeof row.email !== "string" || typeof row.unsub_token !== "string" || row.confirmed !== true) continue;
    if (row.consent_version != null && row.consent_email !== normalizeEmail(row.email)) continue;
    for (const { sitting, sittingKey, offset } of reminderSchedule(String(row.exam_type), now)) {
      const identity = recipientKey(row.email);
      const key = JSON.stringify([identity, sittingKey, offset, "email"]);
      const existing = groups.get(key);
      if (existing) { existing.rows.push(row); continue; }
      const group = { rows: [row], delivery: {} as Delivery };
      group.delivery = {
        keys: { recipient_key: identity, sitting_key: sittingKey, offset_days: offset, channel: "email" },
        mail: { to: normalizeEmail(row.email), ...renderExamReminder(sitting, offset, String(row.locale), dryRun ? SITE : unsubscribeUrl("exam", row.unsub_token, row.locale === "de" ? "de" : "en")) },
        isSubscribed: async () => {
          for (const subscription of group.rows) {
            const { data, error } = await db.from("exam_reminders").select("id").eq("id", subscription.id).eq("confirmed", true).eq("exam_type", subscription.exam_type).eq("email", subscription.email).eq("unsub_token", subscription.unsub_token).is("unsubscribed_at", null).maybeSingle();
            assertDb(error);
            if (data) return true;
          }
          return false;
        },
        onSent: async () => {
          const { error } = await db.from("exam_reminders").update({ last_notified_at: now.toISOString() }).in("id", group.rows.map(r => r.id));
          assertDb(error);
        },
      };
      groups.set(key, group);
    }
  }
  return deliverBatch(db, "exam_reminder_sends", [...groups.values()].map(g => g.delivery), dryRun, now);
}
