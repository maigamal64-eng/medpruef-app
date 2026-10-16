/**
 * a-whop-pin-hotfix (production hotfix 2, 16 Oct): port of
 * a-whop-api-version-pin (Whop review G7) onto the G1 hotfix. The production
 * key now gets 2026-10-09-2 without the header (money objects, plan_id /
 * membership_id); with Api-Version-Date 2025-01-01 it gets numbers and
 * nested records, which every parser expects.
 *
 * 1. Every Whop API fetch in src/ and scripts/ sends Api-Version-Date.
 * 2. A payment in the 2025-01-01 shape (bare numbers) and the same payment in
 *    the 2026-09-02-1 Native Payments shape (money objects
 *    { amount, currency, decimals, display_decimals }, amount a major-unit
 *    decimal string, related records as ids) give the same cents, the same
 *    refund verdict and the same membership/member ids.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WHOP_API_VERSION_DATE, whopHeaders, whopMoneyCents, whopMoneyMajor } from "@/lib/whop-api";
import { extractWhopPayment, looksRefunded, paginateWhopLedger, createWhopCheckoutSession } from "@/lib/whop";
import { paidAmountCents } from "@/lib/mentor/credits/grant-payment";
import { checkMentorPlan, comparePlan, resetPlanCheckCache } from "@/lib/mentor/credits/plan-check";
import { fetchWhopMembership } from "@/lib/whop-buyer";
import { loadWhopBillingRead } from "@/lib/whop-subscription-snapshot";
import { checkWhopPaymentForGrant, judgePaymentForGrant } from "@/lib/whop-payment-read";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
});

// ── 1. The header on every fetch ─────────────────────────────────────────

function codeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : codeFiles(p);
    return /\.(ts|tsx|mts|mjs|js)$/.test(e.name) ? [p] : [];
  });
}

/** The argument text of each fetch call that names api.whop.com in its URL. */
function whopFetchCalls(source: string): string[] {
  const out: string[] = [];
  const re = /\b(fetch|fetchImpl)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    const args = source.slice(m.index, i);
    if (args.includes("api.whop.com")) out.push(args);
  }
  return out;
}

describe("Api-Version-Date on every Whop call", () => {
  it("pins the version the parsers were written for", () => {
    expect(WHOP_API_VERSION_DATE).toBe("2025-01-01");
    expect(whopHeaders("k")).toEqual({ Authorization: "Bearer k", Accept: "application/json", "Api-Version-Date": "2025-01-01" });
    // extra headers never override the key, Accept or the pin
    expect(whopHeaders("k", { "Api-Version-Date": "2026-10-15", "Idempotency-Key": "x" })).toMatchObject({
      "Api-Version-Date": "2025-01-01",
      "Idempotency-Key": "x",
    });
    // nor in another letter case (fetch would join the values)
    const h = whopHeaders("k", { authorization: "x", "API-VERSION-DATE": "2026-10-15", accept: "text/html" });
    expect(Object.keys(h).map((k) => k.toLowerCase()).sort()).toEqual(["accept", "api-version-date", "authorization"]);
    expect(new Headers(h).get("authorization")).toBe("Bearer k");
    expect(new Headers(h).get("api-version-date")).toBe("2025-01-01");
  });

  it("an unreadable refunded-amount object fails closed as refunded", () => {
    expect(looksRefunded({ status: "paid", refunded_amount: { currency: "eur" } })).toBe(true);
    expect(looksRefunded({ status: "paid", refunded_amount: { amount: null } })).toBe(true);
    expect(looksRefunded({ status: "paid", refunded_amount: null })).toBe(false);
    expect(looksRefunded({ status: "paid", refunded_amount: "abc" })).toBe(false);
  });

  it("every fetch to api.whop.com in src/ and scripts/ sends the pin", () => {
    const root = process.cwd();
    const files = [...codeFiles(path.join(root, "src")), ...codeFiles(path.join(root, "scripts")), ...codeFiles(path.join(root, "services"))]
      .filter((f) => fs.readFileSync(f, "utf8").includes("api.whop.com"));
    const calls = files.flatMap((f) => whopFetchCalls(fs.readFileSync(f, "utf8")).map((c) => ({ f, c })));
    expect(calls.length).toBeGreaterThanOrEqual(7);
    const missing = calls.filter(({ c }) => !/headers:\s*whopHeaders\(/.test(c) && !/"Api-Version-Date"/.test(c));
    expect(missing.map(({ f }) => path.relative(root, f))).toEqual([]);
  });

  it("no Whop call builds a bare Bearer header outside whop-api.ts", () => {
    const root = process.cwd();
    const files = [...codeFiles(path.join(root, "src")), ...codeFiles(path.join(root, "scripts"))]
      .filter((f) => !f.endsWith(path.join("lib", "whop-api.ts")))
      // release-int-8: the one-off v2 plan creator (a-whop-grant-amount-guard)
      // was written and read back against the key's own version; it sends a
      // pin only when WHOP_API_VERSION_DATE is set. Kassa decides on Mon 19 Oct.
      .filter((f) => !f.endsWith(path.join("whop", "create-v2-plans.ts")))
      .filter((f) => /api\.whop\.com/.test(fs.readFileSync(f, "utf8")));
    const offenders = files.filter((f) => /Authorization:\s*`Bearer/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("the buyer lookup, billing read, ledger, checkout, payment re-read and plan check send it on the wire", async () => {
    process.env.WHOP_API_KEY = "k";
    const seen: Array<Record<string, string>> = [];
    const fake = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ id: "ch_1", purchase_url: "https://whop.com/x", status: "paid", data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fake);
    await fetchWhopMembership("mem_1");
    await loadWhopBillingRead("mem_1", "first_month_19");
    await paginateWhopLedger({ apiKey: "k", endpoint: "payments", query: "x=1", tag: "t" });
    await createWhopCheckoutSession({ planId: "plan_1", metadata: {}, redirectUrl: "https://medpruf.com" });
    await checkWhopPaymentForGrant({ paymentId: "pay_1", planId: "plan_1", userId: "u-1", apiKey: "k" });
    resetPlanCheckCache();
    await checkMentorPlan({ planId: "plan_1", priceCents: 990, kind: "subscription", apiKey: "k" });
    expect(seen).toHaveLength(6);
    for (const h of seen) {
      expect(h["Api-Version-Date"]).toBe("2025-01-01");
      expect(h.Authorization).toBe("Bearer k");
    }
    // the checkout keeps its content type
    expect(seen[3]["Content-Type"]).toBe("application/json");
  });
});

// ── 2. Same cents, same refund verdict in both shapes ────────────────────

const money = (amount: string, currency = "eur") => ({ amount, currency, decimals: 2, display_decimals: 2 });

/** 2025-01-01 (original) shape: bare numbers, embedded related records. */
function legacyPayment(o: { total: number; net: number; refunded: number; status: string; substatus: string; refundedAt?: string | null }) {
  return {
    id: "pay_1",
    status: o.status,
    substatus: o.substatus,
    currency: "eur",
    final_amount: o.total,
    subtotal: o.total,
    total: o.total,
    usd_total: Math.round(o.total * 1.1 * 100) / 100,
    amount_after_fees: o.net,
    refunded_amount: o.refunded,
    refunded_at: o.refundedAt ?? null,
    plan: { id: "plan_redactedec56d4df" },
    membership: { id: "mem_ABC" },
    member: { id: "mber_XYZ", email: "a@example.com" },
    user: { id: "user_1", email: "a@example.com" },
    metadata: { medpruef_user_id: "u-1", tier: "first_month_19" },
    created_at: "2026-10-01T10:00:00Z",
  };
}

/** 2026-09-02-1 (Native Payments) shape: money objects, related records as ids. */
function nativePayment(o: { total: string; net: string; refunded: string | null; status: string; substatus: string; refundedAt?: string | null }) {
  return {
    id: "pay_1",
    status: o.status,
    substatus: o.substatus,
    currency: "eur",
    total: money(o.total),
    subtotal: money(o.total),
    tax_amount: null,
    usd_total: money((Math.round(Number(o.total) * 1.1 * 100) / 100).toFixed(2), "usd"),
    amount_after_fees: money(o.net),
    refunded_amount: o.refunded === null ? null : money(o.refunded),
    tax_refunded_amount: money("0.00"),
    refunded_at: o.refundedAt ?? null,
    account_id: "biz_1",
    plan_id: "plan_redactedec56d4df",
    product_id: "prod_1",
    membership_id: "mem_ABC",
    member_id: "mber_XYZ",
    email: "a@example.com",
    user: { id: "user_1", username: "a", name: "A", profile_picture: null },
    metadata: { medpruef_user_id: "u-1", tier: "first_month_19" },
    created_at: "2026-10-01T10:00:00Z",
  };
}

const CASES = [
  {
    name: "paid 19 EUR",
    legacy: legacyPayment({ total: 19, net: 17.72, refunded: 0, status: "paid", substatus: "succeeded" }),
    native: nativePayment({ total: "19.00", net: "17.72", refunded: "0.00", status: "paid", substatus: "succeeded" }),
    cents: 1772, paid: 1772, refunded: false,
  },
  {
    name: "paid, refunded_amount absent (native null)",
    legacy: { ...legacyPayment({ total: 49, net: 46.1, refunded: 0, status: "paid", substatus: "succeeded" }), refunded_amount: undefined },
    native: nativePayment({ total: "49.00", net: "46.10", refunded: null, status: "paid", substatus: "succeeded" }),
    cents: 4610, paid: 4610, refunded: false,
  },
  {
    name: "partially refunded",
    legacy: legacyPayment({ total: 19, net: 17.72, refunded: 5, status: "paid", substatus: "succeeded" }),
    native: nativePayment({ total: "19.00", net: "17.72", refunded: "5.00", status: "paid", substatus: "succeeded" }),
    cents: 1772, paid: 1772, refunded: true,
  },
  {
    name: "fully refunded, refund only in the amount",
    legacy: legacyPayment({ total: 19, net: 17.72, refunded: 19, status: "paid", substatus: "succeeded" }),
    native: nativePayment({ total: "19.00", net: "17.72", refunded: "19.00", status: "paid", substatus: "succeeded" }),
    cents: 1772, paid: 1772, refunded: true,
  },
  {
    name: "refunded by substatus and timestamp",
    legacy: legacyPayment({ total: 19, net: 17.72, refunded: 19, status: "paid", substatus: "refunded", refundedAt: "2026-10-03T09:00:00Z" }),
    native: nativePayment({ total: "19.00", net: "17.72", refunded: "19.00", status: "paid", substatus: "refunded", refundedAt: "2026-10-03T09:00:00Z" }),
    cents: 1772, paid: 1772, refunded: true,
  },
  {
    name: "EUR 0 card trial start",
    legacy: legacyPayment({ total: 0, net: 0, refunded: 0, status: "paid", substatus: "succeeded" }),
    native: nativePayment({ total: "0.00", net: "0.00", refunded: "0.00", status: "paid", substatus: "succeeded" }),
    cents: 0, paid: 0, refunded: false,
  },
  {
    name: "failed charge",
    legacy: legacyPayment({ total: 24, net: 0, refunded: 0, status: "open", substatus: "failed" }),
    native: nativePayment({ total: "24.00", net: "0.00", refunded: "0.00", status: "open", substatus: "failed" }),
    cents: 0, paid: 0, refunded: false,
  },
];

describe("2025-01-01 and 2026-09-02-1 payments read the same", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const a = extractWhopPayment(c.legacy);
      const b = extractWhopPayment(c.native);
      expect(a.amountCents).toBe(c.cents);
      expect(b.amountCents).toBe(c.cents);
      expect(paidAmountCents(c.legacy)).toBe(c.paid);
      expect(paidAmountCents(c.native)).toBe(c.paid);
      expect(looksRefunded(c.legacy)).toBe(c.refunded);
      expect(looksRefunded(c.native)).toBe(c.refunded);
      for (const k of ["paymentId", "planId", "membershipId", "memberId", "metaUserId", "metaTier", "currency", "email"] as const) {
        expect(b[k], k).toBe(a[k]);
      }
    });
  }

  it("checkout verify step 3b (judgePaymentForGrant) gives the same verdict", () => {
    const expect3b = { paymentId: "pay_1", planId: "plan_redactedec56d4df", userId: "u-1" };
    for (const c of CASES) {
      expect(judgePaymentForGrant(c.native, expect3b), c.name).toEqual(judgePaymentForGrant(c.legacy, expect3b));
    }
    expect(judgePaymentForGrant(CASES[0].native, expect3b)).toEqual({ ok: true, membershipId: "mem_ABC", amountCents: 1772, chargedCents: 1900, currency: "eur" });
  });

  it("a referral-sized amount is the same number, never null, in the native shape", () => {
    expect(extractWhopPayment(nativePayment({ total: "129.00", net: "122.35", refunded: "0.00", status: "paid", substatus: "succeeded" })).amountCents).toBe(12235);
  });
});

describe("whopMoneyMajor / whopMoneyCents", () => {
  it("reads numbers, numeric strings and money objects alike", () => {
    expect(whopMoneyCents(19)).toBe(1900);
    expect(whopMoneyCents("19.00")).toBe(1900);
    expect(whopMoneyCents(money("19.00"))).toBe(1900);
    expect(whopMoneyCents(money("17.72"))).toBe(1772);
    expect(whopMoneyCents({ amount: 4.9 })).toBe(490);
    expect(whopMoneyCents(money("0.00"))).toBe(0);
  });

  it("never scales by decimals: the string already carries the point", () => {
    expect(whopMoneyMajor({ amount: "1900", currency: "eur", decimals: 2, display_decimals: 2 })).toBe(1900);
  });

  it("fails closed on anything unreadable", () => {
    for (const v of [null, undefined, "", "  ", "abc", NaN, Infinity, {}, { amount: null }, { amount: "" }, { amount: { amount: "1" } }, [], [19], { value: 19 }]) {
      expect(whopMoneyMajor(v)).toBeNull();
    }
  });
});

describe("mentor plan check reads both plan shapes", () => {
  it("a 2025-01-01 numeric plan and a money-object plan give the same verdict", () => {
    const legacy = { currency: "eur", initial_price: 0, renewal_price: 9.9, trial_period_days: 0 };
    const native = { currency: "eur", initial_price: money("0.00"), renewal_price: money("9.90"), trial_period_days: 0 };
    expect(comparePlan(legacy, 990, "subscription")).toEqual({ ok: true });
    expect(comparePlan(native, 990, "subscription")).toEqual({ ok: true });
    expect(comparePlan({ ...native, renewal_price: money("12.00") }, 990, "subscription")).toEqual(comparePlan({ ...legacy, renewal_price: 12 }, 990, "subscription"));
  });
});
