import { renderExamReminder } from "@/lib/email/exam-reminder-template";
import { assertDb, deliverBatch, loadSubscriptions, unsubscribeUrl, type Delivery, type ReminderDb } from "./common";
import { reminderSchedule } from "./schedule";

export async function runExamReminders(db: ReminderDb, now: Date, dryRun: boolean) {
  const rows = await loadSubscriptions(db, "exam_reminders", "id,email,exam_type,locale,unsub_token", "exam");
  const deliveries: Delivery[] = [];
  for (const row of rows) {
    if (typeof row.email !== "string" || typeof row.unsub_token !== "string") continue;
    for (const { sitting, sittingKey, offset } of reminderSchedule(String(row.exam_type), now)) {
      deliveries.push({
        keys: { reminder_id: Number(row.id), sitting_key: sittingKey, offset_days: offset, channel: "email" },
        mail: { to: row.email, ...renderExamReminder(sitting, offset, String(row.locale), unsubscribeUrl("exam", row.unsub_token)) },
        isSubscribed: async () => {
          const { data, error } = await db.from("exam_reminders").select("id").eq("id", row.id).eq("confirmed", true).eq("exam_type", row.exam_type).eq("email", row.email).eq("unsub_token", row.unsub_token).is("unsubscribed_at", null).maybeSingle();
          assertDb(error); return !!data;
        },
        onSent: async () => {
          const { error } = await db.from("exam_reminders").update({ last_notified_at: now.toISOString() }).eq("id", row.id);
          assertDb(error);
        },
      });
    }
  }
  return deliverBatch(db, "exam_reminder_sends", deliveries, dryRun, now);
}
