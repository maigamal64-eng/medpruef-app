/**
 * a-pricing-v2-fit: the renewal guard in the daily 6-month upkeep
 * (decision renewal-guard). Live: claim (audit payload), a zero-amount
 * manual coverage row to the day after the sitting, a compare-and-set on
 * users.tier_expires_at, then cancel_at_period_end at Whop confirmed on a
 * fresh read; never an immediate cancel, no refund. Off and dry run write
 * nothing and the 7-day reminder still goes out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, eqVal, type FakeCall } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/mail-suppression", () => ({ sendUnlessSuppressed: m.send }));

import { guardSittingFor, guardSittings, runHalfYearRenewals } from "@/lib/pricing-v2/half-year-server";
import { dayAfterEnd } from "@/lib/pricing-v2/sitting-pass";
import { halfYearGuardMail } from "@/lib/pricing-v2/emails";

// Bought 4 Nov 2026 for the 4 May 2027 Stichprobentest: Whop renews on 3 May.
const CHARGE = "2027-05-03T11:00:00.000Z";
const NOW = new Date("2027-04-27T08:30:00Z");
const ACCESS_UNTIL = dayAfterEnd("2027-05-04").toISOString();
const ROW_END = "2027-05-04T11:00:00+00:00";

const snapshot = (cancelled: boolean, status = "active") => ({
  snapshot: { provider_state_verified: true, cancel_at_period_end: cancelled, next_charge_at: cancelled ? null : CHARGE, next_charge_amount_cents: 10000, manage_url: null, billing_cadence: "auto_renews", provider_status: status, is_trial: false, plan_id: "plan_half", billing_interval_days: 180 },
  status: 200,
});

function world(opts: { examDate?: string | null; userExpires?: string | null; casMisses?: boolean } = {}) {
  const user = { email: "h@example.com", language_code: "de", exam_date: opts.examDate ?? null, tier: "pro", role: "user", tier_expires_at: opts.userExpires === undefined ? ROW_END : opts.userExpires };
  const claimed = new Map<string, unknown>();
  const inserted: unknown[] = [];
  const calls: FakeCall[] = [];
  const { sb } = createFakeSupabase((c) => {
    calls.push(c);
    if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "tier") === "half_year") {
      return { data: [{ id: "s1", user_id: "u1", whop_membership_id: "mem_HALF", expires_at: ROW_END }] };
    }
    if (c.table === "subscriptions" && c.op === "select" && eqVal(c, "payment_method") === "renewal_guard") {
      return { data: inserted.filter((r) => (r as { provider_payment_id: string }).provider_payment_id === eqVal(c, "provider_payment_id")) };
    }
    if (c.table === "subscriptions" && c.op === "insert") { inserted.push(c.payload); return { data: null }; }
    if (c.table === "users" && c.op === "select") return { data: { ...user } };
    if (c.table === "users" && c.op === "update") {
      if (opts.casMisses || eqVal(c, "tier_expires_at") !== user.tier_expires_at) return { data: [] };
      Object.assign(user, c.payload); return { data: [{ id: "u1" }] };
    }
    if (c.table === "payment_events") {
      return { data: [{ metadata: { sitting_bank: "kmp_innsbruck", sitting_date: "2027-05-04", sitting_last_day: "2027-05-04" } }] };
    }
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      const id = (c.payload as { event_id: string }).event_id;
      if (claimed.has(id)) return { error: { code: "23505" } };
      claimed.set(id, (c.payload as { payload: unknown }).payload); return { data: { event_id: id } };
    }
    if (c.table === "processed_webhook_events" && c.op === "update") {
      claimed.set(String(eqVal(c, "event_id")), (c.payload as { payload: unknown }).payload); return { data: null };
    }
    if (c.table === "processed_webhook_events" && c.op === "delete") { claimed.delete(String(eqVal(c, "event_id"))); return { data: null }; }
    return { data: [] };
  });
  return { sb, user, claimed, inserted, calls };
}

beforeEach(() => { vi.clearAllMocks(); m.send.mockResolvedValue({ ok: true }); });
afterEach(() => vi.unstubAllEnvs());

describe("renewal guard in the 6-month upkeep", () => {
  it("off: nothing; dry run: counted, no write, and the 7-day reminder still goes out (the charge will happen)", async () => {
    const fetchImpl = vi.fn();
    const loadSnapshot = vi.fn(async () => snapshot(false));
    let w = world();
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot, fetchImpl })).toMatchObject({ autoStop: "off", guarded: 0, wouldGuard: 0 });
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_REMINDER_EMAILS_ENABLED", "true");
    const reminderNow = new Date(Date.parse(CHARGE) - 6.5 * 86_400_000);
    w = world();
    expect(await runHalfYearRenewals(w.sb, reminderNow, { loadSnapshot, fetchImpl })).toMatchObject({ autoStop: "dry_run", wouldGuard: 1, guarded: 0, reminded: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(w.inserted).toHaveLength(0);
    expect(w.calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
  });

  it("live: claim with audit images, coverage row, compare-and-set, Whop stop at period end, guard mail", async () => {
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("HALF_YEAR_REMINDER_EMAILS_ENABLED", "true");
    vi.stubEnv("WHOP_API_KEY", "key");
    let cancelled = false;
    const loadSnapshot = vi.fn(async () => snapshot(cancelled, cancelled ? "canceling" : "active"));
    const fetchImpl = vi.fn(async () => { cancelled = true; return new Response("{}", { status: 200 }); });
    const w = world();
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot, fetchImpl })).toMatchObject({ autoStop: "live", guarded: 1, stopped: 0, failed: 0 });

    // Whop: cancel at period end, never an immediate cancel.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.whop.com/api/v1/memberships/mem_HALF/cancel");
    expect(String(init.body)).toBe('{"cancellation_mode":"at_period_end"}');

    // Coverage row: zero amount, manual, from the renewal to the day after the sitting.
    expect(w.inserted).toEqual([expect.objectContaining({ user_id: "u1", tier: "half_year", status: "active", payment_provider: "manual", payment_method: "renewal_guard", amount_cents: 0, started_at: CHARGE, expires_at: ACCESS_UNTIL })]);
    // Compare-and-set on the read value, forward only.
    const cas = w.calls.find((c) => c.table === "users" && c.op === "update")!;
    expect(eqVal(cas, "tier_expires_at")).toBe(ROW_END);
    expect(w.user.tier_expires_at).toBe(ACCESS_UNTIL);
    // Audit: the claim payload carries before and after, final phase "stopped".
    expect(w.claimed.get("half_year_guard:mem_HALF:2027-05-03")).toMatchObject({
      reason: "half_year_renewal_guard", phase: "stopped", access_until: ACCESS_UNTIL,
      before: { user_tier_expires_at: ROW_END, subscription_expires_at: ROW_END },
      after: { user_tier_expires_at: ACCESS_UNTIL, cancel_at_period_end: true },
    });
    expect(w.calls.filter((c) => c.table === "user_events" && c.op === "insert").map((c) => (c.payload as { event_type: string }).event_type))
      .toEqual(["half_year_renewal_guard", "half_year_renewal_stopped"]);
    // The guard mail replaces the 7-day reminder.
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send.mock.calls[0][1]).toBe("transactional");
    expect(m.send.mock.calls[0][2].subject).toBe("MedPrüf: Ihr 6-Monats-Tarif verlängert sich nicht vor Ihrer Prüfung");

    // Second run: the claim holds, nothing repeats.
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot: vi.fn(async () => snapshot(false)), fetchImpl })).toMatchObject({ guarded: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(w.inserted).toHaveLength(1);
  });

  it("a transient Whop failure keeps the extension, releases the claim and retries the stop next run", async () => {
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("WHOP_API_KEY", "key");
    const w = world();
    const fail = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot: vi.fn(async () => snapshot(false)), fetchImpl: fail })).toMatchObject({ guarded: 0, failed: 1 });
    expect(w.claimed.has("half_year_guard:mem_HALF:2027-05-03")).toBe(false);
    expect(w.claimed.has("half_year_stop:mem_HALF")).toBe(false);
    expect(w.inserted).toHaveLength(1);
    let cancelled = false;
    const ok = vi.fn(async () => { cancelled = true; return new Response("{}", { status: 200 }); });
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot: vi.fn(async () => snapshot(cancelled, cancelled ? "canceling" : "active")), fetchImpl: ok })).toMatchObject({ guarded: 1 });
    // The coverage row is not written twice.
    expect(w.inserted).toHaveLength(1);
  });

  it("never moves an open-ended or later paywall date; a lost compare-and-set leaves the date to the coverage row", async () => {
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("WHOP_API_KEY", "key");
    for (const userExpires of [null, "2027-12-01T00:00:00+00:00"]) {
      let cancelled = false;
      const w = world({ userExpires });
      await runHalfYearRenewals(w.sb, NOW, { loadSnapshot: vi.fn(async () => snapshot(cancelled, cancelled ? "canceling" : "active")), fetchImpl: vi.fn(async () => { cancelled = true; return new Response("{}"); }) });
      expect(w.calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
      expect(w.user.tier_expires_at).toBe(userExpires);
    }
    let cancelled = false;
    const w = world({ casMisses: true });
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot: vi.fn(async () => snapshot(cancelled, cancelled ? "canceling" : "active")), fetchImpl: vi.fn(async () => { cancelled = true; return new Response("{}"); }) })).toMatchObject({ guarded: 1 });
    expect(w.user.tier_expires_at).toBe(ROW_END);
    expect(w.inserted).toHaveLength(1);
  });

  it("sittings: the checkout sitting, plus a saved date only when it is an official sitting", () => {
    const bought = { date: "2027-05-04", lastDay: "2027-05-04" };
    // A free planning date never moves or widens the guard (review P2).
    expect(guardSittings("2027-05-14", bought)).toEqual([bought]);
    expect(guardSittings(null, null)).toEqual([]);
    // An official later sitting (Stichprobentest Graz) adds its own window.
    expect(guardSittings("2027-09-22", bought)).toEqual([bought, { date: "2027-09-22", lastDay: "2027-09-22" }]);
    // A day inside an official exam week maps to the whole week.
    expect(guardSittings("2027-01-20", null)).toEqual([{ date: "2027-01-18", lastDay: "2027-01-22" }]);
    // The charge on 3 May is guarded for the bought sitting even with a later official date saved.
    expect(guardSittingFor(guardSittings("2027-09-22", bought), CHARGE, NOW)).toEqual(bought);
  });

  it("a saved planning date does not stop a renewal; a later official sitting's own window does", async () => {
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("WHOP_API_KEY", "key");
    const fetchImpl = vi.fn();
    // Bought for 4 May, charge on 3 May: guarded regardless of a saved planning date.
    const w = world({ examDate: "2027-05-14" });
    let cancelled = false;
    const ok = vi.fn(async () => { cancelled = true; return new Response("{}"); });
    expect(await runHalfYearRenewals(w.sb, NOW, { loadSnapshot: vi.fn(async () => snapshot(cancelled, cancelled ? "canceling" : "active")), fetchImpl: ok })).toMatchObject({ guarded: 1 });
    expect(w.inserted[0]).toMatchObject({ expires_at: ACCESS_UNTIL });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a guard Whop refuses falls through to the 7-day reminder (never a silent charge)", async () => {
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("HALF_YEAR_REMINDER_EMAILS_ENABLED", "true");
    vi.stubEnv("WHOP_API_KEY", "key");
    const reminderNow = new Date(Date.parse(CHARGE) - 6.5 * 86_400_000);
    const w = world();
    const refused = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(await runHalfYearRenewals(w.sb, reminderNow, { loadSnapshot: vi.fn(async () => snapshot(false)), fetchImpl: refused })).toMatchObject({ guarded: 0, failed: 1, reminded: 1 });
    expect(m.send.mock.calls[0][2].subject).toMatch(/verlängert sich am/);
    // The refused claim is kept; the next run still sends no second reminder.
    expect(await runHalfYearRenewals(w.sb, reminderNow, { loadSnapshot: vi.fn(async () => snapshot(false)), fetchImpl: refused })).toMatchObject({ reminded: 0 });
  });

  it("guard mail: Sie, no em dash, the last full day, no charge", () => {
    const de = halfYearGuardMail({ lang: "de", chargeAt: CHARGE, accessUntil: ACCESS_UNTIL });
    expect(de.htmlBody).toContain("Ihr 6-Monats-Tarif hätte sich am 3. Mai 2027 verlängert, also in den 14 Tagen vor Ihrem Prüfungstermin.");
    expect(de.htmlBody).toContain("bis einschließlich 5. Mai 2027, dem Tag nach Ihrem Termin.");
    const en = halfYearGuardMail({ lang: "en", chargeAt: CHARGE, accessUntil: ACCESS_UNTIL });
    expect(en.htmlBody).toContain("through 5 May 2027, the day after your sitting.");
    for (const mail of [de, en]) {
      expect(mail.htmlBody + mail.subject).not.toMatch(/—|–/);
      expect(mail.htmlBody).not.toMatch(/\b(du|dein|dir)\b/);
    }
  });
});
