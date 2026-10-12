import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { cronAuthorized, cronError, enabled, noStore } from "@/lib/reminders/common";
import { runStudyNudges } from "@/lib/reminders/study";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return cronError(401, "Unauthorized");
  const mode = req.nextUrl.searchParams.get("dry_run");
  if (mode !== null && mode !== "true" && mode !== "false") return cronError(400, "Invalid dry_run mode");
  const dryRun = mode === "true";
  if (!dryRun && !enabled("STUDY_NUDGE_ENABLED")) return NextResponse.json({ enabled: false }, { headers: noStore });
  try {
    const counts = await runStudyNudges(getServiceClient(), new Date(), dryRun);
    return NextResponse.json({ dry_run: dryRun, ...counts }, { headers: noStore });
  } catch {
    return cronError(503, "Study sweep failed; reconcile reserved sends before retrying");
  }
}
