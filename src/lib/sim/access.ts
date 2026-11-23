/**
 * Who gets AI marking in a session ([name]-ANSWERS-1116, DECISIONS.md D-1 to D-3).
 * Pure rule over data the caller reads (S10 reads usage and the spend cap, S2
 * stores the decision on the session). Locked cases are decided here too, so the
 * free case guard lives in one place.
 */
import type { SimProfile } from "./profile";
import type { SessionMode } from "./state";

export type AccountKind = "free" | "paid";

export interface AccessInput {
  profile: SimProfile;
  account: AccountKind;
  caseIsFree: boolean;
  mode: SessionMode;
  /** False when SIM_AI_ENABLED is off, the monthly spend cap is reached, or the AI route is down. */
  aiAvailable: boolean;
  /** Full simulations this account already ran with AI marking on the free case (ever). */
  freeCaseAiFullSimulationsUsed: number;
  /** Full simulations with AI marking in the profile's fair-use window (paid accounts). */
  aiFullSimulationsInWindow: number;
}

export type MarkingReason =
  | "free_case_first_full" // free account, the one AI full simulation
  | "paid_full" // paid, inside fair use
  | "paid_practice" // paid, practice parts are unlimited
  | "free_case_used" // free account already had its AI run
  | "free_practice" // free account, practice parts are self-marked
  | "fair_use_reached" // paid, over the window count
  | "ai_unavailable" // kill switch, spend cap or outage
  | "profile_self_only"; // the profile marks nothing with AI

export type AccessDecision =
  | { access: "locked" }
  | { access: "open"; marking: "ai" | "self"; reason: MarkingReason };

function profileUsesAi(profile: SimProfile): boolean {
  return profile.parts.some((p) => p.marking === "ai");
}

export function decideAccess(i: AccessInput): AccessDecision {
  if (i.account === "free" && !i.caseIsFree) return { access: "locked" };
  const self = (reason: MarkingReason): AccessDecision => ({ access: "open", marking: "self", reason });
  const ai = (reason: MarkingReason): AccessDecision => ({ access: "open", marking: "ai", reason });
  if (!profileUsesAi(i.profile)) return self("profile_self_only");
  if (!i.aiAvailable) return self("ai_unavailable");
  if (i.account === "free") {
    if (i.mode !== "full_exam") return self("free_practice");
    return i.freeCaseAiFullSimulationsUsed < i.profile.access.freeCase.aiFullSimulations ? ai("free_case_first_full") : self("free_case_used");
  }
  if (i.mode === "practice_part") return ai("paid_practice");
  return i.aiFullSimulationsInWindow < i.profile.access.paid.aiFullSimulationsPerWindow ? ai("paid_full") : self("fair_use_reached");
}

/** True when a session with this decision uses up one AI full simulation (S10 counts it at start). */
export function countsTowardAllowance(d: AccessDecision, mode: SessionMode): boolean {
  return d.access === "open" && d.marking === "ai" && mode === "full_exam";
}
