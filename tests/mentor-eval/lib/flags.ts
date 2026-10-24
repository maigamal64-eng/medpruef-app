/**
 * Flag state of a golden case (a-mentor-known-bugs). The app.billing.* facts depend on the build flags
 * NEXT_PUBLIC_PRICING_V2, NEXT_PUBLIC_REVERSE_TRIAL and (a-card-trial-preflip-1024) NEXT_PUBLIC_CARD_TRIAL, so a case that grades plan or trial wording
 * names the state it expects and the harness builds its facts under exactly that state, never under
 * whatever the ambient env happens to hold. Synchronous and restoring, so no case can leak a flag.
 */
import type { CaseFlags } from "./types";

const KEYS = ["NEXT_PUBLIC_PRICING_V2", "NEXT_PUBLIC_REVERSE_TRIAL", "NEXT_PUBLIC_CARD_TRIAL"] as const;

export function withCaseFlags<T>(flags: CaseFlags | undefined, fn: () => T): T {
  const saved = KEYS.map((k) => [k, process.env[k]] as const);
  try {
    process.env.NEXT_PUBLIC_PRICING_V2 = flags?.pricing_v2 ? "true" : "false";
    process.env.NEXT_PUBLIC_REVERSE_TRIAL = flags?.reverse_trial ? "true" : "false";
    process.env.NEXT_PUBLIC_CARD_TRIAL = flags?.card_trial ? "true" : "false";
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
