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

/** Review H1/H2 against the real ledger SQL: refund ordering and refund-after-spend. */
const grantPay = (user: string, pkg: string, payId: string) =>
  sql(`SELECT mentor_grant_credits('${user}','${pkg}','whop_payment','${payId}',NULL,NULL,NULL,'${payId}',NULL)::text;`).then((t) => JSON.parse(t) as { ok: boolean; reason?: string; duplicate?: boolean });
const spend = async (user: string, micro: number) => {
  const id = crypto.randomUUID();
  expect(JSON.parse(await sql(`SELECT mentor_reserve('${user}','${id}',0::smallint,${micro})::text;`)).ok).toBe(true);
  await sql(`SELECT mentor_settle('${id}',0::smallint,${micro},'{}'::jsonb,true)::text;`);
};
const debtOf = async (user: string) => Number(await sql(`SELECT COALESCE((SELECT debt_micro FROM ai_credit_wallet WHERE user_id='${user}'),0);`));

describe.skipIf(!PORT)("refunds against the real ledger SQL (review H1, H2)", () => {
  it("H1: a refund that arrives before the grant tombstones the payment; the later grant is refused and no lot exists", async () => {
    const user = crypto.randomUUID();
    const pay = `pay_A_${user}`;
    expect(JSON.parse(await sql(`SELECT mentor_revoke_payment('${pay}','refund.created')::text;`))).toEqual({ ok: true, duplicate: false });
    expect(JSON.parse(await sql(`SELECT mentor_revoke_payment('${pay}','refund.created')::text;`))).toEqual({ ok: true, duplicate: true });
    expect(JSON.parse(await sql(`SELECT mentor_clawback('whop_payment','${pay}','refund.created')::text;`))).toMatchObject({ ok: false, reason: "not_found" });
    expect(await grantPay(user, "mentor_basis", pay)).toMatchObject({ ok: false, reason: "revoked" });
    expect(Number(await sql(`SELECT count(*) FROM ai_credit_lot WHERE user_id='${user}';`))).toBe(0);
    expect(JSON.parse(await sql(`SELECT mentor_balance('${user}')::text;`)).available_micro).toBe(0);
  });

  it("H1: a replayed grant of an already granted and later clawed back payment stays a duplicate, not a new lot", async () => {
    const user = crypto.randomUUID();
    const pay = `pay_A2_${user}`;
    expect(await grantPay(user, "mentor_basis", pay)).toMatchObject({ ok: true, duplicate: false });
    await sql(`SELECT mentor_revoke_payment('${pay}','refund.created')::text;`);
    await sql(`SELECT mentor_clawback('whop_payment','${pay}','refund.created')::text;`);
    expect(await grantPay(user, "mentor_basis", pay)).toMatchObject({ ok: true, duplicate: true });
    expect(Number(await sql(`SELECT count(*) FROM ai_credit_lot WHERE user_id='${user}';`))).toBe(1);
    expect(JSON.parse(await sql(`SELECT mentor_balance('${user}')::text;`)).available_micro).toBe(0);
  });

  it("H1: a grant racing a refund of the same payment never leaves credit behind (12 rounds)", async () => {
    for (let i = 0; i < 12; i++) {
      const user = crypto.randomUUID();
      const pay = `pay_RACE_${i}_${user}`;
      await Promise.all([
        grantPay(user, "mentor_basis", pay),
        // the webhook order: tombstone first, then claw back whatever the grant left
        sql(`SELECT mentor_revoke_payment('${pay}','refund.created')::text;`).then(() => sql(`SELECT mentor_clawback('whop_payment','${pay}','refund.created')::text;`)),
      ]);
      const bal = JSON.parse(await sql(`SELECT mentor_balance('${user}')::text;`));
      expect(bal.available_micro, `round ${i}`).toBe(0);
    }
  }, 60_000);

  it("H2 scenario B: refund after spending leaves the spent part as debt and the ledger reconciles", async () => {
    const user = crypto.randomUUID();
    const pay = `pay_B_${user}`;
    expect(await grantPay(user, "mentor_basis", pay)).toMatchObject({ ok: true });
    await spend(user, 700_000);
    const c = JSON.parse(await sql(`SELECT mentor_clawback('whop_payment','${pay}','refund.created')::text;`));
    expect(c).toMatchObject({ ok: true, clawed_micro: 50_000, debt_added_micro: 700_000 });
    expect(await debtOf(user)).toBe(700_000);
    const again = JSON.parse(await sql(`SELECT mentor_clawback('whop_payment','${pay}','refund.created')::text;`));
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(await debtOf(user)).toBe(700_000);
    const r = await reconcile(user);
    expect(r.ledger).toBe(r.lots - r.debt);
    // debt blocks the next reserve until a new paid lot covers it
    const id = crypto.randomUUID();
    expect(JSON.parse(await sql(`SELECT mentor_reserve('${user}','${id}',0::smallint,1000)::text;`))).toMatchObject({ ok: false, reason: "insufficient" });
    expect(await grantPay(user, "mentor_basis", `pay_B2_${user}`)).toMatchObject({ ok: true });
    expect(await debtOf(user)).toBe(0);
    expect(JSON.parse(await sql(`SELECT mentor_balance('${user}')::text;`)).available_micro).toBe(50_000);
  });

  it("H2 scenario C: buying and refunding cannot launder overrun debt", async () => {
    const user = crypto.randomUUID();
    expect(await grantPay(user, "mentor_basis", `pay_C0_${user}`)).toMatchObject({ ok: true });
    const id = crypto.randomUUID();
    await sql(`SELECT mentor_reserve('${user}','${id}',0::smallint,750000)::text;`);
    await sql(`SELECT mentor_settle('${id}',0::smallint,1050000,'{}'::jsonb,true)::text;`);
    expect(await debtOf(user)).toBe(300_000);
    const pay = `pay_C1_${user}`;
    expect(await grantPay(user, "mentor_basis", pay)).toMatchObject({ ok: true });
    expect(await debtOf(user)).toBe(0);
    await sql(`SELECT mentor_clawback('whop_payment','${pay}','refund.created')::text;`);
    expect(await debtOf(user)).toBe(300_000);
    const r = await reconcile(user);
    expect(r.ledger).toBe(r.lots - r.debt);
  });

  it("H2: a free included lot claws back the unspent part only, no debt", async () => {
    const user = crypto.randomUUID();
    await sql(`SELECT mentor_grant_credits('${user}','included_pro_monthly','pro_included','sub_${user}:0')::text;`);
    await spend(user, 100_000); // part of the 250,000 Pro slice (pricing A)
    await sql(`SELECT mentor_clawback('pro_included','sub_${user}:0','pro refund')::text;`);
    expect(await debtOf(user)).toBe(0);
    const r = await reconcile(user);
    expect(r.ledger).toBe(r.lots - r.debt);
  });
});


describe.skipIf(!PORT)("Mentor P0 money guards on real SQL", () => {
  it("MUX-39: killing after reserve leaves balance unchanged after sweep and books house_cost", async () => {
    const user = await freshUser(100_000);
    const id = crypto.randomUUID();
    const before = JSON.parse(await sql(`SELECT mentor_balance('${user}')::text;`)).available_micro;
    await sql(`SELECT mentor_reserve('${user}','${id}',0::smallint,10000)::text;`);
    await sql(`UPDATE ai_mentor_reservation SET created_at=now()-interval '16 minutes' WHERE request_id='${id}';`);
    const swept = JSON.parse(await sql(`SELECT mentor_sweep_stale(interval '15 minutes')::text;`));
    expect(swept.ok).toBe(true);
    expect(JSON.parse(await sql(`SELECT mentor_balance('${user}')::text;`)).available_micro).toBe(before);
    expect(Number(await sql(`SELECT count(*) FROM ai_usage_ledger WHERE request_id='${id}' AND kind='house_cost' AND delta_micro_usd=0;`))).toBe(1);
    expect(Number(await sql(`SELECT count(*) FROM ai_usage_ledger WHERE request_id='${id}' AND kind='settle';`))).toBe(0);
  });
  it("MUX-35/78/85: concurrent claims and purchases serialize; retry/expiry are bounded", async () => {
    const user = crypto.randomUUID(), client = crypto.randomUUID();
    // Stub users exists in the documented local scratch schema; only owner setup inserts it.
    await run(PSQL, ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", "mentor", "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", `INSERT INTO public.users(id) VALUES('${user}');`]);
    const claims = await Promise.all(Array.from({ length: 10 }, async () => JSON.parse(await sql(`SELECT mentor_claim_request('${user}','${client}','${crypto.randomUUID()}','${"a".repeat(64)}','{"lang":"de","mode":"facts"}')::text;`))));
    expect(claims.filter(c => c.claimed)).toHaveLength(1);
    expect(claims.filter(c => c.result?.status === 'in_progress')).toHaveLength(9);
    const purchases = await Promise.all(Array.from({ length: 10 }, async () => JSON.parse(await sql(`SELECT mentor_begin_purchase('${user}','mentor_basis','${crypto.randomUUID()}',false)::text;`))));
    expect(purchases.filter(p => p.ok)).toHaveLength(1);
    expect(purchases.filter(p => p.reason === 'pending_purchase')).toHaveLength(9);
    expect(JSON.parse(await sql(`SELECT mentor_begin_purchase('${user}','mentor_basis','${crypto.randomUUID()}',true)::text;`)).reason).toBe('pending_purchase');
    await sql(`UPDATE ai_mentor_purchase SET created_at=now()-interval '31 minutes' WHERE user_id='${user}';`);
    expect(JSON.parse(await sql(`SELECT mentor_begin_purchase('${user}','mentor_basis','${crypto.randomUUID()}',true)::text;`)).ok).toBe(true);
    await sql(`UPDATE ai_mentor_purchase SET expires_at=now()-interval '1 second' WHERE user_id='${user}' AND status='pending';`);
    expect(JSON.parse(await sql(`SELECT mentor_begin_purchase('${user}','mentor_basis','${crypto.randomUUID()}',false)::text;`)).ok).toBe(true);
    await sql(`INSERT INTO ai_mentor_whop_membership(membership_id,user_id,package_id,status) VALUES('mem_p0_${user}','${user}','mentor_basis','active');`);
    expect(JSON.parse(await sql(`SELECT mentor_begin_purchase('${user}','mentor_basis','${crypto.randomUUID()}',false)::text;`)).reason).toBe('already_subscribed');
    expect(JSON.parse(await sql(`SELECT mentor_begin_purchase('${user}','mentor_topup','${crypto.randomUUID()}',false)::text;`)).ok).toBe(true);
  });
});
