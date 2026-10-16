/**
 * a-whop-buyer-fail-closed: the checkout-failure-watch mail lists the
 * `whop_membership_read_denied` rows (ids and status only) and the row type
 * stays equal on both sides.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { checkoutWatchEmail, MEMBERSHIP_DENIED_TYPE, membershipDeniedLines } from "@/lib/checkout-failure-rate";
import { MEMBERSHIP_DENIED_EVENT } from "@/lib/whop-buyer";

const row = (failClosed: boolean) => ({
  created_at: "2026-10-20T09:15:00Z",
  event_type: MEMBERSHIP_DENIED_TYPE,
  event_data: { cause: "http_403", status: 403, path: "grant", payment_id: "pay_1", membership_id: "mem_1", fail_closed: failClosed, email: "payer@example.com" },
});

describe("membership read denied in the checkout watch mail", () => {
  it("uses the same row type as the resolver", () => {
    expect(MEMBERSHIP_DENIED_TYPE).toBe(MEMBERSHIP_DENIED_EVENT);
  });

  it("fail-closed on: says renewals wait in 503 retries; ids only, never the email", () => {
    const mail = checkoutWatchEmail(null, [], [], [], membershipDeniedLines([row(true)]));
    expect(mail.subject).toContain("membership_read_denied");
    expect(mail.htmlBody).toContain("answer 503");
    expect(mail.htmlBody).toContain("pay_1");
    expect(mail.htmlBody).toContain("mem_1");
    expect(mail.htmlBody).toContain("http_403");
    expect(mail.htmlBody).not.toContain("payer@example.com");
    expect(mail.htmlBody).not.toMatch(/[–—]/);
  });

  it("fail-closed off: warns that renewals were matched by email", () => {
    const mail = checkoutWatchEmail(null, [], [], [], membershipDeniedLines([row(false)]));
    expect(mail.htmlBody).toContain("matched by the payer's email");
  });
});
