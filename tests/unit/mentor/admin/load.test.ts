import { describe, expect, it } from "vitest";
import {
  fetchAllPages,
  isMissingRelation,
  loadSummaryInputs,
  MAX_PAGES,
  MentorAdminLoadError,
  monthRangeIso,
  PAGE_SIZE,
} from "@/app/api/mentor/admin/summary/load";
import { buildAdminSummary } from "@/app/api/mentor/admin/summary/aggregate";
import { CLAWBACK, CONFIG, NOW, R1, U1, U2 } from "./fixtures";
import { stubClient, type StubOptions } from "./stub-client";

const ledgerRow = (i: number, over: Record<string, unknown> = {}) => ({
  id: i,
  user_id: U1,
  kind: "settle",
  cost_micro: 1,
  hold_micro: -4_000,
  request_id: `req-${i}`,
  model: "claude-haiku-5-5",
  input_tokens: 1,
  output_tokens: 1,
  cache_read_tokens: 0,
  created_at: "2026-10-05T10:00:00.000Z",
  ...over,
});

function base(over: Partial<StubOptions["tables"]> = {}, rpc: StubOptions["rpc"] = undefined): StubOptions {
  return {
    tables: { ai_usage_ledger: [], ai_credit_lot: [], ai_mentor_reservation: [], ai_credit_wallet: [], flags: [], ...over },
    rpc: rpc ?? { ai_spend_month: { data: 7_000_000 }, ai_spend_cap: { data: 50_000_000 } },
  };
}

describe("paging", () => {
  it("reads every page of a month with more than 1,000 ledger rows (PostgREST clips at 1,000)", async () => {
    const rows = Array.from({ length: 2_503 }, (_, i) => ledgerRow(i + 1));
    const { client, log } = stubClient(base({ ai_usage_ledger: rows }));
    const inputs = await loadSummaryInputs(client, CONFIG, NOW);
    expect(inputs.ledger).toHaveLength(2_503);
    expect(buildAdminSummary(inputs).spend.mentor_micro).toBe(2_503);
    const ranges = log.queries.filter((q) => q.table === "ai_usage_ledger" && q.range).map((q) => q.range);
    expect(ranges).toEqual([[0, 999], [1_000, 1_999], [2_000, 2_999]]);
  });

  it("stops at a short page", async () => {
    let calls = 0;
    const rows = await fetchAllPages<number>(async () => {
      calls++;
      return { data: Array.from({ length: 10 }, () => 1), error: null };
    });
    expect(rows).toHaveLength(10);
    expect(calls).toBe(1);
  });

  it("asks for one more page after an exactly full page, then stops on the empty one", async () => {
    const pages = [PAGE_SIZE, PAGE_SIZE, 0];
    let calls = 0;
    const rows = await fetchAllPages<number>(async () => ({
      data: Array.from({ length: pages[calls++] }, () => 1),
      error: null,
    }));
    expect(rows).toHaveLength(2 * PAGE_SIZE);
    expect(calls).toBe(3);
  });

  it("FAILS with row_cap_reached instead of returning a short total", async () => {
    let calls = 0;
    const p = fetchAllPages<number>(async () => {
      calls++;
      return { data: Array.from({ length: PAGE_SIZE }, () => 1), error: null };
    });
    await expect(p).rejects.toMatchObject({ name: "MentorAdminLoadError", code: "row_cap_reached" });
    expect(calls).toBe(MAX_PAGES);
  });
});

describe("what it reads", () => {
  it("reads only settle and house_cost rows inside the UTC month (end exclusive)", async () => {
    const rows = [
      ledgerRow(1, { created_at: "2026-09-30T23:59:59.999Z" }), // last month
      ledgerRow(2, { created_at: "2026-10-01T00:00:00.000Z" }), // first instant
      ledgerRow(3, { kind: "house_cost" }),
      ledgerRow(4, { kind: "grant" }),
      ledgerRow(5, { kind: "reserve" }),
      ledgerRow(6, { kind: "clawback" }),
      ledgerRow(7, { created_at: "2026-11-01T00:00:00.000Z" }), // next month
    ];
    const { client } = stubClient(base({ ai_usage_ledger: rows }));
    const inputs = await loadSummaryInputs(client, CONFIG, NOW);
    expect(inputs.month).toBe("2026-10");
    expect(inputs.ledger.map((r) => r.kind).sort()).toEqual(["house_cost", "settle"]);
    expect(inputs.ledger).toHaveLength(2);
  });

  it("reads clawbacks newest first, stale open reservations only, and wallets with debt only", async () => {
    const { client } = stubClient(
      base({
        ai_usage_ledger: [
          { id: 1, kind: "clawback", lot_id: "l1", user_id: U1, package_id: "mentor_basis", delta_micro_usd: -1, created_at: "2026-10-01T00:00:00Z" },
          { id: 2, kind: "clawback", lot_id: "l2", user_id: U2, package_id: "mentor_plus", delta_micro_usd: -2, created_at: "2026-10-02T00:00:00Z" },
        ],
        ai_mentor_reservation: [
          { request_id: "fresh", call_index: 0, user_id: U1, ceiling_micro: 1, status: "open", created_at: "2026-10-14T11:50:00.000Z" }, // 10 min: not stale
          { request_id: "stale", call_index: 0, user_id: U1, ceiling_micro: 1, status: "open", created_at: "2026-10-14T11:44:00.000Z" }, // 16 min: stale
          { request_id: "done", call_index: 0, user_id: U1, ceiling_micro: 1, status: "settled", created_at: "2026-10-14T08:00:00.000Z" },
        ],
        ai_credit_wallet: [
          { user_id: U1, debt_micro: 0 },
          { user_id: U2, debt_micro: 1_500 },
        ],
        flags: [{ key: "mentor", enabled: true, env: "production", rollout_pct: 10 }, { key: "other", enabled: false, env: "all", rollout_pct: 0 }],
      }),
    );
    const inputs = await loadSummaryInputs(client, CONFIG, NOW);
    expect(inputs.clawbacks.map((c) => c.lot_id)).toEqual(["l2", "l1"]);
    expect(inputs.staleReservations.map((r) => r.request_id)).toEqual(["stale"]);
    expect(inputs.walletDebts).toEqual([1_500]);
    expect(inputs.dbFlag).toEqual({ key: "mentor", enabled: true, env: "production", rollout_pct: 10 });
  });

  it("is read-only and uses only boring filters (no jsonb contains)", async () => {
    const { client, log } = stubClient(base());
    await loadSummaryInputs(client, CONFIG, NOW);
    const kinds = new Set(log.queries.flatMap((q) => q.filters.map((f) => f.split(":")[0])));
    expect([...kinds].every((k) => ["eq", "in", "gt", "gte", "lt"].includes(k))).toBe(true);
    // The two breaker RPCs plus the a38 split probe (absent here, so the shared total decides).
    expect([...new Set(log.rpcs.map((r) => r.fn))].sort()).toEqual(["ai_spend_cap", "ai_spend_month", "ai_spend_month_split"]);
  });

  it("asks the SAME two RPCs the guard asks, with the config floor and percent", async () => {
    const { client, log } = stubClient(base());
    await loadSummaryInputs(client, { ...CONFIG, globalMonthlyCapFloorMicro: 12_345, globalCapNetPct: 9 }, NOW);
    expect(log.rpcs).toContainEqual({ fn: "ai_spend_month", args: { p_month: "2026-10" } });
    expect(log.rpcs).toContainEqual({ fn: "ai_spend_cap", args: { p_floor_micro: 12_345, p_net_pct: 9 } });
  });

  it("returns the RPC numbers as spend and cap", async () => {
    const { client } = stubClient(base({}, { ai_spend_month: { data: "7000000" }, ai_spend_cap: { data: [50_000_000] } }));
    const inputs = await loadSummaryInputs(client, CONFIG, NOW);
    expect(inputs.spendTotalMicro).toBe(7_000_000);
    expect(inputs.capMicro).toBe(50_000_000);
  });
});

describe("failure modes are typed, never zeros", () => {
  const load = (opts: StubOptions) => loadSummaryInputs(stubClient(opts).client, CONFIG, NOW);

  it.each([
    ["42P01 undefined_table", { code: "42P01", message: 'relation "public.ai_usage_ledger" does not exist' }],
    ["PGRST205 schema cache", { code: "PGRST205", message: "Could not find the table 'public.ai_usage_ledger' in the schema cache" }],
    ["message only", { message: 'relation "public.ai_credit_lot" does not exist' }],
  ])("maps a missing mentor table (%s) to ledger_not_applied", async (_n, err) => {
    for (const table of ["ai_usage_ledger", "ai_credit_lot", "ai_mentor_reservation", "ai_credit_wallet"]) {
      await expect(load({ ...base(), errors: { [table]: err } })).rejects.toMatchObject({ code: "ledger_not_applied" });
    }
  });

  it("maps any other table error to db_error", async () => {
    await expect(load({ ...base(), errors: { ai_usage_ledger: { code: "57014", message: "statement timeout" } } })).rejects.toMatchObject({ code: "db_error" });
    await expect(load({ ...base(), errors: { flags: { code: "XX000", message: "boom" } } })).rejects.toMatchObject({ code: "db_error" });
  });

  it("never reports resting=false when the spend or cap RPC fails or is malformed", async () => {
    await expect(load(base({}, { ai_spend_month: { error: { message: "x" } }, ai_spend_cap: { data: 1 } }))).rejects.toMatchObject({ code: "db_error" });
    await expect(load(base({}, { ai_spend_month: { data: 1 }, ai_spend_cap: { error: { message: "x" } } }))).rejects.toMatchObject({ code: "db_error" });
    await expect(load(base({}, { ai_spend_month: { data: "oops" }, ai_spend_cap: { data: 1 } }))).rejects.toMatchObject({ code: "db_error" });
    await expect(
      load(base({}, { ai_spend_month: () => { throw new Error("network"); }, ai_spend_cap: { data: 1 } })),
    ).rejects.toMatchObject({ code: "db_error" });
  });

  it("is an instance of MentorAdminLoadError", async () => {
    await expect(load({ ...base(), errors: { ai_usage_ledger: { code: "42P01" } } })).rejects.toBeInstanceOf(MentorAdminLoadError);
  });
});

describe("small helpers", () => {
  it("detects a missing relation", () => {
    expect(isMissingRelation({ code: "42P01" })).toBe(true);
    expect(isMissingRelation({ code: "PGRST205" })).toBe(true);
    expect(isMissingRelation({ message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingRelation({ code: "42501", message: "permission denied for table x" })).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
  });

  it("builds UTC month bounds", () => {
    expect(monthRangeIso("2026-12")).toEqual({ start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
  });

  it("keeps fixtures honest", () => {
    expect(R1).toMatch(/^[0-9a-f-]{36}$/);
    expect(CLAWBACK.delta_micro_usd).toBeLessThan(0);
  });
});
