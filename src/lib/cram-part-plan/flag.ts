/**
 * CRAM_PART_PLAN_ENABLED (server, default OFF): only the literal "true"
 * turns on the part-aware cram plan (a-cram-part-plan). Off, the study-plan
 * response and the trial-end card are byte for byte today's.
 */
type Env = Record<string, string | undefined>;

export const CRAM_PART_PLAN_ENV = "CRAM_PART_PLAN_ENABLED";

export function cramPartPlanEnabled(env: Env = process.env): boolean {
  return (env[CRAM_PART_PLAN_ENV] ?? "").trim() === "true";
}
