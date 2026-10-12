import type { NextRequest } from "next/server";
import { confirmExamReminderForm, examReminderLink, subscribeExamReminder } from "@/lib/reminders/exam-consent";

// Subscription activation requires possession of an emailed confirmation link.
// a30: the link's GET shows a button; its form POST confirms (b19 S4). Every
// other POST is the JSON signup. Consent and opt-out handlers share
// no-store/no-referrer responses.
export const GET = examReminderLink;
export async function POST(req: NextRequest) {
  return (await confirmExamReminderForm(req)) ?? subscribeExamReminder(req);
}
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";
