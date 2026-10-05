import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { extractWhopPayment, extractWhopRevoke } from "@/lib/whop";
import { resolveWhopBuyer, type WhopMembershipLookup } from "@/lib/whop-buyer";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

// Real shapes (redacted) from the 2026-09-18 renewal pay_o7PGu… and the
// 2026-09-30 trial pay_0GJxt…: v1 = the REST payment object, v2 = legacy hook.
const MEZOO = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const PAYER_EMAIL_OWNER = "3e814abc-3c3f-4ef3-b55a-9f03b63a5841";

const v1Renewal = {
  id: "pay_redactedfd51769b",
  billing_reason: "subscription_cycle",
  plan: { id: "plan_redactedec56d4df", metadata: { tier: "pro_monthly_trial" } },
  user: { id: "user_x", email: "payer@example.com" },
  membership: { id: "mem_redacted24a53b8f", status: "active" },
  member: { id: "mber_bs3QbHTs49VWM" },
  metadata: null,
  checkout_configuration_id: "ch_S0bPNhu0eGZIBvL",
  recovery_url: null,
  currency: "eur",
  total: 19,
  amount_after_fees: 17.92,
};

const v2Renewal = {
  id: "pay_redactedfd51769b",
  membership: {
    id: "mem_redacted24a53b8f",
    email: "payer@example.com",
    status: "active",
    valid: true,
  },
  plan: { id: "plan_redactedec56d4df" },
  final_amount: 19,
  currency: "eur",
};

describe("extractWhopPayment", () => {
  it("reads the MEMBERSHIP id (mem_) separately from the member id (mber_) on a v1 renewal", () => {
    const f = extractWhopPayment(v1Renewal);
    expect(f.membershipId).toBe("mem_redacted24a53b8f");
    expect(f.memberId).toBe("mber_bs3QbHTs49VWM");
    expect(f.metaUserId).toBeNull();
    expect(f.checkoutConfigId).toBe("ch_S0bPNhu0eGZIBvL");
  });

  it("reads the membership id + email from the legacy v2 envelope", () => {
    const f = extractWhopPayment(v2Renewal);
    expect(f.membershipId).toBe("mem_redacted24a53b8f");
    expect(f.memberId).toBeNull();
    expect(f.email).toBe("payer@example.com");
  });
});

describe("extractWhopRevoke", () => {
  it("falls back to the membership object when there is no member key", () => {
    const r = extractWhopRevoke({
      id: "refund_1",
      payment: { id: "pay_1" },
      membership: { id: "mem_A", email: "m@example.com", metadata: { medpruef_user_id: MEZOO } },
    });
    expect(r.membershipId).toBe("mem_A");
    expect(r.email).toBe("m@example.com");
    expect(r.metaUserId).toBe(MEZOO);
  });

  it("treats a membership.deactivated payload's own id as the membership id", () => {
    const r = extractWhopRevoke({ id: "mem_B", metadata: { medpruef_user_id: MEZOO }, checkout_configuration_id: "ch_1" });
    expect(r.membershipId).toBe("mem_B");
    expect(r.checkoutConfigId).toBe("ch_1");
  });
});

function world(opts: {
  pins?: Record<string, string>;
  checkoutSessions?: Record<string, string>;
  users?: string[];
  emails?: Record<string, string>;
}) {
  const users = new Set(opts.users ?? [MEZOO, PAYER_EMAIL_OWNER]);
  return createFakeSupabase((call: FakeCall) => {
    if (call.table === "subscriptions" && call.op === "select") {
      const mem = eqVal(call, "whop_membership_id") as string | undefined;
      const uid = mem ? opts.pins?.[mem] : undefined;
      return { data: uid ? [{ user_id: uid }] : [] };
    }
    if (call.table === "users" && call.op === "select") {
      const id = eqVal(call, "id") as string | undefined;
      if (id) return { data: users.has(id) ? { id } : null };
      const ilike = call.filters.find((f) => f.kind === "ilike")?.value as string | undefined;
      const hit = ilike ? opts.emails?.[ilike] : undefined;
      return { data: hit ? [{ id: hit }] : [] };
    }
    if (call.table === "payment_events") {
      const ch = eqVal(call, "checkout_session_id") as string;
      const uid = opts.checkoutSessions?.[ch];
      return { data: uid ? [{ user_id: uid }, { user_id: uid }] : [] };
    }
    return {};
  });
}

const apiOk = (metaUserId: string | null): (() => Promise<WhopMembershipLookup>) =>
  async () => ({ ok: true, status: 200, metaUserId, manageUrl: "https://whop.com/billing/manage/mber_x", checkoutConfigId: null });

describe("resolveWhopBuyer", () => {
  it("credits the SUBSCRIBER on a renewal with null metadata, not the payer-email account (Mezoo 10-07 case)", async () => {
    const { sb } = world({
      checkoutSessions: { ch_S0bPNhu0eGZIBvL: MEZOO },
      emails: { "payer@example.com": PAYER_EMAIL_OWNER },
    });
    const f = extractWhopPayment(v1Renewal);
    const fetchMembership = vi.fn(apiOk(null));
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, f, { fetchMembership });
    expect(r).toMatchObject({ kind: "resolved", userId: MEZOO, source: "checkout_session" });
    expect(fetchMembership).not.toHaveBeenCalled();
  });

  it("uses the Whop membership metadata when there is no checkout tie (legacy v2 envelope)", async () => {
    const { sb } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
      fetchMembership: apiOk(MEZOO),
    });
    expect(r).toMatchObject({ kind: "resolved", userId: MEZOO, source: "membership_api" });
  });

  it("prefers the DB membership pin over everything else", async () => {
    const { sb } = world({
      pins: { mem_redacted24a53b8f: MEZOO },
      checkoutSessions: { ch_S0bPNhu0eGZIBvL: PAYER_EMAIL_OWNER },
    });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v1Renewal), {
      fetchMembership: apiOk(PAYER_EMAIL_OWNER),
    });
    expect(r).toMatchObject({ userId: MEZOO, source: "membership_pin" });
  });

  it("returns provider_unavailable (never guesses by email) when the membership API is down", async () => {
    const { sb } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
      fetchMembership: async () => ({ ok: false, status: 503, metaUserId: null, manageUrl: null, checkoutConfigId: null }),
    });
    expect(r.kind).toBe("provider_unavailable");
  });

  it("falls back to email only last, and only on a unique match", async () => {
    const { sb } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const r = await resolveWhopBuyer(
      sb as unknown as SupabaseClient,
      { membershipId: null, metaUserId: null, checkoutConfigId: null, email: "payer@example.com" },
      { fetchMembership: apiOk(null) }
    );
    expect(r).toMatchObject({ userId: PAYER_EMAIL_OWNER, source: "email" });
  });

  it("first payment: payment metadata wins", async () => {
    const { sb } = world({});
    const r = await resolveWhopBuyer(
      sb as unknown as SupabaseClient,
      { membershipId: "mem_new", metaUserId: MEZOO, checkoutConfigId: null, email: "payer@example.com" },
      { fetchMembership: apiOk(PAYER_EMAIL_OWNER) }
    );
    expect(r).toMatchObject({ userId: MEZOO, source: "payment_metadata" });
  });

  it("a DB error mid-resolution returns provider_unavailable instead of falling to email", async () => {
    const { sb } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "subscriptions") return { error: { message: "timeout" } };
      if (c.table === "users") return { data: [{ id: PAYER_EMAIL_OWNER }] };
      return {};
    });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v1Renewal), {
      fetchMembership: apiOk(null),
    });
    expect(r.kind).toBe("provider_unavailable");
  });
});
