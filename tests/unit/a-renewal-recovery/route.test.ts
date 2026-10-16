import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[] = [];
let rows: unknown[] = [];
let grants: unknown[] = [];
let refunded: unknown[] = [];
let revokes: unknown[] = [];
let suppressed = false;
let suppressionCategory = "";
let userRow: Record<string, unknown> | null = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "pro" };

const calls = { user_events: 0 };
function table(name: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "gte", "order", "limit"]) chain[m] = self;
  chain.maybeSingle = async () => { reads.push(name); return { data: userRow, error: null }; };
  chain.then = (res: (v: unknown) => unknown) => { reads.push(name); return res({ data: name === "user_events" ? (calls.user_events++ === 0 ? rows : revokes) : name === "payment_events" ? grants : refunded, error: null }); };
  return chain;
}
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: (n: string) => table(n) }) }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "u1", role: "user", tier: "pro", tierExpiresAt: null }) }));
vi.mock("@/lib/mail-suppression", () => ({ isMailSuppressed: async (_d: unknown, _e: unknown, c: string) => { reads.push("mail_suppression"); suppressionCategory = c; return suppressed; } }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: () => {} }));

const { GET } = await import("@/app/api/renewal-recovery/route");
const call = async () => { calls.user_events = 0; return (await GET(new Request("http://x/api/renewal-recovery") as never)).json(); };
const URL_OK = "https://whop.com/checkout/recover/abc";
const failed = () => [{ created_at: new Date(Date.now() - 86_400_000).toISOString(), event_data: { event: "payment.failed", recovery_url: URL_OK } }];

beforeEach(() => {
  reads.length = 0; calls.user_events = 0; revokes = []; rows = failed(); grants = []; refunded = []; suppressed = false; suppressionCategory = "";
  userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "pro" };
  delete process.env.RENEWAL_RECOVERY_CARD_ENABLED; delete process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS;
});

describe("GET /api/renewal-recovery", () => {
  it("flag off: hidden with no database read", async () => {
    expect(await call()).toEqual({ eligible: false });
    expect(reads).toEqual([]);
  });
  it("flag on: eligible with the learner's own link and a kind, while Pro access still runs", async () => {
    process.env.RENEWAL_RECOVERY_CARD_ENABLED = "true";
    expect(await call()).toEqual({ eligible: true, url: URL_OK, kind: "failed" });
    expect(suppressionCategory).toBe("transactional");
  });
  it("no row: one read only", async () => {
    process.env.RENEWAL_RECOVERY_CARD_ENABLED = "true"; rows = [];
    expect(await call()).toEqual({ eligible: false });
    expect(reads).toEqual(["user_events"]);
  });
  it("a later payment, scope-all suppression, refunded history, excluded id and unreadable account hide it", async () => {
    process.env.RENEWAL_RECOVERY_CARD_ENABLED = "true";
    grants = [{ created_at: new Date().toISOString() }]; expect(await call()).toEqual({ eligible: false });
    grants = []; revokes = [{ created_at: new Date().toISOString() }]; calls.user_events = 0; expect(await call()).toEqual({ eligible: false });
    revokes = []; calls.user_events = 0; suppressed = true; expect(await call()).toEqual({ eligible: false });
    suppressed = false; refunded = [{ id: "s1" }]; expect(await call()).toEqual({ eligible: false });
    refunded = []; userRow = null; expect(await call()).toEqual({ eligible: false });
    userRow = { id: "u1", email: "user-14be81d5@example.com", role: "user", tier: "pro" };
    process.env.CHECKOUT_RESUME_EXCLUDE_USER_IDS = "U1"; expect(await call()).toEqual({ eligible: false });
  });
  it("a link that is not on whop.com is never returned", async () => {
    process.env.RENEWAL_RECOVERY_CARD_ENABLED = "true";
    rows = [{ created_at: new Date().toISOString(), event_data: { event: "payment.failed", recovery_url: "https://evil.example/x" } }];
    expect(await call()).toEqual({ eligible: false });
  });
});
