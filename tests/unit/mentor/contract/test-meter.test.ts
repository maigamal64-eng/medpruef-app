import { describe, it, expect } from "vitest";
import { InMemoryLedger, createTestMeter, createTestWallet, type GrantInput } from "@/lib/mentor/test-meter";

const U = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;

function clock(start = Date.UTC(2026, 9, 10)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function grant(l: InMemoryLedger, c: { now: () => number }, over: Partial<GrantInput> = {}) {
  return l.grant({
    userId: U,
    packageId: "mentor_basis",
    kind: "subscription",
    source: "whop_payment",
    sourceId: "pay_1",
    micro: 750_000,
    expiresAt: new Date(c.now() + 33 * DAY),
    ...over,
  });
}

describe("C16 in-memory ledger mirrors the SQL semantics", () => {
  it("reserve books the ceiling; a second reserve that does not fit is refused", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c, { micro: 100_000 });
    expect(l.reserve(U, "r1", 0, 60_000)).toMatchObject({ ok: true, remainingMicro: 40_000 });
    expect(l.reserve(U, "r2", 0, 60_000)).toMatchObject({ ok: false, reason: "insufficient", remainingMicro: 40_000 });
    expect(l.reservedOf(U)).toBe(60_000);
  });

  it("reserve and settle are idempotent per (request, callIndex)", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c);
    expect(l.reserve(U, "r1", 0, 10_000).ok).toBe(true);
    expect(l.reserve(U, "r1", 0, 10_000)).toMatchObject({ ok: true, duplicate: true });
    expect(l.reservedOf(U)).toBe(10_000);
    expect(l.settle("r1", 0, 4_000, { input_tokens: 1, output_tokens: 1 }, true)).toMatchObject({ ok: true, chargedMicro: 4_000 });
    expect(l.settle("r1", 0, 4_000, { input_tokens: 1, output_tokens: 1 }, true)).toMatchObject({ ok: true, duplicate: true });
    expect(l.available(U)).toBe(750_000 - 4_000);
    expect(l.reconciles(U)).toBe(true);
  });

  it("spends the lot that expires first (trial taste before the package)", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c);
    l.grant({ userId: U, packageId: "trial_taste", kind: "trial", source: "trial_taste", sourceId: U, micro: 100_000, expiresAt: new Date(c.now() + 7 * DAY) });
    l.reserve(U, "r1", 0, 200_000);
    l.settle("r1", 0, 120_000, { input_tokens: 1, output_tokens: 1 }, true);
    const lots = l.balance(U).lots;
    expect(lots.find((x) => x.packageId === "trial_taste")?.remainingMicro).toBe(0);
    expect(lots.find((x) => x.packageId === "mentor_basis")?.remainingMicro).toBe(730_000);
  });

  it("an overrun becomes debt, blocks spending, and the next grant pays it down", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c, { micro: 50_000 });
    l.reserve(U, "r1", 0, 10_000);
    expect(l.settle("r1", 0, 80_000, { input_tokens: 1, output_tokens: 1 }, true)).toMatchObject({ overrun: true });
    expect(l.debtOf(U)).toBe(30_000);
    expect(l.reserve(U, "r2", 0, 1)).toMatchObject({ ok: false, reason: "insufficient" });
    grant(l, c, { sourceId: "pay_2", micro: 750_000 });
    expect(l.debtOf(U)).toBe(0);
    expect(l.available(U)).toBe(720_000);
    expect(l.reconciles(U)).toBe(true);
  });

  it("house-billed settles move no user credit but count as spend", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c);
    l.reserve(U, "r1", 0, 10_000);
    expect(l.settle("r1", 0, 9_000, { input_tokens: 1, output_tokens: 1 }, false)).toMatchObject({ billedTo: "house" });
    expect(l.available(U)).toBe(750_000);
    expect(l.spendMicro()).toBe(9_000);
  });

  it("release frees the hold and charges nothing", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c);
    l.reserve(U, "r1", 0, 10_000);
    expect(l.release("r1", 0).ok).toBe(true);
    expect(l.reservedOf(U)).toBe(0);
    expect(l.available(U)).toBe(750_000);
  });

  it("stale reservations settle at the ceiling on the next reserve, never released", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c);
    l.reserve(U, "r1", 0, 50_000);
    c.advance(16 * 60 * 1000);
    l.reserve(U, "r2", 0, 1_000);
    expect(l.available(U)).toBe(750_000 - 50_000 - 1_000);
    expect(l.settle("r1", 0, 10, { input_tokens: 1, output_tokens: 1 }, true)).toMatchObject({ duplicate: true, chargedMicro: 50_000 });
  });

  it("clawback removes the unspent part, turns the spent part of a paid lot into debt, and is idempotent (H2)", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c);
    l.reserve(U, "r1", 0, 300_000);
    l.settle("r1", 0, 250_000, { input_tokens: 1, output_tokens: 1 }, true);
    expect(l.clawback("whop_payment", "pay_1")).toMatchObject({ ok: true, clawedMicro: 500_000, debtAddedMicro: 250_000 });
    expect(l.clawback("whop_payment", "pay_1")).toMatchObject({ duplicate: true, debtAddedMicro: 0 });
    expect(l.debtOf(U)).toBe(250_000);
    expect(l.available(U)).toBe(-250_000);
    expect(l.reserve(U, "r2", 0, 1)).toMatchObject({ ok: false, reason: "insufficient" });
    expect(l.reconciles(U)).toBe(true);
  });

  it("a free included lot claws back the unspent part only (no debt)", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c, { source: "pro_included", sourceId: "sub1:0", packageId: "included_pro_monthly", kind: "included", micro: 1_000_000 });
    l.reserve(U, "r1", 0, 300_000);
    l.settle("r1", 0, 300_000, { input_tokens: 1, output_tokens: 1 }, true);
    expect(l.clawback("pro_included", "sub1:0")).toMatchObject({ ok: true, clawedMicro: 700_000, debtAddedMicro: 0 });
    expect(l.debtOf(U)).toBe(0);
    expect(l.reconciles(U)).toBe(true);
  });

  it("buying then refunding cannot launder overrun debt (H2, scenario C)", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c, { sourceId: "pay_0" });
    l.reserve(U, "r1", 0, 750_000);
    l.settle("r1", 0, 1_050_000, { input_tokens: 1, output_tokens: 1 }, true);
    expect(l.debtOf(U)).toBe(300_000);
    grant(l, c, { sourceId: "pay_1" });
    expect(l.debtOf(U)).toBe(0);
    l.clawback("whop_payment", "pay_1");
    expect(l.debtOf(U)).toBe(300_000);
    expect(l.reconciles(U)).toBe(true);
  });

  it("a refund that arrives before the grant tombstones the payment (H1)", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    expect(l.clawback("whop_payment", "pay_1")).toMatchObject({ ok: false });
    expect(l.revokePayment("pay_1")).toMatchObject({ ok: true, duplicate: false });
    expect(l.revokePayment("pay_1")).toMatchObject({ ok: true, duplicate: true });
    expect(grant(l, c)).toMatchObject({ ok: false, reason: "revoked" });
    expect(l.available(U)).toBe(0);
    expect(l.lots).toHaveLength(0);
  });

  it("a duplicate Whop payment grants once; the same payment id for another user is refused", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    expect(grant(l, c)).toMatchObject({ ok: true, duplicate: false });
    expect(grant(l, c)).toMatchObject({ ok: true, duplicate: true });
    expect(grant(l, c, { userId: "22222222-2222-4222-8222-222222222222" })).toMatchObject({ ok: false, reason: "source_conflict" });
    expect(l.available(U)).toBe(750_000);
  });

  it("expired lots stop counting", () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    grant(l, c, { expiresAt: new Date(c.now() + DAY) });
    c.advance(DAY + 1);
    expect(l.available(U)).toBe(0);
    expect(l.reserve(U, "r1", 0, 1)).toMatchObject({ ok: false, reason: "insufficient" });
  });

  it("an injected DB failure fails closed", () => {
    const l = new InMemoryLedger();
    l.failNext = true;
    expect(l.reserve(U, "r1", 0, 1)).toMatchObject({ ok: false, reason: "db_error" });
  });

  it("property: random grant/reserve/settle/release/clawback sequences keep every invariant", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const c = clock();
    const l = new InMemoryLedger(c.now);
    const open: Array<[string, number]> = [];
    let n = 0;
    for (let i = 0; i < 2_000; i++) {
      const p = rnd();
      if (p < 0.1) {
        grant(l, c, { sourceId: `pay_${i}`, micro: 1 + Math.floor(rnd() * 200_000), expiresAt: new Date(c.now() + (1 + Math.floor(rnd() * 40)) * DAY) });
      } else if (p < 0.5) {
        const id = `r${n++}`;
        const ceiling = 1 + Math.floor(rnd() * 15_000);
        const r = l.reserve(U, id, 0, ceiling);
        if (r.ok) open.push([id, ceiling]);
      } else if (p < 0.8 && open.length) {
        const [id, ceiling] = open.splice(Math.floor(rnd() * open.length), 1)[0];
        // Mostly under the ceiling, sometimes over (overrun path).
        const actual = Math.floor(ceiling * (rnd() < 0.95 ? rnd() : 1 + rnd()));
        l.settle(id, 0, actual, { input_tokens: 1, output_tokens: 1 }, rnd() < 0.9);
      } else if (p < 0.85 && open.length) {
        const [id] = open.splice(Math.floor(rnd() * open.length), 1)[0];
        l.release(id, 0);
      } else if (p < 0.88) {
        l.clawback("whop_payment", `pay_${Math.floor(rnd() * i)}`);
      } else {
        c.advance(Math.floor(rnd() * 6 * 60 * 60 * 1000));
      }
      expect(l.reservedOf(U)).toBeGreaterThanOrEqual(0);
      expect(l.debtOf(U)).toBeGreaterThanOrEqual(0);
      for (const lot of l.lots) expect(lot.spent + lot.clawed).toBeLessThanOrEqual(lot.granted);
    }
    expect(l.reconciles(U)).toBe(true);
  });

  it("createTestMeter and createTestWallet are thin views over the same ledger", async () => {
    const c = clock();
    const l = new InMemoryLedger(c.now);
    const wallet = createTestWallet(l, {
      included: (userId, now) => [
        { userId, packageId: "trial_taste", kind: "trial", source: "trial_taste", sourceId: userId, micro: 100_000, expiresAt: new Date(now.getTime() + 7 * DAY) },
      ],
    });
    await wallet.ensureIncludedGrants(U, new Date(c.now()));
    await wallet.ensureIncludedGrants(U, new Date(c.now()));
    expect((await wallet.balance(U)).availableMicro).toBe(100_000);
    expect(await wallet.accessSources(U)).toEqual(["trial"]);
    const meter = createTestMeter(l, U);
    expect(await meter.reserve("r1", 0, 30_000)).toMatchObject({ ok: true });
    expect(await meter.settle("r1", 0, 2_000, { input_tokens: 10, output_tokens: 5, model: "claude-haiku-5-5" }, true)).toMatchObject({ ok: true });
    expect((await wallet.balance(U)).availableMicro).toBe(98_000);
  });

  it("refuses to load in production", () => {
    const prev = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      expect(() => new InMemoryLedger()).toThrow(/production/);
    } finally {
      if (prev === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prev;
    }
  });
});
