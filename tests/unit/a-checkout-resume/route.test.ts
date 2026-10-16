import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[] = [];
let events: unknown[] = [];
let suppressed = false;
let paid = false;
let userRow: Record<string, unknown> | null = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free", exam_date: null };
let refundedRows: unknown[] = [];

function table(name: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "in", "gte", "order", "limit"]) chain[m] = self;
  chain.maybeSingle = async () => { reads.push(name); return { data: userRow, error: null }; };
  chain.then = (res: (v: unknown) => unknown) => { reads.push(name); return res({ data: name === "payment_events" ? events : refundedRows, error: null }); };
  return chain;
}
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: (n: string) => table(n) }) }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "u1", role: "user", tier: "free", tierExpiresAt: null }),
  isPaidAccess: () => paid,
}));
vi.mock("@/lib/mail-suppression", () => ({ isMailSuppressed: async () => { reads.push("mail_suppression"); return suppressed; } }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));

const { GET } = await import("@/app/api/checkout-resume/route");
const call = async () => (await GET(new Request("http://x/api/checkout-resume") as never)).json();
const opened = () => [{ event: "checkout_session_created", created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), tier: "first_3mo_27" }];

beforeEach(() => {
  reads.length = 0; events = opened(); suppressed = false; paid = false; refundedRows = [];
  userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free", exam_date: null };
  delete process.env.CHECKOUT_RESUME_ENABLED; delete process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS;
});

describe("GET /api/checkout-resume", () => {
  it("flag off: hidden with no database read", async () => {
    expect(await call()).toEqual({ eligible: false });
    expect(reads).toEqual([]);
  });
  it("flag on, unpaid opener: eligible with a plan key and nothing else sensitive", async () => {
    process.env.CHECKOUT_RESUME_ENABLED = "true";
    const body = await call();
    expect(body).toEqual({ eligible: true, tier: "first_3mo_27", fit: null });
  });
  it("no opener: one read only (no users, refunds or do-not-contact)", async () => {
    process.env.CHECKOUT_RESUME_ENABLED = "true"; events = [];
    expect(await call()).toEqual({ eligible: false });
    expect(reads).toEqual(["payment_events"]);
  });
  it("paid access: stops after the events read", async () => {
    process.env.CHECKOUT_RESUME_ENABLED = "true"; paid = true;
    expect(await call()).toEqual({ eligible: false });
    expect(reads).toEqual(["payment_events"]);
  });
  it("do-not-contact, refunded, excluded id and unreadable account hide it", async () => {
    process.env.CHECKOUT_RESUME_ENABLED = "true";
    suppressed = true; expect(await call()).toEqual({ eligible: false });
    suppressed = false; refundedRows = [{ id: "s1" }]; expect(await call()).toEqual({ eligible: false });
    refundedRows = []; userRow = null; expect(await call()).toEqual({ eligible: false });
    userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free", exam_date: null };
    process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS = "U1"; expect(await call()).toEqual({ eligible: false });
  });
  it("an expired Pro tier is not paid access, so a lapsed learner is eligible", async () => {
    process.env.CHECKOUT_RESUME_ENABLED = "true"; paid = false;
    userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "pro", exam_date: null };
    expect((await call()).eligible).toBe(true);
  });
});
