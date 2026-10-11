import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";
/** Independent of the sweep schedule: a missing sweep cannot check its own absence. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`), got = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await getServiceClient().from("ai_mentor_job").select("last_run_at").eq("job", "sweep").maybeSingle();
  if (error || !data || Date.now() - Date.parse(data.last_run_at) > 24 * 3600_000) {
    captureServerError(new Error("mentor sweep missing for 24 hours"), { route: "/api/cron/mentor-health" });
    return NextResponse.json({ ok: false, error: "sweep_overdue" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
