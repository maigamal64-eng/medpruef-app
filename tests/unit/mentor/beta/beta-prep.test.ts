import { describe, expect, it, vi } from "vitest";
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
import * as Sentry from "@sentry/nextjs";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";
import { betaSourceId, enrolBetaUsers, loadBetaUsage, MENTOR_BETA_KEY, parseBetaInput } from "@/lib/mentor/beta-admin";
import { mentorBetaAllowed, envAllowlisted } from "@/lib/mentor/beta";
import { mentorLearnerRouteOpen } from "@/lib/mentor/route-gate";
import { grantMentorPayment } from "@/lib/mentor/credits/grant-payment";
import { resetPackageCache } from "@/lib/mentor/credits/packages";
import { isExcludedUser, pickCandidates } from "../../../../scripts/mentor/pick-beta-users";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-12T10:00:00Z");

describe("beta allowlist is required", () => {
  it("an empty env list admits nobody; a DB row decides when present", async () => {
    expect(envAllowlisted([], A)).toBe(false);
    expect(envAllowlisted([A], A.toUpperCase())).toBe(true);
    const row = (data: unknown) => createFakeSupabase(() => ({ data })).sb;
    expect(await mentorBetaAllowed(row(null) as never, A, [])).toBe(false);
    expect(await mentorBetaAllowed(row(null) as never, A, [A])).toBe(true);
    expect(await mentorBetaAllowed(row({ allowed: true }) as never, A, [])).toBe(true);
    expect(await mentorBetaAllowed(row({ allowed: false }) as never, A, [A])).toBe(false);
  });
  it("secondary learner routes need both masters and the allowlist, failing closed", async () => {
    const on = { aiFeaturesEnabled: true, enabled: true, betaUserIds: [] as string[] };
    const allowed = vi.fn(async () => true);
    expect(await mentorLearnerRouteOpen(A, { ...on, enabled: false }, allowed)).toBe(false);
    expect(await mentorLearnerRouteOpen(A, { ...on, aiFeaturesEnabled: false }, allowed)).toBe(false);
    expect(allowed).not.toHaveBeenCalled();
    expect(await mentorLearnerRouteOpen(A, on, allowed)).toBe(true);
    expect(await mentorLearnerRouteOpen(A, on, async () => false)).toBe(false);
    expect(await mentorLearnerRouteOpen(A, on, async () => { throw new Error("db"); })).toBe(false);
  });
});

describe("admin beta enrolment", () => {
  it("validates ids and credits", () => {
    expect(parseBetaInput({ user_ids: [A, A.toUpperCase(), ` ${B} `], credits: 50 })).toEqual({ ok: true, userIds: [A, B], credits: 50 });
    expect(parseBetaInput({ user_ids: ["x"], credits: 50 })).toMatchObject({ ok: false, error: "invalid_users" });
    expect(parseBetaInput({ user_ids: [], credits: 50 })).toMatchObject({ ok: false, error: "invalid_users" });
    expect(parseBetaInput({ user_ids: Array(101).fill(A), credits: 5 })).toMatchObject({ ok: false, error: "too_many_users" });
    for (const credits of [0, 201, 2.5, "50", null]) expect(parseBetaInput({ user_ids: [A], credits })).toMatchObject({ ok: false, error: "invalid_credits" });
  });

  it("allowlists then grants one idempotent beta lot per user under key beta-2026-10", async () => {
    const granted = new Set<string>();
    const { sb, calls } = createFakeSupabase((c: FakeCall): FakeResult | undefined => {
      if (c.table === "users") return { data: [{ id: A }, { id: B }] };
      if (c.table === "rpc:mentor_set_beta") return { data: true };
      if (c.table === "rpc:mentor_grant_credits") {
        const key = (c.payload as { p_source_id: string }).p_source_id;
        const dup = granted.has(key);
        granted.add(key);
        return { data: { ok: true, duplicate: dup, lot_id: "lot", granted_micro: dup ? null : 250000 } };
      }
      return undefined;
    });
    const missing = "33333333-3333-4333-8333-333333333333";
    const first = await enrolBetaUsers(sb as never, ADMIN, [A, B, missing], 50, NOW);
    expect(first).toEqual([
      { user_id: A, allowlisted: true, status: "granted" },
      { user_id: B, allowlisted: true, status: "granted" },
      { user_id: missing, allowlisted: false, status: "unknown_user" },
    ]);
    const again = await enrolBetaUsers(sb as never, ADMIN, [A], 50, NOW);
    expect(again[0].status).toBe("already_granted");
    const grant = calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload as Record<string, unknown>;
    expect(grant).toMatchObject({ p_user: A, p_package: "beta_grant", p_source: "beta_grant", p_source_id: `${MENTOR_BETA_KEY}:${A}`, p_micro: 250000 });
    expect(Date.parse(String(grant.p_expires_at)) - NOW.getTime()).toBe(30 * 86_400_000);
    expect(calls.find((c) => c.table === "rpc:mentor_set_beta")!.payload).toEqual({ p_user: A, p_allowed: true, p_actor: ADMIN });
    expect(betaSourceId(A.toUpperCase())).toBe(`beta-2026-10:${A}`);
  });

  it("reports allowlist and grant failures per row instead of throwing", async () => {
    const { sb } = createFakeSupabase((c) => {
      if (c.table === "users") return { data: [{ id: A }, { id: B }] };
      if (c.table === "rpc:mentor_set_beta") return (c.payload as { p_user: string }).p_user === A ? { error: { code: "XX000" } } : { data: true };
      if (c.table === "rpc:mentor_grant_credits") return { error: { code: "57014" } };
      return undefined;
    });
    expect(await enrolBetaUsers(sb as never, ADMIN, [A, B], 10, NOW)).toEqual([
      { user_id: A, allowlisted: false, status: "allowlist_failed" },
      { user_id: B, allowlisted: true, status: "grant_failed" },
    ]);
  });

  it("usage view converts ledger micro-USD to credits and keeps true cost", async () => {
    const { sb } = createFakeSupabase((c) => {
      if (c.table === "ai_mentor_beta_override") return { data: [{ user_id: A }, { user_id: B }] };
      if (c.table === "users") return { data: [{ id: A, first_name: "Ana" }] };
      if (c.table === "rpc:mentor_beta_usage") return { data: [
        { user_id: A, messages: 3, failures: 1, blocked: 0, credits_used_micro: 7500, cost_micro: 4200, beta_granted_micro: 250000, remaining_micro: 242500, last_turn_at: "2026-10-12T09:00:00Z" },
        { user_id: B, messages: "0", failures: 0, blocked: 2, credits_used_micro: 0, cost_micro: 0, beta_granted_micro: 0, remaining_micro: 0, last_turn_at: null },
      ] };
      return undefined;
    });
    const rows = await loadBetaUsage(sb as never);
    expect(rows[0]).toEqual({ user_id: A, first_name: "Ana", messages: 3, failures: 1, blocked: 0, credits_used: 1.5, cost_micro: 4200, beta_credits: 50, credits_left: 48.5, last_turn_at: "2026-10-12T09:00:00Z" });
    expect(rows[1]).toMatchObject({ user_id: B, first_name: null, messages: 0, blocked: 2 });
  });

  it("an unapplied ledger is an error, never an empty-looking cohort", async () => {
    const { sb } = createFakeSupabase((c) => (c.table === "ai_mentor_beta_override" ? { error: { code: "42P01" } } : undefined));
    await expect(loadBetaUsage(sb as never)).rejects.toThrow();
  });
});

describe("Whop mentor purchase mismatch no longer retries forever", () => {
  it("a granted payment whose purchase row is missing or for another package acks with a Sentry warning", async () => {
    for (const purchase of [null, { checkout_session_id: B, user_id: A, package_id: "mentor_plus", created_at: NOW.toISOString(), expires_at: NOW.toISOString(), status: "pending", payment_id: null }]) {
      resetPackageCache();
      vi.mocked(Sentry.captureMessage).mockClear();
      const { sb, calls } = createFakeSupabase((c) => {
        if (c.table === "ai_credit_package") return { data: [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: false, sort: 10, note: null }] };
        if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "l", granted_micro: 750000 } };
        if (c.table === "ai_mentor_purchase") return { data: purchase };
        return undefined;
      });
      const r = await grantMentorPayment(sb as never, { userId: A, packageId: "mentor_basis", paymentId: "pay_1", membershipId: "mem_1", paidCents: 490, currency: "EUR", checkoutSessionId: B });
      expect(r.kind).toBe("granted");
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(calls.some((c) => c.table === "ai_mentor_purchase" && c.op === "update")).toBe(false);
    }
  });
});

describe("scripts/mentor/pick-beta-users", () => {
  const day = (d: number, h = 10) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
  it("keeps users with >= min answers and drops admins and test accounts", () => {
    const answers = [
      ...Array.from({ length: 25 }, (_, i) => ({ user_id: A, created_at: day(1 + (i % 3)) })),
      ...Array.from({ length: 19 }, () => ({ user_id: B, created_at: day(5) })),
      ...Array.from({ length: 30 }, () => ({ user_id: ADMIN, created_at: day(6) })),
      { user_id: null, created_at: day(6) },
    ];
    const users = [
      { id: A, role: "user", tier: "free", email: "doc@example.com" },
      { id: B, role: "user", tier: "free", email: "b@example.com" },
      { id: ADMIN, role: "admin", tier: "admin", email: "x@example.com" },
    ];
    expect(pickCandidates(answers, users, 20)).toEqual([{ user_id: A, answers: 25, active_days: 3, last_answer_at: day(3) }]);
  });
  it("excludes internal domains, test or demo mailboxes and named test emails", () => {
    const u = (email: string | null, role = "user") => ({ id: A, role, tier: "free", email });
    expect(isExcludedUser(u("user-b7e46e80@example.com"))).toBe(true);
    expect(isExcludedUser(u("user-41586b3e@example.com"))).toBe(true);
    expect(isExcludedUser(u("user-e882cdd2@example.com"))).toBe(true);
    expect(isExcludedUser(u("user-41fc4b40@example.com"))).toBe(true);
    expect(isExcludedUser(u("user-e388eaf3@example.com"), ["user-e388eaf3@example.com"])).toBe(true);
    expect(isExcludedUser(u("user-58fa5045@example.com"))).toBe(false);
    expect(isExcludedUser(u(null))).toBe(false);
    expect(isExcludedUser(u("a@b.c", "admin"))).toBe(true);
  });
});
