/**
 * Claim links for the release mail claim block (a-reverse-trial-claim).
 * track-A tool for the B3 render step; sends nothing and writes nothing to
 * the database.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/trial-claim/sign-links.ts -- \
 *     --in recipients.csv --out links.csv [--days 14] [--check]
 *
 * recipients.csv: one "user_id,email" per line (the address the mail goes
 * to; it is bound into the link as its sha256 key, never printed).
 * links.csv: "user_id,claim_url" for every signed recipient.
 * --check: READ-ONLY. Also reads each account (same rule as the route) and
 *   signs only recipients who may claim now; the others are listed on stderr
 *   by uid8 and reason. Needs NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY and REVERSE_TRIAL_SINCE.
 * Signing needs REMINDER_LINK_SIGNING_SECRET (environment, else .env.local),
 * the same value production verifies with.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { CLAIM_LINK_DEFAULT_DAYS, claimLinkUrl, claimLinksConfigured, signClaimToken } from "@/lib/trial-claim/token";
import { readClaimContext } from "@/lib/trial-claim/server";

function loadEnvLocal() {
  const file = path.resolve(".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export function parseRecipients(text: string): Array<{ userId: string; email: string }> {
  const out: Array<{ userId: string; email: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^user_id\s*,/i.test(line)) continue;
    const [userId, email] = line.split(",").map((s) => s.trim());
    if (userId && email) out.push({ userId, email });
  }
  return out;
}

async function main(argv: string[]) {
  // Recursion guard (lane rule): this script never starts itself or a child.
  if (process.env.TRIAL_CLAIM_SIGN_LINKS_RUNNING === "1") throw new Error("sign-links is already running in this process tree");
  process.env.TRIAL_CLAIM_SIGN_LINKS_RUNNING = "1";
  loadEnvLocal();
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const input = arg("--in");
  const output = arg("--out");
  const days = Number(arg("--days") ?? CLAIM_LINK_DEFAULT_DAYS);
  if (!input || !output) throw new Error("usage: --in recipients.csv --out links.csv [--days 14] [--check]");
  if (!claimLinksConfigured()) throw new Error("REMINDER_LINK_SIGNING_SECRET is not set (at least 32 bytes)");
  const recipients = parseRecipients(readFileSync(input, "utf8"));
  const sb = argv.includes("--check")
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } })
    : null;
  const lines = ["user_id,claim_url"];
  let skipped = 0;
  for (const r of recipients) {
    const emailKey = trialEmailKey(r.email);
    if (sb) {
      const ctx = await readClaimContext(sb, r.userId, { tokenEmailKey: emailKey });
      if (!ctx.eligible) { skipped++; console.error(`skip ${r.userId.slice(0, 8)} ${ctx.reason}`); continue; }
    }
    lines.push(`${r.userId},${claimLinkUrl(signClaimToken({ userId: r.userId, emailKey, days }))}`);
  }
  writeFileSync(output, lines.join("\n") + "\n", { mode: 0o600 });
  console.error(`signed ${lines.length - 1}, skipped ${skipped}, valid ${days} days`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("trial-claim", "sign-links.ts"));
if (isMain) {
  main(process.argv.slice(2).filter((a) => a !== "--")).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
