/**
 * W2-CORE against the REAL ledger SQL on a LOCAL scratch Postgres (never
 * production). Skipped unless MENTOR_PG_PORT is set. Every psql process is a
 * separate connection, so concurrent calls race for real.
 *
 *   MENTOR_PG_PORT=55434 npx vitest run tests/unit/mentor/core/pg-integration.test.ts
 *
 * Setup: reports/plan-2026-10-10/mentor-race/README.md (R2 files, then the
 * ledger migration, on an empty local database).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { AiEmptyText, AiTimeout, AiUpstream } from "@/lib/ai/anthropic";
import type { RpcClient } from "@/lib/ai/limits";
import { checkMentorBreaker, takeMentorAttempt } from "@/lib/mentor/guard";
import { intOrNull } from "@/lib/mentor/ledger";
import { createHousePolicy, createMeter } from "@/lib/mentor/meter";
import type { Wallet } from "@/lib/mentor/seam";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { collect, config, makeDeps, scriptedClaude, turnInput, usage, type Step } from "./helpers";

const PORT = process.env.MENTOR_PG_PORT;
const PSQL = process.env.MENTOR_PSQL ?? "/opt/homebrew/bin/psql";
const run = promisify(execFile);

const ARG_TYPES: Record<string, string> = {
  p_user: "uuid",
  p_request: "uuid",
  p_call_index: "smallint",
  p_ceiling_micro: "bigint",
  p_input_micro: "bigint",
  p_actual_micro: "bigint",
  p_usage: "jsonb",
  p_bill_user: "boolean",
  p_per_min: "integer",
  p_per_day: "integer",
  p_limit: "integer",
  p_older_than: "interval",
  p_month: "text",
  p_floor_micro: "bigint",
  p_net_pct: "numeric",
};

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

async function sql(query: string): Promise<string> {
  const { stdout } = await run(PSQL, ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", "mentor", "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", `SET ROLE service_role; ${query}`]);
  return stdout.trim();
}

/** PostgREST-shaped RpcClient over psql (one connection per call). */
const pg: RpcClient = {
  async rpc(fn, args = {}) {
    const named = Object.entries(args)
      .map(([k, v]) => `${k} => ${lit(v)}::${ARG_TYPES[k] ?? "text"}`)
      .join(", ");
    try {
      const out = await sql(`SELECT public.${fn}(${named})::text;`);
      return { data: JSON.parse(out), error: null };
    } catch (err) {
      return { data: null, error: { message: String((err as Error).message).slice(0, 200) } };
    }
  },
};

/** Test-only wallet over mentor_balance (the real Wallet is W2-CREDITS). */
function pgWallet(): Wallet {
  return {
    async ensureIncludedGrants() {},
    async balance(userId) {
      const { data, error } = await pg.rpc("mentor_balance", { p_user: userId });
      if (error) throw new Error("balance failed");
      const b = data as Record<string, unknown>;
      return {
        availableMicro: intOrNull(b.available_micro) ?? 0,
        lotsMicro: intOrNull(b.lots_micro) ?? 0,
        reservedMicro: intOrNull(b.reserved_micro) ?? 0,
        debtMicro: intOrNull(b.debt_micro) ?? 0,
        nextExpiry: (b.next_expiry as string | null) ?? null,
        everGranted: b.ever_granted === true,
        lots: [],
      };
    },
    async avgMessageCostMicro() {
      return null;
    },
    async accessSources() {
      return ["gift"];
    },
  };
}

async function freshUser(grantMicro: number): Promise<string> {
  const user = crypto.randomUUID();
  if (grantMicro > 0) {
    const out = await sql(`SELECT (mentor_grant_credits('${user}','gift_admin','admin_gift','it-${user}',${grantMicro}))->>'ok';`);
    expect(out).toBe("true");
  }
  return user;
}

async function reconcile(user: string) {
  const row = await sql(`
    SELECT json_build_object(
      'ledger', (SELECT COALESCE(SUM(delta_micro_usd),0) FROM ai_usage_ledger WHERE user_id='${user}'),
      'lots', (SELECT COALESCE(SUM(granted_micro - spent_micro - clawed_back_micro),0) FROM ai_credit_lot WHERE user_id='${user}'),
      'debt', (SELECT COALESCE(debt_micro,0) FROM ai_credit_wallet WHERE user_id='${user}'),
      'reserved', (SELECT COALESCE(reserved_micro,0) FROM ai_credit_wallet WHERE user_id='${user}'),
      'open', (SELECT count(*) FROM ai_mentor_reservation WHERE user_id='${user}' AND status='open'),
      'spend', (SELECT COALESCE(SUM(cost_micro),0) FROM ai_usage_ledger WHERE user_id='${user}' AND kind IN ('settle','house_cost'))
    )::text;`);
  return JSON.parse(row) as { ledger: number; lots: number; debt: number; reserved: number; open: number; spend: number };
}

describe.skipIf(!PORT)("W2-CORE on the real ledger SQL (local Postgres)", () => {
  it(
    "40 concurrent reserves through createMeter: exactly 3 fit, holds exact, double settles idempotent",
    async () => {
      const user = await freshUser(100_000);
      const meter = createMeter(pg, user);
      const ids = Array.from({ length: 40 }, () => crypto.randomUUID());
      const results = await Promise.all(ids.map((id) => meter.reserve(id, 0, 30_000)));
      const okIds = ids.filter((_, i) => results[i].ok);
      expect(okIds).toHaveLength(3);
      expect(results.filter((r) => !r.ok).every((r) => r.reason === "insufficient")).toBe(true);
      expect((await reconcile(user)).reserved).toBe(90_000);
      const settles = await Promise.all(okIds.flatMap((id) => [0, 1].map(() => meter.settle(id, 0, 25_000, usage(1, 1), true))));
      expect(settles.every((s) => s.ok)).toBe(true);
      expect(settles.filter((s) => s.duplicate)).toHaveLength(3);
      const r = await reconcile(user);
      expect(r).toMatchObject({ reserved: 0, open: 0, spend: 75_000, debt: 0 });
      expect(r.ledger).toBe(r.lots - r.debt);
      console.log(`[race] ok=${okIds.length} insufficient=${40 - okIds.length} reconcile=${JSON.stringify(r)}`);
    },
    60_000,
  );

  it(
    "full turns (mixed outcomes, 8 of them concurrent) reconcile to the micro-USD",
    async () => {
      const user = await freshUser(2_000_000);
      const turn = createRunMentorTurn({ alert: () => {} });
      const scripts: Step[][] = [
        [{ text: "ok", usage: usage(1500, 300) }],
        [{ text: "", toolUses: [{ id: "t", name: "search_facts" }], usage: usage(900, 60) }, { text: "ok", usage: usage(2000, 250) }],
        [{ throw: new AiUpstream("529", { reachedModel: false, status: 529 }) }],
        [{ throw: new AiTimeout("t", {}) }],
        [{ throw: new AiEmptyText("e", { usage: usage(700, 20), stop_reason: null, blocks: [] }) }],
      ];
      const oneTurn = async (i: number) => {
        const env = makeDeps(scripts[i % scripts.length], { grantMicro: 0 });
        env.deps.meter = createMeter(pg, user);
        env.deps.house = createHousePolicy(pg, 2);
        env.deps.wallet = pgWallet();
        env.deps.callClaude = scriptedClaude(scripts[i % scripts.length]).fn;
        return collect(turn(env.deps, turnInput({ userId: user, requestId: crypto.randomUUID() })));
      };
      const sequential: string[] = [];
      for (let i = 0; i < 10; i++) sequential.push(((await oneTurn(i)).at(-1) as { type: string }).type);
      const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => oneTurn(i)));
      expect(sequential.filter((t) => t === "final")).toHaveLength(4);
      expect(concurrent.every((ev) => ev.length > 0)).toBe(true);
      const r = await reconcile(user);
      expect(r.reserved).toBe(0);
      expect(r.open).toBe(0);
      expect(r.ledger).toBe(r.lots - r.debt);
      const houseRows = Number(await sql(`SELECT count(*) FROM ai_usage_ledger WHERE user_id='${user}' AND kind='house_cost';`));
      expect(houseRows).toBe(2); // house_fail_take limit 2 per Vienna day, then the user pays
      const releases = Number(await sql(`SELECT count(*) FROM ai_usage_ledger WHERE user_id='${user}' AND kind='release';`));
      expect(releases).toBeGreaterThanOrEqual(3);
      console.log(`[turns] sequential=${sequential.join(",")} reconcile=${JSON.stringify(r)} house_rows=${houseRows} releases=${releases}`);
    },
    120_000,
  );

  it("attempt limit and breaker against the real functions", async () => {
    const user = await freshUser(0);
    const cfg = config({ ratePerMin: 2, ratePerDay: 60 });
    const now = new Date();
    expect(await takeMentorAttempt(pg, cfg, user, now)).toBeNull();
    expect(await takeMentorAttempt(pg, cfg, user, now)).toBeNull();
    const third = await takeMentorAttempt(pg, cfg, user, now);
    // Two calls can straddle a UTC minute boundary; then the third is allowed.
    if (third) expect(third).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect(await checkMentorBreaker(pg, config(), now)).toBeNull();
    expect(await checkMentorBreaker(pg, config({ globalMonthlyCapFloorMicro: 1 }), now)).toMatchObject({ status: 503, body: { error: "global_cap" } });
  }, 30_000);
});
