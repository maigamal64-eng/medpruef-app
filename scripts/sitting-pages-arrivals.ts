/**
 * Sitting pages: arrivals per page. READ-ONLY, counts only.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/sitting-pages-arrivals.ts -- [--days 7] [--json]
 *
 * Reads landing_hits rows written by the arrival beacon (utm_source "arrival",
 * utm_medium "organic", utm_campaign "sitting:<slug>") and prints one count per
 * page. The Monday scoreboard calls it with --json. No ids, no addresses.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment,
 * else .env.local). Only SELECTs.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sittingPages } from "../src/lib/sitting-pages";

export interface HitRow { utm_source: string | null; utm_campaign: string | null }

/** Pure: arrivals per sitting slug, most first. Anything else (and, when given, any slug not in knownSlugs) is ignored. */
export function countSittingArrivals(rows: readonly HitRow[], knownSlugs?: ReadonlySet<string>): { slug: string; arrivals: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.utm_source !== "arrival") continue;
    const m = /^sitting:([a-z0-9][a-z0-9_-]{0,79})$/.exec(r.utm_campaign ?? "");
    if (m && (!knownSlugs || knownSlugs.has(m[1]))) by.set(m[1], (by.get(m[1]) ?? 0) + 1);
  }
  return [...by].map(([slug, arrivals]) => ({ slug, arrivals })).sort((a, b) => b.arrivals - a.arrivals || a.slug.localeCompare(b.slug));
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

const PAGE = 1000;
const MAX_ROWS = 100_000;

async function main(argv: string[]): Promise<number> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { process.stderr.write("sitting-pages-arrivals: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n"); return 2; }
  const i = argv.indexOf("--days");
  const n = i >= 0 ? Number(argv[i + 1]) : 7;
  const days = Number.isInteger(n) && n > 0 ? n : 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows: HitRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db.from("landing_hits").select("utm_source, utm_campaign")
      .eq("utm_source", "arrival").like("utm_campaign", "sitting:%").gte("at", since)
      .order("at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { process.stderr.write(`sitting-pages-arrivals: landing_hits read failed (${error.code ?? "unknown"}).\n`); return 1; }
    rows.push(...((data ?? []) as HitRow[]));
    if (!data || data.length < PAGE) break;
    if (from + PAGE >= MAX_ROWS) { process.stderr.write("sitting-pages-arrivals: row cap reached; counts would be short, refusing.\n"); return 1; }
  }
  // Only real pages count: anyone can write a sitting:<token> hit, so unknown slugs are dropped.
  const counts = countSittingArrivals(rows, new Set(sittingPages().map((p) => p.slug)));
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ since, days, total: counts.reduce((a, c) => a + c.arrivals, 0), pages: counts })}\n`);
  } else {
    process.stdout.write(`# sitting page arrivals, last ${days} days (since ${since})\nslug\tarrivals\n`);
    for (const c of counts) process.stdout.write(`${c.slug}\t${c.arrivals}\n`);
    process.stdout.write(`# ${counts.length} pages with arrivals\n`);
  }
  return 0;
}

if (process.argv[1] && path.basename(process.argv[1]).startsWith("sitting-pages-arrivals")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`sitting-pages-arrivals: ${String((err as Error)?.message ?? err)}\n`); process.exit(2); },
  );
}
