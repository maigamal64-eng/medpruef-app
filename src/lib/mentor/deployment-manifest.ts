/** One owner for runtime fact tracing, also inspected by the readiness card. */
export const MENTOR_FACT_TRACE: Record<string,string[]> = {
 "/api/mentor/chat": ["./content/mentor-facts/**/*"],
 "/api/mentor/admin/operations": ["./content/mentor-facts/**/*"],
};
/**
 * Last live trust gate that passed in one run (track-A, a-mentor-preconds): scripts/mentor-trust-gate.mjs
 * --live --max-usd 0.40 on 28bd430a, all 18 gate source hashes unchanged since. Evidence: track-b handover
 * a-mentor-preconds/gate-live-1/gate.json. Re-run and update after any change to the mentor answer path.
 */
export const MENTOR_RELEASE_EVAL: { commit: string; score: string; passed_at: string } | null = {
  commit: "28bd430a",
  score: "PASS 5/5 slices (deadline 7/7, precision 168/168 with 0 replaced, trust 32/32, explain 30/30, multilingual 20/20), USD 0.216",
  passed_at: "2026-10-14T04:33:33Z",
};
