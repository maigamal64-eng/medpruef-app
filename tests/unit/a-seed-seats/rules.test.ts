import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), forget: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, forgetGuardUser: m.forget }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { POST as redeemRoute } from "@/app/api/mentor/campaign/redeem/route";
import { GET as statusRoute } from "@/app/api/mentor/campaign/status/route";
import { SEAT_MAX_ACCOUNT_AGE_DAYS, SEAT_PRO_DAYS, SEAT_VENUE_CAP, isSeatRow, seedSeatsFlag, seedSeatsReady } from "@/lib/seed-seats";
import { readCodeKind, redeemSeatCode, seatIdentityKey } from "@/lib/seed-seats/server";
import { seatCopy, seatRedeemMessage } from "@/lib/seed-seats/copy";
import { parseCampaignInput } from "@/lib/mentor/credits/campaign";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { accessIsReverseTrialOnly } from "@/lib/pricing-v2/reverse-trial-server";
import { planIncludedGrantsDetailed, type EntitlementSnapshot, type IncludedPackageRow } from "@/lib/mentor/credits/included";
import { classifyPayers, type SubscriptionLike } from "@/lib/admin/money-rules";
import { shortSubscriptionLabel } from "@/lib/subscription-display";
import type { MentorPackageId } from "@/lib/mentor/contract";
import { pinClock } from "../helpers/pin-clock";

// Fixtures use fixed calendar dates as the future: pin Date so they cannot go stale.
pinClock("2026-10-19T09:00:00Z");

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-12-22T10:00:00Z");
const DAY = 86_400_000;
const READY = { SEED_SEATS_ENABLED: "true", AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "paid" };
const ENV_KEYS = [...Object.keys(READY), "MENTOR_CAMPAIGN_CODES_ENABLED"];

function setEnv(env: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

let ipCounter = 0;
function req(body: unknown, method = "POST") {
  ipCounter += 1;
  return new NextRequest("https://medpruf.com/api/mentor/campaign/redeem", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

describe("seed seat flag and readiness: default OFF, strict literal, needs the Mentor open to Pro", () => {
  it("defaults off", () => {
    expect(seedSeatsFlag({})).toBe(false);
    expect(seedSeatsReady({})).toBe(false);
    for (const v of ["TRUE", "1", "yes", "on"]) expect(seedSeatsFlag({ SEED_SEATS_ENABLED: v })).toBe(false);
  });
  it("the flag alone is not enough: the seat's credits must be spendable", () => {
    expect(seedSeatsReady({ SEED_SEATS_ENABLED: "true" })).toBe(false);
    expect(seedSeatsReady({ ...READY, MENTOR_ACCESS_SCOPE: "beta" })).toBe(false);
    expect(seedSeatsReady({ ...READY, MENTOR_ENABLED: "false" })).toBe(false);
    expect(seedSeatsReady(READY)).toBe(true);
    expect(seedSeatsReady({ ...READY, MENTOR_ACCESS_SCOPE: "signed_in" })).toBe(true);
  });
  it("the bounds match the acceptance: 30 days, 20 seats, under 14 days", () => {
    expect([SEAT_PRO_DAYS, SEAT_VENUE_CAP, SEAT_MAX_ACCOUNT_AGE_DAYS]).toEqual([30, 20, 14]);
    expect(isSeatRow({ tier: "seed_seat", payment_provider: "seat" })).toBe(true);
    expect(isSeatRow({ tier: "reverse_trial", payment_provider: "trial" })).toBe(false);
  });
});

describe("one seat per person: the identity key", () => {
  it("normalises the address like the reverse trial, with its own prefix", () => {
    const a = seatIdentityKey("user-c7c41ec1@example.com");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(seatIdentityKey("user-abc7c021@example.com")).toBe(a);
    expect(seatIdentityKey(" user-d8441de9@example.com ")).toBe(a);
    expect(seatIdentityKey("user-e35f314b@example.com")).not.toBe(seatIdentityKey("user-5c7d0ed1@example.com"));
    expect(a).not.toBe(trialEmailKey("user-d8441de9@example.com"));
    expect(seatIdentityKey(null)).toBeNull();
    expect(seatIdentityKey("not-an-address")).toBeNull();
  });
});

function seatDb(opts: { user?: Record<string, unknown> | null; rpc?: FakeResult; kind?: FakeResult } = {}) {
  return createFakeSupabase((c: FakeCall) => {
    if (c.table === "users") return { data: opts.user ?? { email: "n@example.com", email_verified_at: "2026-12-20T10:00:00Z" } };
    if (c.table === "rpc:mentor_redeem_seat_code") return opts.rpc ?? { data: { ok: true, duplicate: false, kind: "seat", credits: 200, seat_ends_at: "2027-01-21T10:00:00Z", code: "SEAT-REZ" } };
    if (c.table === "ai_credit_campaign") return opts.kind ?? { data: { kind: "seat" } };
    return { data: null };
  });
}

describe("redeemSeatCode", () => {
  it("sends only the account, code, entry and the 14-day rule: the database computes the identity key", async () => {
    const { sb, calls } = seatDb();
    expect(await redeemSeatCode(sb, USER, " seat-rez ", "landing")).toEqual({ ok: true, duplicate: false, credits: 200, seatEndsAt: "2027-01-21T10:00:00Z", code: "SEAT-REZ" });
    const args = calls.find((c) => c.table === "rpc:mentor_redeem_seat_code")!.payload as Record<string, unknown>;
    expect(args).toEqual({ p_user: USER, p_code: "SEAT-REZ", p_via: "landing", p_max_account_age_days: 14 });
    expect(calls.some((c) => c.table === "users")).toBe(false);
  });
  it("maps refusals, a missing function and junk", async () => {
    for (const reason of ["paid_before", "already_pro", "identity_used", "account_too_old", "cap_reached", "daily_cap", "unverified"]) {
      expect(await redeemSeatCode(seatDb({ rpc: { data: { ok: false, reason } } }).sb, USER, "SEAT-REZ", "landing")).toEqual({ ok: false, reason });
    }
    expect(await redeemSeatCode(seatDb({ rpc: { data: { ok: false, reason: "weird" } } }).sb, USER, "SEAT-REZ", "landing")).toEqual({ ok: false, reason: "db_error" });
    expect(await redeemSeatCode(seatDb({ rpc: { error: { code: "PGRST202" } } }).sb, USER, "SEAT-REZ", "landing")).toEqual({ ok: false, reason: "missing_function" });
    expect(await redeemSeatCode(seatDb().sb, USER, "x", "landing")).toEqual({ ok: false, reason: "invalid_args" });
    expect(await redeemSeatCode(seatDb().sb, "not-a-uuid", "SEAT-REZ", "landing")).toEqual({ ok: false, reason: "invalid_args" });
  });
  it("readCodeKind: a database without the column reads every code as no seat", async () => {
    expect(await readCodeKind(seatDb().sb, "SEAT-REZ")).toBe("seat");
    expect(await readCodeKind(seatDb({ kind: { error: { code: "42703" } } }).sb, "SEAT-REZ")).toBeNull();
    expect(await readCodeKind(seatDb({ kind: { data: null } }).sb, "SEAT-REZ")).toBeNull();
    await expect(readCodeKind(seatDb({ kind: { error: { code: "57014" } } }).sb, "SEAT-REZ")).rejects.toBeTruthy();
  });
});

describe("POST /api/mentor/campaign/redeem with seats", () => {
  // A fresh account per request: the route's per-learner rate limit (5 in 10 minutes) stays out of the way.
  let current = USER;
  beforeEach(() => {
    m.guard.mockImplementation(async () => {
      current = crypto.randomUUID();
      return { userId: current };
    });
    m.forget.mockReset();
  });

  it("404 while seats and credit codes are both off; nothing is read", async () => {
    setEnv({});
    const { sb, calls } = seatDb();
    m.client.mockReturnValue(sb);
    expect((await redeemRoute(req({ code: "SEAT-REZ" }))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
  it("seats off, credit codes on: the credit route only (a seat code is refused there as not active)", async () => {
    setEnv({ MENTOR_CAMPAIGN_CODES_ENABLED: "true" });
    const { sb, calls } = createFakeSupabase((c) => (c.table === "rpc:mentor_redeem_campaign_code" ? { data: { ok: false, reason: "unknown_code" } } : { data: null }));
    m.client.mockReturnValue(sb);
    const res = await redeemRoute(req({ code: "SEAT-REZ" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "not_active" });
    expect(calls.map((c) => c.table)).toEqual(["rpc:mentor_redeem_campaign_code"]);
  });
  it("seats on: a seat code goes to the seat function, the guard cache is cleared", async () => {
    setEnv(READY);
    const { sb, calls } = seatDb();
    m.client.mockReturnValue(sb);
    const res = await redeemRoute(req({ code: "SEAT-REZ", via: "settings" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kind: "seat", credits: 200, seat_ends_at: "2027-01-21T10:00:00Z" });
    expect(calls.some((c) => c.table === "rpc:mentor_redeem_campaign_code")).toBe(false);
    expect(m.forget).toHaveBeenCalledWith(current);
  });
  it("seats on: refusals answer 409 with the seat reason; an unknown code reads not active", async () => {
    setEnv(READY);
    m.client.mockReturnValue(seatDb({ rpc: { data: { ok: false, reason: "paid_before" } } }).sb);
    const res = await redeemRoute(req({ code: "SEAT-REZ" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, reason: "paid_before", max_age_days: 14 });
    m.client.mockReturnValue(seatDb({ rpc: { data: { ok: false, reason: "inactive" } } }).sb);
    // A paused or ended seat code answers exactly like an unknown code.
    expect(await (await redeemRoute(req({ code: "SEAT-REZ" }))).json()).toEqual({ ok: false, reason: "not_active" });
    expect(m.forget).not.toHaveBeenCalled();
  });
  it("seats on, credit codes off: a credits code is not active and never redeemed", async () => {
    setEnv(READY);
    const { sb, calls } = seatDb({ kind: { data: { kind: "credits" } } });
    m.client.mockReturnValue(sb);
    const res = await redeemRoute(req({ code: "TG-SPT" }));
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
  });
  it("a failed kind read or grant is a 503, never a wrong answer", async () => {
    setEnv(READY);
    m.client.mockReturnValue(seatDb({ kind: { error: { code: "57014" } } }).sb);
    expect((await redeemRoute(req({ code: "SEAT-REZ" }))).status).toBe(503);
    m.client.mockReturnValue(seatDb({ rpc: { error: { code: "P0001", message: "seed seat credit grant failed" } } }).sb);
    expect((await redeemRoute(req({ code: "SEAT-REZ" }))).status).toBe(503);
  });
});

describe("GET /api/mentor/campaign/status with seats", () => {
  beforeEach(() => m.guard.mockResolvedValue({ userId: USER }));
  const status = () => statusRoute(new NextRequest("https://medpruf.com/api/mentor/campaign/status"), { params: Promise.resolve({}) } as never);
  function db(user: Record<string, unknown>, redemption: Record<string, unknown> | null = null) {
    return createFakeSupabase((c) => {
      if (c.table === "users") return { data: user };
      if (c.table === "ai_credit_campaign_redemption") return { data: redemption };
      return { data: null };
    });
  }
  it("a verified account 10 days old may take a seat; a 15-day-old one may not", async () => {
    setEnv(READY);
    const young = new Date(Date.now() - 10 * DAY).toISOString();
    m.client.mockReturnValue(db({ created_at: young, email_verified_at: young, telegram_id: null }).sb);
    expect(await (await status()).json()).toMatchObject({ enabled: true, eligible: true, seats: true, max_age_days: 14 });
    const old = new Date(Date.now() - 15 * DAY).toISOString();
    m.client.mockReturnValue(db({ created_at: old, email_verified_at: old, telegram_id: null }).sb);
    expect(await (await status()).json()).toMatchObject({ eligible: false, needs_verification: false });
  });
  it("an unverified young account needs verification; a redeemed seat shows its end", async () => {
    setEnv(READY);
    const young = new Date(Date.now() - DAY).toISOString();
    m.client.mockReturnValue(db({ created_at: young, email_verified_at: null, telegram_id: null }).sb);
    expect(await (await status()).json()).toMatchObject({ eligible: false, needs_verification: true });
    m.client.mockReturnValue(db({ created_at: young, email_verified_at: young }, { code: "SEAT-REZ", credits: 200, redeemed_at: young, seat_ends_at: "2027-01-21T10:00:00Z" }).sb);
    expect(await (await status()).json()).toMatchObject({ eligible: false, redeemed: { code: "SEAT-REZ", seat_ends_at: "2027-01-21T10:00:00Z" } });
  });
});

describe("admin seat codes", () => {
  const base = { code: "SEAT-REZ", label: "Rez/GM group", credits: 200, expiry_days: 60, total_cap: 20, daily_cap: 10, ends_at: new Date(Date.now() + 30 * DAY).toISOString() };
  it("a seat code is always 30 Pro days, credits valid as long as the seat, at most 20 seats", () => {
    const r = parseCampaignInput({ ...base, kind: "seat" }, new Date());
    expect(r).toMatchObject({ ok: true, value: { kind: "seat", pro_days: 30, expiry_days: 30, total_cap: 20, daily_cap: 10 } });
    expect(parseCampaignInput({ ...base, kind: "seat", total_cap: 21 }, new Date())).toMatchObject({ ok: false });
    expect(parseCampaignInput({ ...base, kind: "bogus" }, new Date())).toMatchObject({ ok: false });
  });
  it("a credits code never names the new columns (works before the changeset)", () => {
    const r = parseCampaignInput({ ...base, total_cap: 200 }, new Date());
    expect(r.ok && "kind" in r.value).toBe(false);
    expect(r.ok && "pro_days" in r.value).toBe(false);
  });
});

describe("a seat never buys like a payer, never funds included credits, never counts as paying", () => {
  it("checkout treats seat-only access as free access", async () => {
    const end = new Date(Date.now() + 20 * DAY).toISOString();
    const at = (rows: unknown[]) => createFakeSupabase(() => ({ data: rows })).sb;
    expect(await accessIsReverseTrialOnly(at([{ tier: "seed_seat", expires_at: end }]), "u1", new Date(), end)).toBe(true);
    expect(await accessIsReverseTrialOnly(at([{ tier: "seed_seat", expires_at: end }, { tier: "reverse_trial", expires_at: end }]), "u1")).toBe(true);
    expect(await accessIsReverseTrialOnly(at([{ tier: "seed_seat", expires_at: end }, { tier: "flex_month", expires_at: end }]), "u1")).toBe(false);
    // Pro running past the seat (a manual grant) is real access.
    expect(await accessIsReverseTrialOnly(at([{ tier: "seed_seat", expires_at: end }]), "u1", new Date(), new Date(Date.now() + 90 * DAY).toISOString())).toBe(false);
  });

  const row = (package_id: MentorPackageId, grant_micro: number): IncludedPackageRow => ({ package_id, grant_micro, expiry_days: 30, active: true });
  const PACKAGES = new Map<MentorPackageId, IncludedPackageRow>([
    ["included_unknown", row("included_unknown", 250_000)], ["gift_admin", row("gift_admin", 250_000)], ["trial_taste", row("trial_taste", 100_000)],
    ["included_pro_monthly", row("included_pro_monthly", 250_000)],
  ]);
  const seatRow = { id: "seat", tier: "seed_seat", status: "active", payment_provider: "seat", amount_cents: 0, started_at: new Date(NOW.getTime() - DAY).toISOString(), expires_at: new Date(NOW.getTime() + 29 * DAY).toISOString() };
  const pro = { id: USER, role: "user", tier: "pro", tier_expires_at: seatRow.expires_at, email_verified_at: null, telegram_id: null, is_banned: false };
  const snap = (over: Partial<EntitlementSnapshot>): EntitlementSnapshot => ({ user: pro, subs: [], referrals: [], packages: PACKAGES, freeEnabled: false, ...over });
  it("a live seat plans nothing: no unknown_included, no gift for users.tier pro, no trial taste", () => {
    expect(planIncludedGrantsDetailed(snap({ subs: [seatRow] }), NOW)).toEqual({ grants: [], branch: "seat" });
    const trial = { ...seatRow, id: "t", tier: "reverse_trial", payment_provider: "trial" };
    expect(planIncludedGrantsDetailed(snap({ subs: [trial, seatRow] }), NOW)).toEqual({ grants: [], branch: "seat" });
  });
  it("a seat holder who buys a plan gets the plan's included grant", () => {
    const paid = { ...seatRow, id: "p", tier: "first_month_19", payment_provider: "whop", amount_cents: 1900 };
    expect(planIncludedGrantsDetailed(snap({ subs: [seatRow, paid] }), NOW).branch).toBe("paid");
  });
  it("money: seat holders are listed beside paying, never in it", () => {
    const now = NOW;
    const s = (user: string, over: Partial<SubscriptionLike>): SubscriptionLike => ({ user_id: user, tier: "seed_seat", status: "active", payment_provider: "seat", amount_cents: 0, expires_at: seatRow.expires_at, ...over });
    const users = new Map([["a", { email: "user-2a28dc7d@example.com" }], ["b", { email: "user-aeed0f27@example.com" }], ["c", { email: "user-74254402@example.com" }], ["staff", { email: "user-847887c3@example.com", role: "admin" }]]);
    const r = classifyPayers([
      s("a", {}),
      s("b", {}), s("b", { tier: "first_month_19", payment_provider: "whop", amount_cents: 1900 }),
      s("c", { expires_at: new Date(NOW.getTime() - DAY).toISOString() }),
      s("staff", {}),
    ], users as never, now);
    expect([...r.seatHolders]).toEqual(["a"]);
    expect([...r.paying]).toEqual(["b"]);
    expect(r.inTrial.size).toBe(0);
  });
  it("the subscription card names the seat", () => {
    expect(shortSubscriptionLabel({ tier: "seed_seat", is_trial: false, billing_cadence: "one_time", billing_interval_days: null } as never, "de")).toBe("Pro-Platz");
    expect(shortSubscriptionLabel({ tier: "seed_seat", is_trial: false, billing_cadence: "one_time", billing_interval_days: null } as never, "en")).toBe("Pro seat");
  });
});

describe("seat copy", () => {
  const all = (lang: string) => {
    const c = seatCopy(lang);
    return [c.eyebrow, c.title(30), c.lead(30, 200), c.what, c.end(30), c.rule(14), c.success("21. Januar 2027", 200), c.successNoDate, c.toPractice, ...Object.values(c.reasons), c.codeTitle, c.codeLead(14), c.codeLead(14, 7), c.redeemed("SEAT-REZ", "21. Januar 2027")];
  };
  it("no dashes, no bare free, no unlimited, no prices, Sie in German", () => {
    for (const lang of ["de", "en"]) {
      for (const line of all(lang)) {
        expect(line).not.toMatch(/[–—]/);
        expect(line).not.toMatch(/\b(gratis|unbegrenzt|unlimited|free)\b/i);
        expect(line).not.toMatch(/€|EUR|\d+ ?Euro/);
      }
    }
    expect(all("de").join(" ")).not.toMatch(/\b(du|dein|dich|dir)\b/i);
    expect(all("de").join(" ")).not.toMatch(/Deutschland/);
  });
  it("seat reasons first, then the shared code lines; other languages read English", () => {
    expect(seatRedeemMessage("de", "identity_used", 14)).toMatch(/Pro Person ist ein Platz/);
    expect(seatRedeemMessage("de", "account_too_old", 14)).toMatch(/14 Tage/);
    expect(seatRedeemMessage("en", "cap_reached", 14)).toBe("This code has been used up.");
    expect(seatRedeemMessage("de", "anything", 14, { rateLimited: true })).toMatch(/Zu viele Versuche/);
    expect(seatCopy("ar").title(30)).toBe(seatCopy("en").title(30));
  });
});

describe("reviewer round 1: pricing sees a seat holder as a buyer; the AI brakes see seats", () => {
  it("seatOnlyAccess: seat-only (or with the reverse trial it extended) reports the seat end; anything paid does not", async () => {
    const { seatOnlyAccess } = await import("@/lib/seed-seats/server");
    const now = new Date();
    const end = new Date(now.getTime() + 20 * DAY).toISOString();
    const young = new Date(now.getTime() - 5 * DAY).toISOString();
    const user = { createdAt: young, role: "user", tier: "pro", tierExpiresAt: end };
    const at = (rows: unknown[] | null, error: unknown = null) => createFakeSupabase(() => ({ data: rows, error: error as never })).sb;
    expect(await seatOnlyAccess(at([{ tier: "seed_seat", expires_at: end }]), USER, user, now)).toEqual({ endsAt: new Date(Date.parse(end)).toISOString() });
    expect(await seatOnlyAccess(at([{ tier: "seed_seat", expires_at: end }, { tier: "reverse_trial", expires_at: end }]), USER, user, now)).not.toBeNull();
    expect(await seatOnlyAccess(at([{ tier: "seed_seat", expires_at: end }, { tier: "flex_month", expires_at: end }]), USER, user, now)).toBeNull();
    expect(await seatOnlyAccess(at([{ tier: "reverse_trial", expires_at: end }]), USER, user, now)).toBeNull();
    expect(await seatOnlyAccess(at(null, { code: "57014" }), USER, user, now)).toBeNull();
    // No read at all for an old account, an admin, a free account or Pro ending later than a seat could.
    const { sb, calls } = createFakeSupabase(() => ({ data: [] }));
    await seatOnlyAccess(sb, USER, { ...user, createdAt: new Date(now.getTime() - 60 * DAY).toISOString() }, now);
    await seatOnlyAccess(sb, USER, { ...user, role: "admin" }, now);
    await seatOnlyAccess(sb, USER, { ...user, tier: "free" }, now);
    await seatOnlyAccess(sb, USER, { ...user, tierExpiresAt: new Date(now.getTime() + 90 * DAY).toISOString() }, now);
    expect(calls).toHaveLength(0);
    // Pro running past the seat (a manual grant) is not seat-only.
    expect(await seatOnlyAccess(at([{ tier: "seed_seat", expires_at: new Date(now.getTime() + 10 * DAY).toISOString() }]), USER, user, now)).toBeNull();
  });

  it("the house cap is considered while seats are on", async () => {
    const { houseCapConsidered } = await import("@/lib/mentor/credits/house-cap");
    const { readFreeCreditConfig } = await import("@/lib/mentor/credits/free-credits");
    expect(houseCapConsidered(readFreeCreditConfig({}))).toBe(false);
    expect(readFreeCreditConfig({ SEED_SEATS_ENABLED: "true" }).seatsEnabled).toBe(true);
    expect(readFreeCreditConfig({ SEED_SEATS_ENABLED: "TRUE" }).seatsEnabled).toBe(false);
    expect(houseCapConsidered(readFreeCreditConfig({ SEED_SEATS_ENABLED: "true" }))).toBe(true);
  });
});
