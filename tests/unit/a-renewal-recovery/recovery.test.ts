import { describe, expect, it } from "vitest";
import { decideRenewalRecovery, renewalRecoveryEnabled, safeRecoveryUrl, type RecoveryAccount, type RecoveryRow } from "@/lib/renewal-recovery";
import { recoveryCopy } from "@/lib/renewal-recovery-copy";
import { SURFACES } from "@/lib/announcements/queue";
import { sanitizeEventData, isAllowedEvent } from "@/lib/analytics-events";

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const URL_OK = "https://whop.com/checkout/recover/abc123";
const account = (o: Partial<RecoveryAccount> = {}): RecoveryAccount => ({ id: "u1", role: "user", tier: "pro", email: "user-14be81d5@example.com", suppressedAll: false, ...o });
const row = (h = 24, data: Record<string, unknown> = { event: "payment.failed", recovery_url: URL_OK }): RecoveryRow => ({ created_at: ago(h), event_data: data });
const run = (o: { account?: Partial<RecoveryAccount>; rows?: RecoveryRow[]; grants?: { created_at: string; payment_id?: string }[]; revokes?: { created_at: string }[]; enabled?: boolean; excluded?: string[] } = {}) =>
  decideRenewalRecovery({ enabled: o.enabled ?? true, excluded: new Set(o.excluded ?? []), account: account(o.account), rows: o.rows ?? [row()], grants: o.grants ?? [], revokes: o.revokes, now: NOW });

describe("decideRenewalRecovery", () => {
  it("shows for a declined renewal with a recovery link, also while paid access still runs", () => {
    expect(run()).toMatchObject({ show: true, url: URL_OK, kind: "failed" });
    expect(run({ rows: [row(5, { event: "payment.requires_action", recovery_url: URL_OK })] })).toMatchObject({ show: true, kind: "requires_action" });
  });
  it("is off by default", () => {
    expect(renewalRecoveryEnabled({})).toBe(false);
    expect(renewalRecoveryEnabled({ RENEWAL_RECOVERY_CARD_ENABLED: "true" })).toBe(true);
    expect(run({ enabled: false })).toEqual({ show: false, reason: "flag_off" });
  });
  it("needs a recovery link: the manage-page fallback never shows the card", () => {
    expect(run({ rows: [row(24, { event: "payment.failed", recovery_url: null, action_url: "https://whop.com/billing/manage/mber_1" })] })).toEqual({ show: false, reason: "no_link" });
    // a newer decline without a link supersedes an older one with a link
    expect(run({ rows: [row(48), row(2, { event: "payment.failed", recovery_url: null })] })).toEqual({ show: false, reason: "no_link" });
  });
  it("only whop.com https links pass", () => {
    for (const bad of ["http://whop.com/x", "https://evil.com/x", "https://whop.com.evil.com/x", "javascript:alert(1)", "https://u:user-edf3b4e8@example.com/x", "", null, 5]) expect(safeRecoveryUrl(bad)).toBeNull();
    expect(safeRecoveryUrl("https://pay.whop.com/x")).toBe("https://pay.whop.com/x");
    expect(run({ rows: [row(24, { event: "payment.failed", recovery_url: "https://evil.com/x" })] })).toEqual({ show: false, reason: "no_link" });
  });
  it("window is 14 days; no row means no card", () => {
    expect(run({ rows: [row(14 * 24 + 1)] })).toEqual({ show: false, reason: "no_row" });
    expect(run({ rows: [row(14 * 24 - 1)] })).toMatchObject({ show: true });
    expect(run({ rows: [] })).toEqual({ show: false, reason: "no_row" });
  });
  it("hides once a later payment landed, not for an earlier one", () => {
    expect(run({ grants: [{ created_at: ago(1) }] })).toEqual({ show: false, reason: "granted_since" });
    expect(run({ grants: [{ created_at: ago(72) }] })).toMatchObject({ show: true });
  });
  it("a grant for the named payment hides it even when the row was written later (out-of-order webhooks)", () => {
    const withPay = row(2, { event: "payment.failed", recovery_url: URL_OK, payment_id: "pay_1" });
    expect(run({ rows: [withPay], grants: [{ created_at: ago(5), payment_id: "pay_1" }] })).toEqual({ show: false, reason: "granted_since" });
    expect(run({ rows: [withPay], grants: [{ created_at: ago(5), payment_id: "pay_other" }] })).toMatchObject({ show: true });
  });
  it("hides once access was revoked after the decline", () => {
    expect(run({ revokes: [{ created_at: ago(1) }] })).toEqual({ show: false, reason: "revoked" });
    expect(run({ revokes: [{ created_at: ago(72) }] })).toMatchObject({ show: true });
  });
  it("hides for staff, test, excluded ids, scope-all suppression and refunded history", () => {
    expect(run({ account: { role: "admin" } })).toMatchObject({ reason: "staff" });
    expect(run({ account: { email: "user-847887c3@example.com" } })).toMatchObject({ reason: "staff" });
    expect(run({ excluded: ["u1"] })).toMatchObject({ reason: "excluded" });
    expect(run({ account: { suppressedAll: true } })).toMatchObject({ reason: "suppressed" });
    expect(run({ account: { refunded: true } })).toMatchObject({ reason: "refunded" });
  });
});

describe("copy, surface and events", () => {
  it("uses the final C5 strings", () => {
    expect(recoveryCopy("de")).toMatchObject({ title: "Ihre letzte Zahlung ist noch offen", body: "Über den Link schließen Sie die offene Zahlung bei Whop ab, zum Beispiel mit einer anderen Karte.", button: "Zahlung abschließen" });
    expect(recoveryCopy("en")).toMatchObject({ title: "Your last payment is still open", body: "The link takes you to Whop to complete the open payment, for example with another card.", button: "Complete payment" });
  });
  it("has no em dash, exclamation mark or price", () => {
    for (const l of ["de", "en"] as const) for (const v of Object.values(recoveryCopy(l))) expect(v).not.toMatch(/[—–!€\d]/);
  });
  it("is a transactional inline surface (not paused in the sitting week)", () => {
    expect(SURFACES.renewal_recovery).toMatchObject({ kind: "inline", marketing: false });
  });
  it("events are allowlisted with a kind only", () => {
    expect(isAllowedEvent("renewal_recovery_shown")).toBe(true);
    expect(isAllowedEvent("renewal_recovery_click")).toBe(true);
    expect(sanitizeEventData("renewal_recovery_click", { kind: "failed", url: "https://whop.com/x" })).toEqual({ kind: "failed" });
  });
});
