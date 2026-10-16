import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));

import { extendOrInsertWhopSubscription, MEMBERSHIP_REQUIRED, pinnedGrantTarget, resetPinnedGrantCacheForTests, type ActiveSubRow } from "@/lib/whop-grant";
import { extensionAllowedFor, switchTiersFor, whopSwitchCancelEnabled } from "@/lib/whop-extension";
import { stopSwitchedRenewal } from "@/lib/whop-switch";
import { renderAccessEndingReminder, RENEW_EARLY_LINE } from "@/lib/email/access-ending-template";
import { confirmLines, SWITCH_CONFIRM_LINE } from "@/app/pricing/_parts/plans";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

// a-renew-early: an extension or a switch gets its own row starting at the
// old end with its own membership pin; the old renewal is stopped only after
// the new payment is granted; comp and manual access stay non-extendable.

const DAY = 86_400_000;
const NOW = new Date("2026-11-10T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const row = (over: Partial<ActiveSubRow>): ActiveSubRow => ({
  id: "sub_a", tier: "first_month_19", expires_at: iso(NOW.getTime() + 19 * DAY), amount_cents: 1900, currency: "EUR",
  granted_payment_ids: [], whop_membership_id: "mem_A1", ...over,
});

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); resetPinnedGrantCacheForTests(); });

describe("pinnedGrantTarget (mirror of grant_whop_paid_subscription_pinned)", () => {
  it("a renewal extends the live row pinned to its own membership, never the newest other row", () => {
    const a = row({ id: "a", whop_membership_id: "mem_A1", expires_at: iso(NOW.getTime() + 5 * DAY) });
    const b = row({ id: "b", whop_membership_id: "mem_B1", expires_at: iso(NOW.getTime() + 40 * DAY) });
    expect(pinnedGrantTarget([a, b], "mem_A1", NOW)).toEqual({ kind: "extend", row: a });
  });
  it("a new membership while pinned coverage runs stacks after the latest end", () => {
    const a = row({ id: "a", whop_membership_id: "mem_A1", expires_at: iso(NOW.getTime() + 5 * DAY) });
    const c = row({ id: "c", whop_membership_id: "mem_C1", expires_at: iso(NOW.getTime() + 9 * DAY) });
    expect(pinnedGrantTarget([a, c], "mem_N1", NOW)).toEqual({ kind: "stack", pin: "mem_N1", start: new Date(NOW.getTime() + 9 * DAY) });
  });
  it("keeps today's rule for legacy shapes: unpinned or mber_ rows, a non-expiring row, no membership id, no rows", () => {
    const unpinned = row({ id: "u", whop_membership_id: null });
    expect(pinnedGrantTarget([unpinned], "mem_N1", NOW)).toEqual({ kind: "extend", row: unpinned });
    const member = row({ id: "m", whop_membership_id: "mber_x1" });
    expect(pinnedGrantTarget([member], "mem_N1", NOW)).toEqual({ kind: "extend", row: member });
    const open = row({ id: "o", expires_at: null });
    expect(pinnedGrantTarget([open, row({ id: "a" })], "mem_N1", NOW)).toEqual({ kind: "extend", row: open });
    const a = row({ id: "a" });
    expect(pinnedGrantTarget([a], null, NOW)).toEqual({ kind: "extend", row: a });
    expect(pinnedGrantTarget([a], "mber_payer", NOW)).toEqual({ kind: "extend", row: a });
    expect(pinnedGrantTarget([], "mem_N1", NOW)).toEqual({ kind: "insert" });
  });
});

describe("non-atomic grant path", () => {
  it("inserts the stacked row at the old end, pinned to the new membership; the old row is not touched", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "");
    const end = iso(Date.now() + 12 * DAY);
    const fake = createFakeSupabase((call) => {
      if (call.table === "subscriptions" && call.op === "select") return { data: [row({ id: "old", expires_at: end, whop_membership_id: "mem_OLD1" })] };
      if (call.table === "subscriptions" && call.op === "insert") return { data: { id: "new" } };
      return { data: [] };
    });
    const out = await extendOrInsertWhopSubscription(fake.sb as unknown as SupabaseClient, {
      userId: "u", tier: "premium_pass_guaranteed", paymentId: "pay_N", amountCents: 12900, currency: "EUR", membershipId: "mem_NEW1",
    });
    expect(out).toMatchObject({ mode: "inserted", subscriptionId: "new", previousExpiresAt: end });
    const insert = fake.calls.find((c) => c.op === "insert")!.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ whop_membership_id: "mem_NEW1", started_at: end, provider_payment_id: "pay_N" });
    const startMs = Date.parse(end);
    const expected = new Date(startMs); expected.setUTCMonth(expected.getUTCMonth() + 6);
    expect(insert.expires_at).toBe(expected.toISOString());
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });
  it("a renewal of a pinned row never re-pins it to another membership", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "");
    const fake = createFakeSupabase((call) => call.table === "subscriptions" && call.op === "select"
      ? { data: [row({ id: "old", expires_at: iso(Date.now() + 3 * DAY), whop_membership_id: "mem_OLD1" })] } : { data: [] });
    await extendOrInsertWhopSubscription(fake.sb as unknown as SupabaseClient, {
      userId: "u", tier: "first_month_19", paymentId: "pay_R", amountCents: 1900, currency: "EUR", membershipId: "mem_OLD1",
    });
    const update = fake.calls.find((c) => c.op === "update")!.payload as Record<string, unknown>;
    expect(update.whop_membership_id).toBeUndefined();
    expect(update.provider_payment_id).toBe("pay_R");
  });
});

describe("atomic grant path before the changeset", () => {
  const args = { userId: "u", tier: "first_month_19", paymentId: "pay_1", amountCents: 1900, currency: "EUR", membershipId: "mem_A1" };
  const ok = { data: [{ mode: "inserted", subscription_id: "s", expires_at: "2040-01-01T00:00:00Z", previous_expires_at: null, replayed: false, entitlement_reconciled: true }], error: null };
  it("falls back to the applied months function only while extensions are off", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "true");
    const rpc = vi.fn(async (name: string) => name === "grant_whop_paid_subscription_pinned"
      ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } } : ok);
    const out = await extendOrInsertWhopSubscription({ rpc } as unknown as SupabaseClient, args);
    expect(out.mode).toBe("inserted");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["grant_whop_paid_subscription_pinned", "grant_whop_paid_subscription"]);
    // The miss is remembered for 10 minutes: the next grant goes straight to the applied function.
    await extendOrInsertWhopSubscription({ rpc } as unknown as SupabaseClient, { ...args, paymentId: "pay_2" });
    expect(rpc.mock.calls.map((c) => c[0]).slice(2)).toEqual(["grant_whop_paid_subscription"]);
  });
  it("fails closed with extensions on (never merges an extension into the old row)", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "true");
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }));
    const out = await extendOrInsertWhopSubscription({ rpc } as unknown as SupabaseClient, args);
    expect(out.mode).toBe("failed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("a grant without a membership never merges into a pinned row (extensions on)", () => {
  it("returns MEMBERSHIP_REQUIRED and writes nothing", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "true");
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const rpc = vi.fn();
    const fake = createFakeSupabase(() => ({ data: [{ id: "old", expires_at: iso(Date.now() + 5 * DAY), whop_membership_id: "mem_OLD1" }] }));
    const out = await extendOrInsertWhopSubscription({ ...fake.sb, rpc } as unknown as SupabaseClient, {
      userId: "u", tier: "first_month_19", paymentId: "pay_V", amountCents: 1900, currency: "EUR", membershipId: null, holdWithoutMembership: true,
    });
    expect(out).toMatchObject({ mode: "failed", error: MEMBERSHIP_REQUIRED });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("is today's grant while extensions are off", async () => {
    vi.stubEnv("WHOP_ATOMIC_GRANTS_ENABLED", "true");
    const ok = { data: [{ mode: "extended", subscription_id: "s", expires_at: "2040-01-01T00:00:00Z", previous_expires_at: null, replayed: false, entitlement_reconciled: true }], error: null };
    const rpc = vi.fn(async () => ok);
    const out = await extendOrInsertWhopSubscription({ rpc } as unknown as SupabaseClient, {
      userId: "u", tier: "first_month_19", paymentId: "pay_V", amountCents: 1900, currency: "EUR", membershipId: null, holdWithoutMembership: true,
    });
    expect(out.mode).toBe("extended");
  });
});

describe("who may renew early or switch", () => {
  const end = iso(NOW.getTime() + 20 * DAY);
  it("only Whop-owned pinned access that ends with the account (comp and manual stay out)", () => {
    expect(extensionAllowedFor([{ expires_at: end, whop_membership_id: "mem_A1" }], end, NOW)).toBe(true);
    // A comp or manual grant (or a renewal-guard row) outlasting the Whop row.
    expect(extensionAllowedFor([{ expires_at: iso(NOW.getTime() + 5 * DAY), whop_membership_id: "mem_A1" }], end, NOW)).toBe(false);
    // Comp only, no live Whop row.
    expect(extensionAllowedFor([], end, NOW)).toBe(false);
    expect(extensionAllowedFor([{ expires_at: end, whop_membership_id: null }], end, NOW)).toBe(false);
    expect(extensionAllowedFor([{ expires_at: null, whop_membership_id: "mem_A1" }], end, NOW)).toBe(false);
    expect(extensionAllowedFor([{ expires_at: end, whop_membership_id: "mem_A1" }], null, NOW)).toBe(false);
  });
  it("switch targets are strictly longer and never the Sitting Pass", () => {
    const all = ["first_month_19", "first_3mo_27", "premium_pass_guaranteed", "flex_month", "sitting_pass", "half_year", "guarantee_ticket"];
    expect(switchTiersFor("first_month_19", all)).toEqual(["first_3mo_27", "premium_pass_guaranteed", "half_year", "guarantee_ticket"]);
    expect(switchTiersFor("first_3mo_27", all)).toEqual(["premium_pass_guaranteed", "half_year", "guarantee_ticket"]);
    expect(switchTiersFor("half_year", all)).toEqual(["guarantee_ticket"]);
    expect(switchTiersFor("first_month_19", ["unknown_tier"])).toEqual([]);
  });
  it("the switch flag needs the extension flag", () => {
    expect(whopSwitchCancelEnabled({ WHOP_SWITCH_CANCEL_ENABLED: "true" })).toBe(false);
    expect(whopSwitchCancelEnabled({ WHOP_SWITCH_CANCEL_ENABLED: "true", WHOP_EXTENSIONS_ENABLED: "true" })).toBe(true);
    expect(whopSwitchCancelEnabled({ WHOP_EXTENSIONS_ENABLED: "true" })).toBe(false);
  });
});

describe("stopSwitchedRenewal (cancel_at_period_end only after the grant)", () => {
  const ON = { WHOP_EXTENSIONS_ENABLED: "true", WHOP_SWITCH_CANCEL_ENABLED: "true" };
  const oldEnd = iso(Date.now() + 10 * DAY);
  const renewing = { provider_state_verified: true, billing_cadence: "auto_renews", cancel_at_period_end: false, provider_status: "active", next_charge_at: oldEnd };
  const cancelling = { ...renewing, cancel_at_period_end: true, provider_status: "canceling" };
  type State = { granted: boolean; claimExists?: string; claimedAt?: string; rows?: Array<Record<string, unknown>>; claimError?: boolean };
  function db(state: State) {
    let inserts = 0;
    return createFakeSupabase((call: FakeCall) => {
      if (call.table === "subscriptions") {
        const all = state.rows ?? [
          { id: "old", tier: "first_month_19", user_id: "user-1", status: "active", started_at: iso(Date.now() - 20 * DAY), expires_at: oldEnd, whop_membership_id: "mem_OLD1", provider_payment_id: "pay_o", granted_payment_ids: [] },
          ...(state.granted ? [{ id: "new", tier: "premium_pass_guaranteed", user_id: "user-1", status: "active", started_at: oldEnd, expires_at: iso(Date.now() + 190 * DAY), whop_membership_id: "mem_NEW1", provider_payment_id: "pay_N", granted_payment_ids: [{ payment_id: "pay_N" }] }] : []),
        ];
        const byPayment = call.filters.find((f) => f.column === "provider_payment_id");
        return { data: byPayment ? all.filter((r) => r.provider_payment_id === byPayment.value) : all };
      }
      if (call.table === "processed_webhook_events" && call.op === "insert") {
        inserts += 1;
        // A taken-over stale claim inserts again after the delete.
        if (state.claimError && inserts === 1) return { error: { code: "23505", message: "dup" } };
        return { data: { event_id: "k" } };
      }
      if (call.table === "processed_webhook_events" && call.op === "select") return { data: state.claimExists ? { payload: { phase: state.claimExists, claimed_at: state.claimedAt ?? new Date().toISOString() } } : null };
      return { data: null };
    });
  }
  const base = { paymentId: "pay_N", newMembershipId: "mem_NEW1", metaSwitchFrom: "mem_OLD1", checkoutConfigId: "ch_1" };

  it("flags off and no echoed intent: no read at all", async () => {
    const fake = db({ granted: true });
    expect(await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, metaSwitchFrom: null, env: {} })).toBe("not_switch");
    expect(fake.calls).toHaveLength(0);
  });
  it("flags off with an echoed intent: nothing at Whop, reported for a hand stop", async () => {
    const fetchImpl = vi.fn();
    const fake = db({ granted: true });
    expect(await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, env: {}, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sentry.captureMessage.mock.calls[0][1]).toBe("error");
  });
  it("no stop before the new payment is granted (the grant row is the proof, not a log row)", async () => {
    const fetchImpl = vi.fn();
    expect(await stopSwitchedRenewal(db({ granted: false }).sb as unknown as SupabaseClient, { ...base, env: ON, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("a later renewal of the new membership is not a switch (silent)", async () => {
    const fetchImpl = vi.fn();
    const rows = [
      { id: "old", tier: "first_month_19", user_id: "user-1", status: "active", started_at: null, expires_at: oldEnd, whop_membership_id: "mem_OLD1", provider_payment_id: "pay_o", granted_payment_ids: [] },
      { id: "new", tier: "flex_month", user_id: "user-1", status: "active", started_at: oldEnd, expires_at: iso(Date.now() + 60 * DAY), whop_membership_id: "mem_NEW1", provider_payment_id: "pay_R2", granted_payment_ids: [{ payment_id: "pay_N" }, { payment_id: "pay_R2" }] },
    ];
    const out = await stopSwitchedRenewal(db({ granted: true, rows }).sb as unknown as SupabaseClient, { ...base, paymentId: "pay_R2", metaSwitchFrom: null, env: ON, fetchImpl: fetchImpl as unknown as typeof fetch,
      // the checkout_configuration_id of the switch checkout round-trips on renewals
      checkoutConfigId: null });
    expect(out).toBe("not_switch");
    const intent = await stopSwitchedRenewal(db({ granted: true, rows }).sb as unknown as SupabaseClient, { ...base, paymentId: "pay_R2", userId: "user-1", env: ON, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(intent).toBe("not_switch");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
  it("an unverified Whop read is reported, never skipped silently", async () => {
    const fetchImpl = vi.fn();
    const out = await stopSwitchedRenewal(db({ granted: true }).sb as unknown as SupabaseClient, { ...base, env: ON, fetchImpl: fetchImpl as unknown as typeof fetch,
      loadSnapshot: (async () => ({ snapshot: { ...renewing, provider_state_verified: false }, status: 200 })) as never });
    expect(out).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sentry.captureMessage.mock.calls.at(-1)?.[1]).toBe("error");
  });
  it("a fresh claim held by another run answers retry; a stale one is taken over", async () => {
    vi.stubEnv("WHOP_API_KEY", "test-key");
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const fresh = await stopSwitchedRenewal(db({ granted: true, claimError: true, claimExists: "claimed" }).sb as unknown as SupabaseClient, { ...base, env: ON, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fresh).toBe("retry");
    expect(fetchImpl).not.toHaveBeenCalled();
    const fake = db({ granted: true, claimError: true, claimExists: "claimed", claimedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
    const loadSnapshot = vi.fn().mockResolvedValueOnce({ snapshot: renewing, status: 200 }).mockResolvedValueOnce({ snapshot: cancelling, status: 200 });
    const out = await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, env: ON, loadSnapshot: loadSnapshot as never, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBe("stopped");
    expect(fake.calls.filter((c) => c.table === "processed_webhook_events" && c.op === "delete")).toHaveLength(1);
  });
  it("no stop when the new row does not start at the old end (reported)", async () => {
    const fetchImpl = vi.fn();
    const rows = [
      { id: "old", tier: "first_month_19", user_id: "user-1", status: "active", started_at: null, expires_at: oldEnd, whop_membership_id: "mem_OLD1", provider_payment_id: "pay_o", granted_payment_ids: [] },
      { id: "new", tier: "premium_pass_guaranteed", user_id: "user-1", status: "active", started_at: iso(Date.now()), expires_at: iso(Date.now() + 180 * DAY), whop_membership_id: "mem_NEW1", provider_payment_id: "pay_N", granted_payment_ids: [] },
    ];
    expect(await stopSwitchedRenewal(db({ granted: true, rows }).sb as unknown as SupabaseClient, { ...base, env: ON, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("happy path: claim, fresh read, cancel at period end with its own key, confirm, audit", async () => {
    vi.stubEnv("WHOP_API_KEY", "test-key");
    const fake = db({ granted: true });
    const loadSnapshot = vi.fn().mockResolvedValueOnce({ snapshot: renewing, status: 200 }).mockResolvedValueOnce({ snapshot: cancelling, status: 200 });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const out = await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, env: ON, loadSnapshot: loadSnapshot as never, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBe("stopped");
    expect(fetchImpl.mock.calls[0][0]).toContain("/memberships/mem_OLD1/cancel");
    expect(fetchImpl.mock.calls[0][1].headers["Idempotency-Key"]).toBe("renew-switch:mem_OLD1:pay_N");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ cancel_at_period_end: true });
    const claim = fake.calls.find((c) => c.table === "processed_webhook_events" && c.op === "insert")!;
    expect(claim.payload).toMatchObject({ provider: "billing_action", event_id: "switch_cancel:mem_OLD1:pay_N" });
    const phases = fake.calls.filter((c) => c.table === "processed_webhook_events" && c.op === "update").map((c) => (c.payload as { payload: { phase: string } }).payload.phase);
    expect(phases).toEqual(["stopped"]);
    expect(fake.calls.find((c) => c.table === "user_events")?.payload).toMatchObject({ event_type: "whop_switch_renewal_stopped" });
  });
  it("already cancelling at Whop: no second call", async () => {
    const fetchImpl = vi.fn();
    const out = await stopSwitchedRenewal(db({ granted: true }).sb as unknown as SupabaseClient, { ...base, env: ON, loadSnapshot: (async () => ({ snapshot: cancelling, status: 200 })) as never, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toBe("already_stopped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("a transient Whop failure releases the claim for the redelivery; a refusal is reported", async () => {
    vi.stubEnv("WHOP_API_KEY", "test-key");
    let fake = db({ granted: true });
    let out = await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, env: ON, loadSnapshot: (async () => ({ snapshot: renewing, status: 200 })) as never, fetchImpl: (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch });
    expect(out).toBe("retry");
    expect(fake.calls.some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(true);
    fake = db({ granted: true });
    out = await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, env: ON, loadSnapshot: (async () => ({ snapshot: renewing, status: 200 })) as never, fetchImpl: (async () => ({ ok: false, status: 422 })) as unknown as typeof fetch });
    expect(out).toBe("failed");
    expect(fake.calls.some((c) => c.op === "delete")).toBe(false);
    expect(sentry.captureMessage.mock.calls.at(-1)?.[1]).toBe("error");
  });
  it("an unconfirmed stop is reported, never claimed as done", async () => {
    vi.stubEnv("WHOP_API_KEY", "test-key");
    const fake = db({ granted: true });
    const loadSnapshot = vi.fn().mockResolvedValue({ snapshot: renewing, status: 200 });
    const out = await stopSwitchedRenewal(fake.sb as unknown as SupabaseClient, { ...base, env: ON, loadSnapshot: loadSnapshot as never, fetchImpl: (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch });
    expect(out).toBe("failed");
    expect(fake.calls.some((c) => c.table === "user_events")).toBe(false);
  });
  it("a redelivery after the stop is a no-op", async () => {
    const fetchImpl = vi.fn();
    expect(await stopSwitchedRenewal(db({ granted: true, claimError: true, claimExists: "stopped" }).sb as unknown as SupabaseClient, { ...base, env: ON, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("already_stopped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("copy", () => {
  const args = { firstName: null, accessEndsAtIso: "2026-12-16T12:00:00.000Z", qsAnswered: 0, accuracyPct: 0, streakDays: 0, now: new Date("2026-12-03T08:00:00Z") };
  it("the access-ending mail says 'book now' only where the checkout would accept it", () => {
    for (const lang of ["de", "en"] as const) {
      const before = renderAccessEndingReminder({ ...args, lang }).htmlBody;
      expect(before).toContain(lang === "de" ? "Vorher ist eine Buchung hier noch nicht möglich." : "Booking is not possible here before then.");
      const early = renderAccessEndingReminder({ ...args, lang, canRenewEarly: true }).htmlBody;
      expect(early).not.toContain(lang === "de" ? "noch nicht möglich" : "not possible here");
      expect(early).toContain(RENEW_EARLY_LINE[lang](lang === "de" ? "16. Dezember 2026" : "16 December 2026"));
    }
  });
  it("the confirm sheet names the stop of the old renewal only for a switch", () => {
    const from = "2026-11-29T12:00:00.000Z";
    const now = new Date("2026-11-20T12:00:00.000Z");
    expect(confirmLines("premium_pass_guaranteed", "de", now, from, null, true)).toContain(SWITCH_CONFIRM_LINE.de);
    expect(confirmLines("premium_pass_guaranteed", "en", now, from, null, false)).not.toContain(SWITCH_CONFIRM_LINE.en);
  });
  it("no em or en dashes in the new learner lines", () => {
    for (const text of [RENEW_EARLY_LINE.de("x"), RENEW_EARLY_LINE.en("x"), SWITCH_CONFIRM_LINE.de, SWITCH_CONFIRM_LINE.en]) expect(text).not.toMatch(/[–—]/);
  });
});

beforeEach(() => { sentry.captureMessage.mockReset(); });
