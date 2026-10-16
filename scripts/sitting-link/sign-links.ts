/**
 * One-tap sitting links for learner mails (a-sitting-one-tap). track-A tool
 * for the mail render step; sends nothing and writes nothing.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/sitting-link/sign-links.ts -- \
 *     --in recipients.csv --out links.csv [--days 21] [--lang de|en] [--no-check]
 *
 * recipients.csv: one "user_id,email[,lang]" per line (the address the mail
 * goes to; it is bound into the link as its sha256 key, never printed).
 * links.csv: "user_id,sitting_url" for every signed recipient.
 * By default (READ-ONLY) it reads each account and skips banned, missing, staff or
 *   test accounts and addresses that no longer match (listed on stderr by
 *   uid8 and reason). Needs NEXT_PUBLIC_SUPABASE_URL and
 *   SUPABASE_SERVICE_ROLE_KEY. The mail step still sends through
 *   sendUnlessSuppressed (do-not-email list).
 * Signing needs REMINDER_LINK_SIGNING_SECRET (environment, else .env.local),
 * the same value production verifies with.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { SITTING_LINK_DEFAULT_DAYS, signSittingToken, sittingLinkUrl, sittingLinksConfigured, type SittingLinkLang } from "@/lib/sitting-link/token";

function loadEnvLocal() {
  const file = path.resolve(".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export interface Recipient { userId: string; email: string; lang: SittingLinkLang | null }

export function parseRecipients(text: string): Recipient[] {
  const out: Recipient[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^user_id\s*,/i.test(line)) continue;
    const [userId, email, lang] = line.split(",").map((s) => s.trim());
    if (userId && email) out.push({ userId, email, lang: lang === "de" || lang === "en" ? lang : null });
  }
  return out;
}

async function main(argv: string[]) {
  // Recursion guard (lane rule): this script never starts itself or a child.
  if (process.env.SITTING_LINK_SIGN_RUNNING === "1") throw new Error("sign-links is already running in this process tree");
  process.env.SITTING_LINK_SIGN_RUNNING = "1";
  loadEnvLocal();
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const input = arg("--in");
  const output = arg("--out");
  const days = Number(arg("--days") ?? SITTING_LINK_DEFAULT_DAYS);
  const defaultLang: SittingLinkLang = arg("--lang") === "en" ? "en" : "de";
  if (!input || !output) throw new Error("usage: --in recipients.csv --out links.csv [--days 21] [--lang de|en] [--no-check]");
  if (!sittingLinksConfigured()) throw new Error("REMINDER_LINK_SIGNING_SECRET is not set (at least 32 bytes)");
  const recipients = parseRecipients(readFileSync(input, "utf8"));
  // --no-check signs without reading the accounts (offline fixtures only).
  const sb = !argv.includes("--no-check")
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } })
    : null;
  const lines = ["user_id,sitting_url"];
  let skipped = 0;
  for (const r of recipients) {
    const emailKey = trialEmailKey(r.email);
    if (sb) {
      const { data, error } = await sb.from("users").select("email, role, tier, is_banned").eq("id", r.userId).maybeSingle();
      if (error) throw new Error(`read failed for ${r.userId.slice(0, 8)}`);
      const reason = !data ? "missing" : data.is_banned ? "banned" : isStaffOrTestAccount(data) ? "staff_or_test" : trialEmailKey(data.email) !== emailKey ? "address_changed" : null;
      if (reason) { skipped++; console.error(`skip ${r.userId.slice(0, 8)} ${reason}`); continue; }
    }
    lines.push(`${r.userId},${sittingLinkUrl(signSittingToken({ userId: r.userId, emailKey, days }), r.lang ?? defaultLang)}`);
  }
  writeFileSync(output, lines.join("\n") + "\n", { mode: 0o600 });
  console.error(`signed ${lines.length - 1}, skipped ${skipped}, valid ${days} days`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("sitting-link", "sign-links.ts"));
if (isMain) {
  main(process.argv.slice(2).filter((a) => a !== "--")).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
