/**
 * Access-ending reminder (a46): audience preview, copy render and owner
 * self-delivery. track-A tool; nothing here runs on a schedule.
 *
 *   node_modules/.bin/vite-node scripts/reminders/access-ending-preview.ts -- preview [--out file.json]
 *       READ-ONLY. The exact audience a sending run would act on right now
 *       (same code as /api/cron/trial-reminder), with every decision and the
 *       do-not-email status of each would-be recipient. Prints user id
 *       prefixes, Vienna dates and counts; never an address or a name.
 *
 *   ... -- render --dir <folder>
 *       Writes the German and English mail for a synthetic learner, for the
 *       copy read. No database, no send.
 *
 *   SELF_SEND_CONFIRM=yes ... -- self-send --to <owner address> [--lang de|en] [--expect sent|suppressed]
 *       SENDS ONE MAIL to the owner's own address through the same guarded
 *       path as the cron (do-not-email list checked first, category
 *       marketing). Only @medpruf.com / @medpruef.com addresses are accepted.
 *       With --expect suppressed it proves an opt-out: add the owner address
 *       to mail_suppression first, run, and the result must be "suppressed"
 *       with no provider call. Exit code 3 when the result differs.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment,
 * else .env.local); self-send also needs the ZOHO_* mail env.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { previewAccessEndingAudience } from "@/lib/reminders/access-ending";
import { renderAccessEndingReminder } from "@/lib/email/access-ending-template";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";

const OWNER_DOMAINS = ["@medpruf.com", "@medpruef.com"];

export function isOwnerAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(a) && OWNER_DOMAINS.some((d) => a.endsWith(d));
}

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

function sample(lang: "de" | "en", now: Date) {
  return renderAccessEndingReminder({
    firstName: "Mira",
    lang,
    accessEndsAtIso: new Date(now.getTime() + 9 * 86_400_000).toISOString(),
    qsAnswered: 420,
    accuracyPct: 71,
    streakDays: 5,
    now,
  });
}

async function main(argv: string[]): Promise<number> {
  const mode = argv.find((a) => !a.startsWith("--")) ?? "preview";
  loadEnvLocal();
  const now = new Date();

  if (mode === "render") {
    const dir = opt(argv, "dir");
    if (!dir) {
      process.stderr.write("render needs --dir <folder>\n");
      return 2;
    }
    mkdirSync(dir, { recursive: true });
    for (const lang of ["de", "en"] as const) {
      const mail = sample(lang, now);
      writeFileSync(path.join(dir, `access-ending-${lang}.html`), mail.htmlBody);
      writeFileSync(path.join(dir, `access-ending-${lang}.subject.txt`), `${mail.subject}\n`);
    }
    process.stdout.write(`rendered DE and EN into ${dir}\n`);
    return 0;
  }

  if (mode === "preview") {
    const report = await previewAccessEndingAudience(client() as never, now);
    const text = `${JSON.stringify(report, null, 2)}\n`;
    const out = opt(argv, "out");
    if (out) writeFileSync(out, text);
    process.stdout.write(text);
    return 0;
  }

  if (mode === "self-send") {
    const to = opt(argv, "to");
    const lang = opt(argv, "lang") === "en" ? "en" : "de";
    const expect = opt(argv, "expect");
    if (process.env.SELF_SEND_CONFIRM !== "yes") {
      process.stderr.write("self-send sends a real mail: set SELF_SEND_CONFIRM=yes\n");
      return 2;
    }
    if (!to || !isOwnerAddress(to)) {
      process.stderr.write("self-send only mails an owner address (@medpruf.com or @medpruef.com)\n");
      return 2;
    }
    const mail = sample(lang, now);
    const result = await sendUnlessSuppressed(client() as never, "marketing", { to, subject: mail.subject, htmlBody: mail.htmlBody });
    const outcome = result.ok ? "sent" : result.reason;
    process.stdout.write(`${JSON.stringify({ at: now.toISOString(), lang, outcome, subject: mail.subject })}\n`);
    if (expect && expect !== outcome) return 3;
    return result.ok || outcome === "suppressed" ? 0 : 1;
  }

  process.stderr.write(`unknown mode ${mode}\n`);
  return 2;
}

// vite-node puts its own binary in argv[1]; run unless imported by a test.
if (!process.env.VITEST) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`access-ending-preview: ${String((err as Error)?.message ?? err)}\n`);
      process.exit(2);
    },
  );
}
