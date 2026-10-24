import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-card-trial proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:card-trial): 20270115090000 adds flex_month_trial to the
// production fourteen-tier CHECK, is idempotent, keeps every existing row
// valid, and down.sql refuses while 3-day trial rows exist, then restores the
// fourteen tiers plus seed_seat; a_seed_seats (unapplied) keeps the tier in
// either order.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.CARD_TRIAL_DATABASE_TESTS === "1";
const PORT = "55473";
let pgBin = "";
function discoverPgBin() {
  if (process.env.CARD_TRIAL_PG_BIN) return resolve(process.env.CARD_TRIAL_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set CARD_TRIAL_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20270115090000_a_card_trial.sql");
const down = read("scripts/sql/track-a/a-card-trial/down.sql");
const seedSeats = read("supabase/migrations/20270105090000_a_seed_seats.sql");
const seedDown = read("scripts/sql/track-a/a-seed-seats/down.sql");
const PRICING_V2_TIERS = ["premium_pass_guaranteed", "monthly", "three_month", "six_month", "twelve_month", "first_month_19", "first_3mo_27",
  "notes_free_trial", "notes_pro_trial", "flex_month", "sitting_pass", "half_year", "guarantee_ticket", "reverse_trial"];

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
const psqlArgs = () => ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"];
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", psqlArgs(), text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const USER = "00000000-0000-4000-8000-000000000001";
const insert = (tier: string) => sql(`INSERT INTO public.subscriptions (user_id, tier, status) VALUES ('${USER}', '${tier}', 'active');`, true);

describe.skipIf(!databaseEnabled)("a-card-trial migration on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "card-trial-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(`CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, tier text NOT NULL, status text NOT NULL);
      ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_tier_check CHECK (tier = ANY (ARRAY[${PRICING_V2_TIERS.map((t) => `'${t}'`).join(",")}]));
      INSERT INTO public.subscriptions (user_id, tier, status) SELECT '${USER}', t, 'expired' FROM unnest(ARRAY[${PRICING_V2_TIERS.map((t) => `'${t}'`).join(",")}]) t;`);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("refuses the 3-day trial tier before the migration (the 23514 the app would hit)", () => {
    const r = insert("flex_month_trial");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/subscriptions_tier_check/);
  });

  it("allows flex_month_trial, keeps every existing tier valid, rejects unknown tiers, re-runs cleanly", () => {
    sql(migration);
    sql(migration);
    expect(insert("flex_month_trial").status).toBe(0);
    for (const t of PRICING_V2_TIERS) expect(insert(t).status, t).toBe(0);
    expect(insert("free_trial_forever").status).not.toBe(0);
    expect(rows(`SELECT count(*) FROM pg_constraint WHERE conname = 'subscriptions_tier_check';`)).toBe("1");
  });

  it("the later seed-seats migration and its rollback keep the 3-day trial tier", () => {
    // Only the tier CHECK section of a_seed_seats matters here: replay it alone.
    const checkOnly = (text: string) => text.slice(text.indexOf("ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;"))
      .split(/\);\n/)[0] + ");";
    sql(checkOnly(seedSeats));
    expect(insert("flex_month_trial").status).toBe(0);
    expect(insert("seed_seat").status).toBe(0);
    sql(`DELETE FROM public.subscriptions WHERE tier = 'seed_seat';`);
    sql(checkOnly(seedDown));
    expect(insert("flex_month_trial").status).toBe(0);
    sql(migration);
  });

  it("seed seats applied before the card trial keeps seed_seat allowed (Reviewer P2)", () => {
    const checkOnly = (text: string) => text.slice(text.indexOf("ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;"))
      .split(/\);\n/)[0] + ");";
    sql(checkOnly(seedDown));
    sql(`DELETE FROM public.subscriptions WHERE tier IN ('flex_month_trial', 'seed_seat');`);
    sql(down);
    sql(checkOnly(seedSeats));
    expect(insert("seed_seat").status).toBe(0);
    sql(migration);
    expect(insert("seed_seat").status).toBe(0);
    expect(insert("flex_month_trial").status).toBe(0);
    sql(`DELETE FROM public.subscriptions WHERE tier = 'seed_seat';`);
  });

  it("down.sql refuses while 3-day trial rows exist, then restores the fourteen tiers", () => {
    const refused = sql(down, true);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/rollback refused/);
    expect(insert("flex_month_trial").status).toBe(0);
    sql(`DELETE FROM public.subscriptions WHERE tier = 'flex_month_trial';`);
    sql(down);
    sql(down);
    expect(insert("flex_month_trial").status).not.toBe(0);
    for (const t of [...PRICING_V2_TIERS, "seed_seat"]) expect(insert(t).status, t).toBe(0);
  });
});
