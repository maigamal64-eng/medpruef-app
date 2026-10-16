import { describe, expect, it } from "vitest";
import { cramCounts, type CramEvent, type CramPayment } from "../../../scripts/cram-card/monday-count";

const ev = (user_id: string, event_type: string, event_data: Record<string, unknown>, created_at: string): CramEvent => ({ user_id, event_type, event_data, created_at });
const real = new Set(["a", "b", "c"]);

describe("cram card Monday count", () => {
  const events = [
    ev("a", "cram_card_shown", { variant: "sip_bank" }, "2026-10-21T08:00:00Z"),
    ev("a", "sitting_set", { source: "cram_card" }, "2026-10-21T08:01:00Z"),
    ev("a", "cram_card_click", { target: "plan" }, "2026-10-21T08:02:00Z"),
    ev("b", "cram_card_shown", { variant: "sip_named" }, "2026-10-22T08:00:00Z"),
    ev("b", "cram_card_click", { target: "pricing" }, "2026-10-22T08:01:00Z"),
    ev("c", "cram_card_shown", { variant: "rezgm_a" }, "2026-10-23T08:00:00Z"),
    ev("x", "cram_card_shown", { variant: "sip_bank" }, "2026-10-23T08:00:00Z"), // staff: not in real
    ev("a", "sitting_set", { source: "mail_link" }, "2026-10-21T09:00:00Z"), // another source: not counted
  ];
  const payments: CramPayment[] = [
    { user_id: "b", event: "checkout_session_created", created_at: "2026-10-30T08:00:00Z" },
    { user_id: "b", event: "grant_succeeded", created_at: "2026-10-30T08:05:00Z" },
    { user_id: "a", event: "grant_succeeded", created_at: "2026-12-30T08:05:00Z" }, // beyond 14 days
    { user_id: "c", event: "checkout_session_created", created_at: "2026-10-01T08:05:00Z" }, // before the first shown
  ];
  it("counts distinct learners k of n, per variant and in total, staff excluded", () => {
    const t = cramCounts(events, payments, real, 14);
    expect(t.all.shown).toEqual({ k: 3, n: 3 });
    expect(t.all.part_named).toEqual({ k: 1, n: 3 });
    expect(t.all.plan_opens).toEqual({ k: 1, n: 3 });
    expect(t.all.pricing_opens).toEqual({ k: 1, n: 3 });
    expect(t.all.checkout_opens).toEqual({ k: 1, n: 3 });
    expect(t.all.payments).toEqual({ k: 1, n: 3 });
    expect(t.sip_bank.shown).toEqual({ k: 1, n: 1 });
    expect(t.sip_bank.part_named).toEqual({ k: 1, n: 1 });
    expect(t.sip_named.payments).toEqual({ k: 1, n: 1 });
    expect(t.rezgm_a.checkout_opens).toEqual({ k: 0, n: 1 });
  });
  it("an empty table still has the total row", () => {
    expect(cramCounts([], [], new Set(), 14).all.shown).toEqual({ k: 0, n: 0 });
  });
});
