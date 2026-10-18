import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), whop: vi.fn(), log: vi.fn(), forget: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, forgetGuardUser: m.forget }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: m.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), checkRateLimit: m.rate }));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), createWhopCheckoutSession: m.whop }));

import { GET, POST } from "@/app/api/trial/claim/route";
import { resetTrialClaimCache } from "@/lib/trial-claim/server";
import { signClaimToken } from "@/lib/trial-claim/token";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { ensureReverseTrial, resetReverseTrialCache } from "@/lib/pricing-v2/reverse-trial-server";

const DAY = 86_400_000;
const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const SECRET = "s".repeat(40);
const EMAIL = "learner@example.com";

type World = {
  user: Record<string, unknown> | null;
  subs: unknown[];
  ownTrial: unknown;
  identityRows: unknown[];
  ipCount: number;
  trialInsertError?: { code: string; message: string } | null;
  subInsertError?: { message: string } | null;
  updatedRows?: unknown[];
  updateError?: { message: string } | null;
  reread?: Record<string, unknown> | null;
  existingSub?: unknown[];
};

function world(over: Partial<World> = {}): World {
  return {
    user: { role: "user", tier: "free", tier_expires_at: null, created_at: "2026-08-01T00:00:00Z", is_banned: false, email: EMAIL, email_verified_at: "2026-08-02T00:00:00Z", telegram_id: 4242 },
    subs: [],
    ownTrial: null,
    identityRows: [],
    ipCount: 0,
    updatedRows: [{ id: UID }],
    ...over,
  };
}

function fake(w: World) {
  return createFakeSupabase((c: FakeCall): FakeResult => {
    if (c.table === "users" && c.op === "select") return { data: c.columns === "tier, tier_expires_at" ? w.reread ?? null : w.user };
    if (c.table === "users" && c.op === "update") return w.updateError ? { error: w.updateError } : { data: w.updatedRows };
    if (c.table === "subscriptions" && c.op === "select") return { data: c.columns === "id" ? w.existingSub ?? [] : w.subs };
    if (c.table === "subscriptions" && c.op === "insert") return w.subInsertError ? { error: w.subInsertError } : { data: { id: "sub_1" } };
    if (c.table === "trials" && c.op === "select") {
      if (c.filters.some((f) => f.kind === "or")) return { data: w.identityRows };
      if (c.filters.some((f) => f.column === "ip_hash")) return { count: w.ipCount, data: null };
      return { data: w.ownTrial };
    }
    if (c.table === "trials" && c.op === "insert") return w.trialInsertError ? { error: w.trialInsertError } : { data: null };
    return { data: null };
  });
}

const get = (token?: string) => new NextRequest("https://medpruf.com/api/trial/claim", { headers: token ? { "x-claim-token": token } : {} });
const post = (body: unknown = {}) => new NextRequest("https://medpruf.com/api/trial/claim", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "5.6.7.8" } });

function flagOn() {
  vi.stubEnv("TRIAL_CLAIM_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
  vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
  vi.stubEnv("REVERSE_TRIAL_SINCE", "2026-10-20T10:00:00Z");
  vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", SECRET);
  vi.stubEnv("REVERSE_TRIAL_IP_SALT", "salt");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTrialClaimCache();
  resetReverseTrialCache();
  m.guard.mockResolvedValue({ userId: UID });
  m.rate.mockReturnValue({ allowed: true, remaining: 1, resetAt: 0, retryAfterSec: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("flag off (default)", () => {
  it("GET says disabled without a session or database read; POST is 404", async () => {
    const f = fake(world());
    m.client.mockReturnValue(f.sb);
    const r = await GET(get());
    expect(await r.json()).toEqual({ enabled: false });
    expect(m.guard).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
    expect((await POST(post())).status).toBe(404);
    expect(f.calls).toHaveLength(0);
  });
  it("TRIAL_CLAIM_ENABLED alone is not enough while the reverse trial is off", async () => {
    vi.stubEnv("TRIAL_CLAIM_ENABLED", "true");
    expect((await POST(post())).status).toBe(404);
  });
});

describe("GET status", () => {
  it("an eligible account; GET writes nothing", async () => {
    flagOn();
    const f = fake(world());
    m.client.mockReturnValue(f.sb);
    const d = await (await GET(get())).json();
    expect(d).toMatchObject({ enabled: true, eligible: true, reason: "eligible", days: 3 });
    expect(f.calls.every((c) => c.op === "select")).toBe(true);
  });
  it("reports the link state: valid, expired, other account", async () => {
    flagOn();
    m.client.mockReturnValue(fake(world()).sb);
    const valid = signClaimToken({ userId: UID, emailKey: trialEmailKey(EMAIL) });
    expect((await (await GET(get(valid))).json()).link).toBe("valid");
    const old = signClaimToken({ userId: UID, emailKey: null, days: 1, now: new Date(Date.now() - 2 * DAY) });
    expect((await (await GET(get(old))).json()).link).toBe("expired");
    const other = signClaimToken({ userId: OTHER, emailKey: null });
    expect((await (await GET(get(other))).json()).link).toBe("other_account");
  });
});

describe("POST claim", () => {
  it("grants 3 days with the three writes in order and creates no checkout session", async () => {
    flagOn();
    const f = fake(world());
    m.client.mockReturnValue(f.sb);
    const r = await POST(post());
    const d = await r.json();
    expect(r.status).toBe(200);
    expect(d).toMatchObject({ claimed: true, already: false, days: 3 });
    const end = Date.parse(d.ends_at);
    expect(end - Date.now()).toBeGreaterThan(3 * DAY - 60_000);
    expect(end - Date.now()).toBeLessThanOrEqual(3 * DAY);

    const writes = f.calls.filter((c) => c.op !== "select");
    expect(writes.map((c) => `${c.table}:${c.op}`)).toEqual(["trials:insert", "subscriptions:insert", "users:update", "user_events:insert"]);
    const trial = writes[0].payload as Record<string, unknown>;
    expect(trial).toMatchObject({ user_id: UID, kind: "reverse", email_key: trialEmailKey(EMAIL), telegram_id: 4242 });
    expect(String(trial.ip_hash)).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(trial)).not.toContain("5.6.7.8");
    expect(writes[1].payload).toMatchObject({ tier: "reverse_trial", status: "active", payment_provider: "trial", amount_cents: 0 });
    expect(writes[2].payload).toMatchObject({ tier: "pro", tier_expires_at: d.ends_at });
    // Compare-and-set on what was read.
    expect(eqVal(writes[2], "tier")).toBe("free");
    expect(writes[2].filters).toContainEqual({ kind: "is", column: "tier_expires_at", value: null });
    expect(m.whop).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
    expect(f.calls.some((c) => c.table === "payment_events" || c.table === "processed_webhook_events")).toBe(false);
    expect(m.forget).toHaveBeenCalledWith(UID);
  });

  it("single use: a second claim from the same person is refused by the unique index", async () => {
    flagOn();
    const f = fake(world({ trialInsertError: { code: "23505", message: "duplicate key" } }));
    m.client.mockReturnValue(f.sb);
    const r = await POST(post());
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ claimed: false, reason: "trial_used" });
    expect(f.calls.some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(false);
  });

  it("single use: an account with its own ended claim, or an address another account used, is refused before any write", async () => {
    flagOn();
    for (const w of [world({ ownTrial: { kind: "reverse", expires_at: "2026-10-01T00:00:00Z" } }), world({ identityRows: [{ user_id: OTHER }] })]) {
      const f = fake(w);
      m.client.mockReturnValue(f.sb);
      resetTrialClaimCache();
      const r = await POST(post());
      expect(await r.json()).toMatchObject({ claimed: false, reason: "trial_used" });
      expect(f.calls.some((c) => c.op !== "select")).toBe(false);
    }
  });

  it("a repeated press while the claim runs answers success without writing", async () => {
    flagOn();
    const end = new Date(Date.now() + 2 * DAY).toISOString();
    const f = fake(world({
      user: { ...world().user!, tier: "pro", tier_expires_at: end },
      subs: [{ tier: "reverse_trial", status: "active", payment_provider: "trial", amount_cents: 0, expires_at: end }],
      ownTrial: { kind: "reverse", expires_at: end },
    }));
    m.client.mockReturnValue(f.sb);
    expect(await (await POST(post())).json()).toMatchObject({ claimed: true, already: true, ends_at: end });
    expect(f.calls.some((c) => c.op !== "select")).toBe(false);
  });

  it("refuses accounts that paid, have no linked Telegram or are new", async () => {
    flagOn();
    const cases: Array<[Partial<World>, string]> = [
      [{ subs: [{ tier: "first_month_19", status: "expired", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: "2026-09-01T00:00:00Z" }] }, "paid"],
      // a-trial-phone-gate: a confirmed address without Telegram no longer claims.
      [{ user: { ...world().user!, telegram_id: null } }, "telegram_required"],
      [{ user: { ...world().user!, email_verified_at: null, telegram_id: null } }, "telegram_required"],
      [{ user: { ...world().user!, created_at: "2026-10-25T00:00:00Z" } }, "new_account"],
    ];
    for (const [over, reason] of cases) {
      resetTrialClaimCache();
      const f = fake(world(over));
      m.client.mockReturnValue(f.sb);
      expect(await (await POST(post())).json()).toMatchObject({ claimed: false, reason });
      expect(f.calls.some((c) => c.op !== "select")).toBe(false);
    }
  });

  it("the network cap refuses with 429 before any write", async () => {
    flagOn();
    const f = fake(world({ ipCount: 3 }));
    m.client.mockReturnValue(f.sb);
    const r = await POST(post());
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ reason: "ip_limit" });
    expect(f.calls.some((c) => c.op !== "select")).toBe(false);
  });

  it("a failed write is never undone (it may have committed); the next press resumes with the stored dates", async () => {
    flagOn();
    const f = fake(world({ subInsertError: { message: "timeout" } }));
    m.client.mockReturnValue(f.sb);
    expect((await POST(post())).status).toBe(503);
    expect(f.calls.some((c) => c.op === "delete")).toBe(false);
    const lock = f.calls.find((c) => c.table === "trials" && c.op === "insert")!.payload as Record<string, string>;

    // Within 90 s the lock may belong to a request in flight: never resumed, the learner is asked to retry.
    resetTrialClaimCache();
    const young = fake(world({ ownTrial: { kind: "reverse", started_at: lock.started_at, expires_at: lock.expires_at } }));
    m.client.mockReturnValue(young.sb);
    const busy = await POST(post());
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ reason: "in_progress" });
    expect(young.calls.some((c) => c.op !== "select")).toBe(false);

    // Later press: the own lock exists, no access yet -> resume, reusing the lock's subscription row if present.
    resetTrialClaimCache();
    const startedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    lock.started_at = startedAt;
    const g = fake(world({ ownTrial: { kind: "reverse", started_at: startedAt, expires_at: lock.expires_at }, subs: [{ tier: "reverse_trial", status: "active", payment_provider: "trial", amount_cents: 0, started_at: startedAt, expires_at: lock.expires_at }], existingSub: [{ id: "sub_9" }] }));
    m.client.mockReturnValue(g.sb);
    const status = await (await GET(get())).json();
    expect(status).toMatchObject({ eligible: true, reason: "eligible" });
    const r = await POST(post());
    expect(await r.json()).toMatchObject({ claimed: true, ends_at: lock.expires_at });
    const writes = g.calls.filter((c) => c.op !== "select").map((c) => `${c.table}:${c.op}`);
    expect(writes).toEqual(["users:update", "user_events:insert"]);
    expect(g.calls.find((c) => c.table === "users" && c.op === "update")!.payload).toMatchObject({ tier_expires_at: lock.expires_at });
  });

  it("a users update that errors but committed counts as success", async () => {
    flagOn();
    const w = world({ updateError: { message: "deadline" } });
    let committedEnd: string | null = null;
    const f = createFakeSupabase((c: FakeCall): FakeResult => {
      if (c.table === "users" && c.op === "update") { committedEnd = (c.payload as { tier_expires_at: string }).tier_expires_at; return { error: { message: "deadline" } }; }
      if (c.table === "users" && c.columns === "tier, tier_expires_at") return { data: { tier: "pro", tier_expires_at: committedEnd } };
      return ((): FakeResult => {
        if (c.table === "users") return { data: w.user };
        if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_1" } };
        if (c.table === "subscriptions") return { data: [] };
        if (c.table === "trials" && c.op === "select") return c.filters.some((x) => x.column === "ip_hash") ? { count: 0 } : { data: c.filters.some((x) => x.kind === "or") ? [] : null };
        return { data: null };
      })();
    });
    m.client.mockReturnValue(f.sb);
    const r = await POST(post());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ claimed: true });
    expect(f.calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("a compare-and-set miss whose grant landed through a parallel request is a success, never an undo (review N1)", async () => {
    flagOn();
    let end: string | null = null;
    const w = world({ updatedRows: [] });
    const f = createFakeSupabase((c: FakeCall): FakeResult => {
      if (c.table === "users" && c.op === "update") { end = (c.payload as { tier_expires_at: string }).tier_expires_at; return { data: [] }; }
      if (c.table === "users" && c.columns === "tier, tier_expires_at") return { data: { tier: "pro", tier_expires_at: end } };
      if (c.table === "users") return { data: w.user };
      if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_1" } };
      if (c.table === "subscriptions") return { data: [] };
      if (c.table === "trials" && c.op === "select") return c.filters.some((x) => x.column === "ip_hash") ? { count: 0 } : { data: c.filters.some((x) => x.kind === "or") ? [] : null };
      return { data: null };
    });
    m.client.mockReturnValue(f.sb);
    expect(await (await POST(post())).json()).toMatchObject({ claimed: true });
    expect(f.calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("two parallel presses: the loser of the lock reports the winner's claim", async () => {
    flagOn();
    const end = new Date(Date.now() + 3 * DAY).toISOString();
    let reads = 0;
    const f = createFakeSupabase((c: FakeCall): FakeResult => {
      const after = reads > 0;
      if (c.table === "users" && c.op === "select") return { data: after ? { ...world().user, tier: "pro", tier_expires_at: end } : world().user };
      if (c.table === "subscriptions" && c.op === "select") return { data: after ? [{ tier: "reverse_trial", status: "active", payment_provider: "trial", amount_cents: 0, expires_at: end }] : [] };
      if (c.table === "trials" && c.op === "insert") { reads++; return { error: { code: "23505", message: "duplicate" } }; }
      if (c.table === "trials" && c.op === "select") {
        if (c.filters.some((x) => x.column === "ip_hash")) return { count: 0 };
        if (c.filters.some((x) => x.kind === "or")) return { data: after ? [{ user_id: UID }] : [] };
        return { data: after ? { kind: "reverse", started_at: new Date().toISOString(), expires_at: end } : null };
      }
      return { data: null };
    });
    m.client.mockReturnValue(f.sb);
    expect(await (await POST(post())).json()).toMatchObject({ claimed: true, already: true, ends_at: end });
  });

  it("when the account changed between read and write, both rows are removed and the learner may retry", async () => {
    flagOn();
    const f = fake(world({ updatedRows: [] }));
    m.client.mockReturnValue(f.sb);
    const r = await POST(post());
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: "changed" });
    expect(f.calls.filter((c) => c.op === "delete").map((c) => c.table)).toEqual(["subscriptions", "trials"]);
  });

  it("before the pricing-v2 changeset (missing column) the claim is unavailable, never a false no", async () => {
    flagOn();
    m.client.mockReturnValue(fake(world({ trialInsertError: { code: "42703", message: "column kind does not exist" } })).sb);
    const r = await POST(post());
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: "CLAIM_UNAVAILABLE" });
  });
});

describe("cheap refusals", () => {
  it("an account without Telegram is read in full (a payer keeps its own reason) and the reason is remembered", async () => {
    flagOn();
    const f = fake(world({ user: { ...world().user!, email_verified_at: null, telegram_id: null } }));
    m.client.mockReturnValue(f.sb);
    expect(await (await GET(get())).json()).toMatchObject({ eligible: false, reason: "telegram_required" });
    expect(f.calls.map((c) => c.table).sort()).toEqual(["subscriptions", "trials", "users"]);
    f.calls.length = 0;
    expect(await (await GET(get())).json()).toMatchObject({ reason: "telegram_required" });
    expect(f.calls).toHaveLength(0);
  });

  it("a payer without Telegram is told 'paid', never 'link Telegram'", async () => {
    flagOn();
    m.client.mockReturnValue(fake(world({ user: { ...world().user!, telegram_id: null }, subs: [{ tier: "first_month_19", status: "expired", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: "2026-09-01T00:00:00Z" }] })).sb);
    expect(await (await GET(get())).json()).toMatchObject({ eligible: false, reason: "paid" });
  });

  it("a key left by a deleted account (user_id NULL) counts as used", async () => {
    flagOn();
    m.client.mockReturnValue(fake(world({ identityRows: [{ user_id: null }] })).sb);
    expect(await (await GET(get())).json()).toMatchObject({ eligible: false, reason: "trial_used" });
  });

  it("the remembered refusal keeps its own reason (a payer still sees the pricing line)", async () => {
    flagOn();
    const f = fake(world({ subs: [{ tier: "first_month_19", status: "expired", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: "2026-09-01T00:00:00Z" }] }));
    m.client.mockReturnValue(f.sb);
    expect(await (await GET(get())).json()).toMatchObject({ reason: "paid" });
    expect(await (await GET(get())).json()).toMatchObject({ reason: "paid" });
  });
});

describe("rate limit", () => {
  it("POST is limited per account (5 in 10 minutes) and answers 429 without a read", async () => {
    flagOn();
    const f = fake(world());
    m.client.mockReturnValue(f.sb);
    m.rate.mockReturnValue({ allowed: false, remaining: 0, resetAt: 0, retryAfterSec: 60 });
    const r = await POST(post());
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(m.rate.mock.calls[0][0]).toMatchObject({ limit: 5, windowMs: 600_000 });
    expect(f.calls).toHaveLength(0);
  });
});

describe("POST with the mail link", () => {
  it("a valid link for this account claims; its address key verifies an unconfirmed mailbox", async () => {
    flagOn();
    const f = fake(world({ user: { ...world().user!, email_verified_at: null } }));
    m.client.mockReturnValue(f.sb);
    const token = signClaimToken({ userId: UID, emailKey: trialEmailKey(EMAIL) });
    const r = await POST(post({ token }));
    expect(r.status).toBe(200);
    const trial = f.calls.find((c) => c.table === "trials" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(trial.email_key).toBe(trialEmailKey(EMAIL));
    const ev = f.calls.find((c) => c.table === "user_events")!.payload as Record<string, unknown>;
    expect(JSON.stringify(ev)).toContain("\"source\":\"link\"");
  });

  it("a link bound to another address does not verify the mailbox (the Telegram claim stores no address key)", async () => {
    flagOn();
    const f = fake(world({ user: { ...world().user!, email_verified_at: null } }));
    m.client.mockReturnValue(f.sb);
    const token = signClaimToken({ userId: UID, emailKey: trialEmailKey("someone.else@example.com") });
    expect(await (await POST(post({ token }))).json()).toMatchObject({ claimed: true });
    const trial = f.calls.find((c) => c.table === "trials" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(trial.email_key).toBeNull();
  });

  it("a valid mail link never stands in for Telegram (a-trial-phone-gate)", async () => {
    flagOn();
    const f = fake(world({ user: { ...world().user!, email_verified_at: null, telegram_id: null } }));
    m.client.mockReturnValue(f.sb);
    const token = signClaimToken({ userId: UID, emailKey: trialEmailKey(EMAIL) });
    expect(await (await POST(post({ token }))).json()).toMatchObject({ claimed: false, reason: "telegram_required" });
    expect(f.calls.some((c) => c.op !== "select")).toBe(false);
  });

  it("an expired link is 410 and writes nothing", async () => {
    flagOn();
    const f = fake(world());
    m.client.mockReturnValue(f.sb);
    const token = signClaimToken({ userId: UID, emailKey: trialEmailKey(EMAIL), days: 14, now: new Date(Date.now() - 15 * DAY) });
    const r = await POST(post({ token }));
    expect(r.status).toBe(410);
    expect(await r.json()).toMatchObject({ code: "LINK_EXPIRED" });
    expect(f.calls).toHaveLength(0);
  });

  it("another account's link is 403, a forged one 400; neither writes", async () => {
    flagOn();
    const f = fake(world());
    m.client.mockReturnValue(f.sb);
    const other = signClaimToken({ userId: OTHER, emailKey: null });
    expect((await POST(post({ token: other }))).status).toBe(403);
    expect((await POST(post({ token: "tc1.e30.forged" }))).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  it("without the signing secret a link is refused (503), the Home card path still works", async () => {
    flagOn();
    vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", "");
    m.client.mockReturnValue(fake(world()).sb);
    expect((await POST(post({ token: "tc1.a.b" }))).status).toBe(503);
    expect((await POST(post({}))).status).toBe(200);
  });
});

describe("Home trial line for a claimer", () => {
  it("auth/me reports the running claimed trial of an older account while the claim is on", async () => {
    flagOn();
    const end = new Date(Date.now() + 2 * DAY).toISOString();
    const f = createFakeSupabase((c) => (c.table === "trials" ? { data: { expires_at: end, kind: "reverse" } } : { data: null }));
    const cand = { createdAt: "2026-08-01T00:00:00Z", role: "user", tier: "pro", tierExpiresAt: end };
    expect(await ensureReverseTrial(f.sb, { userId: UID, candidate: cand, headers: new Headers() })).toEqual({ active: true, endsAt: end, started: false });
    vi.stubEnv("TRIAL_CLAIM_ENABLED", "false");
    const g = createFakeSupabase(() => ({ data: { expires_at: end, kind: "reverse" } }));
    expect(await ensureReverseTrial(g.sb, { userId: UID, candidate: cand, headers: new Headers() })).toMatchObject({ active: false });
    expect(g.calls).toHaveLength(0);
  });
});
