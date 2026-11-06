import { after, type NextRequest } from "next/server";
import { callClaude } from "@/lib/ai/anthropic";
import { flag } from "@/lib/admin/flags";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { canFreeUserReadQuestion } from "@/lib/free-access";
import { readMentorConfig } from "@/lib/mentor/config";
import { createConversationStore } from "@/lib/mentor/conversation";
import { resolveMentorServices } from "@/lib/mentor/guard";
import { createHousePolicy, createMeter } from "@/lib/mentor/meter";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { buildV2TurnContext } from "@/lib/mentor/v2/learner-context";
import { captureServerError } from "@/lib/sentry-capture";
import { reportMentorAlert, withTurnFailureAlert } from "@/lib/mentor/report-alert";
import { getServiceClient } from "@/lib/supabase";
import { createMentorRequestStore } from "@/lib/mentor/requests";
import { recordReviewSnapshot } from "@/lib/mentor/review";
import { mentorBetaAllowed } from "@/lib/mentor/beta";
import { mentorScopeReads } from "@/lib/mentor/access";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { readHouseCostThisMonth } from "@/lib/mentor/credits/house-cap";
import { writeMentorTurn } from "@/lib/mentor/outcomes";
import { seatOnlyAccess } from "@/lib/seed-seats/server";
import { handleMentorChat, mentorAuthFailure, type MentorAuth } from "./handler";
import { workspaceSpendMeter, type SpendDb } from "@/lib/ai/workspace-spend";
import { reportSpendAlarm, spendMeterDisabled } from "@/lib/ai/spend-guard";

export const dynamic = "force-dynamic";
// 3 API calls x 18 s timeout, plus ledger round trips. A disconnect does not
// end the turn: `after` keeps it running until every call is settled.
export const maxDuration = 60;

/**
 * POST /api/mentor/chat (contract C4). Ships dark: MENTOR_ENABLED, the DB
 * flag "mentor" and AI_FEATURES_ENABLED all default OFF, and the brain,
 * facts and wallet services are wired at R3 (resolveMentorServices).
 */
export async function POST(req: NextRequest) {
  const db = getServiceClient();
  const config = readMentorConfig();
  const runTurn = createRunMentorTurn({
    alert: reportMentorAlert,
  });
  return handleMentorChat(req, {
    config,
    requests: createMentorRequestStore(db),
    recordTurn: (row) => writeMentorTurn(db, row),
    recordReview: (snapshot) => recordReviewSnapshot(db, snapshot),
    async authenticate(request): Promise<MentorAuth> {
      const guard = await requireUser(request as NextRequest);
      if ("error" in guard) return mentorAuthFailure(guard.error.status);
      const paidAccess = isPaidAccess(guard);
      return {
        ok: true,
        userId: guard.userId,
        paidAccess,
        // a-seed-seats: one read, asked only at the 95 % stop while seats are on.
        ...(paidAccess ? { seatFunded: async () => (await seatOnlyAccess(db, guard.userId, { createdAt: guard.profile?.createdAt ?? null, role: guard.role, tier: guard.tier, tierExpiresAt: guard.tierExpiresAt })) !== null } : {}),
      };
    },
    flag: (key, userId) => flag(key, userId, { fresh: true }),
    betaAllowed: (userId) => mentorBetaAllowed(db, userId, config.betaUserIds),
    scopeReads: (_userId, paidAccess) => mentorScopeReads(db, { paidAccess }),
    freeCredits: readFreeCreditConfig(),
    houseCostThisMonth: (userId, now) => readHouseCostThisMonth(db, userId, now),
    rpc: db,
    services: () => resolveMentorServices(db, { v2: config.v2Enabled === true }),
    v2Context: (userId, request, now) => buildV2TurnContext(db, userId, request, now),
    meterFor: (userId) => createMeter(db, userId),
    house: createHousePolicy(db, config.houseFreeFailsPerDay),
    conversations: createConversationStore(db),
    canReadQuestion: (userId, questionId) => canFreeUserReadQuestion(db, userId, questionId),
    callClaude,
    clock: { now: () => new Date() },
    newRequestId: () => crypto.randomUUID(),
    runTurn: withTurnFailureAlert(runTurn),
    background: (task) => after(task),
    alert: (message, ctx) => captureServerError(new Error(message), ctx),
    ...(spendMeterDisabled() ? {} : { spendMeter: () => workspaceSpendMeter(db as unknown as SpendDb, { onAlarm: reportSpendAlarm }) }),
  });
}
