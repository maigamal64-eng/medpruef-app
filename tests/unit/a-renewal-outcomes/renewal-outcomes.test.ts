import { describe, expect, it } from "vitest";
import {
  buildReport,
  parseArgs,
  parseDump,
  projectClaimPayload,
  projectUserEvent,
  type ClaimRow,
  type Inputs,
  type SubRow,
} from "../../../scripts/kassa/renewal-outcomes-lib";

const NOW = new Date("2026-10-15T10:00:00Z");
const MONTHLY = "plan_redacted8f2b848b";
const ONE_TIME = "plan_redacted324decbc";
const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

let seq = 0;
function uid(n: number): string {
  return `${String(n).padStart(8, "a")}-1111-4111-8111-111111111111`;
}
function sub(p: Partial<SubRow> & { user_id: string }): SubRow {
  seq += 1;
  return {
    id: `${String(seq).padStart(8, "0")}-2222-4222-8222-222222222222`,
    tier: "first_month_19",
    status: "active",
    payment_provider: "whop",
    payment_method: "card",
    amount_cents: 1900,
    provider_payment_id: `pay_row${seq}`,
    granted_payment_ids: [{ payment_id: `pay_row${seq}`, amount_cents: 1900, added_months: 1, granted_at: iso(-20 * D) }],
    whop_membership_id: `mem_row${seq}`,
    started_at: iso(-20 * D),
    expires_at: iso(10 * D),
    created_at: iso(-20 * D),
    cancelled_at: null,
    ...p,
  };
}
const planEvent = (row: SubRow, plan: string) => ({
  event: "grant_succeeded", user_id: row.user_id, payment_id: row.provider_payment_id, plan_id: plan,
  amount_cents: row.amount_cents, whop_event: null, created_at: row.created_at,
});
const empty = (): Inputs => ({ subscriptions: [], payment_events: [], claims: [], attempts: [], users: [], last_answers: [], user_events: [] });
const claim = (provider: string, event_id: string, payload: ClaimRow["payload"], at = iso(-1 * D)): ClaimRow => ({ provider, event_id, processed_at: at, payload });

function run(inp: Inputs) {
  const r = buildReport(inp, NOW, 7, 30);
  const byRow = (row: SubRow) => r.ended_rows.find((e) => e.row8 === row.id.slice(0, 8));
  return { r, byRow };
}

describe("ended row classes", () => {
  it("trial_end and admin_comp", () => {
    const inp = empty();
    const trial = sub({ user_id: uid(1), tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: [{ payment_id: "pay_t", amount_cents: 0, added_months: 0, granted_at: iso(-8 * D), trial_ends_at: iso(-1 * D) }], status: "cancelled", cancelled_at: iso(-2 * D), expires_at: iso(-1 * D) });
    const manual = sub({ user_id: uid(2), payment_provider: "manual", payment_method: "admin", amount_cents: 0, granted_payment_ids: [], status: "expired", expires_at: iso(-3 * D) });
    const guard = sub({ user_id: uid(3), tier: "half_year", payment_provider: "manual", payment_method: "renewal_guard", amount_cents: 0, granted_payment_ids: [], status: "expired", expires_at: iso(-3 * D) });
    // The a20 closure: an unpaid NOWPayments checkout with its invoice amount, closed as cancelled.
    const pending = sub({ user_id: uid(4), payment_provider: "nowpayments", status: "cancelled", amount_cents: 11400, granted_payment_ids: [], provider_payment_id: null, cancelled_at: iso(-2 * D) });
    inp.subscriptions.push(trial, manual, guard, pending);
    const { byRow, r } = run(inp);
    expect(byRow(trial)?.class).toBe("trial_end");
    expect(byRow(manual)?.class).toBe("admin_comp");
    expect(byRow(guard)?.class).toBe("admin_comp");
    expect(byRow(pending)).toMatchObject({ class: "admin_comp", reason: "never_paid_closed" });
    expect(r.six_counts["5_paid_access_lost"]).toMatchObject({ admin_comp: 3, trial_end: 1, learners_lost: 0, cancelled_status_rows: 2, cancelled_paid_rows: 0 });
  });

  it("refund: status, claim and a refund after a renewal", () => {
    const inp = empty();
    const byStatus = sub({ user_id: uid(1), status: "refunded", cancelled_at: iso(-2 * D) });
    const renewed = sub({
      user_id: uid(2), status: "cancelled", cancelled_at: iso(-1 * D), started_at: iso(-50 * D), created_at: iso(-50 * D), expires_at: iso(10 * D),
      granted_payment_ids: [
        { payment_id: "pay_first", amount_cents: 1900, added_months: 1, granted_at: iso(-50 * D) },
        { payment_id: "pay_renew", amount_cents: 1900, added_months: 1, granted_at: iso(-20 * D) },
      ],
      provider_payment_id: "pay_renew",
    });
    inp.subscriptions.push(byStatus, renewed);
    inp.payment_events.push(planEvent(byStatus, MONTHLY), planEvent(renewed, MONTHLY));
    inp.claims.push(claim("whop", "refund:r_1", { event: "refund.created", flipped_ids: [renewed.id], payment_candidates: ["pay_renew"] }));
    const { byRow, r } = run(inp);
    expect(byRow(byStatus)?.class).toBe("refund");
    expect(byRow(renewed)).toMatchObject({ class: "refund", evidence: expect.arrayContaining(["refund_claim"]) });
    expect(r.six_counts["5_paid_access_lost"]).toMatchObject({ refund: 2, cancelled_status_rows: 2, cancelled_learners: 2 });
  });

  it("refund of a renewal that leaves the row running shows on the payer's last outcome", () => {
    const inp = empty();
    // After the surviving-window revoke the refunded renewal is gone from the history and the row runs on, shortened.
    const row = sub({
      user_id: uid(5), started_at: iso(-50 * D), created_at: iso(-50 * D), expires_at: iso(5 * D),
      granted_payment_ids: [{ payment_id: "pay_a", amount_cents: 1900, added_months: 1, granted_at: iso(-50 * D) }],
      provider_payment_id: "pay_a",
    });
    inp.subscriptions.push(row);
    // A refund delivery logs the refund's own id, never the reversed payment: it must not match anything.
    inp.payment_events.push(planEvent(row, MONTHLY), { event: "webhook_received", user_id: null, payment_id: "r_refund1", plan_id: null, amount_cents: 1900, whop_event: "payment.refunded", created_at: iso(-2 * D) });
    inp.user_events.push(projectUserEvent({ user_id: row.user_id, event_type: "whop_subscription_revoked", created_at: iso(-2 * D),
      event_data: { event: "payment.refunded", kind: "refunded", affected_subscription_ids: [row.id], flipped_ids: [], partial_kept_active_ids: [row.id], atomic: true } }));
    inp.last_answers = [{ user_id: row.user_id!, last_at: iso(-1 * D) }];
    const { r } = run(inp);
    expect(r.ended_rows).toHaveLength(0);
    expect(r.recurring_payers[0]).toMatchObject({ uid8: row.user_id!.slice(0, 8), last_outcome: { kind: "refunded" }, paid_charges: 1, at_risk: true, at_risk_reasons: ["last_payment_refunded"] });
  });

  it("failed_card from a dunning claim on the membership", () => {
    const inp = empty();
    const row = sub({ user_id: uid(1), status: "cancelled", cancelled_at: iso(-1 * D), expires_at: iso(-1 * D) });
    inp.subscriptions.push(row);
    inp.payment_events.push(planEvent(row, MONTHLY));
    inp.claims.push(claim("whop", "recover:pay_fail", { event: "payment.failed", user_id: row.user_id, membership_id: row.whop_membership_id, claimed_at: iso(-4 * D) }));
    const { byRow, r } = run(inp);
    expect(byRow(row)).toMatchObject({ class: "failed_card", evidence: ["recover_claim"] });
    expect(r.six_counts["5_paid_access_lost"].failed_card).toBe(1);
  });

  it("superseded within 10 minutes, in both orders", () => {
    const inp = empty();
    const t0 = -3 * D;
    const oldA = sub({ user_id: uid(1), created_at: iso(t0), started_at: iso(t0), status: "cancelled", cancelled_at: iso(t0 + 4 * 60_000) });
    const newA = sub({ user_id: uid(1), created_at: iso(t0 + 3 * 60_000), started_at: iso(t0), expires_at: iso(27 * D) });
    const oldB = sub({ user_id: uid(2), created_at: iso(t0), started_at: iso(t0), status: "cancelled", cancelled_at: iso(t0 + 6 * 60_000) });
    const newB = sub({ user_id: uid(2), created_at: iso(t0 - 5 * 60_000), started_at: iso(t0), expires_at: iso(27 * D) });
    inp.subscriptions.push(oldA, newA, oldB, newB);
    const { byRow, r } = run(inp);
    expect(byRow(oldA)).toMatchObject({ class: "superseded", reason: "replaced_within_10m" });
    expect(byRow(oldB)).toMatchObject({ class: "superseded", reason: "replaced_within_10m" });
    expect(r.six_counts["5_paid_access_lost"]).toMatchObject({ superseded: 2, learners_lost: 0, cancelled_status_rows: 2 });
  });

  it("a re-buy weeks after the end is not a supersede; a switch stop is", () => {
    const inp = empty();
    const ended = sub({ user_id: uid(1), status: "cancelled", cancelled_at: iso(-3 * D), expires_at: iso(-3 * D) });
    const rebuyLater = sub({ user_id: uid(1), created_at: iso(-3 * D + 2 * D), started_at: iso(-1 * D), expires_at: iso(29 * D) });
    const switched = sub({ user_id: uid(2), status: "cancelled", cancelled_at: iso(-2 * D), expires_at: iso(-2 * D) });
    inp.subscriptions.push(ended, rebuyLater, switched);
    inp.payment_events.push(planEvent(ended, MONTHLY), planEvent(switched, MONTHLY));
    inp.claims.push(claim("whop", "cancel:mem_x", { event: "membership.deactivated", membership_id: ended.whop_membership_id, flipped_ids: [ended.id] }));
    inp.claims.push(claim("billing_action", `switch_cancel:${switched.whop_membership_id}:pay_new`, { user_id: switched.user_id, phase: "stopped" }));
    const { byRow } = run(inp);
    expect(byRow(ended)).toMatchObject({ class: "recurring_cancel", reason: "renewal_stopped_at_period_end", has_paid_access_now: true });
    expect(byRow(switched)).toMatchObject({ class: "superseded", reason: "switch" });
  });

  it("one_time_end, awaiting_charge and unknown", () => {
    const inp = empty();
    const oneTime = sub({ user_id: uid(1), status: "expired", expires_at: iso(-2 * D) });
    const awaiting = sub({ user_id: uid(2), expires_at: iso(-1 * H) });
    const silentEnd = sub({ user_id: uid(3), status: "expired", expires_at: iso(-4 * D) });
    const noPlan = sub({ user_id: uid(4), status: "cancelled", cancelled_at: iso(-4 * D), expires_at: iso(20 * D) });
    inp.subscriptions.push(oneTime, awaiting, silentEnd, noPlan);
    inp.payment_events.push(planEvent(oneTime, ONE_TIME), planEvent(awaiting, MONTHLY), planEvent(silentEnd, MONTHLY));
    const { byRow, r } = run(inp);
    expect(byRow(oneTime)?.class).toBe("one_time_end");
    expect(byRow(awaiting)?.class).toBe("awaiting_charge");
    expect(byRow(silentEnd)).toMatchObject({ class: "unknown", reason: "renewing_row_ended_without_signal" });
    expect(byRow(noPlan)).toMatchObject({ class: "unknown", reason: "cadence_unknown" });
    // Unknown is never counted as a cancel.
    expect(r.six_counts["5_paid_access_lost"]).toMatchObject({ one_time_end: 1, awaiting_charge: 1, unknown: 2, recurring_cancel: 0 });
  });

  it("a half-year guard stop is a planned end", () => {
    const inp = empty();
    const row = sub({ user_id: uid(1), tier: "half_year", status: "cancelled", cancelled_at: iso(-1 * D), expires_at: iso(-1 * D) });
    inp.subscriptions.push(row);
    inp.claims.push(claim("billing_action", `half_year_guard:${row.whop_membership_id}:2026-10-13`, { subscription_id: row.id, phase: "stopped" }));
    expect(run(inp).byRow(row)).toMatchObject({ class: "one_time_end", reason: "renewal_guard_stop" });
    // A guard whose stop Whop refused is no planned end.
    inp.claims[0] = claim("billing_action", `half_year_guard:${row.whop_membership_id}:2026-10-13`, { subscription_id: row.id, phase: "stop_refused" });
    expect(run(inp).byRow(row)).toMatchObject({ class: "recurring_cancel", evidence: ["cancelled_at_period_end", "half_year_guard_unconfirmed"] });
  });

  it("rows outside the window and staff or test accounts are left out", () => {
    const inp = empty();
    const old = sub({ user_id: uid(1), status: "expired", expires_at: iso(-20 * D) });
    const staff = sub({ user_id: uid(2), status: "refunded", cancelled_at: iso(-1 * D) });
    inp.subscriptions.push(old, staff);
    inp.users.push({ id: staff.user_id!, email: "user-b7895af0@example.com", role: "user", tier: "pro" });
    const { r } = run(inp);
    expect(r.ended_rows).toHaveLength(0);
    expect(r.six_counts["5_paid_access_lost"].cancelled_status_rows).toBe(0);
  });
});

describe("recurring payers", () => {
  it("lists next charges with at-risk flags; cancel_at_period_end stays null unless we stopped it", () => {
    const inp = empty();
    const ok = sub({ user_id: uid(1), expires_at: iso(15 * D) });
    const failed = sub({ user_id: uid(2), expires_at: iso(22 * D) });
    const silent = sub({ user_id: uid(3), expires_at: iso(25 * D) });
    const stopped = sub({ user_id: uid(4), tier: "half_year", expires_at: iso(28 * D) });
    const oneTime = sub({ user_id: uid(5), expires_at: iso(8 * D) });
    const far = sub({ user_id: uid(6), expires_at: iso(60 * D) });
    const trial = sub({ user_id: uid(7), tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: [{ payment_id: "pay_tz", amount_cents: 0, added_months: 0, granted_at: iso(-3 * D), trial_ends_at: iso(4 * D) }], started_at: iso(-3 * D), expires_at: iso(4 * D) });
    inp.subscriptions.push(ok, failed, silent, stopped, oneTime, far, trial);
    inp.payment_events.push(planEvent(ok, MONTHLY), planEvent(failed, MONTHLY), planEvent(silent, MONTHLY), planEvent(oneTime, ONE_TIME), planEvent(far, MONTHLY));
    inp.claims.push(claim("whop", "recover:pay_f", { user_id: failed.user_id, membership_id: failed.whop_membership_id, claimed_at: iso(-2 * D) }));
    inp.claims.push(claim("billing_action", `half_year_guard:${stopped.whop_membership_id}:2026-11-12`, { phase: "stopped" }));
    inp.last_answers = [ok, failed, stopped, trial].map((s) => ({ user_id: s.user_id!, last_at: iso(-1 * D) }));
    inp.last_answers.push({ user_id: silent.user_id!, last_at: iso(-20 * D) });
    const { r } = run(inp);
    const by = (s: SubRow) => r.recurring_payers.find((p) => p.row8 === s.id.slice(0, 8));
    expect(r.recurring_payers.map((p) => p.row8)).toEqual([trial, ok, failed, silent, stopped].map((s) => s.id.slice(0, 8)));
    expect(by(ok)).toMatchObject({ at_risk: false, cancel_at_period_end: null, last_outcome: { kind: "charged" }, expected_cents: 1900, days_to_charge: 15 });
    expect(by(failed)).toMatchObject({ at_risk: true, last_charge_failed: true, last_outcome: { kind: "failed" } });
    expect(by(silent)).toMatchObject({ at_risk: true, silent_14d: true, at_risk_reasons: ["no_answer_14d"] });
    expect(by(stopped)).toMatchObject({ at_risk: true, cancel_at_period_end: true });
    expect(by(trial)).toMatchObject({ last_outcome: { kind: "trial_start" }, expected_cents: null });
    expect(r.text).toContain("AT RISK");
  });

  it("silent_14d is null when answers were not read", () => {
    const inp = empty();
    const row = sub({ user_id: uid(1), expires_at: iso(5 * D) });
    inp.subscriptions.push(row);
    inp.payment_events.push(planEvent(row, MONTHLY));
    inp.last_answers = null;
    const { r } = run(inp);
    expect(r.recurring_payers[0]).toMatchObject({ silent_14d: null, at_risk: false });
    expect(r.notes.join(" ")).toContain("silent_14d is null");
  });
});

describe("trials", () => {
  it("card and reverse trial outcomes", () => {
    const inp = empty();
    const zero = (ends: number) => [{ payment_id: `pay_z${ends}`, amount_cents: 0, added_months: 0, granted_at: iso(ends - 7 * D), trial_ends_at: iso(ends) }];
    const charged = sub({ user_id: uid(1), tier: "notes_pro_trial", started_at: iso(-9 * D), created_at: iso(-9 * D), expires_at: iso(28 * D), amount_cents: 1900,
      granted_payment_ids: [...zero(-2 * D), { payment_id: "pay_c", amount_cents: 1900, added_months: 1, granted_at: iso(-2 * D) }] });
    const failed = sub({ user_id: uid(2), tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: zero(-3 * D), started_at: iso(-10 * D), created_at: iso(-10 * D), status: "cancelled", cancelled_at: iso(-1 * D), expires_at: iso(-3 * D) });
    const cancelled = sub({ user_id: uid(3), tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: zero(-1 * D), started_at: iso(-8 * D), created_at: iso(-8 * D), status: "cancelled", cancelled_at: iso(-4 * D), expires_at: iso(-1 * D) });
    const lapsed = sub({ user_id: uid(4), tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: zero(-2 * D), started_at: iso(-9 * D), created_at: iso(-9 * D), status: "expired", expires_at: iso(-2 * D) });
    const running = sub({ user_id: uid(5), tier: "notes_pro_trial", amount_cents: 0, granted_payment_ids: zero(4 * D), started_at: iso(-3 * D), created_at: iso(-3 * D), expires_at: iso(4 * D) });
    const revPaid = sub({ user_id: uid(6), tier: "reverse_trial", payment_provider: "trial", payment_method: null, amount_cents: 0, granted_payment_ids: [], provider_payment_id: null, started_at: iso(-6 * D), created_at: iso(-6 * D), status: "expired", expires_at: iso(-3 * D) });
    const revBuy = sub({ user_id: uid(6), tier: "flex_month", created_at: iso(-2 * D), started_at: iso(-2 * D), expires_at: iso(28 * D) });
    const revLapsed = sub({ user_id: uid(7), tier: "reverse_trial", payment_provider: "trial", payment_method: null, amount_cents: 0, granted_payment_ids: [], provider_payment_id: null, started_at: iso(-5 * D), created_at: iso(-5 * D), status: "expired", expires_at: iso(-2 * D) });
    inp.subscriptions.push(charged, failed, cancelled, lapsed, running, revPaid, revBuy, revLapsed);
    inp.claims.push(claim("whop", "recover:pay_tf", { user_id: failed.user_id, membership_id: failed.whop_membership_id, claimed_at: iso(-3 * D + H) }));
    const { r } = run(inp);
    const out = (s: SubRow) => r.trials.find((x) => x.row8 === s.id.slice(0, 8))?.outcome;
    expect(out(charged)).toBe("charged");
    expect(out(failed)).toBe("failed");
    expect(out(cancelled)).toBe("cancelled_in_trial");
    expect(out(lapsed)).toBe("ended_no_signal");
    expect(out(running)).toBe("running");
    expect(out(revPaid)).toBe("charged");
    expect(out(revLapsed)).toBe("ended_no_signal");
    const t3 = r.six_counts["3_trials"] as Record<string, unknown>;
    expect(t3.card).toMatchObject({ trial_starts: 1, charged: 1, failed: 1, cancelled_in_trial: 1, ended_no_signal: 1, running: 1 });
    expect(t3.reverse).toMatchObject({ trial_starts: 2, charged: 1, failed: null, cancelled_in_trial: null, ended_no_signal: 1 });
    expect(t3).toMatchObject({ trial_starts: 3, charged: 2, failed: 1, cancelled_in_trial: 1 });
    // The failed card trial also lands in the access-lost list as a trial end, never as paid access lost.
    expect(r.ended_rows.find((e) => e.row8 === failed.id.slice(0, 8))?.class).toBe("trial_end");
  });
});

describe("privacy and inputs", () => {
  it("prints uid8 and short ids only, never an address", () => {
    const inp = empty();
    const row = sub({ user_id: uid(1), status: "refunded", cancelled_at: iso(-1 * D) });
    const next = sub({ user_id: uid(2), expires_at: iso(3 * D) });
    inp.subscriptions.push(row, next);
    inp.users.push({ id: row.user_id!, email: "user-610e28c1@example.com", role: "user", tier: "free" }, { id: next.user_id!, email: "user-c1ed918d@example.com", role: "user", tier: "pro" });
    const json = JSON.stringify(run(inp).r);
    expect(json).not.toContain("@");
    expect(json).not.toContain(row.user_id!);
    expect(json).not.toContain(next.whop_membership_id!);
    expect(json).not.toContain(row.id);
  });

  it("projects claim payloads to the whitelist and parses a dump", () => {
    const p = projectClaimPayload({ event: "membership.deactivated", email: "a@b.c", owner_snapshot: { tier: "pro" }, updates: [{ id: "r1", snapshot: {} }], flipped_ids: ["r1", 3] });
    expect(p).toEqual({ event: "membership.deactivated", user_id: null, membership_id: null, claimed_at: null, phase: null, flipped_ids: ["r1"], update_ids: ["r1"], payment_candidates: null, subscription_id: null });
    const d = parseDump({ subscriptions: [], claims: [{ provider: "whop", event_id: "cancel:x", processed_at: null, payload: { email: "a@b.c" } }] });
    expect(JSON.stringify(d.claims)).not.toContain("@");
    expect(d.last_answers).toBeNull();
  });

  it("checks its arguments", () => {
    expect(parseArgs(["--", "--days", "14", "--horizon", "45", "--json"])).toMatchObject({ days: 14, horizon: 45, json: true, out: null, input: null });
    expect(() => parseArgs(["--days", "0"])).toThrow();
    expect(() => parseArgs(["--horizon", "500"])).toThrow();
  });
});

describe("reviewer cases", () => {
  it("atomic revoke receipts carry no ids: the revoke event and the cancel:<mem> key still tie them to the row", () => {
    const inp = empty();
    const refunded = sub({ user_id: uid(1), status: "cancelled", cancelled_at: iso(-1 * D) });
    const deactivated = sub({ user_id: uid(2), status: "cancelled", cancelled_at: iso(-2 * D), expires_at: iso(12 * D) });
    inp.subscriptions.push(refunded, deactivated);
    inp.payment_events.push(planEvent(refunded, MONTHLY), planEvent(deactivated, MONTHLY));
    inp.claims.push(claim("whop", "refund:r_atomic", { claimed_at: iso(-1 * D), event: "refund.created" }));
    inp.claims.push(claim("whop", `cancel:${deactivated.whop_membership_id}`, { claimed_at: iso(-2 * D), event: "membership.deactivated" }));
    inp.user_events.push(projectUserEvent({ user_id: refunded.user_id, event_type: "whop_subscription_revoked", created_at: iso(-1 * D),
      event_data: { kind: "refunded", affected_subscription_ids: [refunded.id], flipped_ids: [refunded.id], atomic: true } }));
    const { byRow } = run(inp);
    expect(byRow(refunded)).toMatchObject({ class: "refund", evidence: ["revoke_event"] });
    // Deactivated long before its end with no stop, refund or failure: a learner cancel the row shows as a deactivation.
    expect(byRow(deactivated)).toMatchObject({ class: "recurring_cancel", reason: "deactivated_mid_period", evidence: ["deactivation"] });
  });

  it("a stop claim that Whop did not confirm is at risk, never cancel_at_period_end", () => {
    const inp = empty();
    const refused = sub({ user_id: uid(1), tier: "half_year", expires_at: iso(9 * D) });
    const switching = sub({ user_id: uid(2), expires_at: iso(11 * D) });
    inp.subscriptions.push(refused, switching);
    inp.payment_events.push(planEvent(switching, MONTHLY));
    inp.claims.push(claim("billing_action", `half_year_guard:${refused.whop_membership_id}:2026-10-24`, { phase: "stop_unconfirmed" }));
    inp.claims.push(claim("billing_action", `switch_cancel:${switching.whop_membership_id}:pay_n`, { phase: "read_failed" }));
    inp.last_answers = [refused, switching].map((s) => ({ user_id: s.user_id!, last_at: iso(-1 * D) }));
    const { r } = run(inp);
    for (const p of r.recurring_payers) expect(p).toMatchObject({ cancel_at_period_end: null, at_risk: true, at_risk_reasons: ["renewal_stop_unconfirmed"] });
    // The switch user event (old_membership_id) is the confirmation.
    inp.user_events.push(projectUserEvent({ user_id: switching.user_id, event_type: "whop_switch_renewal_stopped", created_at: iso(-1 * D),
      event_data: { old_membership_id: switching.whop_membership_id, new_membership_id: "mem_new" } }));
    const again = run(inp).r.recurring_payers.find((p) => p.row8 === switching.id.slice(0, 8));
    expect(again).toMatchObject({ cancel_at_period_end: true, at_risk_reasons: ["renewal_stopped_by_us"] });
  });

  it("a failure without a membership only marks the learner's renewing row near its charge", () => {
    const inp = empty();
    const oneTime = sub({ user_id: uid(1), status: "expired", expires_at: iso(-3 * D) });
    const renewing = sub({ user_id: uid(1), status: "cancelled", cancelled_at: iso(-1 * D), expires_at: iso(-1 * D), created_at: iso(-40 * D), started_at: iso(-31 * D) });
    inp.subscriptions.push(oneTime, renewing);
    inp.payment_events.push(planEvent(oneTime, ONE_TIME), planEvent(renewing, MONTHLY));
    inp.claims.push(claim("whop", "recover:pay_nomem", { user_id: uid(1), membership_id: null, claimed_at: iso(-1 * D - 2 * H) }));
    const { byRow } = run(inp);
    expect(byRow(oneTime)?.class).toBe("one_time_end");
    expect(byRow(renewing)?.class).toBe("failed_card");
  });

  it("a learner who bought again is recovered, not lost", () => {
    const inp = empty();
    const ended = sub({ user_id: uid(1), status: "expired", expires_at: iso(-5 * D) });
    const rebuy = sub({ user_id: uid(1), created_at: iso(-1 * D), started_at: iso(-1 * D), expires_at: iso(29 * D) });
    const gone = sub({ user_id: uid(2), status: "expired", expires_at: iso(-5 * D) });
    inp.subscriptions.push(ended, rebuy, gone);
    inp.payment_events.push(planEvent(ended, ONE_TIME), planEvent(gone, ONE_TIME), planEvent(rebuy, ONE_TIME));
    const lost = run(inp).r.six_counts["5_paid_access_lost"];
    expect(lost).toMatchObject({ one_time_end: 2, learners_lost: 1, recovered: 1 });
  });

  it("the dump's staff flag excludes accounts without any address", () => {
    const inp = parseDump({
      subscriptions: [sub({ user_id: uid(9), status: "refunded", cancelled_at: iso(-1 * D) })],
      users: [{ id: uid(9), role: "user", tier: "pro", staff: true }],
    });
    expect(run(inp).r.ended_rows).toHaveLength(0);
  });

  it("an old refund that left the row running does not explain a later end", () => {
    const inp = empty();
    const row = sub({
      user_id: uid(3), status: "cancelled", cancelled_at: iso(-1 * D), expires_at: iso(-1 * D), started_at: iso(-61 * D), created_at: iso(-61 * D),
      granted_payment_ids: [
        { payment_id: "pay_1", amount_cents: 1900, added_months: 1, granted_at: iso(-61 * D) },
        { payment_id: "pay_3", amount_cents: 1900, added_months: 1, granted_at: iso(-31 * D) },
      ],
      provider_payment_id: "pay_3",
    });
    inp.subscriptions.push(row);
    inp.payment_events.push(planEvent(row, MONTHLY));
    inp.user_events.push(projectUserEvent({ user_id: row.user_id, event_type: "whop_subscription_revoked", created_at: iso(-45 * D),
      event_data: { kind: "refunded", affected_subscription_ids: [row.id], partial_kept_active_ids: [row.id] } }));
    expect(run(inp).byRow(row)).toMatchObject({ class: "recurring_cancel", reason: "renewal_stopped_at_period_end" });
  });

  it("a switch claim at not_renewing counts as a confirmed stop", () => {
    const inp = empty();
    const row = sub({ user_id: uid(4), expires_at: iso(6 * D) });
    inp.subscriptions.push(row);
    inp.payment_events.push(planEvent(row, MONTHLY));
    inp.claims.push(claim("billing_action", `switch_cancel:${row.whop_membership_id}:pay_q`, { phase: "not_renewing" }));
    inp.last_answers = [{ user_id: row.user_id!, last_at: iso(-1 * D) }];
    expect(run(inp).r.recurring_payers[0]).toMatchObject({ cancel_at_period_end: true, at_risk_reasons: ["renewal_stopped_by_us"] });
  });
});
