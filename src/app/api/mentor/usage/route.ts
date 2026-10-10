import type { NextRequest } from "next/server";
import { flag } from "@/lib/admin/flags";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { readMentorConfig } from "@/lib/mentor/config";
import { resolveMentorServices } from "@/lib/mentor/guard";
import { readActiveMentorSubscriptions, readActivePackageIds } from "@/lib/mentor/ledger";
import { captureServerError } from "@/lib/sentry-capture";
import { getServiceClient } from "@/lib/supabase";
import type { MentorAuth } from "../chat/handler";
import { handleMentorUsage } from "./handler";

export const dynamic = "force-dynamic";

/** GET /api/mentor/usage (contract C4): credits left, state, sources, subscriptions. */
export async function GET(req: NextRequest) {
  const db = getServiceClient();
  return handleMentorUsage(req, {
    config: readMentorConfig(),
    env: process.env,
    async authenticate(request): Promise<MentorAuth> {
      const guard = await requireUser(request as NextRequest);
      if ("error" in guard) return { ok: false };
      return { ok: true, userId: guard.userId, paidAccess: isPaidAccess(guard) };
    },
    flag: (key, userId) => flag(key, userId),
    rpc: db,
    services: () => resolveMentorServices(db),
    clock: { now: () => new Date() },
    subscriptions: (userId) => readActiveMentorSubscriptions(db, userId),
    activePackageIds: () => readActivePackageIds(db),
    alert: (message, ctx) => captureServerError(new Error(message), ctx),
  });
}
