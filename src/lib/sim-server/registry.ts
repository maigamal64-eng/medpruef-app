/**
 * Server-side registry of exams the simulation serves (PLAN.md 2.2). The route never takes a
 * profile or a case from the request body: the body names a profile key and a case id, the
 * registry decides whether the key exists, the profile is its own, and the case comes from the
 * exam's own store. Each exam registers here with its own module, so the core stays exam-agnostic.
 *
 * This is the one generic file that imports a Germany module (the KP registration); the
 * never-say boundary test lists it by name.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SimCaseInput } from "@/lib/sim/case";
import type { SimProfile } from "@/lib/sim/profile";
import { kpSimRegistration } from "@/lib/de-kp/sim/server";

export type CaseLoad = { ok: true; caseInput: SimCaseInput | null } | { ok: false; unavailable: boolean; error: unknown };

export interface SimRegistration {
  profile: SimProfile;
  /** The exam's own dark flag (KP: DE_KP_ENABLED). Off reads as not found. */
  enabled(): boolean;
  /** One active case by id (KP: slug). Null when the id names no active case. */
  loadCase(sb: SupabaseClient, caseId: string): Promise<CaseLoad>;
}

const REGISTRY: readonly SimRegistration[] = [kpSimRegistration];

export function findRegistration(profileKey: unknown): SimRegistration | null {
  if (typeof profileKey !== "string") return null;
  const r = REGISTRY.find((x) => x.profile.key === profileKey);
  return r && r.enabled() ? r : null;
}
