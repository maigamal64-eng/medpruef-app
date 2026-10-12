import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { flag } from "@/lib/admin/flags";
import { readMentorConfig } from "@/lib/mentor/config";
import { getServiceClient } from "@/lib/supabase";
import { mentorBetaAllowed } from "@/lib/mentor/beta";
import { handleMentorAvailability } from "./handler";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(req: NextRequest) {
  const config = readMentorConfig();
  return handleMentorAvailability(req, {
    config,
    betaAllowed: userId => mentorBetaAllowed(getServiceClient(), userId, config.betaUserIds, { throwOnError: true }),
    authenticate: async request => {
      const auth = await requireUser(request as NextRequest);
      return "error" in auth ? { ok: false } : { ok: true, userId: auth.userId };
    },
    flag: (key, id) => flag(key, id, { fresh: true, throwOnError: true }),
  });
}
