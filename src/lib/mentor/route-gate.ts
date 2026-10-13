/**
 * Gate for the mentor's secondary learner routes (thread history, result
 * recovery, answer report). They spend nothing, so they skip the DB rollout
 * flag (a paused rollout keeps read-only access), but they still need both
 * masters (AI_FEATURES_ENABLED, MENTOR_ENABLED) and an admission (allowlist,
 * or MENTOR_ACCESS_SCOPE through src/lib/mentor/access.ts).
 * Every error fails closed. Erasure (DELETE history) and checkout verify are
 * deliberately ungated: deleting one's own data and receiving paid credits
 * must always work.
 */

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { readMentorConfig, type MentorConfig } from "./config";
import { mentorBetaAllowed } from "./beta";
import { decideMentorAdmission, mentorScopeReads, type MentorScopeReads } from "./access";

export async function mentorLearnerRouteOpen(
  userId: string,
  config: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "betaUserIds"> & Partial<Pick<MentorConfig, "accessScope" | "packagesEnabled">> = readMentorConfig(),
  betaAllowed: (userId: string) => Promise<boolean> = (id) => mentorBetaAllowed(getServiceClient(), id, config.betaUserIds),
  reads?: MentorScopeReads,
): Promise<boolean> {
  if (!config.aiFeaturesEnabled || !config.enabled) return false;
  try {
    return (await decideMentorAdmission({ scope: config.accessScope ?? "beta", packagesEnabled: config.packagesEnabled === true, userId, allowlisted: betaAllowed, reads })) !== null;
  } catch { return false; }
}

/** The route form: the caller's requireUser guard supplies paid access. */
export function mentorLearnerRouteOpenFor(guard: { userId: string; paidAccess: boolean }): Promise<boolean> {
  const config = readMentorConfig();
  return mentorLearnerRouteOpen(guard.userId, config, undefined, mentorScopeReads(getServiceClient(), { paidAccess: guard.paidAccess }));
}

export function mentorRouteClosed(): NextResponse {
  return NextResponse.json({ error: "mentor_disabled" }, { status: 403, headers: { "cache-control": "no-store" } });
}
