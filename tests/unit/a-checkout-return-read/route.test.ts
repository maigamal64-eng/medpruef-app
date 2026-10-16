import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[] = [];
const inserts: Array<{ event_type: string; event_data: Record<string, unknown> }> = [];
let payEvents: unknown[] = [];
let returnSeen: unknown[] = [];
let userRow: Record<string, unknown> | null = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };
let refundedRows: unknown[] = [];
let suppressed = false;
let paid = false;

function table(name: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "in", "gte", "order", "limit"]) chain[m] = self;
  chain.maybeSingle = async () => { reads.push(name); return { data: userRow, error: null }; };
  chain.insert = async (row: { event_type: string; event_data: Record<string, unknown> }) => { inserts.push(row); return { error: null }; };
  chain.then = (res: (v: unknown) => unknown) => { reads.push(name); return res({ data: name === "payment_events" ? payEvents : name === "user_events" ? returnSeen : refundedRows, error: null }); };
  return chain;
}
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: (n: string) => table(n) }) }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "u1", role: "user", tier: "free", tierExpiresAt: null }),
  isPaidAccess: () => paid,
}));
vi.mock("@/lib/mail-suppression", () => ({ isMailSuppressed: async () => { reads.push("mail_suppression"); return suppressed; } }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));
vi.mock("@/lib/db-unavailable-route", () => ({ withDbUnavailable: (h: unknown) => h }));

const { POST } = await import("@/app/api/checkout-return/route");
const call = async (body: unknown) => {
  const res = await POST(new Request("http://x/api/checkout-return", { method: "POST", body: JSON.stringify(body) }) as never);
  return { status: res.status, json: await res.json() };
};
const redirected = () => [{ event: "checkout_redirected", created_at: new Date(Date.now() - 4 * 60_000).toISOString(), tier: "flex_month" }];

beforeEach(() => {
  reads.length = 0; inserts.length = 0; payEvents = redirected(); returnSeen = []; refundedRows = []; suppressed = false; paid = false;
  userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };
  delete process.env.CHECKOUT_RETURN_READ_ENABLED; delete process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS;
});

describe("POST /api/checkout-return", () => {
  it("flag off: 404 with no database read", async () => {
    const r = await call({ kind: "return", page: "/" });
    expect(r.status).toBe(404); expect(reads).toEqual([]); expect(inserts).toEqual([]);
  });
  it("records one checkout_return with bucket, tier and page, and arms the prompt", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true";
    const r = await call({ kind: "return", page: "/pricing" });
    expect(r.json).toEqual({ recorded: true, prompt: true });
    expect(inserts).toEqual([{ user_id: "u1", event_type: "checkout_return", event_data: { bucket: "1_5m", tier: "flex_month", page: "/pricing" } }]);
  });
  it("a repeat read for the same redirect records nothing but still arms the prompt", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true"; returnSeen = [{ id: 1 }];
    expect((await call({ kind: "return", page: "/" })).json).toEqual({ recorded: false, prompt: true });
    expect(inserts).toEqual([]);
  });
  it("no redirect: one read only; paid access: one read only", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true"; payEvents = [];
    expect((await call({ kind: "return", page: "/" })).json).toEqual({ recorded: false, prompt: false });
    expect(reads).toEqual(["payment_events"]);
    reads.length = 0; payEvents = redirected(); paid = true;
    await call({ kind: "return", page: "/" });
    expect(reads).toEqual(["payment_events"]); expect(inserts).toEqual([]);
  });
  it("do-not-contact, refunded, excluded id and unreadable account record nothing", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true";
    suppressed = true; expect((await call({ kind: "return", page: "/" })).json.recorded).toBe(false);
    suppressed = false; refundedRows = [{ id: "s" }]; expect((await call({ kind: "return", page: "/" })).json.recorded).toBe(false);
    refundedRows = []; userRow = null; expect((await call({ kind: "return", page: "/" })).json.recorded).toBe(false);
    userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "free" };
    process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS = "U1"; expect((await call({ kind: "return", page: "/" })).json.recorded).toBe(false);
    expect(inserts).toEqual([]);
  });
  it("stall_shown is written once per redirect", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true"; returnSeen = [{ id: 9 }];
    expect((await call({ kind: "stall_shown", surface: "pricing" })).json).toEqual({ recorded: false, prompt: false });
    expect(inserts).toEqual([]);
  });
  it("a failed read is a retryable 503, never an answer of no", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true"; userRow = null;
    const r = await call({ kind: "return", page: "/" });
    expect(r.status).toBe(503); expect(r.json).toMatchObject({ retry: true });
  });
  it("stall_shown writes checkout_stall_shown for a real return, validates the surface", async () => {
    process.env.CHECKOUT_RETURN_READ_ENABLED = "true";
    expect((await call({ kind: "stall_shown", surface: "pricing" })).json.recorded).toBe(true);
    expect(inserts[0]).toMatchObject({ event_type: "checkout_stall_shown", event_data: { tier: "flex_month", surface: "pricing" } });
    expect((await call({ kind: "stall_shown", surface: "x" })).status).toBe(400);
    expect((await call({ kind: "stall_shown", surface: "home" })).status).toBe(400);
    expect((await call({ kind: "nope" })).status).toBe(400);
  });
});
