import { describe, expect, it, vi } from "vitest";
import { runTrialEndNotices } from "@/lib/trial-end-notice/run";
import { inHoldout } from "@/lib/trial-end-notice/rules";
import { suppressionKey } from "@/lib/mail-suppression";

const now = new Date("2026-11-01T10:00:00Z");
const ids = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const live = ids.filter((i) => !inHoldout(i));
const hold = ids.filter((i) => inHoldout(i));

type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeSb(t: Tables, opts: { failTable?: string; claims?: Set<string> } = {}) {
  const claims = opts.claims ?? new Set<string>();
  const inserted: unknown[] = [];
  const deleted: string[] = [];
  const from = (table: string) => {
    const state: { filters: Array<(r: Record<string, unknown>) => boolean> } = { filters: [] };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { state.filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { state.filters.push((r) => v.includes(r[c])); return q; },
      gt: (c: string, v: string) => { state.filters.push((r) => String(r[c]) > v); return q; },
      lte: (c: string, v: string) => { state.filters.push((r) => String(r[c]) <= v); return q; },
      gte: (c: string, v: string) => { state.filters.push((r) => String(r[c]) >= v); return q; },
      is: (c: string, v: unknown) => { state.filters.push((r) => (r[c] ?? null) === v); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: (t[table] ?? []).find((r) => state.filters.every((f) => f(r))) ?? null, error: null }),
      insert: (row: Record<string, unknown>) => {
        const c2: any = {
          select: () => c2,
          maybeSingle: async () => {
            if (table !== "processed_webhook_events") return { data: null, error: { code: "x" } };
            if (claims.has(String(row.event_id))) return { data: null, error: { code: "23505" } };
            claims.add(String(row.event_id)); inserted.push(row);
            return { data: { event_id: row.event_id }, error: null };
          },
        };
        return c2;
      },
      delete: () => ({ eq: () => ({ eq: async (_c: string, v: string) => { claims.delete(v); deleted.push(v); return { error: null }; } }) }),
      then: (res: (v: unknown) => unknown) => {
        if (opts.failTable === table) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res);
        let rows = (t[table] ?? []).filter((r) => state.filters.every((f) => f(r)));
        if (table === "processed_webhook_events") rows = [...claims].map((e) => ({ event_id: e }));
        return Promise.resolve({ data: rows, error: null }).then(res);
      },
    };
    return q;
  };
  return { sb: { from } as any, claims, inserted, deleted };
}

const trialFor = (id: string, endsAt = "2026-11-02T04:00:00Z") => ({ user_id: id, kind: "reverse", started_at: "2026-10-30T04:00:00Z", expires_at: endsAt });
const userFor = (id: string, over: Record<string, unknown> = {}) => ({
  id, email: `${id.slice(-4)}@gmail.com`, email_verified_at: "2026-10-30T00:00:00Z", first_name: "A", language_code: "de",
  role: "user", tier: "pro", tier_expires_at: "2026-11-02T04:00:00Z", is_banned: false, exam_date: null, active_exam: "kenntnispruefung",
  telegram_id: null, telegram_chat_confirmed: false, telegram_chat_id_confirmed: null, ...over,
});

describe("runTrialEndNotices", () => {
  it("dry run counts and writes nothing", async () => {
    const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])] });
    const events: string[] = []; const send = vi.fn();
    const r = await runTrialEndNotices(f.sb, { now, dryRun: true, recordEvent: async (_u, e) => { events.push(e); }, send });
    expect(r.wouldSend.email).toBe(1); expect(send).not.toHaveBeenCalled(); expect(events).toEqual([]); expect(f.claims.size).toBe(0);
  });
  it("live: claims, sends once, records the event; a second run is a no-op", async () => {
    const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])] });
    const events: string[] = []; const send = vi.fn(async () => ({ ok: true } as any));
    const run = () => runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async (_u, e) => { events.push(e); }, send });
    const a = await run();
    expect(a.sent.email).toBe(1); expect(events).toEqual(["trial_end_notice_sent"]);
    const b = await run();
    expect(b.sent.email).toBe(0); expect(send).toHaveBeenCalledTimes(1); expect(b.skipped.already_decided).toBe(1);
  });
  it("holdout is claimed and recorded as held, never sent", async () => {
    const f = fakeSb({ trials: [trialFor(hold[0])], users: [userFor(hold[0])] });
    const events: Array<[string, unknown]> = []; const send = vi.fn();
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async (_u, e, d) => { events.push([e, d]); }, send });
    expect(send).not.toHaveBeenCalled(); expect(r.held.holdout).toBe(1);
    expect(events[0][0]).toBe("trial_end_notice_held"); expect((events[0][1] as any).reason).toBe("holdout"); expect(f.claims.size).toBe(1);
  });
  it("mail cap holds; payer and checkout opener are skipped", async () => {
    const [a, b, c] = live;
    const f = fakeSb({
      trials: [trialFor(a), trialFor(b), trialFor(c)], users: [userFor(a), userFor(b), userFor(c)],
      user_events: [{ user_id: a, event_type: "trial_reminder_email_sent", created_at: "2026-10-31T10:00:00Z" }],
      subscriptions: [{ user_id: b, tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: "2026-12-01T00:00:00Z" }],
      payment_events: [{ event: "checkout_session_created", user_id: c, created_at: "2026-10-31T10:00:00Z" }],
    });
    const send = vi.fn();
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async () => {}, send });
    expect(send).not.toHaveBeenCalled();
    expect(r.held.mail_cap).toBe(1); expect(r.skipped.has_access).toBe(1); expect(r.skipped.checkout_opened).toBe(1);
  });
  it("a-release-int-7: a day-1 sitting ask in the last 72 h holds the notice (shared learner-mail cap)", async () => {
    const [a] = live;
    const f = fakeSb({
      trials: [trialFor(a)], users: [userFor(a)],
      user_events: [{ user_id: a, event_type: "day1_ask_sent", created_at: "2026-10-31T09:00:00Z" }],
    });
    const send = vi.fn();
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async () => {}, send });
    expect(send).not.toHaveBeenCalled();
    expect(r.held.mail_cap).toBe(1);
  });
  it("a checkout opened before the trial began does not block", async () => {
    const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])], payment_events: [{ event: "checkout_session_created", user_id: live[0], created_at: "2026-10-01T10:00:00Z" }] });
    const r = await runTrialEndNotices(f.sb, { now, dryRun: true, recordEvent: async () => {} });
    expect(r.wouldSend.email).toBe(1);
  });
  it("do-not-contact address: held, claim kept, nothing sent", async () => {
    const u = userFor(live[0]);
    const f = fakeSb({ trials: [trialFor(live[0])], users: [u], mail_suppression: [{ email_key: suppressionKey(u.email as string), cause: "opt_out", scope: "marketing", lifted_at: null, id: "1", source: "t", created_at: "x" }] });
    const events: string[] = []; const send = vi.fn();
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async (_u, e) => { events.push(e); }, send });
    expect(send).not.toHaveBeenCalled(); expect(r.held.do_not_contact).toBe(1); expect(events).toEqual(["trial_end_notice_held"]); expect(f.claims.size).toBe(1);
  });
  it("send_failed without a status keeps the claim", async () => {
    const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])] });
    const events: string[] = [];
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async (_u, e) => { events.push(e); }, send: async () => ({ ok: false, reason: "send_failed" } as any) });
    // send_failed without status keeps the claim (may have been delivered)
    expect(r.errors[0]).toMatch(/send_failed/); expect(f.claims.size).toBe(1);
    expect(events).toEqual([]);
  });
  it("certainly undelivered releases the claim", async () => {
    const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])] });
    await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async () => {}, send: async () => ({ ok: false, reason: "not_configured" } as any) });
    expect(f.claims.size).toBe(0);
  });
  it("telegram: own flag, bot message, blocked is held", async () => {
    const id = live[0];
    const tgUser = userFor(id, { email: null, email_verified_at: null, telegram_id: 12345, telegram_chat_id_confirmed: "12345" });
    const sendBot = vi.fn(async () => ({ ok: true } as any));
    const off = await runTrialEndNotices(fakeSb({ trials: [trialFor(id)], users: [tgUser] }).sb, { now, dryRun: false, telegramEnabled: false, recordEvent: async () => {}, sendBot });
    expect(sendBot).not.toHaveBeenCalled(); expect(off.held.no_channel).toBe(1);
    const f = fakeSb({ trials: [trialFor(id)], users: [tgUser] });
    const on = await runTrialEndNotices(f.sb, { now, dryRun: false, telegramEnabled: true, recordEvent: async () => {}, sendBot });
    expect(on.sent.telegram).toBe(1); expect(sendBot).toHaveBeenCalledWith(12345, expect.stringContaining("MedPrüf"), expect.any(Array));
    const f2 = fakeSb({ trials: [trialFor(id)], users: [tgUser] });
    const blocked = await runTrialEndNotices(f2.sb, { now, dryRun: false, telegramEnabled: true, recordEvent: async () => {}, sendBot: async () => ({ ok: false, reason: "blocked" }) });
    expect(blocked.held.telegram_blocked).toBe(1);
  });
  it("clearable holds (cap) record an event but keep the account undecided", async () => {
    const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])], study_nudge_prefs: [{ user_id: live[0], last_sent: "2026-10-31T10:00:00Z" }] });
    const ev: Array<[string, any]> = [];
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async (_u, e, d) => { ev.push([e, d]); }, send: vi.fn() });
    expect(r.held.mail_cap).toBe(1); expect(f.claims.size).toBe(0); expect(ev[0][1]).toMatchObject({ reason: "mail_cap", claimed: false });
  });
  it("telegram path honours the do-not-contact list of the account email", async () => {
    const u = userFor(live[0], { email: "user-bd1e93d1@example.com", email_verified_at: null, telegram_id: 12345, telegram_chat_id_confirmed: "12345" });
    const f = fakeSb({ trials: [trialFor(live[0])], users: [u], mail_suppression: [{ email_key: suppressionKey("user-bd1e93d1@example.com"), cause: "opt_out", scope: "marketing", lifted_at: null, id: "1", source: "t", created_at: "x" }] });
    const sendBot = vi.fn();
    const r = await runTrialEndNotices(f.sb, { now, dryRun: false, telegramEnabled: true, recordEvent: async () => {}, sendBot });
    expect(sendBot).not.toHaveBeenCalled(); expect(r.held.do_not_contact).toBe(1); expect(f.claims.size).toBe(1);
  });
  it("reports when the trial read hits its limit", async () => {
    const many = Array.from({ length: 500 }, (_, i) => trialFor(`10000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    const r = await runTrialEndNotices(fakeSb({ trials: many, users: [] }).sb, { now, dryRun: true, recordEvent: async () => {} });
    expect(r.errors).toContain("trials_limit_reached");
  });
  it("fails closed on an unreadable table", async () => {
    for (const failTable of ["trials", "users", "subscriptions", "payment_events", "user_events", "study_nudge_prefs"]) {
      const f = fakeSb({ trials: [trialFor(live[0])], users: [userFor(live[0])] }, { failTable });
      const send = vi.fn();
      const r = await runTrialEndNotices(f.sb, { now, dryRun: false, recordEvent: async () => {}, send });
      expect(send).not.toHaveBeenCalled(); expect(r.errors.length).toBeGreaterThan(0);
    }
  });
});
