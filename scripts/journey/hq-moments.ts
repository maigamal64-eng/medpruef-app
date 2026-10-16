/**
 * HQ journey export (a-journey-engine, hq-v2-spec 5.3 `moments`): prints the
 * upcoming official moments as JSON, from the same library the app uses.
 * Read-only, no network, no database. Run:
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/journey/hq-moments.ts [-- --now 2026-10-15T10:00:00Z]
 * HQ may read this instead of parsing exam-dates.ts by regex.
 */
import { journeyMomentsForHq } from "../../src/lib/journey/moments";

const READ_ON_NOTE =
  "Dates come only from OFFICIAL_SITTINGS in src/lib/exam-dates.ts; read_on is the day the official source was read. results_window and t_minus_28 are derived spans, not published dates (sourced:false).";

if (process.env.MP_JOURNEY_HQ_RUNNING === "1") {
  // Recursion guard: this script never spawns itself.
  process.exit(0);
}
process.env.MP_JOURNEY_HQ_RUNNING = "1";

const i = process.argv.indexOf("--now");
const now = i > -1 && process.argv[i + 1] ? new Date(process.argv[i + 1]) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("--now must be an ISO timestamp");
  process.exit(2);
}
process.stdout.write(
  JSON.stringify({ schema: 2, doc: "journey.moments", generated_at: now.toISOString(), note: READ_ON_NOTE, moments: journeyMomentsForHq(now) }, null, 1) + "\n",
);
