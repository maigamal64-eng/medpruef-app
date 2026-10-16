import type { NextRequest } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { flag } from "@/lib/admin/flags";
import { readMentorConfig } from "@/lib/mentor/config";
import { getServiceClient } from "@/lib/supabase";
import { mentorBetaAllowed } from "@/lib/mentor/beta";
import { mentorScopeReads } from "@/lib/mentor/access";
import { handleMentorAvailability } from "./handler";
import { mentorAuthFailure } from "../chat/handler";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(req: NextRequest) {
  const config = readMentorConfig();
  return handleMentorAvailability(req, {
    config,
    betaAllowed: userId => mentorBetaAllowed(getServiceClient(), userId, config.betaUserIds, { throwOnError: true }),
    scopeReads: user => mentorScopeReads(getServiceClient(), { paidAccess: user.paidAccess === true }),
    authenticate: async request => {
      const auth = await requireUser(request as NextRequest);
      return "error" in auth ? mentorAuthFailure(auth.error.status) : { ok: true, userId: auth.userId, paidAccess: isPaidAccess(auth) };
    },
    flag: (key, id) => flag(key, id, { fresh: true, throwOnError: true }),
  });
}
