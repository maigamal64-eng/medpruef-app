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
    if (call.table === "processed_webhook_events" && call.op === "insert") {
      return { data: { event_id: (call.payload as { event_id: string }).event_id } };
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

describe("resolveWhopBuyer, fail-closed (a-whop-buyer-fail-closed, Whop review G10)", () => {
  const denied = (status: number, noKey = false): (() => Promise<WhopMembershipLookup>) =>
    async () => ({ ok: false, status, noKey, metaUserId: null, manageUrl: null, checkoutConfigId: null });
  const now = () => new Date("2026-10-20T09:15:00Z");
  const alertRows = (calls: FakeCall[]) =>
    calls.filter((c) => c.table === "user_events" && c.op === "insert");

  for (const status of [401, 403]) {
    it(`a ${status} from the membership read is provider_unavailable (denied), never an email match`, async () => {
      const { sb, calls } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
      const r = await resolveWhopBuyer(
        sb as unknown as SupabaseClient,
        { ...extractWhopPayment(v2Renewal), path: "grant", paymentId: "pay_redactedfd51769b" },
        { fetchMembership: denied(status), failClosed: true, now }
      );
      expect(r).toEqual({ kind: "provider_unavailable", status, reason: "denied" });
      expect(calls.some((c) => c.table === "users" && c.filters.some((f) => f.kind === "ilike"))).toBe(false);
      const rows = alertRows(calls);
      expect(rows).toHaveLength(1);
      expect((rows[0].payload as { event_type: string; event_data: Record<string, unknown> })).toMatchObject({
        user_id: "whop-webhook",
        event_type: "whop_membership_read_denied",
        event_data: { cause: `http_${status}`, status, membership_id: "mem_redacted24a53b8f", payment_id: "pay_redactedfd51769b", path: "grant", fail_closed: true, hour: "2026-10-20T09" },
      });
      expect(JSON.stringify(rows[0].payload)).not.toContain("payer@example.com");
    });
  }

  it("no API key at all reads as no_key, also fail-closed", async () => {
    const { sb } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
      fetchMembership: denied(401, true), failClosed: true, now,
    });
    expect(r).toMatchObject({ kind: "provider_unavailable", reason: "no_key" });
  });

  it("a membership the API can read but nothing ties stays unresolved; the payer email is not used", async () => {
    const { sb, calls } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
      fetchMembership: apiOk(null), failClosed: true,
    });
    expect(r).toEqual({ kind: "unresolved", manageUrl: "https://whop.com/billing/manage/mber_x" });
    expect(calls.some((c) => c.table === "users" && c.filters.some((f) => f.kind === "ilike"))).toBe(false);
  });

  it("a payload without a membership id still resolves by a unique email", async () => {
    const { sb } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const fetchMembership = vi.fn(apiOk(null));
    const r = await resolveWhopBuyer(
      sb as unknown as SupabaseClient,
      { membershipId: null, metaUserId: null, checkoutConfigId: null, email: "payer@example.com" },
      { fetchMembership, failClosed: true }
    );
    expect(r).toMatchObject({ kind: "resolved", userId: PAYER_EMAIL_OWNER, source: "email" });
    expect(fetchMembership).not.toHaveBeenCalled();
  });

  it("membership-bound ties still win while the key is denied (pin, metadata, checkout) and never read the API", async () => {
    const { sb } = world({ checkoutSessions: { ch_S0bPNhu0eGZIBvL: MEZOO } });
    const fetchMembership = vi.fn(denied(403));
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v1Renewal), { fetchMembership, failClosed: true });
    expect(r).toMatchObject({ kind: "resolved", userId: MEZOO, source: "checkout_session" });
    expect(fetchMembership).not.toHaveBeenCalled();
  });

  it("flag off: a 403 keeps the old email fallback but still writes the alert row (shadow evidence)", async () => {
    const { sb, calls } = world({ emails: { "payer@example.com": PAYER_EMAIL_OWNER } });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
      fetchMembership: denied(403), failClosed: false, now,
    });
    expect(r).toMatchObject({ kind: "resolved", userId: PAYER_EMAIL_OWNER, source: "email" });
    const rows = alertRows(calls);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { event_data: { fail_closed: boolean } }).event_data.fail_closed).toBe(false);
  });

  it("alerts once per hour: a second denial in the same hour hits the claim and writes no second row", async () => {
    const seen = new Set<string>();
    const { sb, calls } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "processed_webhook_events" && c.op === "insert") {
        const key = (c.payload as { event_id: string }).event_id;
        if (seen.has(key)) return { error: { code: "23505", message: "dup" } };
        seen.add(key);
        return { data: { event_id: key } };
      }
      if (c.table === "subscriptions") return { data: [] };
      if (c.table === "payment_events") return { data: [] };
      if (c.table === "users") return { data: null };
      return {};
    });
    for (let i = 0; i < 3; i++) {
      const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
        fetchMembership: denied(403), failClosed: true, now,
      });
      expect(r.kind).toBe("provider_unavailable");
    }
    expect(alertRows(calls)).toHaveLength(1);
    expect([...seen]).toEqual(["http_403:2026-10-20T09"]);
  });

  it("a failed alert row frees the hour's claim so the next denial alerts again", async () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall) => {
      if (c.table === "processed_webhook_events" && c.op === "insert") return { data: { event_id: "x" } };
      if (c.table === "user_events" && c.op === "insert") return { error: { message: "insert failed" } };
      if (c.table === "subscriptions" || c.table === "payment_events") return { data: [] };
      if (c.table === "users") return { data: null };
      return {};
    });
    const r = await resolveWhopBuyer(sb as unknown as SupabaseClient, extractWhopPayment(v2Renewal), {
      fetchMembership: denied(403), failClosed: true, now,
    });
    expect(r.kind).toBe("provider_unavailable");
    const del = calls.find((c) => c.table === "processed_webhook_events" && c.op === "delete");
    expect(del && eqVal(del, "event_id")).toBe("http_403:2026-10-20T09");
  });
});

describe("whopHttpsUrl", () => {
  it("keeps https whop.com links and drops everything else", async () => {
    const { whopHttpsUrl } = await import("@/lib/whop-buyer");
    expect(whopHttpsUrl("https://whop.com/billing/manage/mem_a")).toBe("https://whop.com/billing/manage/mem_a");
    expect(whopHttpsUrl("https://sub.whop.com/x")).toBe("https://sub.whop.com/x");
    for (const bad of ["http://whop.com/x", "https://whop.com.evil.example/x", "https://user@whop.com/x", "javascript:alert(1)", "", null, 3]) {
      expect(whopHttpsUrl(bad)).toBeNull();
    }
  });
});
