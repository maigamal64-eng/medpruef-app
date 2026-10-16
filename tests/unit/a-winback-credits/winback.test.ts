import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import {
  decideWinback,
  readWinbackNote,
  runWinbackGrants,
  winbackMailPromise,
  winbackMentorReachable,
  WINBACK_COOLDOWN_DAYS,
  WINBACK_GRACE_HOURS,
  WINBACK_LOOKBACK_DAYS,
  clawbackRefundedWinbacks,
  previewWinbackGrants,
  type WinbackDecisionInput,
  type WinbackRow,
} from "@/lib/mentor/credits/winback";
import { isWinbackLot, readFreeCreditConfig, winbackSourceId } from "@/lib/mentor/credits/free-credits";
import { houseCapApplies, houseCapConsidered } from "@/lib/mentor/credits/house-cap";
import { grantKind } from "@/lib/mentor/credits/free-grants-admin";
import { SURFACES } from "@/lib/announcements/queue";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const NOW = new Date("2026-12-17T08:00:00Z");
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const iso = (ms: number) => new Date(ms).toISOString();

const freeOwner = { role: "user", tier: "free", tier_expires_at: null, email: "user-ddefe0c4@example.com", is_banned: false };

function row(over: Partial<WinbackRow> = {}): WinbackRow {
  return {
    id: "sub_1",
    status: "expired",
    payment_provider: "whop",
    amount_cents: 4900,
    granted_payment_ids: [{ payment_id: "pay_1", amount_cents: 4900 }],
    provider_payment_id: "pay_1",
    started_at: iso(NOW_MS - 90 * DAY),
    expires_at: iso(NOW_MS - 3 * DAY),
    cancelled_at: null,
    ...over,
  };
}

function input(over: Partial<WinbackDecisionInput> = {}): WinbackDecisionInput {
  return { owner: freeOwner, rows: [row()], lastWinbackAtMs: null, refundEvent: false, nowMs: NOW_MS, ...over };
}

describe("J11 eligibility matrix", () => {
  it("one-time end: grant, keyed on the ended row", () => {
    expect(decideWinback(input())).toEqual({ decision: "grant", subscriptionId: "sub_1", kind: "access_end", endedAtMs: NOW_MS - 3 * DAY });
  });
  it("recurring cancel: grant at the cancel time", () => {
    const cancel = row({ status: "cancelled", amount_cents: 1900, cancelled_at: iso(NOW_MS - 4 * DAY), expires_at: iso(NOW_MS + 20 * DAY) });
    expect(decideWinback(input({ rows: [cancel] }))).toMatchObject({ decision: "grant", kind: "cancelled", endedAtMs: NOW_MS - 4 * DAY });
  });
  it("failed renewal: a Whop deactivation after dunning (cancelled) or a renewal that never came (expired) both grant", () => {
    const deactivated = row({ id: "sub_m", status: "cancelled", amount_cents: 1900, cancelled_at: iso(NOW_MS - 3 * DAY), expires_at: iso(NOW_MS - 3 * DAY) });
    expect(decideWinback(input({ rows: [deactivated] })).decision).toBe("grant");
    const lapsed = row({ id: "sub_m", status: "active", amount_cents: 1900, expires_at: iso(NOW_MS - 60 * 3600_000) });
    expect(decideWinback(input({ rows: [lapsed] }))).toMatchObject({ decision: "grant", kind: "access_end" });
  });
  it("refund: never", () => {
    expect(decideWinback(input({ rows: [row(), row({ id: "sub_r", status: "refunded" })] })).decision).toBe("skip_refund");
    // A refunded payment on a row that otherwise expired (partial revoke): the revoke event blocks it.
    expect(decideWinback(input({ refundEvent: true })).decision).toBe("skip_refund");
  });
  it("chargeback: never (disputes land as refunded, legacy statuses too)", () => {
    for (const status of ["refunded", "chargeback", "disputed"]) {
      expect(decideWinback(input({ rows: [row(), row({ id: "sub_d", status, expires_at: iso(NOW_MS - 2 * DAY) })] })).decision).toBe("skip_refund");
    }
  });
  it("second lapse within 90 days: no; after 90 days: yes", () => {
    expect(decideWinback(input({ lastWinbackAtMs: NOW_MS - 40 * DAY })).decision).toBe("skip_cooldown");
    expect(decideWinback(input({ lastWinbackAtMs: NOW_MS - (WINBACK_COOLDOWN_DAYS - 1) * DAY })).decision).toBe("skip_cooldown");
    expect(decideWinback(input({ lastWinbackAtMs: NOW_MS - (WINBACK_COOLDOWN_DAYS + 1) * DAY })).decision).toBe("grant");
  });
  it("grace: an end less than 48 hours ago waits (a late refund or a dunning retry lands first)", () => {
    expect(decideWinback(input({ rows: [row({ expires_at: iso(NOW_MS - (WINBACK_GRACE_HOURS - 1) * 3600_000) })] })).decision).toBe("skip_no_paid_end");
    expect(decideWinback(input({ rows: [row({ expires_at: iso(NOW_MS - (WINBACK_GRACE_HOURS + 1) * 3600_000) })] })).decision).toBe("grant");
  });
  it("backfill guard: an end older than the lookback window gets nothing", () => {
    expect(decideWinback(input({ rows: [row({ expires_at: iso(NOW_MS - (WINBACK_LOOKBACK_DAYS + 1) * DAY) })] })).decision).toBe("skip_no_paid_end");
    expect(decideWinback(input({ rows: [row({ expires_at: iso(NOW_MS - (WINBACK_LOOKBACK_DAYS - 1) * DAY) })] })).decision).toBe("grant");
    // A cancel today of a row that ended long ago is an old end.
    expect(decideWinback(input({ rows: [row({ status: "cancelled", cancelled_at: iso(NOW_MS - 3 * DAY), expires_at: iso(NOW_MS - 60 * DAY) })] })).decision).toBe("skip_no_paid_end");
  });
  it("access still live: a later paid row, an active trial or a manual extension", () => {
    expect(decideWinback(input({ rows: [row(), row({ id: "sub_2", status: "active", expires_at: iso(NOW_MS + 30 * DAY) })] })).decision).toBe("skip_still_covered");
    expect(decideWinback(input({ rows: [row(), row({ id: "sub_t", status: "active", amount_cents: 0, granted_payment_ids: [], expires_at: null })] })).decision).toBe("skip_still_covered");
    expect(decideWinback(input({ owner: { ...freeOwner, tier: "pro", tier_expires_at: iso(NOW_MS + 5 * DAY) } })).decision).toBe("skip_still_covered");
    expect(decideWinback(input({ owner: { ...freeOwner, tier: "pro", tier_expires_at: null } })).decision).toBe("skip_still_covered");
  });
  it("only paid access on a real rail counts: a EUR 0 trial or a manual grant ends with nothing", () => {
    expect(decideWinback(input({ rows: [row({ amount_cents: 0, granted_payment_ids: [{ payment_id: "pay_t", amount_cents: 0 }] })] })).decision).toBe("skip_no_paid_end");
    expect(decideWinback(input({ rows: [row({ payment_provider: "manual" })] })).decision).toBe("skip_no_paid_end");
    // A NOWPayments checkout that was never paid, closed as cancelled: invoice price only, no end date.
    const unpaid = row({ payment_provider: "nowpayments", amount_cents: 11400, granted_payment_ids: [], provider_payment_id: null, started_at: null, status: "cancelled", cancelled_at: iso(NOW_MS - 3 * DAY), expires_at: null });
    expect(decideWinback(input({ rows: [unpaid] })).decision).toBe("skip_no_paid_end");
    expect(decideWinback(input({ rows: [row({ granted_payment_ids: [], provider_payment_id: null })] })).decision).toBe("skip_no_paid_end");
    // A legacy paid row without history: amount, payment id and start date together.
    expect(decideWinback(input({ rows: [row({ granted_payment_ids: null })] })).decision).toBe("grant");
    expect(decideWinback(input({ rows: [row({ payment_provider: "nowpayments", amount_cents: 11400 })] })).decision).toBe("grant");
  });
  it("banned, staff, test and missing accounts get nothing", () => {
    expect(decideWinback(input({ owner: null })).decision).toBe("skip_no_user");
    expect(decideWinback(input({ owner: { ...freeOwner, is_banned: true } })).decision).toBe("skip_banned");
    expect(decideWinback(input({ owner: { ...freeOwner, email: "user-b7e46e80@example.com" } })).decision).toBe("skip_staff_or_test");
    expect(decideWinback(input({ owner: { ...freeOwner, role: "admin" } })).decision).toBe("skip_staff_or_test");
  });
  it("two ended rows: the key is the latest end (deterministic across runs)", () => {
    const a = row({ id: "sub_a", expires_at: iso(NOW_MS - 6 * DAY) });
    const b = row({ id: "sub_b", expires_at: iso(NOW_MS - 3 * DAY) });
    expect(decideWinback(input({ rows: [b, a] })).subscriptionId).toBe("sub_b");
    expect(decideWinback(input({ rows: [a, b] })).subscriptionId).toBe("sub_b");
  });
});

describe("config and keys", () => {
  it("default off; only the literal true switches it on; amounts 100 / 30", () => {
    expect(readFreeCreditConfig({})).toMatchObject({ winbackEnabled: false, winbackCredits: 100, winbackExpiryDays: 30 });
    expect(readFreeCreditConfig({ REWARDS_WINBACK_ENABLED: "1" }).winbackEnabled).toBe(false);
    expect(readFreeCreditConfig({ REWARDS_WINBACK_ENABLED: "true", REWARDS_WINBACK_CREDITS: "0" })).toMatchObject({ winbackEnabled: true, winbackCredits: 100 });
  });
  it("lot key and classification", () => {
    expect(winbackSourceId("sub_1")).toBe("reward:winback:sub_1");
    expect(isWinbackLot("admin_gift", "reward:winback:sub_1")).toBe(true);
    expect(isWinbackLot("admin_gift", "sub_1:0")).toBe(false);
    expect(isWinbackLot("experience_reward", "reward:winback:sub_1")).toBe(false);
    expect(grantKind("admin_gift", "reward:winback:sub_1")).toBe("winback");
    expect(grantKind("admin_gift", "sub_1:0")).toBeNull();
  });
  it("mentor must be open to a lapsed (free) learner", () => {
    expect(winbackMentorReachable({ aiFeaturesEnabled: true, enabled: true, accessScope: "paid" })).toBe(true);
    expect(winbackMentorReachable({ aiFeaturesEnabled: true, enabled: true, accessScope: "signed_in" })).toBe(true);
    expect(winbackMentorReachable({ aiFeaturesEnabled: true, enabled: true, accessScope: "beta" })).toBe(false);
    expect(winbackMentorReachable({ aiFeaturesEnabled: true, enabled: false, accessScope: "paid" })).toBe(false);
  });
  it("house cap reads switch on with the flag and cover a live admin_gift lot", () => {
    const base = { houseGrantsScope: "allowlist" as const, welcomeEnabled: false, campaignEnabled: false, experienceEnabled: false };
    expect(houseCapConsidered(base)).toBe(false);
    expect(houseCapConsidered({ ...base, winbackEnabled: true })).toBe(true);
    const lot = { source: "admin_gift", remainingMicro: 500_000, startsAt: iso(NOW_MS - DAY), expiresAt: iso(NOW_MS + 29 * DAY) };
    expect(houseCapApplies("scope", base, [lot], NOW_MS)).toBe(false);
    expect(houseCapApplies("scope", { ...base, winbackEnabled: true }, [lot], NOW_MS)).toBe(true);
    expect(houseCapApplies("allowlist", { ...base, winbackEnabled: true }, [lot], NOW_MS)).toBe(false);
  });
  it("the Home note is an inline queue surface behind renewal", () => {
    expect(SURFACES.winback_note).toMatchObject({ kind: "inline", priority: 2 });
  });
});

// ── In-memory store with the filters the run uses and the grant RPC ─────
type Row = Record<string, unknown>;
function cmp(a: unknown, b: unknown): number {
  const da = Date.parse(String(a));
  const db = Date.parse(String(b));
  if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
function match(r: Row, call: FakeCall): boolean {
  return call.filters.every((f) => {
    const v = r[f.column];
    switch (f.kind) {
      case "eq": return v === f.value;
      case "in": return (f.value as unknown[]).includes(v);
      case "gt": return v != null && cmp(v, f.value) > 0;
      case "gte": return v != null && cmp(v, f.value) >= 0;
      case "lte": return v != null && cmp(v, f.value) <= 0;
      case "like": return typeof v === "string" && v.startsWith(String(f.value).replace(/%$/, ""));
      default: throw new Error(`unsupported ${f.kind}`);
    }
  });
}
function store(t: Record<string, Row[]>, failTables: string[] = []) {
  let lotSeq = 0;
  return createFakeSupabase((call) => {
    if (call.table === "rpc:mentor_grant_credits") {
      const p = call.payload as Record<string, unknown>;
      const lots = (t.ai_credit_lot ??= []);
      const dupe = lots.find((l) => l.source === p.p_source && l.source_id === p.p_source_id);
      if (dupe) return { data: { ok: true, duplicate: true, lot_id: dupe.id, granted_micro: dupe.granted_micro, expires_at: dupe.expires_at } };
      const lot = { id: `lot_${++lotSeq}`, user_id: p.p_user, package_id: p.p_package, source: p.p_source, source_id: p.p_source_id, granted_micro: p.p_micro, expires_at: p.p_expires_at, created_at: p.p_starts_at, status: "live" };
      lots.push(lot);
      return { data: { ok: true, duplicate: false, lot_id: lot.id, granted_micro: p.p_micro, expires_at: p.p_expires_at } };
    }
    if (call.table === "rpc:mentor_clawback") {
      const p = call.payload as Record<string, unknown>;
      const lot = (t.ai_credit_lot ??= []).find((l) => l.source === p.p_source && l.source_id === p.p_source_id);
      if (!lot) return { data: { ok: false, reason: "not_found" } };
      if (lot.status === "clawed_back") return { data: { ok: true, duplicate: true, lot_id: lot.id, user_id: lot.user_id, clawed_micro: 0 } };
      lot.status = "clawed_back";
      return { data: { ok: true, duplicate: false, lot_id: lot.id, user_id: lot.user_id, clawed_micro: lot.granted_micro, debt_added_micro: 0 } };
    }
    if (failTables.includes(call.table)) return { error: { code: "57014" } };
    const rows = (t[call.table] ??= []);
    if (call.op === "select") {
      let found = rows.filter((r) => match(r, call));
      if (call.limit !== undefined) found = found.slice(0, call.limit);
      return { data: found.map((r) => ({ ...r })) };
    }
    if (call.op === "insert") { rows.push(...((Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[])); return { data: null }; }
    return {};
  });
}

const FC_ON = { winbackEnabled: true, winbackCredits: 100, winbackExpiryDays: 30 };
const MENTOR_OPEN = { aiFeaturesEnabled: true, enabled: true, accessScope: "paid" as const };

function tables(): Record<string, Row[]> {
  return {
    users: [{ id: USER, ...freeOwner }],
    subscriptions: [{ user_id: USER, ...row() }],
    ai_credit_lot: [],
    user_events: [],
  };
}

describe("runWinbackGrants", () => {
  it("flag off: no read, no write; mentor closed: no grant", async () => {
    const { sb, calls } = store(tables());
    const events: string[] = [];
    const off = await runWinbackGrants(sb as never, { now: NOW, fc: { ...FC_ON, winbackEnabled: false }, mentor: MENTOR_OPEN, recordEvent: async (_u, e) => { events.push(e); } });
    expect(off).toMatchObject({ enabled: false, granted: 0 });
    expect(calls).toHaveLength(0);
    // Mentor closed: only the clawback pass reads live win-back lots (none here); no grant, no write.
    const beta = await runWinbackGrants(sb as never, { now: NOW, fc: FC_ON, mentor: { ...MENTOR_OPEN, accessScope: "beta" }, recordEvent: async (_u, e) => { events.push(e); } });
    expect(beta).toMatchObject({ enabled: true, mentor_reachable: false, granted: 0, candidates: 0 });
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(["ai_credit_lot:select"]);
    expect(events).toHaveLength(0);
  });
  it("grants 100 credits for 30 days once per ended row; a rerun is a duplicate-free no-op", async () => {
    const t = tables();
    const { sb, calls } = store(t);
    const events: Array<[string, Record<string, unknown>]> = [];
    const rec = async (_u: string, e: string, d: Record<string, unknown>) => { events.push([e, d]); };
    const first = await runWinbackGrants(sb as never, { now: NOW, fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: rec });
    expect(first).toMatchObject({ candidates: 1, granted: 1, duplicates: 0, errors: [] });
    const grant = calls.find((c) => c.table === "rpc:mentor_grant_credits");
    expect(grant?.payload).toMatchObject({ p_user: USER, p_package: "gift_admin", p_source: "admin_gift", p_source_id: "reward:winback:sub_1", p_micro: 500_000, p_starts_at: NOW.toISOString(), p_expires_at: iso(NOW_MS + 30 * DAY) });
    expect(events).toEqual([["winback_credits_granted", expect.objectContaining({ subscription_id: "sub_1", lot_id: "lot_1", kind: "access_end", credits: 100 })]]);
    // Next day: the breaker sees the lot, no second RPC.
    const next = await runWinbackGrants(sb as never, { now: new Date(NOW_MS + DAY), fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: rec });
    expect(next).toMatchObject({ granted: 0, skipped: { skip_cooldown: 1 } });
    expect(calls.filter((c) => c.table === "rpc:mentor_grant_credits")).toHaveLength(1);
  });
  it("a refund revoke event in the last 90 days blocks the grant", async () => {
    const t = tables();
    t.user_events.push({ user_id: USER, event_type: "whop_subscription_revoked", event_data: { kind: "refunded" }, created_at: iso(NOW_MS - 10 * DAY) });
    const { sb } = store(t);
    const r = await runWinbackGrants(sb as never, { now: NOW, fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: async () => {} });
    expect(r).toMatchObject({ granted: 0, skipped: { skip_refund: 1 } });
  });
  it("a read failure grants nothing and reports it", async () => {
    const { sb, calls } = store(tables(), ["ai_credit_lot"]);
    const r = await runWinbackGrants(sb as never, { now: NOW, fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: async () => {} });
    expect(r.granted).toBe(0);
    expect(r.errors.join(" ")).toMatch(/winback read failed: (live_)?lots/);
    expect(calls.some((c) => c.table === "rpc:mentor_grant_credits")).toBe(false);
  });
});

describe("refund after the grant", () => {
  it("the next daily run claws the lot back, once", async () => {
    const t = tables();
    const { sb, calls } = store(t);
    const events: string[] = [];
    const rec = async (_u: string, e: string) => { events.push(e); };
    expect((await runWinbackGrants(sb as never, { now: NOW, fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: rec })).granted).toBe(1);
    t.subscriptions[0].status = "refunded";
    const next = await runWinbackGrants(sb as never, { now: new Date(NOW_MS + DAY), fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: rec });
    expect(next.clawed_back).toBe(1);
    expect(t.ai_credit_lot[0].status).toBe("clawed_back");
    expect(calls.find((c) => c.table === "rpc:mentor_clawback")?.payload).toMatchObject({ p_source: "admin_gift", p_source_id: "reward:winback:sub_1" });
    // Even with the mentor closed, and never twice.
    const again = await clawbackRefundedWinbacks(sb as never, new Date(NOW_MS + 2 * DAY), rec);
    expect(again).toEqual({ clawed: 0, errors: [] });
    expect(events).toEqual(["winback_credits_granted", "winback_credits_clawed_back"]);
  });
  it("an unmatched refund event also counts as evidence", async () => {
    const t = tables();
    t.user_events.push({ user_id: USER, event_type: "whop_revoke_unmatched", event_data: { kind: "refunded" }, created_at: iso(NOW_MS - 5 * DAY) });
    const r = await runWinbackGrants(store(t).sb as never, { now: NOW, fc: FC_ON, mentor: MENTOR_OPEN, recordEvent: async () => {} });
    expect(r).toMatchObject({ granted: 0, skipped: { skip_refund: 1 } });
  });
  it("preview reads only and reports uid8 decisions", async () => {
    const { sb, calls } = store(tables());
    const p = await previewWinbackGrants(sb as never, NOW, MENTOR_OPEN);
    expect(p).toMatchObject({ mentor_reachable: true, counts: { grant: 1 }, rows: [{ user: USER.slice(0, 8), decision: "grant", kind: "access_end" }] });
    expect(calls.every((c) => c.op === "select" && !c.table.startsWith("rpc:"))).toBe(true);
  });
});

describe("mail promise", () => {
  const endMs = NOW_MS + 5 * DAY;
  const active = (over: Partial<WinbackRow> = {}) => ({ user_id: USER, ...row({ status: "active", expires_at: iso(endMs), ...over }) });
  const users = (over: Record<string, unknown> = {}) => [{ id: USER, ...freeOwner, tier: "pro", tier_expires_at: iso(endMs), ...over }];
  it("only when the grant would follow at that end", async () => {
    const ok = store({ users: users(), subscriptions: [active()], ai_credit_lot: [] });
    expect(await winbackMailPromise(ok.sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(true);
    const off = store({ users: users(), subscriptions: [active()], ai_credit_lot: [] });
    expect(await winbackMailPromise(off.sb as never, USER, endMs, { fc: { winbackEnabled: false }, mentor: MENTOR_OPEN })).toBe(false);
    expect(off.calls).toHaveLength(0);
    expect(await winbackMailPromise(ok.sb as never, USER, endMs, { fc: FC_ON, mentor: { ...MENTOR_OPEN, accessScope: "beta" } })).toBe(false);
    // End moved by hand (row ends earlier than the stated date), unpaid row, refund, recent win-back, read error: no line.
    expect(await winbackMailPromise(store({ users: users(), subscriptions: [active({ expires_at: iso(endMs - 3 * DAY) })] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    expect(await winbackMailPromise(store({ users: users(), subscriptions: [active({ amount_cents: 0, granted_payment_ids: [] })] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    expect(await winbackMailPromise(store({ users: users(), subscriptions: [active(), { user_id: USER, ...row({ id: "r", status: "refunded" }) }] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    expect(await winbackMailPromise(store({ users: users(), subscriptions: [active()], ai_credit_lot: [{ user_id: USER, source: "admin_gift", source_id: "reward:winback:old", created_at: iso(NOW_MS - 30 * DAY) }] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    expect(await winbackMailPromise(store({ users: users(), subscriptions: [active()] }, ["subscriptions"]).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    // The same account and refund rules as the grant: banned, staff, a refund event.
    expect(await winbackMailPromise(store({ users: users({ is_banned: true }), subscriptions: [active()] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    expect(await winbackMailPromise(store({ users: users({ email: "user-847887c3@example.com" }), subscriptions: [active()] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN })).toBe(false);
    expect(await winbackMailPromise(store({ users: users(), subscriptions: [active()], user_events: [{ user_id: USER, event_type: "whop_subscription_revoked", event_data: { kind: "refunded" }, created_at: iso(NOW_MS - DAY) }] }).sb as never, USER, endMs, { fc: FC_ON, mentor: MENTOR_OPEN, now: NOW })).toBe(false);
  });
});

describe("learner note", () => {
  it("returns the own live win-back lot, never another admin gift", async () => {
    const t = { ai_credit_lot: [
      { id: "lot_x", user_id: USER, source: "admin_gift", source_id: "sub_9:0", granted_micro: 300_000, expires_at: iso(NOW_MS + 9 * DAY), created_at: iso(NOW_MS - DAY), status: "live" },
      { id: "lot_w", user_id: USER, source: "admin_gift", source_id: "reward:winback:sub_1", granted_micro: 500_000, spent_micro: 52_000, clawed_back_micro: 0, expires_at: iso(NOW_MS + 29 * DAY), created_at: iso(NOW_MS - DAY), status: "live" },
    ] };
    const { sb, calls } = store(t);
    // What is left (debt paydown or use), in whole credits.
    expect(await readWinbackNote(sb as never, USER, NOW)).toEqual({ lot_id: "lot_w", credits: 89, expires_at: iso(NOW_MS + 29 * DAY) });
    expect(calls[0].filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "user_id", value: USER }, { kind: "like", column: "source_id", value: "reward:winback:%" }]));
    expect(await readWinbackNote(store({ ai_credit_lot: [] }).sb as never, USER, NOW)).toBeNull();
    const spent = { ai_credit_lot: [{ ...t.ai_credit_lot[1], spent_micro: 500_000 }] };
    expect(await readWinbackNote(store(spent).sb as never, USER, NOW)).toBeNull();
    await expect(readWinbackNote(store({}, ["ai_credit_lot"]).sb as never, USER, NOW)).rejects.toThrow(/winback note read failed/);
  });
});
