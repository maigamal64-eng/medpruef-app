/**
 * Win-back credits (J11): read-only preview of what the daily grant run would
 * do right now, whatever REWARDS_WINBACK_ENABLED says. track-A tool for the
 * switch-on decision; nothing here runs on a schedule.
 *
 *   node_modules/.bin/vite-node scripts/rewards/winback-preview.ts -- [--out file.json]
 *
 * Same code as /api/cron/trial-reminder step 4 (loadWinbackCandidates,
 * loadWinbackFacts, decideWinback). Prints user id prefixes, decisions and
 * Vienna end days; never an address or a name. No grant, no event, no write.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment,
 * else .env.local); mentor reach follows the MENTOR_* env of the shell.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { previewWinbackGrants } from "@/lib/mentor/credits/winback";
import { readMentorConfig } from "@/lib/mentor/config";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function main(argv: string[]): Promise<void> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const preview = await previewWinbackGrants(sb, new Date(), readMentorConfig());
  const json = JSON.stringify(preview, null, 2);
  const i = argv.indexOf("--out");
  if (i >= 0 && argv[i + 1]) writeFileSync(argv[i + 1], json + "\n");
  console.log(json);
}

main(process.argv.slice(2)).catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
