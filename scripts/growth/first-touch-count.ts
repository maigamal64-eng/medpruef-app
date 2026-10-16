/**
 * First touch (a-first-touch): read-only Monday read of signups and payers
 * by first-touch key and lever, the tagged share (k of n) and the same split
 * per segment at M1.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/growth/first-touch-count.ts -- [--days 7] [--json] [--out file.json]
 *
 * Service-role SELECTs only (users, user_events user_registered,
 * subscriptions), every read date-filtered and paged; no write, no send.
 * Prints keys and counts, never an id (uid8 included). Staff and test
 * accounts are excluded with the money-rules predicate. PARTNER_CODES, when
 * set, marks partner codes. Needs NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (environment, else .env.local). A guard variable
 * stops a script that re-invokes itself.
 *
 * Note for the Analyst: the scoreboard reads first touch from
 * user_events.event_data (event_type 'user_registered'; `first_touch`, else
 * `attribution`), joined on users.id::text = user_events.user_id (TEXT).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SubscriptionLike } from "@/lib/admin/money-rules";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { foldFirstTouch, firstPaidByUser, type CountUser, type RegRow } from "@/lib/first-touch/counts";
import { parsePartnerCodes } from "@/lib/partner-kit";

const PAGE = 1000;
const MAX_PAGES = 50;
const SINCE_FLOOR = "2025-01-01T00:00:00Z";
const USER_COLS = "id, created_at, email, role, tier, exam_date, active_exam, onboarding_data";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await read(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(`read failed: ${error.message ?? "unknown"}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
  throw new Error("read truncated: more than 50 pages, narrow --days");
}

type RawUser = Omit<CountUser, "ob_date" | "ob_src"> & { onboarding_data?: Record<string, unknown> | null };
function toCountUser(r: RawUser): CountUser {
  const ob = r.onboarding_data ?? {};
  return {
    id: r.id, created_at: r.created_at, email: r.email, role: r.role, tier: r.tier,
    exam_date: r.exam_date, active_exam: r.active_exam,
    ob_date: typeof ob.examDate === "string" ? ob.examDate : null,
    ob_src: typeof ob.examSource === "string" ? ob.examSource : null,
  };
}

async function readByIds<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await read(ids.slice(i, i + 200));
    if (error) throw new Error(`read failed: ${error.message ?? "unknown"}`);
    out.push(...(data ?? []));
  }
  return out;
}

/** Campaign codes (lower case); an absent table (changeset not applied) reads as none. */
async function readCampaignCodes(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb.from("ai_credit_campaign").select("code").limit(1000);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return new Set();
    throw new Error(`campaign code read failed: ${error.message ?? "unknown"}`);
  }
  return new Set(((data ?? []) as Array<{ code: string }>).map((r) => String(r.code).toLowerCase()));
}

async function collect(sb: SupabaseClient, days: number) {
  const sinceMs = Date.now() - days * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const signups = (await pageAll<RawUser>((a, b) =>
    sb.from("users").select(USER_COLS).gte("created_at", sinceIso).order("created_at").order("id").range(a, b))).map(toCountUser);
  const subs = await pageAll<SubscriptionLike>((a, b) =>
    sb.from("subscriptions")
      .select("id, user_id, tier, status, payment_provider, amount_cents, provider_payment_id, granted_payment_ids, expires_at, started_at, created_at")
      .gte("created_at", SINCE_FLOOR).in("payment_provider", ["whop", "stripe", "nowpayments"]).order("created_at").order("id").range(a, b));
  const firstPaid = firstPaidByUser(subs);
  const signupIds = new Set(signups.map((u) => u.id));
  const payerIds = [...firstPaid.entries()].filter(([, t]) => t >= sinceMs).map(([id]) => id);
  const extraPayers = (await readByIds<RawUser>(payerIds.filter((id) => !signupIds.has(id)), (chunk) =>
    sb.from("users").select(USER_COLS).in("id", chunk).gte("created_at", SINCE_FLOOR))).map(toCountUser);
  const byId = new Map<string, CountUser>([...signups, ...extraPayers].map((u) => [u.id, u]));
  const payerUsers = payerIds.map((id) => byId.get(id)).filter((u): u is CountUser => !!u);
  const regRows = await readByIds<RegRow>([...byId.keys()], (chunk) =>
    sb.from("user_events").select("user_id, created_at, event_data").eq("event_type", "user_registered").in("user_id", chunk).gte("created_at", SINCE_FLOOR));
  return foldFirstTouch({
    windowDays: days, sinceMs, signups, payerUsers, regRows, subs, sittings: OFFICIAL_SITTINGS,
    partnerCodes: new Set(parsePartnerCodes(process.env.PARTNER_CODES).map((c) => c.toLowerCase())),
    campaignCodes: await readCampaignCodes(sb),
  });
}

function text(c: Awaited<ReturnType<typeof collect>>): string {
  const lines = [
    `First touch, last ${c.window_days} days (staff and test excluded: ${c.staff_excluded})`,
    `Signups ${c.signups.n}, tagged ${c.signups.tagged_share} (untagged row ${c.signups.untagged_row}, no row ${c.signups.no_row}), payers ${c.signups.payers}`,
    ...Object.entries(c.signups.by_lever).sort((a, b) => b[1].n - a[1].n).map(([l, x]) => `  ${l.padEnd(16)} signups ${x.n}  payers ${x.payers}`),
    "Keys:",
    ...c.signups.by_key.map((k) => `  ${k.key.padEnd(32)} ${k.lever.padEnd(14)} signups ${k.signups}  payers ${k.payers}`),
    "By segment:",
    ...Object.entries(c.signups.by_segment).map(([s, g]) => `  ${s.padEnd(16)} signups ${g.n}, tagged ${g.tagged} of ${g.n}, payers ${g.payers}`),
    `New payers ${c.new_payers.n}, tagged ${c.new_payers.tagged_share} (untagged row ${c.new_payers.untagged_row}, no row ${c.new_payers.no_row})`,
    ...Object.entries(c.new_payers.by_lever).map(([l, x]) => `  ${l.padEnd(16)} ${x.n}`),
    "Analyst: read first touch from user_events.event_data (user_registered: first_touch, else attribution), join users.id::text = user_events.user_id.",
  ];
  return lines.join("\n");
}

async function main(argv: string[]): Promise<void> {
  if (process.env.MEDPRUEF_FIRST_TOUCH_COUNT_RUNNING === "1") throw new Error("recursion guard: first-touch-count is already running");
  process.env.MEDPRUEF_FIRST_TOUCH_COUNT_RUNNING = "1";
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1]) : 7;
  if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error("--days must be 1 to 365");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const counts = await collect(sb, days);
  const json = JSON.stringify({ generated_at: new Date().toISOString(), ...counts }, null, 2);
  const oi = argv.indexOf("--out");
  if (oi >= 0 && argv[oi + 1]) writeFileSync(argv[oi + 1], json + "\n");
  console.log(argv.includes("--json") ? json : text(counts));
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
