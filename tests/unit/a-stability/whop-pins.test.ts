import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";

// a-stability B (Sentry JAVASCRIPT-NEXTJS-13): a legacy mber_ pin is no pin,
// a refused key is one warning an hour, never a member id as a membership.
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
import { captureServerError } from "@/lib/sentry-capture";
import { loadRenewalState, resetWhopAuthWarningForTests, warnWhopKeyUnauthorized } from "@/lib/renewal-state";
import { isWhopMemberId, isWhopMembershipId, trialEndingMembershipId, whopMembershipIdOrNull } from "@/lib/whop-ids";
import { loadWhopBillingRead } from "@/lib/whop-subscription-snapshot";
import {
  applies, auditRowFor, membershipFromPayment, memberFromMembership, parseArgs, paymentIdsForRow, proposeRepair,
  type PinRow, type WhopGet,
} from "../../../scripts/whop/repair-member-pins";

const MONTHLY = "plan_redacted8f2b848b";
type Row = { tier: string; payment_provider: string | null; provider_payment_id: string | null; whop_membership_id: string | null };
const db = (rows: Row[]) => createFakeSupabase((c) => {
  if (c.table === "subscriptions") return { data: rows };
  if (c.table === "payment_events") return { data: rows.map((r) => ({ payment_id: r.provider_payment_id, plan_id: MONTHLY })) };
  return {};
}).sb as unknown as SupabaseClient;
const row = (pin: string | null): Row => ({ tier: "first_month_19", payment_provider: "whop", provider_payment_id: "pay_a", whop_membership_id: pin });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubEnv("WHOP_API_KEY", "synthetic");
  vi.mocked(captureServerError).mockClear();
  sentry.captureMessage.mockClear();
  resetWhopAuthWarningForTests();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Whop id shapes", () => {
  it("tells memberships from members", () => {
    expect(isWhopMembershipId("mem_O9ek12")).toBe(true);
    expect(isWhopMembershipId("mber_ABC123")).toBe(false);
    expect(isWhopMemberId("mber_ABC123")).toBe(true);
    expect(whopMembershipIdOrNull("mber_ABC123")).toBeNull();
    expect(whopMembershipIdOrNull("mem_x; drop")).toBeNull();
    expect(whopMembershipIdOrNull(null)).toBeNull();
  });
  it("trial_ending_soon never takes the membership from member.id", () => {
    expect(trialEndingMembershipId({ member: { id: "mber_ABC123" } })).toBeNull();
    expect(trialEndingMembershipId({ member: { id: "mem_lookalike" } })).toBeNull();
    expect(trialEndingMembershipId({ member: { id: "mber_ABC123" }, membership: { id: "mem_T1" } })).toBe("mem_T1");
    expect(trialEndingMembershipId({ membership_id: "mem_T2", membership: { id: "mem_T1" } })).toBe("mem_T2");
    expect(trialEndingMembershipId({ id: "mem_T3", member: { id: "mber_ABC123" } })).toBe("mem_T3");
    expect(trialEndingMembershipId({ membership_id: "mber_ABC123" })).toBeNull();
  });
  it("the membership read never calls Whop for a member id and reports the HTTP status", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await loadWhopBillingRead("mber_ABC123", "first_month_19")).toEqual({ snapshot: null, status: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await loadWhopBillingRead("mem_A1", "first_month_19")).toEqual({ snapshot: null, status: 401 });
    fetchSpy.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await loadWhopBillingRead("mem_A1", "first_month_19")).toEqual({ snapshot: null, status: 0 });
  });
});

describe("renewal state reporting", () => {
  it("a legacy mber_ pin counts as no pin: unknown, no Whop read, nothing reported", async () => {
    const load = vi.fn();
    expect(await loadRenewalState(db([row("mber_ABC123")]), "c66759a3", load)).toBe("unknown");
    expect(load).not.toHaveBeenCalled();
    await flush();
    expect(captureServerError).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
  it("a real mem_ pin whose read fails for another reason is still reported", async () => {
    const load = vi.fn(async () => ({ snapshot: null, status: 500 }));
    expect(await loadRenewalState(db([row("mem_A1")]), "u", load)).toBe("unknown");
    expect(load).toHaveBeenCalledWith("mem_A1", "first_month_19");
    expect(captureServerError).toHaveBeenCalledTimes(1);
  });
  it("401/403 is one named warning per hour, never an error per read", async () => {
    const load = vi.fn(async () => ({ snapshot: null, status: 401 }));
    for (let i = 0; i < 5; i++) expect(await loadRenewalState(db([row("mem_A1")]), "u", load)).toBe("unknown");
    const forbidden = vi.fn(async () => ({ snapshot: null, status: 403 }));
    expect(await loadRenewalState(db([row("mem_A1")]), "u", forbidden)).toBe("unknown");
    await flush();
    expect(captureServerError).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = sentry.captureMessage.mock.calls[0];
    expect(message).toMatch(/not authorized \(HTTP 401\).*memberships.*read permission for memberships and payments/);
    expect(options).toMatchObject({ level: "warning" });
  });
  it("the warning comes back after an hour", () => {
    const t0 = Date.UTC(2026, 9, 12, 14, 0);
    expect(warnWhopKeyUnauthorized(401, "GET /api/v1/memberships/{id}", t0)).toBe(true);
    expect(warnWhopKeyUnauthorized(401, "GET /api/v1/memberships/{id}", t0 + 59 * 60_000)).toBe(false);
    expect(warnWhopKeyUnauthorized(403, "GET /api/v1/memberships/{id}", t0 + 61 * 60_000)).toBe(true);
  });
});

describe("repair-member-pins (pure parts; never run against a database here)", () => {
  const pinRow = (over: Partial<PinRow> = {}): PinRow => ({
    id: "11111111-1111-4111-8111-111111111111", user_id: "dfb2d123-a86f-47bc-8928-abd77a373b0e", status: "active", tier: "first_month_19",
    provider_payment_id: "pay_B2", granted_payment_ids: [{ payment_id: "pay_A1" }, { payment_id: "pay_B2" }, { payment_id: "mem_trial" }],
    whop_membership_id: "mber_ABC123", ...over,
  });
  const whop = (routes: Record<string, { status: number | null; body: unknown }>): WhopGet => async (p) => routes[p] ?? { status: 404, body: null };

  it("collects the row's own payment ids once, provider id first, pay_ only", () => {
    expect(paymentIdsForRow(pinRow())).toEqual(["pay_B2", "pay_A1"]);
    expect(paymentIdsForRow(pinRow({ provider_payment_id: null, granted_payment_ids: null }))).toEqual([]);
  });
  it("reads the membership from a payment and the member from a membership, never mixing them", () => {
    expect(membershipFromPayment({ membership: { id: "mem_X1" }, member: { id: "mber_ABC123" } })).toBe("mem_X1");
    expect(membershipFromPayment({ membership: "mem_X2" })).toBe("mem_X2");
    expect(membershipFromPayment({ member: { id: "mber_ABC123" }, membership_id: "mber_ABC123" })).toBeNull();
    expect(memberFromMembership({ member: { id: "mber_ABC123" } })).toBe("mber_ABC123");
  });
  it("proposes the fix when every readable payment names the same membership of that member", async () => {
    const p = await proposeRepair(pinRow(), whop({
      "/api/v1/payments/pay_B2": { status: 200, body: { membership: { id: "mem_X1" } } },
      "/api/v1/payments/pay_A1": { status: 200, body: { membership_id: "mem_X1" } },
      "/api/v1/memberships/mem_X1": { status: 200, body: { id: "mem_X1", member: { id: "mber_ABC123" } } },
    }));
    expect(p).toMatchObject({ kind: "fix", membershipId: "mem_X1", viaPaymentId: "pay_B2", memberChecked: true });
  });
  it("leaves the row for manual work on disagreement, another member, or a refused key", async () => {
    expect(await proposeRepair(pinRow(), whop({
      "/api/v1/payments/pay_B2": { status: 200, body: { membership: { id: "mem_X1" } } },
      "/api/v1/payments/pay_A1": { status: 200, body: { membership: { id: "mem_Y2" } } },
    }))).toMatchObject({ kind: "manual", reason: expect.stringMatching(/different memberships/) });
    expect(await proposeRepair(pinRow(), whop({
      "/api/v1/payments/pay_B2": { status: 200, body: { membership: { id: "mem_X1" } } },
      "/api/v1/memberships/mem_X1": { status: 200, body: { member: { id: "mber_OTHER9" } } },
    }))).toMatchObject({ kind: "manual", reason: expect.stringMatching(/belongs to mber_OTHER9/) });
    expect(await proposeRepair(pinRow(), whop({
      "/api/v1/payments/pay_B2": { status: 401, body: null },
      "/api/v1/payments/pay_A1": { status: 403, body: null },
    }))).toMatchObject({ kind: "manual", reason: "Whop key not authorized to read payments" });
    expect(await proposeRepair(pinRow({ whop_membership_id: "mem_ok1" }), whop({}))).toMatchObject({ kind: "manual" });
    // A membership already pinned to another learner is never proposed.
    expect(await proposeRepair(pinRow(), whop({
      "/api/v1/payments/pay_B2": { status: 200, body: { membership: { id: "mem_X1" } } },
    }), async () => ["dfb2d123-a86f-47bc-8928-abd77a373b0e", "other-learner"])).toMatchObject({ kind: "manual", reason: expect.stringMatching(/another learner's row \(other-learner\)/) });
  });
  it("an applied fix is audited with actor, reason and before/after; --apply is opt-in", async () => {
    const p = await proposeRepair(pinRow(), whop({ "/api/v1/payments/pay_B2": { status: 200, body: { membership: { id: "mem_X1" } } } }));
    if (p.kind !== "fix") throw new Error("expected a fix");
    const audit = auditRowFor(p, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.invalid" }, "Sentry 13 legacy pin");
    expect(audit).toMatchObject({
      action: "whop_member_pin_repaired", target_type: "subscription", target_id: p.row.id,
      payload: { reason: "Sentry 13 legacy pin", before: { whop_membership_id: "mber_ABC123" }, after: { whop_membership_id: "mem_X1" } },
    });
    expect(parseArgs([])).toEqual({ apply: false, actor: null, reason: null, allowUnchecked: false });
    expect(parseArgs(["--apply", "--actor", "a", "--reason", "r"])).toEqual({ apply: true, actor: "a", reason: "r", allowUnchecked: false });
    // Without the member check only --allow-unchecked writes the fix.
    expect(p.memberChecked).toBe(false);
    expect(applies(p, { apply: true, allowUnchecked: false })).toBe(false);
    expect(applies(p, { apply: true, allowUnchecked: true })).toBe(true);
    expect(applies(p, { apply: false, allowUnchecked: true })).toBe(false);
  });
});
