/**
 * Renewal pack (a-renewal-pack-1019): read-only audience preview and copy
 * render for the pre-charge renewal notice and the post-expiry mail. track-A
 * tool; nothing here runs on a schedule and nothing here sends.
 *
 *   node_modules/.bin/vite-node scripts/reminders/renewal-pack-preview.ts -- preview [--at <ISO>] [--out file.json]
 *       READ-ONLY. Runs both sweeps exactly as the cron would, with dryRun
 *       forced on: database reads, one bounded Whop membership GET per
 *       renewing membership, do-not-email status per would-be recipient. No
 *       claim, no event, no provider call. Prints user id prefixes, membership
 *       prefixes, Vienna days and counts; never an address or a name.
 *       --at evaluates the rules as of that instant (for example
 *       2026-10-27T07:00:00Z, the cron run that sends the 30 Oct notice).
 *
 *   ... -- render --dir <folder>
 *       Writes the German and English mails of both classes for a synthetic
 *       learner, for the Lektor read. No database, no Whop, no send.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and WHOP_API_KEY
 * (environment, else .env.local) for preview only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { runRenewalNotices } from "@/lib/renewal-notice/run";
import { renderRenewalNotice } from "@/lib/renewal-notice/copy";
import { runAccessEndedMails } from "@/lib/access-ended/run";
import { renderAccessEnded } from "@/lib/access-ended/copy";

function opt(argv: string[], name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function renderSamples(now: Date): Record<string, { subject: string; htmlBody: string }> {
  const charge = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const ended = new Date(now.getTime() - 86_400_000).toISOString();
  const out: Record<string, { subject: string; htmlBody: string }> = {};
  for (const lang of ["de", "en"] as const) {
    out[`renewal-notice-${lang}`] = renderRenewalNotice({ lang, chargeAtIso: charge, amountCents: 1900, intervalDays: 30, manageUrl: "https://whop.com/@me/settings/memberships" });
    out[`access-ended-${lang}`] = renderAccessEnded({ lang, endedAtIso: ended, answered: 58, activeExam: "kmp_innsbruck" });
    out[`access-ended-${lang}-other-bank`] = renderAccessEnded({ lang, endedAtIso: ended, answered: 0, activeExam: "kenntnispruefung" });
  }
  return out;
}

async function main(argv: string[]): Promise<number> {
  const mode = argv.find((a) => !a.startsWith("--")) ?? "preview";
  loadEnvLocal();

  if (mode === "render") {
    const dir = opt(argv, "dir");
    if (!dir) { process.stderr.write("render needs --dir <folder>\n"); return 2; }
    mkdirSync(dir, { recursive: true });
    for (const [name, mail] of Object.entries(renderSamples(new Date()))) {
      writeFileSync(path.join(dir, `${name}.html`), `<!-- Subject: ${mail.subject} -->\n${mail.htmlBody}\n`);
    }
    process.stdout.write(`rendered both classes (DE and EN) into ${dir}\n`);
    return 0;
  }

  if (mode === "preview") {
    const atArg = opt(argv, "at");
    const now = atArg ? new Date(atArg) : new Date();
    if (!Number.isFinite(now.getTime())) { process.stderr.write("--at needs an ISO instant\n"); return 2; }
    const sb = client() as never;
    const noop = async () => {};
    const renewal = await runRenewalNotices(sb, { now, dryRun: true, recordEvent: noop });
    const ended = await runAccessEndedMails(sb, { now, dryRun: true, recordEvent: noop });
    const text = `${JSON.stringify({ generated_at: new Date().toISOString(), evaluated_at: now.toISOString(), renewal_notice: renewal, access_ended: ended }, null, 2)}\n`;
    const out = opt(argv, "out");
    if (out) writeFileSync(out, text);
    process.stdout.write(text);
    return 0;
  }

  process.stderr.write(`unknown mode ${mode}\n`);
  return 2;
}

// vite-node puts its own binary in argv[1]; run unless imported by a test.
if (!process.env.VITEST) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`renewal-pack-preview: ${String((err as Error)?.message ?? err)}\n`);
      process.exit(2);
    },
  );
}
