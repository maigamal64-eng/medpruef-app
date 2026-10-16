import { describe, expect, it, vi } from "vitest";
import replies from "../mentor/core/fixtures/rpc-replies.json";
import { decideMentorAdmission, holdsLiveMentorLot, parseMentorAccessScope, type MentorAccessScope, type MentorScopeReads } from "@/lib/mentor/access";
import { readMentorConfig, MENTOR_CONFIG_DEFAULTS, type MentorConfig } from "@/lib/mentor/config";
import { handleMentorAvailability } from "@/app/api/mentor/availability/handler";
import { checkMentorAdmission, checkMentorAccess } from "@/lib/mentor/guard";
import { mentorLearnerRouteOpen } from "@/lib/mentor/route-gate";
import { canBuyMentorPackages } from "@/lib/mentor/credits/gate";
import { handleMentorUsage, type UsageHandlerDeps } from "@/app/api/mentor/usage/handler";
import { handleMentorChat, type ChatHandlerDeps } from "@/app/api/mentor/chat/handler";
import type { MentorUsageResponse } from "@/lib/mentor/contract";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { mentorOpenForAccount } from "@/lib/mentor/access-account";
import { USER, makeDeps } from "../mentor/core/helpers";
import { createFakeSupabase } from "../helpers/fake-supabase";

const R = replies as Record<string, unknown>;
const OTHER = "99999999-9999-4999-8999-999999999999";

type Account = "allowlisted" | "pro" | "holder" | "free" | "banned";
function readsFor(a: Account): MentorScopeReads {
  return {
    paidAccess: async () => a === "pro",
    holdsLiveLot: async () => a === "holder",
    accountOk: async () => a !== "banned",
  };
}
const allowlisted = (a: Account) => async () => a === "allowlisted";

function cfg(over: Partial<MentorConfig> = {}): MentorConfig {
  // USER is NOT on the allowlist here: admission must come from the scope.
  return { ...MENTOR_CONFIG_DEFAULTS, aiFeaturesEnabled: true, enabled: true, packagesEnabled: true, betaUserIds: [OTHER], ...over };
}

describe("MENTOR_ACCESS_SCOPE parsing", () => {
  it("defaults to beta; only the exact literals widen", () => {
    expect(parseMentorAccessScope(undefined)).toBe("beta");
    expect(parseMentorAccessScope("")).toBe("beta");
    for (const v of ["all", "PAID", "Signed_In", "signed-in", "true", "beta"]) expect(parseMentorAccessScope(v)).toBe("beta");
    expect(parseMentorAccessScope("paid")).toBe("paid");
    expect(parseMentorAccessScope(" signed_in ")).toBe("signed_in");
    expect(readMentorConfig({}).accessScope).toBe("beta");
    expect(readMentorConfig({ MENTOR_ACCESS_SCOPE: "signed_in" }).accessScope).toBe("signed_in");
  });
});

describe("decideMentorAdmission: every scope x account", () => {
  const table: Array<[MentorAccessScope, Account, "allowlist" | "scope" | null]> = [
    ["beta", "allowlisted", "allowlist"], ["beta", "pro", null], ["beta", "holder", null], ["beta", "free", null], ["beta", "banned", null],
    ["paid", "allowlisted", "allowlist"], ["paid", "pro", "scope"], ["paid", "holder", "scope"], ["paid", "free", null], ["paid", "banned", null],
    ["signed_in", "allowlisted", "allowlist"], ["signed_in", "pro", "scope"], ["signed_in", "holder", "scope"], ["signed_in", "free", "scope"], ["signed_in", "banned", null],
  ];
  it.each(table)("scope %s, %s account -> %s", async (scope, account, want) => {
    expect(await decideMentorAdmission({ scope, packagesEnabled: true, userId: USER, allowlisted: allowlisted(account), reads: readsFor(account) })).toBe(want);
  });
  it("without packages for sale, the scope admits only accounts holding a live lot", async () => {
    for (const scope of ["paid", "signed_in"] as const) {
      expect(await decideMentorAdmission({ scope, packagesEnabled: false, userId: USER, allowlisted: allowlisted("free"), reads: readsFor("free") })).toBeNull();
      expect(await decideMentorAdmission({ scope, packagesEnabled: false, userId: USER, allowlisted: allowlisted("pro"), reads: readsFor("pro") })).toBeNull();
      expect(await decideMentorAdmission({ scope, packagesEnabled: false, userId: USER, allowlisted: allowlisted("holder"), reads: readsFor("holder") })).toBe("scope");
    }
  });
  it("beta never runs a scope read; a read error propagates (callers fail closed)", async () => {
    const reads = { paidAccess: vi.fn(), holdsLiveLot: vi.fn() };
    expect(await decideMentorAdmission({ scope: "beta", packagesEnabled: true, userId: USER, allowlisted: async () => false, reads })).toBeNull();
    expect(reads.paidAccess).not.toHaveBeenCalled(); expect(reads.holdsLiveLot).not.toHaveBeenCalled();
    await expect(decideMentorAdmission({ scope: "paid", packagesEnabled: true, userId: USER, allowlisted: async () => false, reads: { paidAccess: async () => false, holdsLiveLot: async () => { throw new Error("db"); } } })).rejects.toThrow();
  });
});

describe("availability, guard, learner routes and buying agree", () => {
  const req = () => new Request("http://localhost/api/mentor/availability");
  const auth = (paidAccess = false) => async () => ({ ok: true as const, userId: USER, paidAccess });
  const flagOn = async () => true;

  it("scope beta: a free signed-in account sees nothing new (403 not_eligible)", async () => {
    const res = await handleMentorAvailability(req(), { config: cfg(), authenticate: auth(), flag: flagOn, scopeReads: () => readsFor("free") });
    expect(res.status).toBe(403); expect(await res.json()).toEqual({ error: "mentor_disabled", reason: "not_eligible" });
  });
  it("scope signed_in admits a free account; paid admits Pro and credit holders only", async () => {
    const open = async (scope: MentorAccessScope, a: Account) => (await handleMentorAvailability(req(), { config: cfg({ accessScope: scope }), authenticate: auth(a === "pro"), flag: flagOn, betaAllowed: allowlisted(a), scopeReads: () => readsFor(a) })).status;
    expect(await open("signed_in", "free")).toBe(200);
    expect(await open("paid", "free")).toBe(403);
    expect(await open("paid", "pro")).toBe(200);
    expect(await open("paid", "holder")).toBe(200);
    expect(await open("signed_in", "banned")).toBe(403);
    expect(await open("beta", "allowlisted")).toBe(200);
  });
  it("signed out is 401 under every scope; masters and the DB flag still close everything", async () => {
    const out = await handleMentorAvailability(req(), { config: cfg({ accessScope: "signed_in" }), authenticate: async () => ({ ok: false, reason: "unauthenticated" as const }), flag: flagOn, scopeReads: () => readsFor("free") });
    expect(out.status).toBe(401);
    for (const over of [{ enabled: false }, { aiFeaturesEnabled: false }]) {
      expect((await handleMentorAvailability(req(), { config: cfg({ accessScope: "signed_in", ...over }), authenticate: auth(), flag: flagOn, scopeReads: () => readsFor("free") })).status).toBe(403);
    }
    expect((await handleMentorAvailability(req(), { config: cfg({ accessScope: "signed_in" }), authenticate: auth(), flag: async () => false, scopeReads: () => readsFor("free") })).status).toBe(403);
  });
  it("a failing lot read is 503 upstream_error, never an admission", async () => {
    const res = await handleMentorAvailability(req(), { config: cfg({ accessScope: "paid" }), authenticate: auth(), flag: flagOn, scopeReads: () => ({ paidAccess: async () => false, holdsLiveLot: async () => { throw new Error("db"); } }) });
    expect(res.status).toBe(503);
  });

  it("checkMentorAdmission reports via; checkMentorAccess keeps its old contract", async () => {
    expect((await checkMentorAdmission(cfg({ accessScope: "signed_in" }), USER, flagOn, undefined, readsFor("free"))).via).toBe("scope");
    expect((await checkMentorAdmission(cfg({ accessScope: "signed_in", betaUserIds: [USER] }), USER, flagOn, undefined, readsFor("free"))).via).toBe("allowlist");
    expect((await checkMentorAdmission(cfg({ accessScope: "beta" }), USER, flagOn, undefined, readsFor("free"))).error?.body.error).toBe("mentor_disabled");
    expect(await checkMentorAccess(cfg({ accessScope: "paid" }), USER, flagOn, undefined, readsFor("pro"))).toBeNull();
    expect((await checkMentorAccess(cfg({ accessScope: "paid", aiFeaturesEnabled: false }), USER, flagOn, undefined, readsFor("pro")))?.body.error).toBe("ai_disabled");
  });

  it("learner routes and the package gate follow the same rule", async () => {
    expect(await mentorLearnerRouteOpen(USER, cfg({ accessScope: "signed_in" }), async () => false, readsFor("free"))).toBe(true);
    expect(await mentorLearnerRouteOpen(USER, cfg({ accessScope: "beta" }), async () => false, readsFor("free"))).toBe(false);
    expect(await mentorLearnerRouteOpen(USER, cfg({ accessScope: "paid" }), async () => false, readsFor("free"))).toBe(false);
    expect(await canBuyMentorPackages(USER, cfg({ accessScope: "signed_in" }), flagOn, async () => false, readsFor("free"))).toBe(true);
    expect(await canBuyMentorPackages(USER, cfg({ accessScope: "beta" }), flagOn, async () => false, readsFor("free"))).toBe(false);
    expect(await canBuyMentorPackages(USER, cfg({ accessScope: "signed_in", packagesEnabled: false }), flagOn, async () => false, readsFor("holder"))).toBe(false);
  });
});

function rpc() {
  const map: Record<string, unknown> = { mentor_reserved_attempt: R.attempt_ok, ai_spend_month: R.spend_month, ai_spend_cap: R.spend_cap };
  return {
    rpc(fn: string) {
      if (!(fn in map)) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `missing ${fn}` } });
      return Promise.resolve({ data: map[fn], error: null });
    },
  };
}

describe("house-funded grants stay allowlist-only", () => {
  function usageDeps(over: Partial<UsageHandlerDeps>, grantMicro = 0) {
    const env = makeDeps([], { grantMicro });
    const ensure = vi.spyOn(env.deps.wallet, "ensureIncludedGrants");
    const deps: UsageHandlerDeps = {
      config: cfg({ accessScope: "signed_in" }),
      env: { WHOP_PLAN_MENTOR_BASIS: "plan_b" },
      authenticate: async () => ({ ok: true, userId: USER, paidAccess: false }),
      flag: async () => true,
      betaAllowed: async () => false,
      scopeReads: () => readsFor("free"),
      rpc: rpc(),
      services: () => ({ brain: env.deps.brain, facts: env.deps.facts, wallet: env.deps.wallet }),
      clock: env.deps.clock,
      subscriptions: async () => [],
      activePackageIds: async () => new Set(["mentor_basis"]),
      trialProIncludedCredits: async () => 50,
      alert: () => {},
      ...over,
    };
    return { deps, ensure };
  }
  const get = () => new Request("http://localhost/api/mentor/usage");

  it("a scope-admitted free account with 0 credits gets the buy state, credits_only, and no included grant", async () => {
    const { deps, ensure } = usageDeps({ referralCredits: () => 50 });
    const res = await handleMentorUsage(get(), deps);
    const body = (await res.json()) as MentorUsageResponse;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ state: "none", can_buy: true, credits_only: true, credits_left: 0, referral_credits: 50 });
    expect(ensure).not.toHaveBeenCalled();
  });
  it("an allowlisted account keeps today's shape and its included grants", async () => {
    const { deps, ensure } = usageDeps({ betaAllowed: async () => true }, 200_000);
    const body = (await (await handleMentorUsage(get(), deps)).json()) as MentorUsageResponse;
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty("credits_only");
    expect(body).not.toHaveProperty("referral_credits");
  });
  it("scope beta: the same free account is still refused (identical to before)", async () => {
    const { deps, ensure } = usageDeps({ config: cfg({ accessScope: "beta" }) });
    const res = await handleMentorUsage(get(), deps);
    expect(res.status).toBe(403);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("chat: a scope-admitted account with 0 credits gets 402 with the packages link, never an included grant", async () => {
    const env = makeDeps([], { grantMicro: 0 });
    const ensure = vi.spyOn(env.deps.wallet, "ensureIncludedGrants");
    const deps: ChatHandlerDeps = {
      config: { ...env.deps.config, ...cfg({ accessScope: "signed_in" }) },
      requests: {
        async claim(_u, _r, id) { return { claimed: true, requestId: id }; },
        async finish() {},
        async result() { return { status: "missing" }; },
      },
      recordTurn: async () => {},
      authenticate: async () => ({ ok: true, userId: USER, paidAccess: false }),
      flag: async () => true,
      betaAllowed: async () => false,
      scopeReads: () => readsFor("free"),
      rpc: rpc(),
      services: () => ({ brain: env.deps.brain, facts: env.deps.facts, wallet: env.deps.wallet }),
      meterFor: () => env.deps.meter,
      house: env.deps.house,
      conversations: { async resolve(_u, id) { return { conversationId: id ?? "33333333-3333-4333-8333-333333333333", history: [], isNew: true }; }, async append() { return true; } },
      canReadQuestion: async () => true,
      callClaude: env.deps.callClaude,
      clock: env.deps.clock,
      newRequestId: () => "44444444-4444-4444-8444-444444444444",
      runTurn: createRunMentorTurn({ alert: () => {} }),
      background: () => {},
      alert: () => {},
    };
    const res = await handleMentorChat(new Request("http://localhost/api/mentor/chat", { method: "POST", body: JSON.stringify({ client_request_id: "55555555-5555-4555-8555-555555555555", message: "Wie melde ich mich an?", lang: "de", mode: "facts" }) }), deps);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "credits_required", packages_url: "/mentor/packages" });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("server reads", () => {
  it("holdsLiveMentorLot asks for a live, started, unexpired lot and throws on a DB error", async () => {
    const now = new Date("2026-10-15T10:00:00Z");
    const { sb, calls } = createFakeSupabase(() => ({ data: [{ id: "lot" }] }));
    expect(await holdsLiveMentorLot(sb as never, USER, now)).toBe(true);
    expect(calls[0].filters).toEqual(expect.arrayContaining([
      { kind: "eq", column: "user_id", value: USER }, { kind: "eq", column: "status", value: "live" },
      { kind: "lte", column: "starts_at", value: now.toISOString() }, { kind: "gt", column: "expires_at", value: now.toISOString() },
    ]));
    const bad = createFakeSupabase(() => ({ error: { code: "57014" } }));
    await expect(holdsLiveMentorLot(bad.sb as never, USER, now)).rejects.toThrow();
  });
  it("mentorOpenForAccount (the referral check) refuses banned accounts and applies the scope", async () => {
    const row = (r: Record<string, unknown>) => createFakeSupabase((c) => c.table === "users" ? { data: r } : c.table === "ai_mentor_beta_override" ? { data: null } : { data: [] }).sb as never;
    const on = async () => true;
    expect(await mentorOpenForAccount(row({ role: "user", tier: "pro", tier_expires_at: null, is_banned: true }), USER, cfg({ accessScope: "signed_in" }), on)).toBe(false);
    expect(await mentorOpenForAccount(row({ role: "user", tier: "pro", tier_expires_at: null, is_banned: false }), USER, cfg({ accessScope: "paid" }), on)).toBe(true);
    expect(await mentorOpenForAccount(row({ role: "user", tier: "free", tier_expires_at: null, is_banned: false }), USER, cfg({ accessScope: "paid" }), on)).toBe(false);
    expect(await mentorOpenForAccount(row({ role: "user", tier: "free", tier_expires_at: null, is_banned: false }), USER, cfg({ accessScope: "beta" }), on)).toBe(false);
  });
});
