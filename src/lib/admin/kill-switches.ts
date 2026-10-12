/**
 * Emergency kill switches (a19, ADM-12 B). Both default off; when one is
 * left on, analytics numbers or sign-in behaviour silently change (17 to 19
 * Sep 2026: DISABLE_ANALYTICS_WRITES stayed on and every analytics number
 * read near zero). The admin shows a red banner on every page while one is
 * on. Server-only: reads process.env, returns names and on/off only.
 */

import { analyticsWritesDisabled, supabaseDegradedModeEnabled } from "@/lib/supabase-resilience";

export interface KillSwitchState {
  key: "DISABLE_ANALYTICS_WRITES" | "SUPABASE_DEGRADED_MODE";
  on: boolean;
  /** What is affected while it is on. */
  effect: string;
}

export function readKillSwitches(): KillSwitchState[] {
  return [
    { key: "DISABLE_ANALYTICS_WRITES", on: analyticsWritesDisabled(), effect: "Sessions, landing hits, CSP reports and tracked events are not written; analytics numbers read near zero." },
    { key: "SUPABASE_DEGRADED_MODE", on: supabaseDegradedModeEnabled(), effect: "Sign-in may serve short-lived cached sessions on database errors." },
  ];
}
