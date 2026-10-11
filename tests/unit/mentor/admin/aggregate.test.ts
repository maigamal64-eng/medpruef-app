import { describe, expect, it } from "vitest";
import {
  buildAdminSummary,
  daysOfMonthUpTo,
  monthBounds,
  pctOfCap,
  TOP_USERS_LIMIT,
  CLAWBACKS_LIMIT,
  STALE_RESERVATIONS_LIMIT,
} from "@/app/api/mentor/admin/summary/aggregate";
import { MENTOR_PACKAGE_IDS } from "@/lib/mentor/contract";
import { CLAWBACK, CONFIG, MONTH, NOW, R1, R2, R3, STALE, U1, U2, U3, call, inputs, lot } from "./fixtures";

describe("spend and the breaker", () => {
  it("sums settle and house_cost cost_micro as mentor spend; legacy is the remainder of the RPC total", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [call({ cost_micro: 2_000 }), call({ cost_micro: 3_000, request_id: R2 }), call({ kind: "house_cost", cost_micro: 5_000, user_id: U2 })],
        spendTotalMicro: 1_010_000,
      }),
    );
    expect(s.spend.mentor_micro).toBe(10_000);
    expect(s.spend.total_micro).toBe(1_010_000);
    expect(s.spend.legacy_micro).toBe(1_000_000);
    expect(s.spend.mentor_micro + s.spend.legacy_micro).toBe(s.spend.total_micro);
  });

  it("never lets legacy go negative when the ledger read is ahead of the RPC", () => {
    const s = buildAdminSummary(inputs({ ledger: [call({ cost_micro: 9_000 })], spendTotalMicro: 4_000 }));
    expect(s.spend.legacy_micro).toBe(0);
    expect(s.spend.total_micro).toBe(9_000);
  });

  it("is resting exactly when total >= cap (the guard admits only while strictly below)", () => {
    const at = (total: number, cap: number) => buildAdminSummary(inputs({ spendTotalMicro: total, capMicro: cap })).state.resting;
    expect(at(49_999_999, 50_000_000)).toBe(false);
    expect(at(50_000_000, 50_000_000)).toBe(true);
    expect(at(60_000_000, 50_000_000)).toBe(true);
    // A zero cap rests even at zero spend, like the guard (0 < 0 is false).
    expect(at(0, 0)).toBe(true);
  });

  it("computes pct_of_cap to one decimal and guards cap = 0", () => {
    expect(pctOfCap(12_500_000, 50_000_000)).toBe(25);
    expect(pctOfCap(1, 3)).toBe(33.3);
    expect(pctOfCap(1, 1_000_000)).toBe(0);
    expect(pctOfCap(1_234_567, 10_000_000)).toBe(12.3);
    expect(pctOfCap(60_000_000, 50_000_000)).toBe(120);
    expect(pctOfCap(0, 0)).toBe(0);
    expect(pctOfCap(5, 0)).toBe(100);
    expect(buildAdminSummary(inputs({ spendTotalMicro: 5, capMicro: 0 })).spend.pct_of_cap).toBe(100);
  });

  it("treats malformed numbers as 0 instead of poisoning totals with NaN", () => {
    const s = buildAdminSummary(
      inputs({ ledger: [call({ cost_micro: Number.NaN }), call({ cost_micro: null }), call({ cost_micro: 700, request_id: R2 })] }),
    );
    expect(s.spend.mentor_micro).toBe(700);
    expect(Number.isFinite(s.spend.pct_of_cap)).toBe(true);
  });
});

describe("spend per day (UTC)", () => {
  it("zero-fills every UTC day from the 1st through today", () => {
    const s = buildAdminSummary(inputs({ ledger: [call({ created_at: "2026-10-03T10:00:00.000Z" })] }));
    expect(s.by_day.map((d) => d.day)).toEqual(Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`));
    expect(s.by_day[0]).toEqual({ day: "2026-10-01", mentor_micro: 0, calls: 0, house_micro: 0 });
    expect(s.by_day[2]).toEqual({ day: "2026-10-03", mentor_micro: 2_000, calls: 1, house_micro: 0 });
  });

  it("buckets on the UTC day boundary, not local time", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [
          call({ created_at: "2026-10-05T23:59:59.999Z", cost_micro: 100 }),
          call({ created_at: "2026-10-06T00:00:00.000Z", cost_micro: 200, request_id: R2 }),
        ],
      }),
    );
    expect(s.by_day.find((d) => d.day === "2026-10-05")?.mentor_micro).toBe(100);
    expect(s.by_day.find((d) => d.day === "2026-10-06")?.mentor_micro).toBe(200);
  });

  it("counts house_cost in mentor_micro and calls, and reports it separately as house_micro", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [call({ cost_micro: 1_000 }), call({ kind: "house_cost", cost_micro: 400, request_id: R2 })],
      }),
    );
    const day = s.by_day.find((d) => d.day === "2026-10-03");
    expect(day).toEqual({ day: "2026-10-03", mentor_micro: 1_400, calls: 2, house_micro: 400 });
    expect(day!.house_micro).toBeLessThanOrEqual(day!.mentor_micro);
  });

  it("sums by_day back to the month total", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [
          call({ created_at: "2026-10-01T01:00:00Z", cost_micro: 11 }),
          call({ created_at: "2026-10-09T01:00:00Z", cost_micro: 22, request_id: R2 }),
          call({ created_at: "2026-10-14T11:59:00Z", cost_micro: 33, kind: "house_cost", request_id: R3 }),
        ],
      }),
    );
    expect(s.by_day.reduce((t, d) => t + d.mentor_micro, 0)).toBe(s.spend.mentor_micro);
  });

  it("covers the whole month for a month that is already over", () => {
    expect(daysOfMonthUpTo("2026-09", NOW)).toHaveLength(30);
    expect(daysOfMonthUpTo("2026-02", NOW)).toHaveLength(28);
    expect(daysOfMonthUpTo("2026-10", new Date("2026-10-01T00:00:00Z"))).toEqual(["2026-10-01"]);
  });

  it("rejects a malformed month", () => {
    expect(() => monthBounds("2026-13")).toThrow(RangeError);
    expect(() => monthBounds("2026-1")).toThrow(RangeError);
  });
});

describe("by model", () => {
  it("groups, sums tokens, labels a missing model unknown and sorts by spend", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [
          call({ model: "claude-haiku-5-5", cost_micro: 1_000, input_tokens: 100, output_tokens: 10, cache_read_tokens: 5 }),
          call({ model: "claude-haiku-5-5", cost_micro: 1_000, input_tokens: 300, output_tokens: 30, cache_read_tokens: 15, request_id: R2 }),
          call({ model: "claude-sonnet-5-5", cost_micro: 9_000, request_id: R3 }),
          call({ model: null, cost_micro: 50, request_id: R3 }),
        ],
      }),
    );
    expect(s.by_model.map((m) => m.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5", "unknown"]);
    const haiku = s.by_model.find((m) => m.model === "claude-haiku-5-5")!;
    expect(haiku).toMatchObject({ mentor_micro: 2_000, calls: 2, input_tokens: 400, output_tokens: 40, cache_read_tokens: 20 });
  });
});

describe("top users", () => {
  it("bills settle rows only and counts distinct requests (one message is up to 3 calls)", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [
          call({ user_id: U1, cost_micro: 1_000, request_id: R1 }),
          call({ user_id: U1, cost_micro: 1_000, request_id: R1 }),
          call({ user_id: U1, cost_micro: 1_000, request_id: R1 }),
          call({ user_id: U1, cost_micro: 4_000, request_id: R2 }),
          call({ user_id: U2, kind: "house_cost", cost_micro: 99_000, request_id: R3 }),
        ],
      }),
    );
    expect(s.top_users).toEqual([{ user_id: U1, spent_micro: 7_000, messages: 2, available_micro: 0 }]);
  });

  it("sorts by spend then id, and limits to the top ten", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const s = buildAdminSummary(inputs({ ledger: ids.map((id, i) => call({ user_id: id, cost_micro: 100, request_id: `req-${i}` })) }));
    expect(s.top_users).toHaveLength(TOP_USERS_LIMIT);
    expect(s.top_users.map((u) => u.user_id)).toEqual(ids.slice(0, TOP_USERS_LIMIT));
    const s2 = buildAdminSummary(inputs({ ledger: [call({ user_id: U2, cost_micro: 5 }), call({ user_id: U1, cost_micro: 9, request_id: R2 })] }));
    expect(s2.top_users.map((u) => u.user_id)).toEqual([U1, U2]);
  });

  it("reports available credit from live lots only", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [call({ user_id: U1 })],
        lots: [
          lot({ user_id: U1, granted_micro: 1_000_000, spent_micro: 250_000 }), // 750k live
          lot({ user_id: U1, granted_micro: 500_000, spent_micro: 0, expires_at: "2026-10-10T00:00:00Z" }), // expired
          lot({ user_id: U1, granted_micro: 500_000, spent_micro: 0, starts_at: "2026-10-20T00:00:00Z", expires_at: "2026-11-20T00:00:00Z" }), // not started
          lot({ user_id: U1, granted_micro: 500_000, spent_micro: 0, status: "clawed_back", clawed_back_micro: 500_000 }), // clawed back
          lot({ user_id: U2, granted_micro: 9_000_000, spent_micro: 0 }), // someone else
        ],
      }),
    );
    expect(s.top_users[0].available_micro).toBe(750_000);
  });
});

describe("overruns", () => {
  it("counts calls whose true cost exceeded their reserved ceiling (hold = -ceiling)", () => {
    const s = buildAdminSummary(
      inputs({
        ledger: [
          call({ cost_micro: 4_001, hold_micro: -4_000 }), // over
          call({ cost_micro: 4_000, hold_micro: -4_000, request_id: R2 }), // equal: a swept settle, not an overrun
          call({ cost_micro: 3_999, hold_micro: -4_000, request_id: R3 }),
          call({ kind: "house_cost", cost_micro: 9_000, hold_micro: -4_000, request_id: R3 }), // over, house
          call({ cost_micro: 5_000, hold_micro: 0 }), // no ceiling recorded: cannot be judged
          call({ cost_micro: 5_000, hold_micro: null }),
        ],
      }),
    );
    expect(s.overruns).toBe(2);
  });
});

describe("credits sold vs consumed", () => {
  it("always lists the three sold packages, then only included packages that have lots", () => {
    const s = buildAdminSummary(inputs({ lots: [lot({ package_id: "trial_taste" })] }));
    expect(s.lots_by_package.map((p) => p.package_id)).toEqual(["mentor_basis", "mentor_plus", "mentor_topup", "trial_taste"]);
    expect(s.lots_by_package[0]).toEqual({ package_id: "mentor_basis", lots: 0, granted_micro: 0, spent_micro: 0, clawed_back_micro: 0, live_remaining_micro: 0 });
  });

  it("aggregates granted, spent, clawed back and live remaining per package", () => {
    const s = buildAdminSummary(
      inputs({
        lots: [
          lot({ package_id: "mentor_basis", granted_micro: 750_000, spent_micro: 100_000 }), // live 650k
          lot({ package_id: "mentor_basis", granted_micro: 750_000, spent_micro: 750_000, expires_at: "2026-10-02T00:00:00Z" }), // expired, fully used
          lot({ package_id: "mentor_basis", granted_micro: 750_000, spent_micro: 200_000, expires_at: "2026-10-05T00:00:00Z" }), // expired, 550k unused
          lot({ package_id: "mentor_basis", granted_micro: 750_000, spent_micro: 0, clawed_back_micro: 750_000, status: "clawed_back" }),
        ],
      }),
    );
    expect(s.lots_by_package.find((p) => p.package_id === "mentor_basis")).toEqual({
      package_id: "mentor_basis",
      lots: 4,
      granted_micro: 3_000_000,
      spent_micro: 1_050_000,
      clawed_back_micro: 750_000,
      live_remaining_micro: 650_000,
    });
  });

  it("includes a package the code does not know instead of hiding its credit", () => {
    const s = buildAdminSummary(inputs({ lots: [lot({ package_id: "mentor_enterprise", granted_micro: 123 })] }));
    const last = s.lots_by_package[s.lots_by_package.length - 1];
    expect(last.package_id).toBe("mentor_enterprise");
    expect(last.granted_micro).toBe(123);
  });

  it("lists known package ids in contract order", () => {
    const s = buildAdminSummary(inputs({ lots: MENTOR_PACKAGE_IDS.map((id) => lot({ package_id: id })) }));
    expect(s.lots_by_package.map((p) => p.package_id)).toEqual([...MENTOR_PACKAGE_IDS]);
  });
});

describe("clawbacks, stuck holds, debt", () => {
  it("reports clawed_micro as the positive size of the ledger delta and drops unusable rows", () => {
    const s = buildAdminSummary(
      inputs({
        clawbacks: [CLAWBACK, { ...CLAWBACK, lot_id: null }, { ...CLAWBACK, user_id: null }, { ...CLAWBACK, package_id: null }],
      }),
    );
    expect(s.clawbacks).toEqual([
      { lot_id: CLAWBACK.lot_id, user_id: U2, package_id: "mentor_plus", clawed_micro: 1_500_000, at: CLAWBACK.created_at },
    ]);
  });

  it("limits the lists it returns", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...CLAWBACK, lot_id: `lot-${i}` }));
    expect(buildAdminSummary(inputs({ clawbacks: many })).clawbacks).toHaveLength(CLAWBACKS_LIMIT);
    const stale = Array.from({ length: 80 }, (_, i) => ({ ...STALE, request_id: `r-${i}` }));
    expect(buildAdminSummary(inputs({ staleReservations: stale })).stale_reservations).toHaveLength(STALE_RESERVATIONS_LIMIT);
  });

  it("computes the age of a stuck hold in whole minutes", () => {
    const s = buildAdminSummary(inputs({ staleReservations: [STALE] }));
    expect(s.stale_reservations).toEqual([
      { request_id: R3, call_index: 1, user_id: U3, ceiling_micro: 12_000, age_minutes: 150 },
    ]);
  });

  it("sums wallet debt", () => {
    expect(buildAdminSummary(inputs({ walletDebts: [1_000, 2_500, 0] })).debt_total_micro).toBe(3_500);
    expect(buildAdminSummary(inputs()).debt_total_micro).toBe(0);
  });
});

describe("state and shape", () => {
  it("mirrors the config switches, the DB flag row and the allowlist size", () => {
    const s = buildAdminSummary(inputs({ dbFlag: { enabled: true, env: "production", rollout_pct: 25 } }));
    expect(s.state).toEqual({
      ai_features_enabled: true,
      mentor_enabled: true,
      packages_enabled: false,
      topups_enabled: false,
      db_flag: { enabled: true, env: "production", rollout_pct: 25 },
      resting: false,
      beta_allowlist_size: 2,
    });
    expect(buildAdminSummary(inputs({ config: { ...CONFIG, packagesEnabled: true, topupsEnabled: true } })).state).toMatchObject({
      packages_enabled: true,
      topups_enabled: true,
    });
  });

  it("reports a missing DB flag row as null, not as off", () => {
    expect(buildAdminSummary(inputs()).state.db_flag).toBeNull();
  });

  it("returns exactly the frozen MentorAdminSummary keys, ids only, no emails", () => {
    const s = buildAdminSummary(
      inputs({ ledger: [call()], lots: [lot()], clawbacks: [CLAWBACK], staleReservations: [STALE], walletDebts: [5] }),
    );
    expect(Object.keys(s).sort()).toEqual(
      ["by_day", "by_model", "clawbacks", "debt_total_micro", "generated_at", "lots_by_package", "month", "overruns", "quality", "spend", "stale_reservations", "state", "top_users"].sort(),
    );
    expect(s.month).toBe(MONTH);
    expect(s.generated_at).toBe(NOW.toISOString());
    expect(JSON.stringify(s)).not.toMatch(/@/);
    expect(CONFIG.betaUserIds).toHaveLength(2);
  });
});
