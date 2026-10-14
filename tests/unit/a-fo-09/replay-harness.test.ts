import { describe, expect, it } from "vitest";
import { replay } from "../../../scripts/whop/replay-pending-revoke";

describe("a-fo-09 replay harness", () => {
  it("normal order changes nothing; a refund before its payment is the only withhold", () => {
    const normal = replay([
      { at: "2026-10-01T10:00:00Z", event: "payment.succeeded", id: "pay_a", prod_outcome: "granted" },
      { at: "2026-10-01T10:00:01Z", event: "payment.succeeded", id: "pay_a", prod_outcome: "granted" },
      { at: "2026-10-02T10:00:00Z", event: "refund.created", id: "rf_a", refunded_payment_hint: "pay_a" },
      { at: "2026-10-03T10:00:00Z", event: "membership.deactivated", id: "mem_a" },
    ]);
    expect(normal).toMatchObject({ grant_decisions: 1, refund_class: 1, cancel_class: 1, withheld: [], changed_matched_events: 0 });

    const outOfOrder = replay([
      { at: "2026-10-02T10:00:00Z", event: "dispute.created", id: "dp_b", refunded_payment_hint: "pay_b" },
      { at: "2026-10-02T10:05:00Z", event: "payment.succeeded", id: "pay_b", prod_outcome: "granted" },
      { at: "2026-10-02T10:06:00Z", event: "payment.succeeded", id: "pay_c", prod_outcome: "granted" },
    ]);
    expect(outOfOrder.withheld.map((w) => w.payment)).toEqual(["pay_b"]);
    expect(outOfOrder.changed_matched_events).toBe(1);
  });
});
