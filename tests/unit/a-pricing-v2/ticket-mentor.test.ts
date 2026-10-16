import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { createWallet } from "@/lib/mentor/credits/wallet";
import { resetPackageCache } from "@/lib/mentor/credits/packages";
import { TICKET_HOUSE_GRANT_TIERS, houseGrantsAllowed, ticketOnlyHouseGrants } from "@/lib/mentor/access";

// Review P2 #1: selling the Guarantee Ticket must not turn on included Mentor
// credits for other paid plans. A scope-admitted account gets only the ticket
// rows' included grant while house grants stay allowlist-only.
const U = "55555555-5555-4555-8555-555555555555";
const DAY = 86_400_000;
const PKG = [
  { package_id: "included_pro_monthly", kind: "included", grant_micro: 250000, period_days: 30, expiry_days: 30, price_eur_cents: null, active: true, provisional: false, sort: 40, note: null },
  { package_id: "included_cohort", kind: "included", grant_micro: 2000000, period_days: 30, expiry_days: 30, price_eur_cents: null, active: true, provisional: false, sort: 41, note: null },
  { package_id: "trial_taste", kind: "trial", grant_micro: 100000, period_days: null, expiry_days: 7, price_eur_cents: null, active: true, provisional: true, sort: 50, note: null },
  { package_id: "gift_admin", kind: "gift", grant_micro: 100000, period_days: 30, expiry_days: 30, price_eur_cents: null, active: true, provisional: false, sort: 60, note: null },
];
const sub = (id: string, tier: string) => ({ id, tier, status: "active", payment_provider: "whop", amount_cents: 1000, started_at: new Date(Date.now() - 2 * DAY).toISOString(), expires_at: new Date(Date.now() + 200 * DAY).toISOString() });
const handler = (subs: unknown[]) => (c: FakeCall): FakeResult | undefined => {
  if (c.table === "users") return { data: { id: U, role: "user", tier: "pro", tier_expires_at: new Date(Date.now() + 200 * DAY).toISOString() } };
  if (c.table === "subscriptions") return { data: subs };
  if (c.table === "referrals") return { data: [] };
  if (c.table === "ai_credit_package") return { data: PKG };
  if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "l", granted_micro: 1 } };
  return {};
};
const grants = (calls: FakeCall[]) => calls.filter((c) => c.table === "rpc:mentor_grant_credits").map((c) => (c.payload as { p_package: string }).p_package);

beforeEach(() => resetPackageCache());

describe("ticket-only house grants", () => {
  it("applies to scope-admitted accounts only while house grants are allowlist-only", () => {
    const raise = { MENTOR_INCLUDED_RAISE_ENABLED: "true" };
    expect(ticketOnlyHouseGrants(undefined, "scope", raise)).toBe(true);
    // Off with the raise off: no extra read for any scope-admitted account.
    expect(ticketOnlyHouseGrants(undefined, "scope", {})).toBe(false);
    expect(ticketOnlyHouseGrants("signed_in", "scope", raise)).toBe(false);
    expect(ticketOnlyHouseGrants(undefined, "allowlist", raise)).toBe(false);
    expect(ticketOnlyHouseGrants(undefined, null, raise)).toBe(false);
    expect(houseGrantsAllowed(undefined, "scope")).toBe(false);
  });
  it("a ticket holder gets the Cohort-level slice of the ticket row", async () => {
    const { sb, calls } = createFakeSupabase(handler([sub("t1", "guarantee_ticket"), sub("m1", "first_month_19")]));
    await createWallet(sb as never, { freeEnabled: true }).ensureIncludedGrants(U, new Date(), { onlyTiers: TICKET_HOUSE_GRANT_TIERS });
    expect(grants(calls)).toEqual(["included_cohort"]);
  });
  it("a reverse trialist gets the bounded trial taste only", async () => {
    const { sb, calls } = createFakeSupabase(handler([{ ...sub("r1", "reverse_trial"), payment_provider: "trial", amount_cents: 0 }]));
    await createWallet(sb as never, { freeEnabled: true }).ensureIncludedGrants(U, new Date(), { onlyTiers: TICKET_HOUSE_GRANT_TIERS });
    expect(grants(calls)).toEqual(["trial_taste"]);
  });
  it("any other paid plan, the card trial or Pro by users.tier alone gets nothing", async () => {
    for (const subs of [[sub("m1", "first_month_19")], [sub("f1", "flex_month")], [{ ...sub("c1", "notes_pro_trial"), amount_cents: 0 }], []]) {
      resetPackageCache();
      const { sb, calls } = createFakeSupabase(handler(subs));
      await createWallet(sb as never, { freeEnabled: true }).ensureIncludedGrants(U, new Date(), { onlyTiers: TICKET_HOUSE_GRANT_TIERS });
      expect(grants(calls)).toEqual([]);
    }
  });
});
