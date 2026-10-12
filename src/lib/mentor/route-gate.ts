/**
 * Gate for the mentor's secondary learner routes (thread history, result
 * recovery, answer report). They spend nothing, so they skip the DB rollout
 * flag (a paused rollout keeps read-only access), but they still need both
 * masters (AI_FEATURES_ENABLED, MENTOR_ENABLED) and an allowlist entry.
 * Every error fails closed. Erasure (DELETE history) and checkout verify are
 * deliberately ungated: deleting one's own data and receiving paid credits
 * must always work.
 */

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { readMentorConfig, type MentorConfig } from "./config";
import { mentorBetaAllowed } from "./beta";

export async function mentorLearnerRouteOpen(
  userId: string,
  config: Pick<MentorConfig, "aiFeaturesEnabled" | "enabled" | "betaUserIds"> = readMentorConfig(),
  betaAllowed: (userId: string) => Promise<boolean> = (id) => mentorBetaAllowed(getServiceClient(), id, config.betaUserIds),
): Promise<boolean> {
  if (!config.aiFeaturesEnabled || !config.enabled) return false;
  try { return await betaAllowed(userId); } catch { return false; }
}

export function mentorRouteClosed(): NextResponse {
  return NextResponse.json({ error: "mentor_disabled" }, { status: 403, headers: { "cache-control": "no-store" } });
}
