/**
 * Named future sitting coverage for the Monday scoreboard (a-sitting-one-tap).
 * READ-ONLY: SELECTs only, prints counts, never an address or a full id.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/sitting-link/coverage.ts -- [--out f.json] [--days 7]
 *
 *   accounts            every users row (baseline 15 Oct: 186)
 *   with_date           users.exam_date set
 *   future_date         exam_date on or after Vienna today
 *   named_future        future exam_date that is an official sitting date of
 *                       the account's bank (OFFICIAL_SITTINGS; baseline 25)
 *   real_*              the same without staff and test accounts
 *   link_*              user_events of the last --days days: sitting_link_open
 *                       (browser opens and automation separately),
 *                       sitting_set with source mail_link, and
 *                       reminder_optin_from_link by result
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OFFICIAL_KEYS_BY_BANK, OFFICIAL_SITTINGS, asPuypExamType, viennaToday } from "@/lib/exam-dates";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";

function loadEnvLocal() {
  const file = path.resolve(".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export interface CoverageUser { email: string | null; role: string | null; tier: string | null; active_exam: string | null; exam_date: string | null }

/** Official sitting dates (first day) per bank, unconfirmed windows included: the sitting date itself is confirmed. */
function officialDatesByBank(): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const bank of Object.keys(OFFICIAL_KEYS_BY_BANK) as Array<keyof typeof OFFICIAL_KEYS_BY_BANK>) {
    out[bank] = new Set(OFFICIAL_SITTINGS.filter((s) => OFFICIAL_KEYS_BY_BANK[bank].includes(s.exam_key)).map((s) => s.date));
  }
  return out;
}

export function coverageCounts(users: CoverageUser[], today: string) {
  const dates = officialDatesByBank();
  const c = { accounts: 0, with_date: 0, future_date: 0, named_future: 0, real_accounts: 0, real_with_date: 0, real_future_date: 0, real_named_future: 0 };
  for (const u of users) {
    const real = !isStaffOrTestAccount(u);
    const date = typeof u.exam_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(u.exam_date) ? u.exam_date : null;
    const future = !!date && date >= today;
    const bank = asPuypExamType(u.active_exam) ?? "kenntnispruefung";
    const named = future && dates[bank].has(date!);
    c.accounts++; if (date) c.with_date++; if (future) c.future_date++; if (named) c.named_future++;
    if (real) { c.real_accounts++; if (date) c.real_with_date++; if (future) c.real_future_date++; if (named) c.real_named_future++; }
  }
  return c;
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error("read failed");
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function linkEvents(sb: SupabaseClient, sinceIso: string) {
  const rows = await pageAll<{ event_type: string; event_data: Record<string, unknown> | null }>((from, to) =>
    sb.from("user_events").select("event_type, event_data")
      .in("event_type", ["sitting_link_open", "sitting_set", "reminder_optin_from_link"])
      .gte("created_at", sinceIso).order("created_at", { ascending: true }).range(from, to));
  const out = { link_open_browser: 0, link_open_automation: 0, sitting_set_mail_link: 0, sitting_set_open: 0, reminder_optin: {} as Record<string, number> };
  for (const r of rows) {
    const d = r.event_data ?? {};
    if (r.event_type === "sitting_link_open") { if (d.ua_class === "automation") out.link_open_automation++; else out.link_open_browser++; }
    if (r.event_type === "sitting_set" && d.source === "mail_link") { if (d.choice === "open") out.sitting_set_open++; else out.sitting_set_mail_link++; }
    if (r.event_type === "reminder_optin_from_link") { const k = String(d.result ?? "unknown"); out.reminder_optin[k] = (out.reminder_optin[k] ?? 0) + 1; }
  }
  return out;
}

async function main(argv: string[]) {
  if (process.env.SITTING_LINK_COVERAGE_RUNNING === "1") throw new Error("coverage is already running in this process tree");
  process.env.SITTING_LINK_COVERAGE_RUNNING = "1";
  loadEnvLocal();
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Math.max(1, Math.min(90, Number(arg("--days") ?? 7)));
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const users = await pageAll<CoverageUser>((from, to) =>
    sb.from("users").select("email, role, tier, active_exam, exam_date").order("id", { ascending: true }).range(from, to));
  const now = new Date();
  const report = {
    read_at: now.toISOString(),
    vienna_today: viennaToday(now),
    baseline_2026_10_15: { accounts: 186, with_date: 40, future_date: 25 },
    ...coverageCounts(users, viennaToday(now)),
    events_days: days,
    ...(await linkEvents(sb, new Date(now.getTime() - days * 86_400_000).toISOString())),
  };
  const text = JSON.stringify(report, null, 2);
  const out = arg("--out");
  if (out) writeFileSync(out, text + "\n");
  console.log(text);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("sitting-link", "coverage.ts"));
if (isMain) {
  main(process.argv.slice(2).filter((a) => a !== "--")).catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
