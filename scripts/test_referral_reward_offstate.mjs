#!/usr/bin/env node
/**
 * Standalone test — proves REFERRAL_EXAM_REWARD_ENABLED gates the
 * BINDING code path in src/lib/referral-exam-reward.ts, not just the
 * UI. Spec: reviews/referral-exam-reward-2026-07-11/SPEC.md §4 Step 10
 * (BLOCKER-5). Per the `meta-pipeline-safety-incident` memory, a flag
 * that only hides UI while the underlying mutation still fires is not
 * a real gate — this test asserts on whether the mock Supabase client's
 * mutation methods (.update) were ever INVOKED, not on a return value,
 * so a false-positive pass (e.g. "no pending row found" masquerading
 * as "flag worked") is structurally impossible: every case below uses
 * the IDENTICAL qualifying mock dataset (pending row present, referee
 * has 20 distinct questions across 2 distinct UTC days, referrer
 * already has 1 prior qualified referral so this 2nd one crosses the
 * N=2 threshold) and differs ONLY in REFERRAL_EXAM_REWARD_ENABLED.
 *
 * The repo has no test framework wired up for TypeScript+alias imports
 * from a plain script (vitest exists per package.json but is
 * configured for `tests/unit/**` only, zero test files today — this
 * standalone script is the blessed path per the build spec). The
 * actual case logic lives in scripts/_referral_reward_case.mts, run
 * via `npx tsx` (which resolves the `@/*` path alias from
 * tsconfig.json) as a child process per case, so each case gets a
 * clean process.env and no cross-case state leaks.
 *
 * Run: node scripts/test_referral_reward_offstate.mjs
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function runOne(envFlag, caseName, extraEnv = {}) {
  const env = { ...process.env, TEST_CASE_NAME: caseName, ...extraEnv };
  if (envFlag === undefined) {
    delete env.REFERRAL_EXAM_REWARD_ENABLED;
  } else {
    env.REFERRAL_EXAM_REWARD_ENABLED = envFlag;
  }
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/_referral_reward_case.mts"],
    { cwd: repoRoot, env, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    console.error(`[${caseName}] child process failed (exit ${result.status}):`);
    console.error(result.stdout);
    console.error(result.stderr);
    process.exitCode = 1;
    return null;
  }
  const lastLine = result.stdout.trim().split("\n").pop();
  try {
    return JSON.parse(lastLine);
  } catch {
    console.error(`[${caseName}] could not parse child output: ${lastLine}`);
    console.error(result.stdout);
    console.error(result.stderr);
    process.exitCode = 1;
    return null;
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

console.log("=== OFF-state case (REFERRAL_EXAM_REWARD_ENABLED unset) ===");
const offResult = runOne(undefined, "flag-unset");
if (offResult) {
  assert(
    offResult.anyMutationFired === false,
    "OFF (unset): no mutation (.update) was invoked anywhere in the module"
  );
  assert(offResult.rowFlipped === false, "OFF (unset): pending row did NOT flip to qualified");
  assert(offResult.enqueued === false, "OFF (unset): no grant-review enqueue happened");
  assert(offResult.tierGranted === false, "OFF (unset): referrer tier was NOT granted");
  assert(
    offResult.grantResult &&
      offResult.grantResult.granted === false &&
      offResult.grantResult.reason === "flag_off",
    "OFF (unset): grantExamRewardToReferrer explicitly refuses with reason=flag_off"
  );
}

console.log("\n=== OFF-state case (REFERRAL_EXAM_REWARD_ENABLED='false') ===");
const offFalseResult = runOne("false", "flag-false");
if (offFalseResult) {
  assert(
    offFalseResult.anyMutationFired === false,
    "OFF ('false'): no mutation was invoked (explicit false, not just unset, also gates)"
  );
  assert(offFalseResult.rowFlipped === false, "OFF ('false'): pending row did NOT flip");
}

console.log("\n=== ON-state case (REFERRAL_EXAM_REWARD_ENABLED='true') ===");
const onResult = runOne("true", "flag-true");
if (onResult) {
  assert(
    onResult.anyMutationFired === true,
    "ON: at least one mutation was invoked (the flip + grant actually run)"
  );
  assert(
    onResult.rowFlipped === true,
    "ON: pending row DID flip to qualified (20 distinct Qs across 2 distinct days)"
  );
  assert(onResult.enqueued === true, "ON: 2nd qualifying referral enqueued the grant for review");
  assert(onResult.tierGranted === true, "ON: grantExamRewardToReferrer actually granted tier='pro'");
  assert(
    onResult.grantResult &&
      onResult.grantResult.granted === true &&
      typeof onResult.grantResult.newExpiry === "string",
    "ON: grant result reports granted=true with a real newExpiry ISO string"
  );
}

console.log(
  "\n=== Stuck-queue no-op case (ON, referrer has no active_exam) ==="
);
const stuckQueueResult = runOne("true", "stuck-queue-no-op", { NO_ACTIVE_EXAM: "1" });
if (stuckQueueResult) {
  assert(
    stuckQueueResult.enqueued === true,
    "STUCK-QUEUE: the 2nd qualifying referral still enqueues the grant for review"
  );
  assert(
    stuckQueueResult.grantResult &&
      stuckQueueResult.grantResult.granted === false &&
      stuckQueueResult.grantResult.reason === "no_active_exam",
    "STUCK-QUEUE: grant correctly no-ops with reason=no_active_exam (referrer has no active_exam)"
  );
  assert(
    stuckQueueResult.tierGranted === false,
    "STUCK-QUEUE: referrer tier was NOT granted (no-op, not a grant)"
  );
  assert(
    stuckQueueResult.queueResolved === true,
    "STUCK-QUEUE (the 2026-07-11 fix): the no-op grant RESOLVES the queue entry " +
      "(hold_reason moves off 'exam_reward_pending_review') instead of leaving " +
      "the referrer stuck in the admin queue forever with a Grant button that " +
      "always no-ops"
  );
}

// ── Card-trial gate scenarios (2026-07-11 tightening) ──────────────────
// All four cases below run with REFERRAL_EXAM_REWARD_ENABLED='true' (the
// master flag is ON) and vary ONLY the card-trial fixture + the
// REFERRAL_REQUIRE_CARD_TRIAL flag, so any pass/fail difference is
// attributable to the card gate specifically, not the master flag.

console.log(
  "\n=== Card-gate case (a): activity met, NO card trial → must NOT qualify ==="
);
const noCardResult = runOne("true", "card-gate-no-card", {
  CARD_TRIAL_FIXTURE: "none",
});
if (noCardResult) {
  assert(
    noCardResult.rowFlipped === false,
    "CARD-GATE (a): pending row did NOT flip despite 20 distinct Qs / 2 days (no card on file)"
  );
  assert(
    noCardResult.anyMutationFiredAfterQualify === false,
    "CARD-GATE (a): no mutation fired from qualifyReferralOnActivity (short-circuited before the activity check)"
  );
}

console.log(
  "\n=== Card-gate case (b): card trial + activity → qualifies ==="
);
const cardAndActivityResult = runOne("true", "card-gate-card-and-activity", {
  CARD_TRIAL_FIXTURE: "card",
});
if (cardAndActivityResult) {
  assert(
    cardAndActivityResult.rowFlipped === true,
    "CARD-GATE (b): pending row DID flip (active Whop card-rail subscription + 20 distinct Qs / 2 days)"
  );
  assert(
    cardAndActivityResult.tierGranted === true,
    "CARD-GATE (b): the full chain still completes end-to-end (referrer granted)"
  );
}

console.log(
  "\n=== Card-gate case (c): REFERRAL_REQUIRE_CARD_TRIAL='false' → activity-only fallback works ==="
);
const fallbackResult = runOne("true", "card-gate-fallback-off", {
  CARD_TRIAL_FIXTURE: "none",
  REFERRAL_REQUIRE_CARD_TRIAL: "false",
});
if (fallbackResult) {
  assert(
    fallbackResult.rowFlipped === true,
    "CARD-GATE (c): with the card requirement explicitly OFF, activity-only (no card fixture) still qualifies: proves the fallback polarity is correct, not just that the gate exists"
  );
}

console.log(
  "\n=== Card-gate case (d): legacy no-card (telegram_trial) row does NOT satisfy the gate ==="
);
const legacyResult = runOne("true", "card-gate-legacy-row", {
  CARD_TRIAL_FIXTURE: "legacy",
});
if (legacyResult) {
  assert(
    legacyResult.rowFlipped === false,
    "CARD-GATE (d): a tier='notes_free_trial'/payment_provider='trial'/payment_method='telegram_trial' row does NOT satisfy hasActiveWhopCardSubscription (fails provider AND method, not just tier)"
  );
}

if (process.exitCode === 1) {
  console.error("\nFAILED — see FAIL lines above.");
  process.exit(1);
} else {
  console.log("\nAll assertions passed.");
}
