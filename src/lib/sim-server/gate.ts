/**
 * Who may open a simulation session, decided by one injectable function. S10 replaces
 * `staffOnlyGate` with the real rule (`decideAccess` over usage and the spend cap). Until then
 * only staff pass, so nothing reaches learners even with SIM_ENABLED on.
 */
import type { GuardSuccess } from "@/lib/auth-guard";
import type { SimCaseInput } from "@/lib/sim/case";
import type { SessionMode } from "@/lib/sim/state";
import type { SimProfile } from "@/lib/sim/profile";

export interface GateInput {
  guard: GuardSuccess;
  profile: SimProfile;
  caseInput: SimCaseInput;
  mode: SessionMode;
}

/** `aiMarking` is the decision stored on the session at creation (the restore context reads it back). */
export type GateDecision = { allowed: true; aiMarking: boolean } | { allowed: false };

export type SimAccessGate = (i: GateInput) => Promise<GateDecision> | GateDecision;

/** The house staff check available on the guard (role or tier admin). Staff get self-marking until S5 and S10 land. */
export const staffOnlyGate: SimAccessGate = ({ guard }) => (guard.role === "admin" || guard.tier === "admin" ? { allowed: true, aiMarking: false } : { allowed: false });

/** Server flag. Absent or anything but the literal "true" is OFF. */
export function simEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SIM_ENABLED === "true";
}
