/**
 * Plan prompt after the first quiz round (a-free-set issue 13).
 *
 * A free-intent signup lands straight in the quiz and never sees the Home
 * onboarding, so no exam date or daily goal is captured. After their first
 * round (10 answers, or the round length when shorter) the quiz shows the
 * onboarding date and goal steps once. Eligible: a free account whose
 * onboarding was neither completed nor skipped on the server, with no local
 * completion record and no earlier prompt on this device.
 */
import { safeStorage } from "@/lib/safe-storage";

export const FIRST_ROUND_SIZE = 10;

export const planPromptKey = (userId: string) => `medpruef_plan_prompt:${userId}`;

export interface OnboardingStateBody {
  completed_at?: string | null;
  skipped_at?: string | null;
}

/** Pure rule, tested: may this learner get the prompt? */
export function planPromptEligible(args: {
  free: boolean;
  server: OnboardingStateBody | null;
  localOnboarding: string | null;
  alreadyPrompted: boolean;
}): boolean {
  if (!args.free || args.alreadyPrompted || args.localOnboarding) return false;
  if (!args.server) return false;
  return !args.server.completed_at && !args.server.skipped_at;
}

/** Answers that end the first round. */
export function firstRoundSize(targetCount: number | null | undefined, continuous: boolean): number {
  if (continuous || !targetCount || targetCount <= 0) return FIRST_ROUND_SIZE;
  return Math.min(FIRST_ROUND_SIZE, targetCount);
}

export function readPlanPromptLocal(userId: string): { localOnboarding: string | null; alreadyPrompted: boolean } {
  try {
    return {
      localOnboarding: safeStorage.getItem("medpruef_onboarding"),
      alreadyPrompted: safeStorage.getItem(planPromptKey(userId)) !== null,
    };
  } catch {
    // Unreadable storage: do not prompt (it could repeat on every round).
    return { localOnboarding: null, alreadyPrompted: true };
  }
}

export function markPlanPrompted(userId: string): void {
  try { safeStorage.setItem(planPromptKey(userId), new Date().toISOString()); } catch { /* best effort */ }
}
