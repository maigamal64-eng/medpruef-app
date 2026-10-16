import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<Record<string, unknown>> = [];
let redirects: unknown[] = [];
let userRow: Record<string, unknown> | null = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };

function table(name: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  let ev = "";
  for (const m of ["select", "gte", "gt", "order", "limit"]) chain[m] = self;
  chain.in = (c: string) => { if (c === "event") ev = "checkout_redirected"; return chain; };
  chain.eq = (c: string, v: string) => { if (c === "event") ev = v; return chain; };
  chain.maybeSingle = async () => ({ data: name === "users" ? userRow : { tier: "flex_month" }, error: null });
  chain.insert = async (row: Record<string, unknown>) => { inserts.push({ table: name, ...row }); return { error: null }; };
  chain.then = (res: (v: unknown) => unknown) => res({ data: name === "payment_events" && ev === "checkout_redirected" ? redirects : [], error: null });
  return chain;
}
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: (n: string) => table(n) }) }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "u1", role: "user", tier: "free", tierExpiresAt: null }),
  isPaidAccess: () => false,
}));
vi.mock("@/lib/mail-suppression", () => ({ isMailSuppressed: async () => false }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));

const elig = await import("@/app/api/checkout-feedback/eligibility/route");
const feedback = await import("@/app/api/checkout-feedback/route");
const eligible = async () => (await elig.GET(new Request("http://x/api/checkout-feedback/eligibility") as never)).json();

beforeEach(() => {
  inserts.length = 0; redirects = [{ event: "checkout_redirected", created_at: new Date().toISOString(), tier: "flex_month" }];
  userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };
  delete process.env.CHECKOUT_RETURN_READ_ENABLED; delete process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS;
});

describe("stall prompt eligibility", () => {
  it("flag off: unchanged answer, no returnRead key", async () => {
    expect(await eligible()).toEqual({ eligible: true, tier: "flex_month" });
  });
  it("flag on: returnRead and the resume exclusions", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true";
    expect(await eligible()).toEqual({ eligible: true, tier: "flex_month", returnRead: true });
    userRow = { id: "u1", email: "user-847887c3@example.com", role: "user", tier: "free" };
    expect((await eligible()).eligible).toBe(false);
    userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };
    process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS = "u1";
    expect((await eligible()).eligible).toBe(false);
    delete process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS;
    redirects = [{ event: "checkout_redirected", created_at: new Date().toISOString(), tier: "notes_pro_trial" }];
    expect((await eligible()).eligible).toBe(false);
  });
});

describe("stall prompt answer", () => {
  const post = async (body: unknown) => feedback.POST(new Request("http://x/api/checkout-feedback", { method: "POST", body: JSON.stringify(body) }) as never);
  it("flag off: only the feedback row", async () => {
    await post({ reason: "price", url: "/pricing" });
    expect(inserts.map((i) => i.table)).toEqual(["user_feedback"]);
  });
  it("flag on: also one checkout_stall_answered with the enum reason, never the details text", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true";
    await post({ reason: "other", details: "my card was blocked", url: "/pricing" });
    const ev = inserts.find((i) => i.table === "user_events");
    expect(ev).toMatchObject({ event_type: "checkout_stall_answered", event_data: { reason: "other", tier: "flex_month", surface: "pricing" } });
    expect(JSON.stringify(ev)).not.toContain("blocked");
  });
  it("flag on: no answered row for an excluded account or outside the return window (the feedback row is still saved)", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true";
    userRow = { id: "u1", email: "user-847887c3@example.com", role: "user", tier: "free" };
    await post({ reason: "price", url: "/pricing" });
    userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };
    redirects = [{ event: "checkout_redirected", created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), tier: "flex_month" }];
    await post({ reason: "price", url: "/pricing" });
    expect(inserts.map((i) => i.table)).toEqual(["user_feedback", "user_feedback"]);
  });
});
