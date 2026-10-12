import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { cronAuthorized, cronError, enabled, noStore } from "@/lib/reminders/common";
import { runExamReminders } from "@/lib/reminders/exam";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return cronError(401, "Unauthorized");
  const mode = req.nextUrl.searchParams.get("dry_run");
  if (mode !== null && mode !== "true" && mode !== "false") return cronError(400, "Invalid dry_run mode");
  const dryRun = mode === "true";
  if (!dryRun && !enabled("EXAM_REMINDERS_ENABLED")) return NextResponse.json({ enabled: false }, { headers: noStore });
  try {
    const counts = await runExamReminders(getServiceClient(), new Date(), dryRun);
    return NextResponse.json({ dry_run: dryRun, ...counts, telegram: enabled("EXAM_REMINDERS_TELEGRAM_ENABLED") ? "held_pending_consent_shape" : "off" }, { headers: noStore });
  } catch {
    return cronError(503, "Reminder sweep failed; reconcile reserved sends before retrying");
  }
}
