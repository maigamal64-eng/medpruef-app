import type { NextRequest } from "next/server";
import { captureServerError } from "@/lib/sentry-capture";
import { getServiceClient } from "@/lib/supabase";
import { readMentorConfig } from "@/lib/mentor/config";
import { handleMentorSweep } from "./handler";

export const dynamic = "force-dynamic";

/** Bearer CRON_SECRET, fail closed. Schedule added to vercel.json at R3. */
export async function GET(req: NextRequest) {
  return handleMentorSweep(req, {
    cronSecret: process.env.CRON_SECRET,
    enabled: readMentorConfig().enabled,
    rpc: getServiceClient(),
    alert: (message) => captureServerError(new Error(message), { route: "/api/cron/mentor-sweep" }),
  });
}
