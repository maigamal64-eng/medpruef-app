import type { NextRequest } from "next/server";
import { captureServerError } from "@/lib/sentry-capture";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { readMentorConfig } from "@/lib/mentor/config";
import { handleMentorSweep } from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bearer CRON_SECRET, fail closed. Schedule added to vercel.json at R3. */
export async function GET(req: NextRequest) {
  return handleMentorSweep(req, {
    cronSecret: process.env.CRON_SECRET,
    enabled: readMentorConfig().enabled,
    rpc: getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS }),
    alert: (message) => captureServerError(new Error(message), { route: "/api/cron/mentor-sweep" }),
  });
}
