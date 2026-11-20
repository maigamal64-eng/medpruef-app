import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { captureServerError, captureServerWarning } from "@/lib/sentry-capture";
import { readMentorConfig } from "@/lib/mentor/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Independent of the sweep schedule: a missing sweep cannot check its own absence. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), got = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Dark: the sweep is a no-op while MENTOR_ENABLED is off, so there is no heartbeat to watch.
  if (!readMentorConfig().enabled) return NextResponse.json({ ok: true, skipped: "mentor_disabled" });
  // A database read error is its own outcome: it says nothing about the sweep (12 Nov outage: a
  // restart made this look like "missing for 24 hours"). The client already retries reads once.
  let data: { last_run_at: string } | null = null;
  let readError: unknown = null;
  try {
    const res = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS }).from("ai_mentor_job").select("last_run_at").eq("job", "sweep").maybeSingle();
    data = res.data;
    readError = res.error;
  } catch (e) {
    readError = e;
  }
  if (readError) {
    console.warn("[/api/cron/mentor-health] database read error, sweep state unknown:", readError instanceof Error ? readError.message : readError);
    captureServerWarning("mentor-health could not read the sweep row", { route: "/api/cron/mentor-health", outcome: "db_read_error" });
    return NextResponse.json({ ok: false, error: "db_read_error" }, { status: 503 });
  }
  if (!data || !(Date.now() - Date.parse(data.last_run_at) <= 24 * 3600_000)) {
    captureServerError(new Error("mentor sweep missing for 24 hours"), { route: "/api/cron/mentor-health", outcome: "sweep_overdue" });
    return NextResponse.json({ ok: false, error: "sweep_overdue" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
