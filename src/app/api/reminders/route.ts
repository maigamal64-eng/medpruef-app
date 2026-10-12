// Subscription activation requires possession of an emailed confirmation link.
// Consent and opt-out handlers share no-store/no-referrer responses.
export { subscribeExamReminder as POST, examReminderLink as GET } from "@/lib/reminders/exam-consent";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";
