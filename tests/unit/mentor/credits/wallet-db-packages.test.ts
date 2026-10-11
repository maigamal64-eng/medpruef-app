import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";
import { isMissingObjectError, isUuid, rpcBalance, rpcGrantCredits, rpcWhopLookup } from "@/lib/mentor/credits/db";
import { accessSourcesFromLots, averageMessageCost, createWallet, toWalletBalance } from "@/lib/mentor/credits/wallet";
import { buildOffers, isBuyable, parsePackageRow, resetPackageCache } from "@/lib/mentor/credits/packages";
import type { CreditPackageRow, MentorPackageId } from "@/lib/mentor/contract";

const U = "55555555-5555-4555-8555-555555555555";
const DAY = 86_400_000;

// Rows exactly as the seeded migration returns them through PostgREST.
const SEED: Array<Record<string, unknown>> = [
  { package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: false, provisional: false, sort: 10, note: "x" },
  { package_id: "mentor_plus", kind: "subscription", grant_micro: 2000000, period_days: 30, expiry_days: 33, price_eur_cents: 990, active: false, provisional: false, sort: 20, note: null },
  { package_id: "mentor_topup", kind: "topup", grant_micro: 2000000, period_days: null, expiry_days: 180, price_eur_cents: 1000, active: false, provisional: false, sort: 30, note: null },
  { package_id: "included_pro_monthly", kind: "included", grant_micro: 250000, period_days: 30, expiry_days: 30, price_eur_cents: null, active: true, provisional: false, sort: 40, note: null },
  { package_id: "trial_taste", kind: "trial", grant_micro: 100000, period_days: null, expiry_days: 7, price_eur_cents: null, active: true, provisional: true, sort: 50, note: null },
];

function cat(over: Partial<Record<MentorPackageId, Partial<CreditPackageRow>>> = {}) {
  const m = new Map<MentorPackageId, CreditPackageRow>();
  for (const raw of SEED) {
    const r = parsePackageRow(raw)!;
    m.set(r.package_id, { ...r, ...over[r.package_id] });
  }
  return m;
}

describe("db wrappers", () => {
  it("isUuid / missing-object codes", () => {
    expect(isUuid(U)).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isMissingObjectError({ code: "PGRST202" })).toBe(true);
    expect(isMissingObjectError({ code: "42883" })).toBe(true);
    expect(isMissingObjectError({ code: "57014" })).toBe(false);
  });

  it("grant rejects bad args before any RPC", async () => {
    const { sb, calls } = createFakeSupabase(() => ({}));
    const r = await rpcGrantCredits(sb as never, { userId: "nope", packageId: "mentor_basis", source: "whop_payment", sourceId: "pay_1" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(calls).toHaveLength(0);
  });

  it("grant parses ok/duplicate/failure bodies and treats an unparseable body as bad_response", async () => {
    const bodies: FakeResult[] = [
      { data: { ok: true, duplicate: false, lot_id: "l1", granted_micro: 750000, expires_at: "x", debt_paid_micro: 0 } },
      { data: { ok: true, duplicate: true, lot_id: "l1", granted_micro: 750000 } },
      { data: { ok: false, reason: "source_conflict", lot_id: "l9" } },
      { data: null },
      { error: { code: "XX000", message: "boom" } },
    ];
    const out = [];
    for (const b of bodies) {
      const { sb } = createFakeSupabase(() => b);
      out.push(await rpcGrantCredits(sb as never, { userId: U, packageId: "mentor_basis", source: "whop_payment", sourceId: "pay_1" }));
    }
    expect(out[0]).toMatchObject({ ok: true, duplicate: false, lotId: "l1", grantedMicro: 750000 });
    expect(out[1]).toMatchObject({ ok: true, duplicate: true });
    expect(out[2]).toMatchObject({ ok: false, reason: "source_conflict", lotId: "l9" });
    expect(out[3]).toMatchObject({ ok: false, reason: "bad_response" });
    expect(out[4]).toMatchObject({ ok: false, reason: "db_error" });
  });

  it("lookup: no ids -> not_mentor without a call; error vs missing function", async () => {
    const a = createFakeSupabase(() => ({}));
    expect(await rpcWhopLookup(a.sb as never, null, null)).toEqual({ kind: "not_mentor" });
    expect(a.calls).toHaveLength(0);
    const b = createFakeSupabase(() => ({ error: { code: "PGRST202" } }));
    expect(await rpcWhopLookup(b.sb as never, "pay_1", null)).toEqual({ kind: "missing_function" });
    const c = createFakeSupabase(() => ({ data: { foo: 1 } }));
    expect(await rpcWhopLookup(c.sb as never, "pay_1", null)).toEqual({ kind: "error" });
  });

  it("balance parses the mentor_balance jsonb and throws on a shape change", async () => {
    const body = {
      lots_micro: 900000,
      reserved_micro: 36000,
      debt_micro: 0,
      available_micro: 864000,
      next_expiry: "2026-10-17T00:00:00+00:00",
      ever_granted: true,
      lots: [
        { lot_id: "l1", package_id: "trial_taste", kind: "trial", source: "trial_taste", remaining_micro: 100000, granted_micro: 100000, starts_at: "2026-10-10T00:00:00+00:00", expires_at: "2026-10-17T00:00:00+00:00" },
      ],
    };
    const { sb } = createFakeSupabase(() => ({ data: body }));
    const b = await rpcBalance(sb as never, U);
    expect(b.available_micro).toBe(864000);
    expect(toWalletBalance(b).lots[0]).toMatchObject({ lotId: "l1", kind: "trial", remainingMicro: 100000 });
    const bad = createFakeSupabase(() => ({ data: { lots_micro: "x" } }));
    await expect(rpcBalance(bad.sb as never, U)).rejects.toThrow();
  });
});

describe("wallet", () => {
  beforeEach(() => resetPackageCache());

  function walletHandler(over: (c: FakeCall) => FakeResult | undefined = () => undefined) {
    return (c: FakeCall): FakeResult | undefined => {
      const o = over(c);
      if (o) return o;
      if (c.table === "users") return { data: { id: U, role: "user", tier: "pro", tier_expires_at: new Date(Date.now() + 20 * DAY).toISOString() } };
      if (c.table === "subscriptions")
        return {
          data: [
            { id: "sub-9", tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: 1900, started_at: new Date(Date.now() - 2 * DAY).toISOString(), expires_at: new Date(Date.now() + 28 * DAY).toISOString() },
          ],
        };
      if (c.table === "referrals") return { data: [] };
      if (c.table === "ai_credit_package") return { data: SEED };
      if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "l", granted_micro: 1000000 } };
      return {};
    };
  }

  it("ensureIncludedGrants grants the Pro slice with an explicit clamped expiry", async () => {
    const { sb, calls } = createFakeSupabase(walletHandler());
    await createWallet(sb as never, { freeEnabled: false }).ensureIncludedGrants(U, new Date());
    const g = calls.find((c) => c.table === "rpc:mentor_grant_credits")!;
    expect(g.payload).toMatchObject({ p_user: U, p_package: "included_pro_monthly", p_source: "pro_included", p_source_id: "sub-9:0", p_micro: null });
    expect(typeof (g.payload as { p_expires_at: string }).p_expires_at).toBe("string");
    expect(eqVal(calls.find((c) => c.table === "subscriptions")!, "status")).toBe("active");
  });

  it("throws (fail closed) on a DB error, tolerates source_conflict", async () => {
    const a = createFakeSupabase(walletHandler((c) => (c.table === "subscriptions" ? { error: { code: "57014" } } : undefined)));
    await expect(createWallet(a.sb as never, { freeEnabled: false }).ensureIncludedGrants(U, new Date())).rejects.toThrow();
    resetPackageCache();
    const b = createFakeSupabase(walletHandler((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "db_error" } } : undefined)));
    await expect(createWallet(b.sb as never, { freeEnabled: false }).ensureIncludedGrants(U, new Date())).rejects.toThrow();
    resetPackageCache();
    const c = createFakeSupabase(walletHandler((x) => (x.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "source_conflict" } } : undefined)));
    await expect(createWallet(c.sb as never, { freeEnabled: false }).ensureIncludedGrants(U, new Date())).resolves.toBeUndefined();
  });

  it("averageMessageCost groups settle rows by request and averages the last 20 messages", () => {
    const rows = [
      { request_id: "r1", delta_micro_usd: -1000 },
      { request_id: "r1", delta_micro_usd: -1300 },
      { request_id: "r2", delta_micro_usd: "-1200" },
      { request_id: "r3", delta_micro_usd: 0 },
    ];
    expect(averageMessageCost(rows)).toBe(Math.ceil((2300 + 1200) / 2));
    expect(averageMessageCost([])).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => ({ request_id: `r${i}`, delta_micro_usd: i < 20 ? -100 : -10000 }));
    expect(averageMessageCost(many)).toBe(100);
  });

  it("accessSourcesFromLots maps live lot kinds to learner labels", () => {
    const now = Date.now();
    const lot = (kind: string, remaining = 1) => ({
      lotId: kind,
      packageId: "trial_taste" as const,
      kind: kind as never,
      source: "trial_taste" as const,
      remainingMicro: remaining,
      grantedMicro: 1,
      startsAt: new Date(now - DAY).toISOString(),
      expiresAt: new Date(now + DAY).toISOString(),
    });
    expect(accessSourcesFromLots([lot("subscription"), lot("included"), lot("trial", 0)], now)).toEqual(["package", "pro_included"]);
    expect(accessSourcesFromLots([], now)).toEqual(["none"]);
  });
});

describe("packages", () => {
  const env = { WHOP_PLAN_MENTOR_BASIS: "plan_b", WHOP_PLAN_MENTOR_PLUS: "plan_p", WHOP_PLAN_MENTOR_TOPUP: "plan_t" };
  const on = { packagesEnabled: true, topupsEnabled: false };

  it("nothing is buyable while the seeded rows are inactive (dark launch)", () => {
    expect(buildOffers(cat(), on, null, env)).toEqual([]);
  });

  it("an active row with a plan id is offered with credits and an estimate, never dollars", () => {
    const c = cat({ mentor_basis: { active: true }, mentor_plus: { active: true }, mentor_topup: { active: true } });
    const offers = buildOffers(c, on, null, env);
    expect(offers.map((o) => o.package_id)).toEqual(["mentor_basis", "mentor_plus"]);
    expect(offers[0]).toEqual({ package_id: "mentor_basis", kind: "subscription", credits: 150, messages_estimate: 150, price_eur_cents: 490, period_days: 30, valid_days: 33 });
    expect(JSON.stringify(offers)).not.toMatch(/usd|micro/i);
    // top-up needs its own flag
    expect(buildOffers(c, { packagesEnabled: true, topupsEnabled: true }, 2500, env).map((o) => o.package_id)).toEqual(["mentor_basis", "mentor_plus", "mentor_topup"]);
    expect(buildOffers(c, { packagesEnabled: true, topupsEnabled: true }, 2500, env)[0].messages_estimate).toBe(300);
  });

  it("no plan env, packages flag off, or a non-sold kind -> not buyable", () => {
    const c = cat({ mentor_basis: { active: true } });
    expect(isBuyable("mentor_basis", c.get("mentor_basis"), on, {})).toBe(false);
    expect(isBuyable("mentor_basis", c.get("mentor_basis"), { packagesEnabled: false, topupsEnabled: true }, env)).toBe(false);
    expect(isBuyable("mentor_basis", { ...c.get("mentor_basis")!, kind: "topup" }, on, env)).toBe(false);
  });

  it("parsePackageRow rejects unknown ids and kinds", () => {
    expect(parsePackageRow({ ...SEED[0], package_id: "evil" })).toBeNull();
    expect(parsePackageRow({ ...SEED[0], kind: "bogus" })).toBeNull();
  });
});
