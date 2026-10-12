import { describe, expect, it, vi } from "vitest";
import {
  alertMessage,
  evaluateCheckoutFailureRate,
  isAuthorizedCron,
  maybeSendAlert,
  type CheckoutEventRow,
} from "@/lib/master-learning/checkout-failure-rate";

const NOW = new Date("2026-10-12T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const created = (n: number, h = 2): CheckoutEventRow[] =>
  Array.from({ length: n }, () => ({ event: "checkout_session_created", createdAt: at(h) }));
const failed = (n: number, reason = "provider_error", h = 3): CheckoutEventRow[] =>
  Array.from({ length: n }, () => ({ event: "checkout_failed", reason, createdAt: at(h) }));

describe("checkout failure rate", () => {
  it("6 failed of 10 created returns alert true", () => {
    const r = evaluateCheckoutFailureRate([...created(10), ...failed(6)], { now: NOW });
    expect(r).toMatchObject({ created: 10, failed: 6, rate: 0.6, rateAlert: true, alert: true });
  });

  it("1 failed of 30 created returns alert false", () => {
    const r = evaluateCheckoutFailureRate([...created(30), ...failed(1)], { now: NOW });
    expect(r.alert).toBe(false);
  });

  it("fewer than 5 sessions never alerts on rate", () => {
    const r = evaluateCheckoutFailureRate([...created(4), ...failed(4)], { now: NOW });
    expect(r.rateAlert).toBe(false);
    expect(r.alert).toBe(false);
  });

  it("exactly 5 percent is not above the threshold", () => {
    const r = evaluateCheckoutFailureRate([...created(20), ...failed(1)], { now: NOW });
    expect(r.rate).toBe(0.05);
    expect(r.rateAlert).toBe(false);
  });

  it("any plan_not_configured in the last hour alerts, an older one does not", () => {
    const fresh = evaluateCheckoutFailureRate([...failed(1, "plan_not_configured", 0.5)], { now: NOW });
    expect(fresh.alert).toBe(true);
    expect(fresh.planNotConfiguredLastHour).toBe(1);
    const old = evaluateCheckoutFailureRate([...failed(1, "plan_not_configured", 5)], { now: NOW });
    expect(old.alert).toBe(false);
  });

  it("ignores rows outside the 24 hour window and in the future", () => {
    const rows = [...created(10, 30), ...failed(10, "provider_error", 30), { event: "checkout_failed", createdAt: "2026-10-13T00:00:00Z" }];
    const r = evaluateCheckoutFailureRate(rows, { now: NOW });
    expect(r).toMatchObject({ created: 0, failed: 0, rate: null, alert: false });
  });

  it("flag off performs no send at all", async () => {
    const send = vi.fn();
    const r = evaluateCheckoutFailureRate([...created(10), ...failed(6)], { now: NOW });
    expect(await maybeSendAlert(r, { enabled: false, send })).toEqual({ sent: false, reason: "flag_off" });
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("flag on sends once for an alert and not for a quiet day", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const bad = evaluateCheckoutFailureRate([...created(10), ...failed(6)], { now: NOW });
    expect((await maybeSendAlert(bad, { enabled: true, send })).sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("6 failed of 10 created");
    const quiet = evaluateCheckoutFailureRate(created(30), { now: NOW });
    expect(await maybeSendAlert(quiet, { enabled: true, send })).toEqual({ sent: false, reason: "no_alert" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("the alert text has no em dash", () => {
    const r = evaluateCheckoutFailureRate([...created(10), ...failed(6)], { now: NOW });
    expect(alertMessage(r)).not.toMatch(/[\u2013\u2014]/);
  });

  it("cron authorisation is exact and constant time", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCron("Bearer s3creT", "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer s3cret ", "s3cret")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
});
