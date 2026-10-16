/**
 * a-whop-webhook-ack (G3): every Whop API call carries a deadline, so a hung
 * Whop read can never hold a webhook past Whop's 5 s delivery limit.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWhopMembership } from "@/lib/whop-buyer";
import { cancelMembershipAtPeriodEnd } from "@/lib/whop-membership-cancel";
import { loadWhopBillingRead } from "@/lib/whop-subscription-snapshot";
import { paginateWhopLedger, createWhopCheckoutSession } from "@/lib/whop";
import { WHOP_CHECKOUT_CREATE_TIMEOUT_MS, WHOP_FETCH_TIMEOUT_MS } from "@/lib/whop-timeouts";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

function srcFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return srcFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
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

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
});

describe("Whop fetch deadlines", () => {
  it("every Whop fetch in src/ passes an AbortSignal.timeout", () => {
    const files = srcFiles(path.join(process.cwd(), "src")).filter((f) => fs.readFileSync(f, "utf8").includes("api.whop.com"));
    const calls = files.flatMap((f) => whopFetchCalls(fs.readFileSync(f, "utf8")).map((c) => ({ f, c })));
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const missing = calls.filter(({ c }) => !/signal:\s*AbortSignal\.timeout\((WHOP_(FETCH|CHECKOUT_CREATE)_TIMEOUT_MS|timeoutMs)\)/.test(c));
    expect(missing.map(({ f }) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("the cancel helper defaults to the webhook deadline (the half-year cron passes the longer one)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/whop-membership-cancel.ts"), "utf8");
    expect(src).toMatch(/timeoutMs: number = WHOP_FETCH_TIMEOUT_MS/);
  });

  it("webhook-path reads end inside Whop's 5 s limit", () => {
    expect(WHOP_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(3000);
    expect(WHOP_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(4000);
    expect(WHOP_CHECKOUT_CREATE_TIMEOUT_MS).toBe(8000);
  });

  it("the buyer lookup, billing read, cancel, ledger and checkout calls hand fetch a signal", async () => {
    process.env.WHOP_API_KEY = "k";
    const seen: Array<AbortSignal | undefined> = [];
    const fake = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return new Response(JSON.stringify({ id: "ch_1", purchase_url: "https://whop.com/x", data: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fake);
    await fetchWhopMembership("mem_1");
    await loadWhopBillingRead("mem_1", "first_month_19");
    await cancelMembershipAtPeriodEnd("mem_1", "k1", fake as unknown as typeof fetch);
    await paginateWhopLedger({ apiKey: "k", endpoint: "payments", query: "x=1", tag: "t" });
    await createWhopCheckoutSession({ planId: "plan_1", metadata: {}, redirectUrl: "https://medpruf.com" });
    expect(seen).toHaveLength(5);
    for (const s of seen) expect(s).toBeInstanceOf(AbortSignal);
  });

  it("a timed-out membership read is provider_unavailable (status 0), never an email guess", async () => {
    process.env.WHOP_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }));
    const r = await fetchWhopMembership("mem_1");
    expect(r).toMatchObject({ ok: false, status: 0 });
  });
});
