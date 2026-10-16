import { describe, expect, it } from "vitest";
import { claimEligibility, type ClaimInput } from "@/lib/trial-claim/rules";
import { trialClaimEnabled } from "@/lib/trial-claim/flag";
import { claimCopy, claimReasonLine } from "@/lib/trial-claim/copy";
import { safeNext } from "@/lib/auth-entry";

const DAY = 86_400_000;
const now = new Date("2026-11-05T10:00:00Z");
const since = new Date("2026-10-20T10:00:00Z");
const base = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  user: { role: "user", tier: "free", tierExpiresAt: null, createdAt: "2026-08-01T00:00:00Z", isBanned: false },
  subs: [],
  ownTrial: null,
  identityUsed: false,
  verified: true,
  since,
  now,
  ...over,
});
const sub = (o: Record<string, unknown>) => ({ tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: 1900, expires_at: null, ...o }) as never;

describe("claim eligibility", () => {
  it("an existing free, verified account that never paid and never trialled may claim", () => {
    expect(claimEligibility(base())).toEqual({ eligible: true, reason: "eligible" });
  });

  it.each([
    ["admin role", base({ user: { ...base().user, role: "admin" } }), "admin"],
    ["banned", base({ user: { ...base().user, isBanned: true } }), "banned"],
    ["created after REVERSE_TRIAL_SINCE (gets the automatic trial)", base({ user: { ...base().user, createdAt: "2026-10-21T00:00:00Z" } }), "new_account"],
    ["no creation date", base({ user: { ...base().user, createdAt: null } }), "new_account"],
    ["a paid Whop row", base({ subs: [sub({ provider_payment_id: "pay_1", status: "expired" })] }), "paid"],
    ["a refunded payment still counts as paid", base({ subs: [sub({ provider_payment_id: "pay_2", status: "refunded" })] }), "paid"],
    ["a paid crypto row", base({ subs: [sub({ payment_provider: "nowpayments", crypto_tx_hash: "0xabc", expires_at: "2026-09-01T00:00:00Z", status: "expired" })] }), "paid"],
    ["the card trial (EUR 0 notes_pro_trial)", base({ subs: [sub({ tier: "notes_pro_trial", amount_cents: 0, status: "cancelled" })] }), "trial_used"],
    ["the retired no-card trial row", base({ subs: [sub({ tier: "notes_free_trial", payment_provider: "trial", amount_cents: 0, status: "expired" })] }), "trial_used"],
    ["an own trials row (legacy)", base({ ownTrial: { kind: "legacy", expiresAt: "2026-07-10T00:00:00Z" } }), "trial_used"],
    ["an ended own reverse trial", base({ ownTrial: { kind: "reverse", expiresAt: "2026-11-01T00:00:00Z" } }), "trial_used"],
    ["address or Telegram id used by another account", base({ identityUsed: true }), "trial_used"],
    ["running Pro access (manual grant)", base({ user: { ...base().user, tier: "pro", tierExpiresAt: new Date(now.getTime() + 5 * DAY).toISOString() } }), "live_access"],
    ["permanent Pro", base({ user: { ...base().user, tier: "pro", tierExpiresAt: null } }), "live_access"],
    ["unverified identity", base({ verified: false }), "unverified"],
  ])("refuses: %s", (_label, input, reason) => {
    expect(claimEligibility(input)).toEqual({ eligible: false, reason });
  });

  it("an unpaid invoice, a pending checkout and an expired manual comp do not count as paid", () => {
    const subs = [
      sub({ status: "pending", provider_payment_id: null }),
      sub({ payment_provider: "nowpayments", provider_payment_id: "np_1", expires_at: null, status: "cancelled" }),
      sub({ tier: "pro", payment_provider: "manual", amount_cents: 0, status: "expired" }),
    ];
    expect(claimEligibility(base({ subs, user: { ...base().user, tier: "pro", tierExpiresAt: "2026-09-01T00:00:00Z" } }))).toEqual({ eligible: true, reason: "eligible" });
  });

  it("a running own claim answers running (a repeated press is a success, not a refusal)", () => {
    const end = new Date(now.getTime() + 2 * DAY).toISOString();
    const r = claimEligibility(base({ ownTrial: { kind: "reverse", expiresAt: end }, subs: [sub({ tier: "reverse_trial", payment_provider: "trial", amount_cents: 0, expires_at: end })], user: { ...base().user, tier: "pro", tierExpiresAt: end } }));
    expect(r).toEqual({ eligible: false, reason: "running" });
  });
});

describe("flag", () => {
  const on = { TRIAL_CLAIM_ENABLED: "true", REVERSE_TRIAL_ENABLED: "true", REVERSE_TRIAL_SINCE: "2026-10-20T10:00:00Z" };
  it("is off by default and only the literal true opens it, together with the reverse trial", () => {
    expect(trialClaimEnabled({})).toBe(false);
    expect(trialClaimEnabled(on)).toBe(true);
    expect(trialClaimEnabled({ ...on, TRIAL_CLAIM_ENABLED: "1" })).toBe(false);
    expect(trialClaimEnabled({ ...on, REVERSE_TRIAL_ENABLED: "false" })).toBe(false);
    expect(trialClaimEnabled({ ...on, REVERSE_TRIAL_SINCE: "" })).toBe(false);
  });
});

describe("copy and return path", () => {
  it("states exactly the enforced conditions, in Sie, without dashes", () => {
    const de = claimCopy("de");
    expect(de.offer).toBe("Möchten Sie alles {days} Tage lang testen? Dafür brauchen Sie keine Karte und kein Abo, es gilt einmal pro Person. Danach üben Sie mit der kostenlosen Probe weiter.");
    expect(claimCopy("en").offer).toBe("Would you like to try everything for {days} days? You need no card and no subscription, and it applies once per person. Afterwards you keep practising with the free sample.");
    const all = JSON.stringify([claimCopy("de"), claimCopy("en")]);
    expect(all).not.toMatch(/[–—]/);
    expect(JSON.stringify(de)).not.toMatch(/\b(du|dein|dich|dir)\b/i);
    expect(claimCopy("ru")).toBe(claimCopy("en"));
    expect(claimReasonLine(de, "changed")).toBe(de.reasons.retry);
    expect(claimReasonLine(de, "new_account")).toBe(de.reasons.other);
  });
  it("sign-in returns to the claim page with its token", () => {
    expect(safeNext("/trial/claim?t=tc1.abc.def")).toBe("/trial/claim?t=tc1.abc.def");
  });
});
